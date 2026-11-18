// 1.0 readiness review (docs/audit/2026-11-1.0-readiness.md), work package R4 — through the IPC
// handlers (electron mocked; a scratch TOTAL_DATA_DIR):
//  - SEC2-6 (decision Q6): the screen lock of a business whose passphrase lock is on is STORED
//    outside the books; until its passphrase is typed, every open asks for it — a key remembered
//    on this computer included — past a switch of business and a restart;
//  - SEC-13 (decision Q7): an owner's new PIN has at least 6 digits; old PINs keep working;
//  - SEC3-2: a refused encrypted-backup import leaves no decrypted books in the temp folder.
import { TRUSTED_EVENT } from './ipcSender.testutil'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

type Result = { ok: boolean; data?: unknown; error?: string; code?: string; field?: string; params?: Record<string, unknown> }
const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<Result>>()
const io = vi.hoisted(() => ({ pick: [] as string[] }))

vi.mock('electron', () => ({
  app: { getVersion: () => '0.12.0-test', getPath: () => tmpdir(), isPackaged: false, on: () => {} },
  ipcMain: { handle: (ch: string, fn: (e: unknown, p: unknown) => Promise<Result>) => handlers.set(ch.replace(/^total:/, ''), fn) },
  dialog: {
    showOpenDialog: async () => {
      const filePaths = io.pick
      io.pick = []
      return { canceled: filePaths.length === 0, filePaths }
    },
    showSaveDialog: async () => ({ canceled: true })
  },
  shell: { openPath: async () => '', showItemInFolder: () => {}, openExternal: async () => {} },
  Notification: class {},
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('./updater', () => ({ checkForUpdatesInteractive: async () => null }))

const DATA_DIR = mkdtempSync(join(tmpdir(), 'total-security-readiness-'))
process.env.TOTAL_DATA_DIR = DATA_DIR
process.env.TOTAL_SUPPRESS_SYNC_WARNING = '1'
process.env.TOTAL_INSECURE_TEST_SECRETS = '1'

async function call(channel: string, payload?: unknown): Promise<Result> {
  const h = handlers.get(channel)
  if (!h) throw new Error(`no handler ${channel}`)
  return h(TRUSTED_EVENT, payload)
}
async function ok<T>(channel: string, payload?: unknown): Promise<T> {
  const r = await call(channel, payload)
  if (!r.ok) throw new Error(`${channel}: ${r.error} (${r.code ?? ''})`)
  return r.data as T
}
const company = (name: string): Record<string, unknown> => ({
  name, stateCode: '27', gstin: null, gstRegistrationType: 'regular', address: '', booksFrom: 2026, email: null, phone: null, pan: null, tan: null
})
const dbFile = (slug: string): string => join(DATA_DIR, 'companies', slug, 'company.db')
const LOCK_FILE = join(DATA_DIR, 'screen-locks.json')
const storedLocks = (): Record<string, { reason: string }> => (existsSync(LOCK_FILE) ? JSON.parse(readFileSync(LOCK_FILE, 'utf8')) : {})
/** Whether the lock file holds `slug` (a damaged file holds every business). */
const isLockedOnDisk = (slug: string): boolean => {
  try {
    return slug in storedLocks()
  } catch {
    return true
  }
}

let ipc: typeof import('./ipc')
let encryption: typeof import('./db/encryption')
let crypt: typeof import('./db/crypt')
let authcrypt: typeof import('./services/authcrypt')

beforeAll(async () => {
  ipc = await import('./ipc')
  encryption = await import('./db/encryption')
  crypt = await import('./db/crypt')
  authcrypt = await import('./services/authcrypt')
  ipc.registerIpc()
}, 120_000)

afterAll(() => {
  ipc.closeCurrentCompany()
  rmSync(DATA_DIR, { recursive: true, force: true })
})

/** The `user` audit rows (logout / login) of a closed business, read with its passphrase. */
async function userAuditRows(slug: string, passphrase: string): Promise<{ action: string; after: Record<string, unknown> }[]> {
  await ok('company:open', { slug, passphrase })
  const rows = (await ok<{ rows: { action: string; afterJson: string | null }[] }>('audit:list', { entity: 'user' })).rows
  return rows.map((r) => ({ action: r.action, after: (r.afterJson ? JSON.parse(r.afterJson) : {}) as Record<string, unknown> }))
}

describe('SEC2-6: a stored screen lock asks for the passphrase on every open until it is typed', () => {
  const PASS = 'monsoon ledger 77'
  let slug: string

  it('a remembered business opens without the passphrase while its screen was never locked', async () => {
    slug = (await ok<{ slug: string }>('company:create', company('Screen Lock Co'))).slug
    await ok('company:open', { slug })
    await ok('security:passphrase:on', { passphrase: PASS, confirm: PASS })
    await ok('company:close')
    expect((await ok<{ remember?: string }>('company:open', { slug, passphrase: PASS, remember: true })).remember).toBe('saved')
    await ok('company:close')
    expect(await ok<{ openedWith?: string; locked: boolean }>('company:open', { slug })).toMatchObject({ openedWith: 'remembered', locked: false })
    expect(storedLocks()).toEqual({})
  })

  it('after ⌘L, switching business and back asks for the passphrase — the remembered key does not open it', async () => {
    await ok('session:lock')
    expect(storedLocks()).toMatchObject({ [slug]: { reason: 'manual', rememberHeld: true } })
    // The lock takes the remembered key away: that, not the file, is what keeps the books shut.
    expect(await ok<string[]>('company:remembered')).not.toContain(slug)
    await ok('company:close')
    const refused = await call('company:open', { slug })
    expect(refused).toMatchObject({ ok: false, code: 'screen_locked_passphrase', field: 'passphrase' })
    // Nothing was opened by the refusal.
    expect((await ok<unknown>('company:current'))).toBeNull()
    // A wrong passphrase is refused and the lock stays.
    expect((await call('company:open', { slug, passphrase: 'not the one' })).code).toBe('wrong_passphrase')
    expect(storedLocks()).toHaveProperty(slug)
  })

  it('the same after a restart: the lock is read back from the disk, and the key is not in memory', async () => {
    ipc.closeCurrentCompany()
    expect(encryption.keyForPath(dbFile(slug))).toBeNull()
    expect(JSON.parse(readFileSync(LOCK_FILE, 'utf8'))).toHaveProperty(slug)
    expect((await call('company:open', { slug })).code).toBe('screen_locked_passphrase')
  })

  it('the passphrase opens it and clears the stored lock (audited in the books); the remembered key works again after', async () => {
    expect(await ok<{ openedWith?: string; locked: boolean }>('company:open', { slug, passphrase: PASS })).toMatchObject({ openedWith: 'passphrase', locked: false })
    expect(storedLocks()).toEqual({})
    expect(await ok<string[]>('company:remembered')).toContain(slug)
    await ok('company:close')
    expect(await ok<{ openedWith?: string }>('company:open', { slug })).toMatchObject({ openedWith: 'remembered' })
    await ok('company:close')
    const rows = await userAuditRows(slug, PASS)
    expect(rows.find((r) => r.action === 'logout' && r.after.lock === 'manual')?.after).toMatchObject({ noUsers: true, stored: true, rememberHeld: true })
    expect(rows.find((r) => r.action === 'login' && r.after.lock === 'stored')?.after).toMatchObject({ passphrase: true })
    const security = (await ok<{ rows: { afterJson: string | null }[] }>('audit:list', { entity: 'security' })).rows.map((r) => JSON.parse(r.afterJson ?? '{}') as Record<string, unknown>)
    // Newest first: remembered again after the passphrase, held by the lock before it.
    expect(security.slice(0, 2)).toEqual([{ rememberedOnThisComputer: true }, { rememberedOnThisComputer: false, heldByScreenLock: true }])
    await ok('company:close')
  })

  it('deleting the lock file does not open the books: the remembered key went with the lock (review of #291)', async () => {
    await ok('company:open', { slug })
    await ok('session:lock')
    await ok('company:close')
    rmSync(LOCK_FILE)
    // The plain prompt (the note's reason is gone with the file) — never the remembered key.
    expect((await call('company:open', { slug })).code).toBe('passphrase_required')
    expect(await ok<{ openedWith?: string }>('company:open', { slug, passphrase: PASS })).toMatchObject({ openedWith: 'passphrase' })
    // Nothing says a key was held, so none comes back: "Remember on this computer" is ticked again.
    expect(await ok<string[]>('company:remembered')).not.toContain(slug)
    await ok('company:close')
    expect(await ok<{ remember?: string }>('company:open', { slug, passphrase: PASS, remember: true })).toMatchObject({ remember: 'saved' })
  })

  it('an emptied lock file fails closed: the passphrase is asked', async () => {
    await ok('session:lock')
    await ok('company:close')
    writeFileSync(LOCK_FILE, '')
    expect((await call('company:open', { slug })).code).toBe('screen_locked_passphrase')
    await ok('company:open', { slug, passphrase: PASS })
    expect(isLockedOnDisk(slug)).toBe(false)
    await ok('company:close')
    await ok('company:open', { slug, passphrase: PASS, remember: true })
  })

  it('unlocking the screen with the passphrase while the business stays open clears the stored lock too, and remembers the key again', async () => {
    await ok('session:lock')
    expect(storedLocks()).toHaveProperty(slug)
    expect(await ok<string[]>('company:remembered')).not.toContain(slug)
    expect((await call('session:unlock', {})).code).toBe('passphrase_required')
    await ok('session:unlock', { passphrase: PASS })
    expect(storedLocks()).toEqual({})
    expect(await ok<string[]>('company:remembered')).toContain(slug)
    await ok('company:close')
    expect(await ok<{ openedWith?: string }>('company:open', { slug })).toMatchObject({ openedWith: 'remembered' })
  })

  it('deleting the business drops its stored lock', async () => {
    await ok('session:lock')
    await ok('company:close')
    expect(storedLocks()).toHaveProperty(slug)
    await ok('company:delete', { slug, confirmName: 'Screen Lock Co', passphrase: PASS })
    expect(storedLocks()).not.toHaveProperty(slug)
  })

  it('a business without the passphrase lock keeps the privacy screen in memory only: nothing stored, the next open is open', async () => {
    const plain = (await ok<{ slug: string }>('company:create', company('Plain Screen Co'))).slug
    await ok('company:open', { slug: plain })
    await ok('session:lock')
    expect((await call('security:get')).code).toBe('session_locked')
    expect(storedLocks()).not.toHaveProperty(plain)
    await ok('company:close')
    expect(await ok<{ locked: boolean }>('company:open', { slug: plain })).toMatchObject({ locked: false })
    await ok('company:close')
  })
})

describe('SEC-13: an owner’s new PIN needs 6 digits; old PINs keep working', () => {
  let slug: string
  const users = async (): Promise<{ id: number; name: string; role: string }[]> => ok('users:list')

  it('the first person (always an owner) is refused a 4- or 5-digit PIN and gets in with 6; nothing is saved by a refusal', async () => {
    slug = (await ok<{ slug: string }>('company:create', company('Pin Length Co'))).slug
    await ok('company:open', { slug })
    for (const pin of ['1234', '12345']) {
      expect(await call('users:save', { data: { name: 'Owner', role: 'accountant', pin } })).toMatchObject({
        ok: false, code: 'owner_pin_short', field: 'pin', params: { min: 6 }
      })
    }
    expect(await users()).toEqual([])
    await ok('users:save', { data: { name: 'Owner', role: 'owner', pin: '123456' } })
  })

  it('accountants and viewers keep 4 digits; making one an owner asks for a new 6-digit PIN and changes nothing until then', async () => {
    const acct = await ok<{ id: number }>('users:save', { data: { name: 'Asha', role: 'accountant', pin: '2222' } })
    await ok('users:save', { data: { name: 'Vik', role: 'viewer', pin: '3333' } })
    expect(await call('users:save', { id: acct.id, data: { name: 'Asha', role: 'owner', capabilities: { canExport: false } } })).toMatchObject({ ok: false, code: 'owner_pin_needed', field: 'pin' })
    expect(await call('users:save', { id: acct.id, data: { name: 'Asha', role: 'owner', pin: '4444' } })).toMatchObject({ ok: false, code: 'owner_pin_short' })
    expect((await users()).find((u) => u.id === acct.id)).toMatchObject({ role: 'accountant', capabilities: null })
    await ok('users:save', { id: acct.id, data: { name: 'Asha', role: 'owner', pin: '444444' } })
    expect((await users()).find((u) => u.id === acct.id)).toMatchObject({ role: 'owner' })
    // An owner renamed without a new PIN keeps theirs.
    await ok('users:save', { id: acct.id, data: { name: 'Asha K', role: 'owner' } })
    await ok('auth:logout')
    await ok('auth:login', { userId: acct.id, pin: '444444' })
  })

  it('an owner whose 4-digit PIN was set before keeps signing in with it, and keeps it when renamed', async () => {
    await ok('company:close')
    const db = encryption.openDb(dbFile(slug), { fileMustExist: true })
    const oldId = Number(db.prepare("INSERT INTO users (name, pin_hash, role, active) VALUES ('Old Owner', ?, 'owner', 1)").run(authcrypt.hashPin('9876')).lastInsertRowid)
    db.close()
    await ok('company:open', { slug })
    await ok('auth:login', { userId: oldId, pin: '9876' })
    await ok('users:save', { id: oldId, data: { name: 'Old Owner (2019)', role: 'owner' } })
    await ok('auth:logout')
    await ok('auth:login', { userId: oldId, pin: '9876' })
    // Deleting the business still takes the old PIN.
    await ok('company:close')
    await ok('company:delete', { slug, confirmName: 'Pin Length Co', pin: '9876' })
  })
})

describe('SEC3-2: a refused encrypted-backup import leaves no decrypted books behind', () => {
  const PASS = 'export pass 2026'
  const TMP = mkdtempSync(join(tmpdir(), 'total-import-tmp-'))
  const saved = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP }
  const leftovers = (): string[] => readdirSync(TMP).filter((n) => n.startsWith('total-import-'))
  const importing = async (file: string): Promise<Result> => {
    // os.tmpdir() reads these on every call: the handler's temp folder lands in TMP.
    process.env.TMPDIR = TMP
    process.env.TMP = TMP
    process.env.TEMP = TMP
    try {
      io.pick = [file]
      return await call('backup:importEncrypted', { passphrase: PASS })
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  }
  afterEach(() => {
    for (const n of leftovers()) rmSync(join(TMP, n), { recursive: true, force: true })
  })
  afterAll(() => rmSync(TMP, { recursive: true, force: true }))

  let source: string
  const work = mkdtempSync(join(tmpdir(), 'total-import-src-'))
  afterAll(() => rmSync(work, { recursive: true, force: true }))

  it('a backup from a newer Total is refused and its decrypted copy is gone', async () => {
    source = (await ok<{ slug: string }>('company:create', company('Import Source Co'))).slug
    ipc.closeCurrentCompany()
    const newer = join(work, 'newer.db')
    copyFileSync(dbFile(source), newer)
    const db = encryption.openDb(newer, { fileMustExist: true })
    const max = (db.prepare('SELECT MAX(id) AS n FROM migrations').get() as { n: number }).n
    db.prepare('INSERT INTO migrations (id, applied_at) VALUES (?, ?)').run(max + 1, new Date().toISOString())
    db.close()
    const file = join(work, 'newer.totalbak')
    await crypt.encryptFile(newer, file, PASS, { logN: 14, r: 8, p: 1 })
    expect(await importing(file)).toMatchObject({ ok: false, code: 'db_newer_version' })
    expect(leftovers()).toEqual([])
  })

  it('a wrong passphrase and a file that is not books are refused with nothing left behind', async () => {
    const good = join(work, 'good.totalbak')
    await crypt.encryptFile(dbFile(source), good, 'another passphrase', { logN: 14, r: 8, p: 1 })
    expect(await importing(good)).toMatchObject({ ok: false, error: 'Wrong passphrase or corrupted file' })
    expect(leftovers()).toEqual([])
    const notBooks = join(work, 'not-books.bin')
    writeFileSync(notBooks, Buffer.alloc(8192, 7))
    const junk = join(work, 'junk.totalbak')
    await crypt.encryptFile(notBooks, junk, PASS, { logN: 14, r: 8, p: 1 })
    expect(await importing(junk)).toMatchObject({ ok: false, error: "This file doesn't look like a Total company backup" })
    expect(leftovers()).toEqual([])
  })

  it('a good backup imports as a new business and its temp folder goes too', async () => {
    const file = join(work, 'ok.totalbak')
    await crypt.encryptFile(dbFile(source), file, PASS, { logN: 14, r: 8, p: 1 })
    const r = await importing(file)
    expect(r.ok).toBe(true)
    expect(existsSync(dbFile((r.data as { slug: string }).slug))).toBe(true)
    expect(leftovers()).toEqual([])
  })
})
