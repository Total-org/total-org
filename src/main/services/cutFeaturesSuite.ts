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
import { statementData } from './receivables'
import { listRuns, getRun } from './payroll'
import { form24qData } from './payrollStatutory'
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
  return out
}

export async function cutFeatureHashes(db: DB, info: CompanyInfo): Promise<Record<string, string>> {
  const out = await cutFeatureOutputs(db, info)
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, hashOf(v)]))
}
