// Scheduled release — the upgrade test's worker. Bundled by run-snapshot.mjs against ONE source tree
// (`@main` / `@shared` = that tree's src/), so the same file runs as the LAST RELEASE (seed + dump)
// and as HEAD (open + migrate + check + dump). It calls only services that exist with the same
// signatures in both (createDemoCompany, perfSeed, readCompanyInfo, trialBalance, profitAndLoss,
// balanceSheet, outstandingsWithAdvances, stockSummary, gstr1, gstr3b, verifyAudit, verifyBackupFile).
// If a later refactor renames one, the bundle fails and the gate SKIPS with that error — it never
// passes on a check it could not make. Phase 6 runs it from older releases too (0.10.0, 0.11.0 —
// .github/workflows/upgrade-matrix.yml): run-snapshot.mjs hands a release that predates a module in
// its OPTIONAL list an empty stand-in, and the code below falls back — no clock shift (the run must
// then be on UPGRADE_TODAY itself), no Perf Traders (Demo Traders only), `outstandings` wrapped as
// `{ parties }` where `outstandingsWithAdvances` is missing (HEAD's extra fields are then "added",
// never differences). `check` (HEAD only) still needs the restore check.
//
//   seed  <dataDir>             create Demo Traders + Perf Traders (UPGRADE_VOUCHERS vouchers) — old tree only
//   dump  <dataDir> <out.json>  every company's figures, without migrating (old tree, same version)
//   check <dataDir> <out.json>  copy each file, open it with this tree (migrates), health + figures
//
// Env: TOTAL_DATA_DIR is set to <dataDir>; UPGRADE_TODAY (YYYY-MM-DD) is the as-on date of every
// figure and the day the demo is dated by (installE2eClock), identical for both runs.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import * as e2eClock from '@shared/e2eClock'
import { openCompanyDb, closeCompanyDb, type DB } from '@main/db/connection'
import { readCompanyInfo } from '@main/db/seed'
import { MIGRATIONS } from '@main/db/migrations'
import { readRegistry } from '@main/registry'
import { companyDbPath, ensureDataTree } from '@main/paths'
import { createDemoCompany } from '@main/services/demo'
import * as perfCli from '@main/perf/cli'
import * as seedLarge from '@main/perf/seedLarge'
import { trialBalance, profitAndLoss, balanceSheet } from '@main/services/reports'
import * as analysis from '@main/services/analysis'
import { stockSummary } from '@main/services/stockAnalysis'
import { gstr1, gstr3b } from '@main/services/gst'
import { verifyAudit } from '@main/services/audit'
import * as backupVerify from '@main/services/backupVerify'

/** An export the tree may not have (see the header); undefined when it doesn't. */
const optional = (mod: object, name: string): any => (mod as Record<string, unknown>)[name]

const localToday = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const [command, dataDir, outFile] = process.argv.slice(2)
const TODAY = process.env.UPGRADE_TODAY ?? ''
if (!/^\d{4}-\d{2}-\d{2}$/.test(TODAY)) throw new Error('UPGRADE_TODAY=YYYY-MM-DD is required')
if (!dataDir) throw new Error('usage: snapshot <seed|dump|check> <dataDir> [out.json]')
process.env.TOTAL_DATA_DIR = dataDir
const installE2eClock = optional(e2eClock, 'installE2eClock')
if (installE2eClock) installE2eClock(TODAY)
else if (TODAY !== localToday()) throw new Error(`this release cannot shift its clock: run it on ${TODAY} or set UPGRADE_TODAY=${localToday()}`)
const PERF_TODAY: string | undefined = optional(seedLarge, 'PERF_TODAY')

/** Outstandings on one side as the release computes them (0.10 has only `outstandings`). */
function outstandingsOf(db: DB, side: 'receivable' | 'payable', asOn: string): unknown {
  const withAdvances = optional(analysis, 'outstandingsWithAdvances')
  if (withAdvances) return withAdvances(db, side, asOn)
  return { parties: optional(analysis, 'outstandings')(db, side, asOn) }
}

/** JSON-safe, deterministic: Maps → objects, BigInts → strings, per-run line uids dropped. */
function plain(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, v: unknown) => {
      if (/uid$/i.test(key)) return undefined
      if (v instanceof Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [String(k), x]))
      if (v instanceof Set) return [...v]
      if (typeof v === 'bigint') return v.toString()
      return v
    })
  )
}

const months = (from: string, to: string): Array<{ from: string; to: string; period: string }> => {
  const out: Array<{ from: string; to: string; period: string }> = []
  let y = Number(from.slice(0, 4))
  let m = Number(from.slice(5, 7))
  for (;;) {
    const first = `${y}-${String(m).padStart(2, '0')}-01`
    if (first > to) break
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    out.push({ from: first, to: last < to ? last : to, period: `${String(m).padStart(2, '0')}${y}` })
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

/** The as-on day per company: Perf Traders is generated as on PERF_TODAY, everything else today. */
const asOnFor = (slug: string): string => (slug === 'perf-traders' && PERF_TODAY ? PERF_TODAY : TODAY)

/** Every figure the owner named: TB, P&L, BS, Outstandings (both sides), stock summary per FY end
 *  (or as-on day), GSTR-1 / GSTR-3B for every month of the books up to the as-on day. */
function figures(db: DB, today: string): Record<string, unknown> {
  const info = readCompanyInfo(db)
  const booksFrom = `${info.booksFrom}-04-01`
  const out: Record<string, unknown> = {}
  for (let y = info.booksFrom; `${y}-04-01` <= today; y++) {
    const from = `${y}-04-01`
    const to = `${y + 1}-03-31` < today ? `${y + 1}-03-31` : today
    out[`tb:${to}`] = trialBalance(db, to)
    out[`pnl:${from}:${to}`] = profitAndLoss(db, from, to, { comparePrior: true })
    out[`bs:${to}`] = balanceSheet(db, booksFrom, to, true)
    out[`stock:${to}`] = stockSummary(db, to)
    out[`outstandings:receivable:${to}`] = outstandingsOf(db, 'receivable', to)
    out[`outstandings:payable:${to}`] = outstandingsOf(db, 'payable', to)
    for (const m of months(from, to)) {
      out[`gstr1:${m.period}`] = gstr1(db, info, m.from, m.to, m.period)
      out[`gstr3b:${m.period}`] = gstr3b(db, info, m.from, m.to, m.period)
    }
  }
  return plain(out) as Record<string, unknown>
}

const count = (db: DB, sql: string): number => (db.prepare(sql).get() as { n: number }).n
const migrationCount = (db: DB): number => count(db, 'SELECT COUNT(*) AS n FROM migrations')

function companies(): Array<{ slug: string; name: string }> {
  return readRegistry().companies.map((c) => ({ slug: c.slug, name: c.name }))
}

function seed(): void {
  ensureDataTree()
  const vouchers = Number(process.env.UPGRADE_VOUCHERS ?? 3000)
  const perfSeed = optional(perfCli, 'perfSeed')
  if (perfSeed) perfSeed({ vouchers, out: dataDir, log: (s: string) => process.stderr.write(`${s}\n`) })
  else process.stderr.write('this release has no Perf Traders seeder: Demo Traders only\n')
  createDemoCompany()
  process.stderr.write(`seeded: ${companies().map((c) => c.slug).join(', ')}\n`)
}

function dump(): void {
  const result: Record<string, unknown> = {}
  for (const c of companies()) {
    const db = openCompanyDb(c.slug)
    try {
      result[c.slug] = { migrations: migrationCount(db), figures: figures(db, asOnFor(c.slug)) }
    } finally {
      closeCompanyDb(db)
    }
  }
  writeFileSync(outFile, JSON.stringify({ migrations: MIGRATIONS.length, companies: result }, null, 1))
}

function check(): void {
  const scratch = join(dataDir, '..', 'upgrade-check-scratch')
  mkdirSync(scratch, { recursive: true })
  const result: Record<string, unknown> = {}
  for (const c of companies()) {
    const path = companyDbPath(c.slug)
    if (!existsSync(path)) throw new Error(`${c.slug}: ${path} is missing`)
    // The untouched old file, checked like a backup restore: copy, open, quick_check, MIGRATE,
    // audit chain, company row, Σ Dr = Σ Cr (services/backupVerify.ts — the app's own check).
    const oldCopy = join(scratch, `${c.slug}.old.db`)
    copyFileSync(path, oldCopy)
    const restore = optional(backupVerify, 'verifyBackupFile')(oldCopy, { asOn: asOnFor(c.slug), scratchRoot: scratch })
    // Then open the books in place, as the app does on launch (migrates them).
    const db = openCompanyDb(c.slug)
    try {
      const integrity = db.pragma('integrity_check', { simple: true })
      const foreignKeys = (db.pragma('foreign_key_check') as unknown[]).length
      const chain = verifyAudit(db)
      result[c.slug] = {
        migrations: migrationCount(db),
        integrity,
        foreignKeyProblems: foreignKeys,
        auditChain: { ok: chain.ok, rows: chain.rows },
        restoreCheck: { ok: restore.ok, error: restore.error, steps: restore.steps },
        figures: figures(db, asOnFor(c.slug))
      }
    } finally {
      closeCompanyDb(db)
    }
  }
  writeFileSync(outFile, JSON.stringify({ migrations: MIGRATIONS.length, companies: result }, null, 1))
}

if (command === 'seed') seed()
else if (command === 'dump') dump()
else if (command === 'check') check()
else throw new Error(`unknown command ${command}`)
