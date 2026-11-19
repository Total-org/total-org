// WP 7.1 — performance work must not change a single figure. Every budgeted read (and the same
// reports over other periods, ledgers and sides — reportSuite.ts) is hashed on two companies:
// the 0.10 demo seed (dated as on PERF_TODAY) and a 10k-voucher Perf Traders seed. The expected
// hashes in __fixtures__/reportHashes.json were generated from origin/main's code BEFORE the
// WP 7.1 index / query changes (TOTAL_PERF_WRITE_EXPECTED=1 rewrites them — only ever on code
// whose outputs are known good; a field added later is listed in ADDITIVE_FIELDS instead — never
// regenerate to pass). On a mismatch the outputs are written to a temp dir to diff.
import { describe, it, expect, vi, afterAll } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { freshDb } from '../db/testdb'
import { openCompanyDb } from '../db/connection'
import { readCompanyInfo } from '../db/seed'
import { createDemoCompany } from '../services/demo'
import type { DB } from '../db/connection'
import type { CompanyInfo } from '@shared/domain'
import { PERF_COMPANY, PERF_TODAY, seedLargeAsync } from './seedLarge'
import { bsPartsProblems, canonical, hashOf, hashOutputs, reportOutputs, withoutAdditive } from './reportSuite'

const EXPECTED_PATH = join(__dirname, '__fixtures__', 'reportHashes.json')
const WRITE = process.env.TOTAL_PERF_WRITE_EXPECTED === '1'
const expected: Record<string, Record<string, string>> = existsSync(EXPECTED_PATH) ? JSON.parse(readFileSync(EXPECTED_PATH, 'utf8')) : {}
const written: Record<string, Record<string, string>> = { ...expected }

/** vouchers.created_at is SQLite's real clock (fake timers can't reach it), and the anomaly scan
 *  in simple:homeAttention reads it (back-dated = entered 30+ days after its date) — so the hashes
 *  moved with the calendar (perf10k homeAttention failed on origin/main from 15 Oct 2026). Pinned
 *  to the day the expectations were generated (14 Oct 2026, UTC), so the inputs are the ones they
 *  were made on: with this pin origin/main's own code reproduces every expected hash.
 *  The two homeAttention hashes were moved once, on purpose (Home's "added for an earlier, closed
 *  date" no longer counts entries merely made 30+ days late): with the old rule restored the old
 *  hashes still matched, and the new outputs differ from them only by that dropped row. */
const ENTERED_ON = '2026-10-14 12:00:00'

async function compare(name: string, db: DB, info: CompanyInfo): Promise<void> {
  db.prepare('UPDATE vouchers SET created_at = ?').run(ENTERED_ON)
  const outputs = await reportOutputs(db, info, PERF_TODAY)
  const got = hashOutputs(outputs)
  if (WRITE) {
    written[name] = got
    return
  }
  const want = expected[name]
  expect(want, `no expectations for ${name} — generate them on known-good code`).toBeTruthy()
  const differ = Object.keys({ ...want, ...got }).filter((k) => want![k] !== got[k])
  if (differ.length) {
    const dir = mkdtempSync(join(tmpdir(), `total-report-diff-${name}-`))
    for (const k of differ) writeFileSync(join(dir, `${k.replace(/[^\w.-]/g, '_')}.json`), canonical(outputs[k] ?? null))
    console.log(`[report equality] ${name}: outputs that differ written to ${dir}`)
  }
  expect(differ, `${name}: these outputs changed`).toEqual([])
  // The one field the hashes leave out for every balance sheet (R7): checked on its own.
  expect(bsPartsProblems(outputs), `${name}: the balance sheets' profit-line parts`).toEqual([])
}

describe('report outputs are unchanged by the performance work (WP 7.1)', () => {
  afterAll(() => {
    if (WRITE) writeFileSync(EXPECTED_PATH, JSON.stringify(written, null, 2) + '\n')
  })

  it('an additive field is left out of the hash only at its neutral value (never regenerate to pass)', () => {
    const before = { lines: { sales: 100, expenses: 30, profit: 70 } }
    expect(hashOf(withoutAdditive('doing', { lines: { ...before.lines, rounding: 0 } }))).toBe(hashOf(before))
    expect(hashOf(withoutAdditive('home', { profit: { month: { lines: { ...before.lines, rounding: 0 } } } }))).toBe(hashOf({ profit: { month: before } }))
    // A real round-off still changes the hash, and so does the field on any other output.
    expect(hashOf(withoutAdditive('doing', { lines: { ...before.lines, rounding: 50 } }))).not.toBe(hashOf(before))
    expect(hashOf(withoutAdditive('pnl:2025-04-01', { lines: { ...before.lines, rounding: 0 } }))).not.toBe(hashOf(before))
  })

  it('R7: a balance sheet hashes as it did before the profit line was split; the split has its own guard', () => {
    const line = { id: -3, kind: 'computed', name: 'Profit & Loss A/c', amount: 20_000_00, children: [] }
    const parts = [
      { id: -6, kind: 'computed', name: 'Opening balance', amount: 15_000_00, children: [] },
      { id: -7, kind: 'computed', name: 'Current period', amount: 5_000_00, children: [] }
    ]
    const sheet = (l: object): object => ({ asOn: '2027-03-31', liabilities: [l], assets: [], totalAssets: 0, totalLiabilities: 20_000_00, profitCurrentPeriod: 20_000_00 })
    // Left out of `bs` and `bs:<date>` (and of the sheet's prior), at any value; kept on any other output.
    for (const id of ['bs', 'bs:2027-03-31']) {
      expect(hashOf(withoutAdditive(id, { ...sheet({ ...line, parts }), prior: sheet({ ...line, parts }) }))).toBe(hashOf({ ...sheet(line), prior: sheet(line) }))
    }
    expect(hashOf(withoutAdditive('pnl:2026-04-01', sheet({ ...line, parts })))).not.toBe(hashOf(sheet(line)))
    // A changed figure still changes the hash.
    expect(hashOf(withoutAdditive('bs', sheet({ ...line, amount: 20_000_01, parts })))).not.toBe(hashOf(sheet(line)))
    // The guard: right parts pass; each way to be wrong is refused.
    const problems = (l: object): string[] => bsPartsProblems({ 'bs:2027-03-31': sheet(l) })
    expect(problems({ ...line, parts })).toEqual([])
    expect(problems(line)).toHaveLength(1) // a profit line without its parts
    expect(problems({ ...line, parts: [parts[0]!, { ...parts[1]!, amount: 5_000_01 }] })).toHaveLength(1) // not adding up
    expect(problems({ ...line, parts: [parts[1]!, parts[0]!] })).toHaveLength(1) // not the two parts, in order
    expect(problems({ ...line, id: -9, name: 'Reserves', parts })).toHaveLength(1) // parts on another line
    expect(bsPartsProblems({ bs: { ...sheet({ ...line, parts }), prior: sheet({ ...line, parts: [parts[0]!] }) } })).toHaveLength(1) // the prior sheet is checked too
  })

  // The clock is pinned to the perf day in both cases, so nothing date-relative can drift.
  it('on a 10k-voucher Perf Traders seed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${PERF_TODAY}T10:00:00`))
    const db = freshDb()
    try {
      await seedLargeAsync(db, { vouchers: 10_000 })
      await compare('perf10k', db, PERF_COMPANY)
    } finally {
      db.close()
      vi.useRealTimers()
    }
  }, 600_000)

  it('on the demo company, dated as on the perf day', async () => {
    const root = mkdtempSync(join(tmpdir(), 'total-report-eq-'))
    const before = process.env.TOTAL_DATA_DIR
    process.env.TOTAL_DATA_DIR = root
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${PERF_TODAY}T10:00:00`))
    try {
      const { slug } = createDemoCompany()
      const db = openCompanyDb(slug)
      try {
        await compare('demo', db, readCompanyInfo(db))
      } finally {
        db.close()
      }
    } finally {
      vi.useRealTimers()
      if (before === undefined) delete process.env.TOTAL_DATA_DIR
      else process.env.TOTAL_DATA_DIR = before
      rmSync(root, { recursive: true, force: true })
    }
  }, 120_000)
})
