import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, utimesSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, basename as nodeBasename } from 'path'
import { migrate } from './migrate'
import { seedCompany } from './seed'
import { TEST_INFO, postSimpleVoucher, testFileDb } from './testdb'
import {
  snapshotTo, listBackupsIn, pruneBackupsIn, tagOf, backupStamp, restoreCompanyDb, rollbackRestore, pinnedFileCopy, cloneFile
} from './backup'
import { isEncryptedFile, keyOfHandle, openDb, rekeyFile } from './encryption'
import { runningFileReaders, stopAllChecks, stopChecks, stopChecksUnder } from './checkHost'
import { newDataKey } from './keyEnvelope'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'total-backup-'))
}

describe('snapshotTo', () => {
  it('captures uncheckpointed WAL content that a raw file copy would miss', async () => {
    const dir = tmpDir()
    const dbPath = join(dir, 'company.db')
    const db = testFileDb(dbPath)
    db.pragma('journal_mode = WAL')
    migrate(db)
    seedCompany(db, TEST_INFO)

    // Post several vouchers WITHOUT checkpointing — this content lives only in the -wal file.
    for (let i = 0; i < 5; i++) {
      postSimpleVoucher(db, { date: '2025-04-10', amount: 10000 * (i + 1), kind: 'receipt' })
    }
    const liveCount = (db.prepare('SELECT COUNT(*) AS n FROM vouchers').get() as { n: number }).n
    expect(liveCount).toBe(5)

    // A raw copyFileSync of the main file (no checkpoint) does NOT see the WAL-only content —
    // with nothing checkpointed yet, the copy doesn't even have the schema, so it's unusable.
    const rawCopyPath = join(dir, 'raw-copy.db')
    copyFileSync(dbPath, rawCopyPath)
    const rawDb = new Database(rawCopyPath, { readonly: true })
    expect(() => rawDb.prepare('SELECT COUNT(*) AS n FROM vouchers').get()).toThrow()
    rawDb.close()

    // snapshotTo (native online backup) DOES capture it.
    const snapPath = join(dir, 'snapshot.db')
    await snapshotTo(db, snapPath)

    const snapDb = new Database(snapPath, { readonly: true })
    const check = snapDb.pragma('quick_check') as Array<{ quick_check: string }>
    expect(check[0]?.quick_check).toBe('ok')
    const snapCount = (snapDb.prepare('SELECT COUNT(*) AS n FROM vouchers').get() as { n: number }).n
    snapDb.close()
    expect(snapCount).toBe(liveCount)

    db.close()
  })
})

// Phase 5 speed: the snapshot is a copy of the FILE taken under a pinned read (an APFS clone on
// macOS). It must hold exactly the books as of the call — never a write made while it copies.
describe('pinnedFileCopy (the snapshot as a pinned file copy)', () => {
  const walCompany = (): { dir: string; dbPath: string; db: ReturnType<typeof testFileDb> } => {
    const dir = tmpDir()
    const dbPath = join(dir, 'company.db')
    const db = testFileDb(dbPath)
    db.pragma('journal_mode = WAL')
    migrate(db)
    seedCompany(db, TEST_INFO)
    return { dir, dbPath, db }
  }
  const count = (path: string, key?: Buffer): number => {
    const r = key ? openDb(path, { readonly: true, key }) : new Database(path, { readonly: true })
    try {
      expect((r.pragma('quick_check') as Array<{ quick_check: string }>)[0]?.quick_check).toBe('ok')
      return (r.prepare('SELECT COUNT(*) AS n FROM vouchers').get() as { n: number }).n
    } finally {
      r.close()
    }
  }

  it('copies the books as of the call: WAL-only entries in, entries saved while it copies out', async () => {
    const { dir, db } = walCompany()
    for (let i = 0; i < 3; i++) postSimpleVoucher(db, { date: '2025-04-10', amount: 10000 * (i + 1), kind: 'receipt' })
    const dest = join(dir, 'snap.db')
    const copying = pinnedFileCopy(db, dest)
    // The checkpoint and the pin ran synchronously; these saves land while the copy is under way
    // (the WAL can't be checkpointed into the file past the pin, even by a full checkpoint).
    for (let i = 0; i < 4; i++) postSimpleVoucher(db, { date: '2025-04-11', amount: 500 * (i + 1), kind: 'payment' })
    db.pragma('wal_checkpoint(PASSIVE)')
    expect(await copying).toBe(true)
    expect(count(dest)).toBe(3)
    expect(existsSync(`${dest}.copy-tmp`)).toBe(false)
    // The pin is gone: the live file checkpoints in full again, and the books hold all 7.
    const [cp] = db.pragma('wal_checkpoint(PASSIVE)') as Array<{ log: number; checkpointed: number }>
    expect(cp?.log).toBe(cp?.checkpointed)
    expect((db.prepare('SELECT COUNT(*) AS n FROM vouchers').get() as { n: number }).n).toBe(7)
    db.close()
  })

  it('the pin is a tracked reader of the live file: stopChecks waits for the copy, after which a full checkpoint and close leave no WAL behind (review of #253)', async () => {
    const { dir, dbPath, db } = walCompany()
    db.pragma('busy_timeout = 5000') // as openCompanyDb sets it
    postSimpleVoucher(db, { date: '2025-04-10', amount: 10000, kind: 'receipt' })
    const dest = join(dir, 'snap.db')
    const copying = pinnedFileCopy(db, dest)
    expect(runningFileReaders(dbPath)).toBe(1)
    // A save while the copy runs (it goes into the WAL), then what restore / the lock change do:
    postSimpleVoucher(db, { date: '2025-04-11', amount: 20000, kind: 'receipt' })
    await stopChecks(dbPath)
    expect(runningFileReaders(dbPath)).toBe(0)
    expect(await copying).toBe(true)
    const t0 = performance.now()
    const [cp] = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number; log: number; checkpointed: number }>
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(cp).toEqual({ busy: 0, log: 0, checkpointed: 0 })
    db.close()
    expect(existsSync(`${dbPath}-wal`) ? readFileSync(`${dbPath}-wal`).length : 0).toBe(0)
    expect(count(dest)).toBe(1)
  })

  it('stopChecksUnder (delete, a lock change) and stopAllChecks (a data-folder move) wait for a pinned copy too', async () => {
    for (const stop of [(d: string) => stopChecksUnder(d), () => stopAllChecks()]) {
      const { dir, dbPath, db } = walCompany()
      const copying = pinnedFileCopy(db, join(dir, 'snap.db'))
      expect(runningFileReaders(dbPath)).toBe(1)
      await stop(dir)
      expect(runningFileReaders(dbPath)).toBe(0)
      expect(await copying).toBe(true)
      db.close()
    }
  })

  it('the backup copy is stamped now, not with the books file’s modified time (a clone keeps the source’s)', async () => {
    const { dir, dbPath, db } = walCompany()
    db.pragma('wal_checkpoint(TRUNCATE)')
    const old = new Date(Date.now() - 10 * 86_400_000)
    utimesSync(dbPath, old, old)
    const dest = join(dir, 'snap.db')
    expect(await pinnedFileCopy(db, dest)).toBe(true)
    expect(Date.now() - listBackupsIn(dir).find((b) => b.file === 'snap.db')!.mtime).toBeLessThan(60_000)
    db.close()
  })

  it('a second snapshot in the same second replaces the first, as the online backup does', async () => {
    const { dir, db } = walCompany()
    const dest = join(dir, 'snap.db')
    postSimpleVoucher(db, { date: '2025-04-10', amount: 10000, kind: 'receipt' })
    await snapshotTo(db, dest)
    postSimpleVoucher(db, { date: '2025-04-10', amount: 20000, kind: 'receipt' })
    await snapshotTo(db, dest)
    expect(count(dest)).toBe(2)
    db.close()
  })

  it('declines (nothing written) while a reader on an older snapshot keeps the checkpoint from finishing; snapshotTo then takes the online backup', async () => {
    const { dir, dbPath, db } = walCompany()
    postSimpleVoucher(db, { date: '2025-04-10', amount: 10000, kind: 'receipt' })
    db.pragma('wal_checkpoint(TRUNCATE)')
    const reader = new Database(dbPath, { readonly: true })
    reader.exec('BEGIN')
    reader.prepare('SELECT COUNT(*) FROM vouchers').get()
    postSimpleVoucher(db, { date: '2025-04-11', amount: 20000, kind: 'receipt' })
    const dest = join(dir, 'snap.db')
    expect(await pinnedFileCopy(db, dest)).toBe(false)
    expect(existsSync(dest)).toBe(false)
    await snapshotTo(db, dest)
    expect(count(dest)).toBe(2)
    reader.exec('ROLLBACK')
    reader.close()
    db.close()
  })

  it('cloneFile: an exact copy on macOS (false elsewhere, and when it cannot clone — nothing left behind)', async () => {
    const dir = tmpDir()
    const src = join(dir, 'a.bin')
    writeFileSync(src, Buffer.from('total clone test'))
    const ok = await cloneFile(src, join(dir, 'b.bin'))
    expect(ok).toBe(process.platform === 'darwin')
    if (ok) expect(readFileSync(join(dir, 'b.bin')).toString()).toBe('total clone test')
    expect(await cloneFile(src, join(dir, 'missing-folder', 'c.bin'))).toBe(false)
    expect(existsSync(join(dir, 'missing-folder', 'c.bin'))).toBe(false)
  })

  it('declines a database that is not in WAL mode', async () => {
    const dir = tmpDir()
    const db = testFileDb(join(dir, 'company.db'))
    migrate(db)
    expect(await pinnedFileCopy(db, join(dir, 'snap.db'))).toBe(false)
    db.close()
  })

  it('an encrypted business: the copy is encrypted with the same key and reads back whole', async () => {
    const dir = tmpDir()
    const dbPath = join(dir, 'company.db')
    const seed = testFileDb(dbPath)
    migrate(seed)
    seedCompany(seed, TEST_INFO)
    seed.close()
    const key = newDataKey()
    rekeyFile(dbPath, null, key)
    const db = openDb(dbPath, { key })
    db.pragma('journal_mode = WAL')
    expect(keyOfHandle(db)?.equals(key)).toBe(true)
    postSimpleVoucher(db, { date: '2025-04-10', amount: 10000, kind: 'receipt' })
    const dest = join(dir, 'snap.db')
    expect(await pinnedFileCopy(db, dest)).toBe(true)
    expect(isEncryptedFile(dest)).toBe(true)
    expect(count(dest, key)).toBe(1)
    db.close()
  })
})

describe('listBackupsIn / tagOf / backupStamp', () => {
  it('lists *.db files newest-first with tags parsed from the filename', () => {
    const dir = tmpDir()
    const older = join(dir, `${backupStamp(new Date(2025, 0, 1))}-auto.db`)
    const newer = join(dir, `${backupStamp(new Date(2025, 0, 2))}-manual.db`)
    writeFileSync(older, 'x')
    writeFileSync(newer, 'yy')
    // Pin mtimes explicitly — filesystem timestamp resolution can otherwise tie files written
    // in the same tick, making the newest-first sort flaky.
    utimesSync(older, new Date(2025, 0, 1), new Date(2025, 0, 1))
    utimesSync(newer, new Date(2025, 0, 2), new Date(2025, 0, 2))

    const list = listBackupsIn(dir)
    expect(list.map((b) => b.file)).toEqual([basename(newer), basename(older)])
    expect(list[0]?.tag).toBe('manual')
    expect(list[1]?.tag).toBe('auto')
    expect(tagOf('2025-01-01T00-00-00-pre-tally-import.db')).toBe('pre-tally-import')
  })

  it('gate polish: the stamp is LOCAL time in the fixed-width sortable ISO shape (1 am stays that day)', () => {
    const at = new Date(2026, 9, 15, 1, 5, 9)
    expect(backupStamp(at)).toBe('2026-10-15T01-05-09')
    const now = new Date()
    const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(backupStamp(now).slice(0, 10)).toBe(local)
    expect(backupStamp(at)).toHaveLength(19)
    expect(tagOf(`${backupStamp(at)}-manual.db`)).toBe('manual')
    expect(backupStamp(new Date(2026, 11, 31, 23, 59, 59)) > backupStamp(new Date(2026, 11, 31, 23, 59, 58))).toBe(true)
  })

  it('old UTC-named backups beside local-time ones: the list orders by mtime and reads every tag; pruning keeps the newest', () => {
    // Nothing reads a date back out of a backup's name — BackupInfo.mtime is the file's own time —
    // so a file named by the old UTC stamp (01:05 IST was "…T19-35-09" the day before) sorts by
    // when it was written, not by its name.
    const dir = tmpDir()
    const files = [
      { name: '2026-10-14T19-35-09-open.db', at: new Date(2026, 9, 15, 1, 5, 9) }, // old UTC name
      { name: `${backupStamp(new Date(2026, 9, 15, 0, 30, 0))}-auto.db`, at: new Date(2026, 9, 15, 0, 30, 0) }, // local, earlier
      { name: `${backupStamp(new Date(2026, 9, 15, 9, 0, 0))}-manual.db`, at: new Date(2026, 9, 15, 9, 0, 0) }
    ]
    for (const f of files) {
      const p = join(dir, f.name)
      writeFileSync(p, 'x')
      utimesSync(p, f.at, f.at)
    }
    const list = listBackupsIn(dir)
    // The UTC name sorts BEFORE the local 00:30 name as text, yet it is the newer file.
    expect(files[0]!.name < files[1]!.name).toBe(true)
    expect(list.map((b) => b.file)).toEqual([files[2]!.name, files[0]!.name, files[1]!.name])
    expect(list.map((b) => b.tag)).toEqual(['manual', 'open', 'auto'])
    expect(list[1]!.mtime).toBe(files[0]!.at.getTime())
    pruneBackupsIn(dir, 2)
    expect(listBackupsIn(dir).map((b) => b.file)).toEqual([files[2]!.name, files[0]!.name])
  })
})

function basename(p: string): string {
  // Node's path.basename splits on the platform separator — a hand-rolled '/' split
  // returns the full path on Windows and broke this suite on the CI runner.
  return nodeBasename(p)
}

describe('pruneBackupsIn', () => {
  it('prunes only auto/open tags beyond `keep`, never manual or other protected tags', () => {
    const dir = tmpDir()
    // Oldest to newest by array order; pin mtimes explicitly so the prune order is deterministic
    // regardless of filesystem timestamp resolution.
    const files = [
      '2025-01-01T00-00-00-auto.db',
      '2025-01-01T01-00-00-manual.db',
      '2025-01-01T02-00-00-auto.db',
      '2025-01-01T03-00-00-open.db',
      '2025-01-01T04-00-00-pre-restore.db',
      '2025-01-01T05-00-00-auto.db'
    ]
    files.forEach((f, i) => {
      writeFileSync(join(dir, f), 'x')
      const t = new Date(2025, 0, 1, i)
      utimesSync(join(dir, f), t, t)
    })

    // keep = 1 → only the single newest file (auto, 05) survives untouched; of the rest, the
    // auto/open ones get pruned, manual + pre-restore never do.
    pruneBackupsIn(dir, 1)

    const remaining = new Set(listBackupsIn(dir).map((b) => b.file))
    expect(remaining.has('2025-01-01T05-00-00-auto.db')).toBe(true) // newest, kept regardless
    expect(remaining.has('2025-01-01T01-00-00-manual.db')).toBe(true) // never pruned
    expect(remaining.has('2025-01-01T04-00-00-pre-restore.db')).toBe(true) // never pruned
    expect(remaining.has('2025-01-01T00-00-00-auto.db')).toBe(false) // pruned
    expect(remaining.has('2025-01-01T02-00-00-auto.db')).toBe(false) // pruned
    expect(remaining.has('2025-01-01T03-00-00-open.db')).toBe(false) // pruned
  })
})

/** Build a standalone, valid Total company DB file at `path` with `voucherCount` vouchers. */
function makeCompanyDbFile(path: string, voucherCount: number): void {
  const db = testFileDb(path)
  migrate(db)
  seedCompany(db, TEST_INFO)
  for (let i = 0; i < voucherCount; i++) {
    postSimpleVoucher(db, { date: '2025-04-10', amount: 1000 * (i + 1), kind: 'receipt' })
  }
  db.close()
}

function voucherCountOf(path: string): number {
  const db = new Database(path, { readonly: true })
  const n = (db.prepare('SELECT COUNT(*) AS n FROM vouchers').get() as { n: number }).n
  db.close()
  return n
}

describe('restoreCompanyDb', () => {
  it('happy path: swaps the backup into place, and reopening dbPath afterwards has the restored data', () => {
    const dir = tmpDir()
    const dbPath = join(dir, 'company.db')
    const backupsDir = join(dir, 'backups')
    mkdirSync(backupsDir)

    // Live DB has 2 vouchers, posted without checkpointing (WAL-only content).
    const db = testFileDb(dbPath)
    db.pragma('journal_mode = WAL')
    migrate(db)
    seedCompany(db, TEST_INFO)
    postSimpleVoucher(db, { date: '2025-04-10', amount: 10000, kind: 'receipt' })
    postSimpleVoucher(db, { date: '2025-04-11', amount: 20000, kind: 'receipt' })

    // The chosen backup has different (5-voucher) content.
    const backupPath = join(dir, 'chosen-backup.db')
    makeCompanyDbFile(backupPath, 5)

    const { preRestoreSnapshotPath } = restoreCompanyDb(db, dbPath, backupPath, backupsDir)
    expect(db.open).toBe(false) // restore closes the handle itself (Windows rename locks)

    // The pre-restore safety snapshot captured the live DB's state (2 vouchers) before the swap.
    expect(existsSync(preRestoreSnapshotPath)).toBe(true)
    expect(voucherCountOf(preRestoreSnapshotPath)).toBe(2)

    // Reopening dbPath now sees the restored (backup's) data, not the live DB's original data.
    expect(voucherCountOf(dbPath)).toBe(5)

    // No stale WAL/SHM siblings left pointing at pre-swap content.
    expect(existsSync(`${dbPath}-wal`)).toBe(false)
    expect(existsSync(`${dbPath}-shm`)).toBe(false)
  })

  it('rejects a corrupted backup file BEFORE the live DB is touched', () => {
    const dir = tmpDir()
    const dbPath = join(dir, 'company.db')
    const backupsDir = join(dir, 'backups')
    mkdirSync(backupsDir)

    const db = testFileDb(dbPath)
    db.pragma('journal_mode = WAL')
    migrate(db)
    seedCompany(db, TEST_INFO)
    postSimpleVoucher(db, { date: '2025-04-10', amount: 10000, kind: 'receipt' })
    const liveBytesBefore = readFileSync(dbPath)

    const corruptBackupPath = join(dir, 'corrupt.db')
    writeFileSync(corruptBackupPath, 'this is not a sqlite database file at all')

    expect(() => restoreCompanyDb(db, dbPath, corruptBackupPath, backupsDir)).toThrow(
      'That file is not a valid Total backup'
    )

    // The live DB file on disk is byte-for-byte unchanged — validation happened first.
    expect(readFileSync(dbPath).equals(liveBytesBefore)).toBe(true)
    // Nothing was checkpointed/snapshotted either, since we bailed before that step.
    expect(listBackupsIn(backupsDir)).toHaveLength(0)
    // The live handle is still fully open and usable — it was never closed or touched.
    expect((db.prepare('SELECT COUNT(*) AS n FROM vouchers').get() as { n: number }).n).toBe(1)

    db.close()
  })

  it('also rejects a well-formed but unrelated SQLite file (no meta.company row)', () => {
    const dir = tmpDir()
    const dbPath = join(dir, 'company.db')
    const backupsDir = join(dir, 'backups')
    mkdirSync(backupsDir)

    const db = testFileDb(dbPath)
    migrate(db)
    seedCompany(db, TEST_INFO)

    const unrelatedPath = join(dir, 'unrelated.db')
    const unrelated = testFileDb(unrelatedPath)
    unrelated.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT)')
    unrelated.close()

    expect(() => restoreCompanyDb(db, dbPath, unrelatedPath, backupsDir)).toThrow(
      'That file is not a valid Total backup'
    )
    db.close()
  })
})

describe('rollbackRestore', () => {
  it('restores dbPath back to a previously-taken snapshot', () => {
    const dir = tmpDir()
    const dbPath = join(dir, 'company.db')
    const backupsDir = join(dir, 'backups')
    mkdirSync(backupsDir)

    const db = testFileDb(dbPath)
    db.pragma('journal_mode = WAL')
    migrate(db)
    seedCompany(db, TEST_INFO)
    postSimpleVoucher(db, { date: '2025-04-10', amount: 10000, kind: 'receipt' })

    const backupPath = join(dir, 'chosen-backup.db')
    makeCompanyDbFile(backupPath, 9)

    const { preRestoreSnapshotPath } = restoreCompanyDb(db, dbPath, backupPath, backupsDir)
    db.close()
    expect(voucherCountOf(dbPath)).toBe(9) // restored

    rollbackRestore(dbPath, preRestoreSnapshotPath)
    expect(voucherCountOf(dbPath)).toBe(1) // back to the pre-restore state
  })
})
