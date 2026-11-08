// A13b — the readers whose outputs must be identical on a book that used interest on overdue bills,
// the fixed-asset register and payroll PF / ESI / PT, before and after those features were cut.
// Used by the generator (run once on the old code) and by cutFeaturesRead.dbtest.ts (the new code).
// It may only call readers that exist, with the same signatures, in both trees.
import type { DB } from '../db/connection'
import type { CompanyInfo } from '@shared/domain'
import { hashOf, reportOutputs } from '../perf/reportSuite'
import { cashFlow, ledgerStatement, trialBalance } from './reports'
import { outstandingsWithAdvances } from './analysis'
import { gstr1, gstr3b } from './gst'
import { forecastBase } from './cashForecast'
import { closePreview } from './yearEnd'
import { collectionReport, creditControl, reminderCandidates, statementData, topOverdue } from './receivables'
import { listRuns, getRun } from './payroll'
import { form16Data, form24qData, statutoryDues } from './payrollStatutory'
import { actualWorkings } from './payroll'

/** The day the fixture was made on; every as-on date and the clock are pinned to it. */
export const CUT_TODAY = '2026-11-08'

export async function cutFeatureOutputs(db: DB, info: CompanyInfo): Promise<Record<string, unknown>> {
  const out = await reportOutputs(db, info, CUT_TODAY)
  const late = (db.prepare("SELECT id FROM ledgers WHERE name = 'Late Payer & Co'").get() as { id: number }).id
  const buyer = (db.prepare("SELECT id FROM ledgers WHERE name = 'Shree Traders'").get() as { id: number }).id
  for (const m of ['04', '05', '06', '07', '08', '09', '10', '11']) {
    const from = `2026-${m}-01`
    const to = new Date(Date.UTC(2026, Number(m), 0)).toISOString().slice(0, 10)
    out[`gstr1:all:${m}`] = gstr1(db, info, from, to, `${m}2026`)
    out[`gstr3b:all:${m}`] = gstr3b(db, info, from, to, `${m}2026`)
    out[`tb:${to}`] = trialBalance(db, to)
  }
  out['cashFlow:fy'] = cashFlow(db, '2026-04-01', CUT_TODAY)
  out['cashFlow:q2'] = cashFlow(db, '2026-07-01', '2026-09-30')
  out['forecast:30'] = forecastBase(db, info, CUT_TODAY, '2026-12-08')
  out['yearEnd:2026'] = closePreview(db, 2026)
  for (const side of ['receivable', 'payable'] as const) out[`outstandings:${side}`] = outstandingsWithAdvances(db, side, CUT_TODAY)
  out['ledger:late'] = ledgerStatement(db, late, '2026-04-01', CUT_TODAY)
  out['ledger:buyer'] = ledgerStatement(db, buyer, '2026-04-01', CUT_TODAY)
  out['statement:late'] = statementData(db, info, late, '2026-04-01', CUT_TODAY)
  out['payrollRuns'] = listRuns(db).map((r) => getRun(db, r.id))
  out['form24q:q2'] = form24qData(db, 2026, 2, (id) => actualWorkings(db, id, 2026))
  // Review of #243 (finding 4): the other readers of the kept data.
  out['statutoryDues:2026'] = statutoryDues(db, 2026, CUT_TODAY)
  out['form16:2026'] = form16Data(db, info, 2026, (id) => actualWorkings(db, id, 2026))
  out['creditControl'] = creditControl(db, CUT_TODAY)
  out['reminderCandidates'] = reminderCandidates(db, CUT_TODAY)
  out['topOverdue'] = topOverdue(db, CUT_TODAY, 20)
  out['collections:fy'] = collectionReport(db, '2026-04-01', CUT_TODAY)
  return out
}

/** A PF / ESI due-date entry of the compliance calendar (shared/compliance.ts `Deadline`). */
const isPfEsiDeadline = (v: unknown): boolean => {
  if (!v || typeof v !== 'object') return false
  const o = v as { id?: unknown; kind?: unknown }
  return (o.kind === 'pf' || o.kind === 'esi') && typeof o.id === 'string' && /^(pf|esi)-\d{4}-\d{2}$/.test(o.id)
}
/** The output with every PF / ESI due-date entry left out of its lists. Owner, 8 Nov (review of
 *  #243): those dates now show only for a month a pay run deducted PF / ESI — so for the outputs
 *  that carry them, the old code's hash of THIS form is what must still match. */
export function withoutPfEsiDeadlines(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((x) => !isPfEsiDeadline(x)).map(withoutPfEsiDeadlines)
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, withoutPfEsiDeadlines(v)]))
  }
  return value
}
export const NO_PF_ESI = '#withoutPfEsiDeadlines'

export async function cutFeatureHashes(db: DB, info: CompanyInfo): Promise<Record<string, string>> {
  const out = await cutFeatureOutputs(db, info)
  const hashes: Record<string, string> = {}
  for (const [k, v] of Object.entries(out)) {
    hashes[k] = hashOf(v)
    const stripped = hashOf(withoutPfEsiDeadlines(v))
    if (stripped !== hashes[k]) hashes[k + NO_PF_ESI] = stripped
  }
  return hashes
}
