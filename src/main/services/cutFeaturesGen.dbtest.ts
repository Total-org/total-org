// A13b — GENERATOR, run once on origin/main's code BEFORE the cut (interest on overdue bills, the
// fixed-asset register, payroll PF / ESI / PT): makes a book that used all three through the old
// services, saves it as a gzipped fixture and writes the hash of every reader's output, computed by
// the OLD code. `cutFeaturesRead.dbtest.ts` opens that file with the new code and must reproduce
// every hash. Never run on the new code (its services are gone) and never regenerate to pass.
//
//   TOTAL_CUT_FIXTURE_WRITE=1 npm run test:db -- src/main/services/cutFeaturesGen.dbtest.ts
import { describe, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { gzipSync } from 'zlib'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('./pdf', () => ({ htmlToPdf: async (html: string) => Buffer.from(`%PDF-test ${html.length}`), writeExportPdf: async () => '/dev/null' }))

import { openCompanyDb } from '../db/connection'
import { readCompanyInfo } from '../db/seed'
import type { DB } from '../db/connection'
import { computeGst } from '@shared/gst/calc'
import { createDemoCompany } from './demo'
import { createLedger } from './masters'
import { saveVoucher } from './vouchers'
import * as rx from './receivables'
import * as fa from './fixedAssets'
import { saveEmployee, commitRun } from './payroll'
import { recordStatutoryPayment } from './payrollStatutory'
import { cutFeatureHashes, CUT_TODAY } from './cutFeaturesSuite'

const OUT = join(__dirname, '__fixtures__', 'cutFeatures')
const R = (rupees: number): number => Math.round(rupees * 100)
const one = <T>(db: DB, sql: string, ...a: unknown[]): T => db.prepare(sql).get(...a) as T
const gid = (db: DB, name: string): number => one<{ id: number }>(db, 'SELECT id FROM groups WHERE name = ?', name).id
const vt = (db: DB, kind: string): number => one<{ id: number }>(db, 'SELECT id FROM voucher_types WHERE kind = ? ORDER BY id LIMIT 1', kind).id
const taxLedger = (db: DB, type: string, side: 'Output' | 'Input'): number =>
  one<{ id: number }>(db, `SELECT id FROM ledgers WHERE tax_type = ? ORDER BY (name LIKE ?) DESC, id LIMIT 1`, type, `%${side}%`).id

function useAllThree(db: DB): void {
  const info = readCompanyInfo(db)
  const bank = one<{ id: number }>(db, "SELECT l.id FROM ledgers l JOIN groups g ON g.id = l.group_id WHERE g.name = 'Bank Accounts' ORDER BY l.id LIMIT 1").id
  const sales = one<{ id: number }>(db, "SELECT l.id FROM ledgers l JOIN groups g ON g.id = l.group_id WHERE g.name = 'Sales Accounts' ORDER BY l.id LIMIT 1").id
  const outC = taxLedger(db, 'cgst', 'Output')
  const outS = taxLedger(db, 'sgst', 'Output')
  const inC = taxLedger(db, 'cgst', 'Input')
  const inS = taxLedger(db, 'sgst', 'Input')

  // ---- 1. interest on an overdue bill: ₹50,000 + 18% GST on 1 May, 30 days, 18% a year, 5 days' grace ----
  const late = createLedger(db, {
    name: 'Late Payer & Co', groupId: gid(db, 'Sundry Debtors'), stateCode: info.stateCode, creditDays: 30, interestRateBp: 1800, interestGraceDays: 5
  }).id
  const g = computeGst(R(50_000), 18, 'intra')
  saveVoucher(db, {
    voucherTypeId: vt(db, 'sales'), date: '2026-05-01', number: 'LP-1', partyLedgerId: late,
    lines: [
      { ledgerId: late, drCr: 'dr', amount: R(50_000) + g.cgst + g.sgst },
      { ledgerId: sales, drCr: 'cr', amount: R(50_000) },
      { ledgerId: outC, drCr: 'cr', amount: g.cgst },
      { ledgerId: outS, drCr: 'cr', amount: g.sgst }
    ]
  })
  rx.postInterest(db, info, { asOn: '2026-08-31', ledgerId: late, gstOnInterest: true }, CUT_TODAY)

  // ---- 2. the fixed-asset register: a ₹1,00,000 machine (ITC taken), a half-year run, sold with GST ----
  const plant = createLedger(db, { name: 'Plant and Machinery', groupId: gid(db, 'Fixed Assets') }).id
  const works = createLedger(db, { name: 'Machine Works', groupId: gid(db, 'Sundry Creditors'), stateCode: info.stateCode }).id
  const buyer = createLedger(db, { name: 'Shree Traders', groupId: gid(db, 'Sundry Debtors'), stateCode: info.stateCode }).id
  const bill = saveVoucher(db, {
    voucherTypeId: vt(db, 'purchase'), date: '2026-04-10', reference: 'MW-77', partyLedgerId: works,
    lines: [
      { ledgerId: plant, drCr: 'dr', amount: R(100_000) },
      { ledgerId: inC, drCr: 'dr', amount: R(9_000) },
      { ledgerId: inS, drCr: 'dr', amount: R(9_000) },
      { ledgerId: works, drCr: 'cr', amount: R(118_000) }
    ]
  }).id
  const groupId = one<{ id: number }>(db, "SELECT id FROM fixed_asset_groups WHERE name = 'Plant and machinery'").id
  const machine = fa.saveAsset(db, {
    name: 'CNC lathe', assetGroupId: groupId, ledgerId: plant, purchaseVoucherId: bill, purchaseDate: '2026-04-10', putToUseDate: '2026-04-10',
    costPaise: R(100_000), residualBp: 500, lifeMonths: 180, method: 'slm', itBlockId: null, location: null, identifier: null
  }).id
  fa.postRun(db, '2026-04-01', '2026-06-30')
  fa.disposeAsset(db, { assetId: machine, date: '2026-09-15', kind: 'sale', proceedsPaise: R(80_000), considerationLedgerId: buyer, chargeCatchUp: true, gst: { ratePercent: 18 } })
  // A second asset still on the register (depreciated, not sold).
  const laptops = createLedger(db, { name: 'Computers', groupId: gid(db, 'Fixed Assets') }).id
  const lapBill = saveVoucher(db, {
    voucherTypeId: vt(db, 'payment'), date: '2026-04-20', partyLedgerId: null,
    lines: [{ ledgerId: laptops, drCr: 'dr', amount: R(60_000) }, { ledgerId: bank, drCr: 'cr', amount: R(60_000) }]
  }).id
  fa.saveAsset(db, {
    name: 'Laptops', assetGroupId: one<{ id: number }>(db, "SELECT id FROM fixed_asset_groups WHERE name = 'Computers'").id, ledgerId: laptops,
    purchaseVoucherId: lapBill, purchaseDate: '2026-04-20', putToUseDate: '2026-04-20', costPaise: R(60_000), residualBp: 500, lifeMonths: 36,
    method: 'slm', itBlockId: null, location: null, identifier: null
  })
  fa.postRun(db, '2026-07-01', '2026-09-30')

  // ---- 3. payroll with PF, ESI and PT: July and August runs, July's PF paid ----
  const base = { code: null, designation: null, joined: null, uan: null, esicNo: null, pfEnabled: true, esiEnabled: true, ptEnabled: true, ptState: 'MH' as const, active: true }
  saveEmployee(db, { ...base, name: 'Anil Mehta', code: 'E1', pan: 'ABCPM1234K', uan: '100100100100', basic: R(25_000), hra: R(10_000), special: R(5_000) })
  saveEmployee(db, { ...base, name: 'Bina Rao', code: 'E2', pan: 'ABCPR5678L', uan: '100100100200', esicNo: '3100123456', basic: R(12_000), hra: R(4_000), special: R(2_000) })
  const july = commitRun(db, '2026-07', [])
  commitRun(db, '2026-08', [])
  const pfJuly = one<{ n: number }>(db, 'SELECT COALESCE(SUM(pf_emp + pf_er), 0) AS n FROM payroll_lines WHERE run_id = ?', july.id).n
  recordStatutoryPayment(db, { kind: 'pf', period: '2026-07', state: null, amountPaise: pfJuly, paidOn: '2026-08-12', bankLedgerId: bank, reference: 'TRRN 123', bsrCode: null, challanNo: null })
}

describe.runIf(process.env.TOTAL_CUT_FIXTURE_WRITE === '1')('A13b fixture (old code only)', () => {
  it('makes the book and writes the hashes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'total-cut-gen-'))
    process.env.TOTAL_DATA_DIR = root
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${CUT_TODAY}T10:00:00`))
    try {
      const { slug } = createDemoCompany()
      const db = openCompanyDb(slug)
      useAllThree(db)
      const hashes = await cutFeatureHashes(db, readCompanyInfo(db))
      mkdirSync(OUT, { recursive: true })
      const file = join(root, 'cut.db')
      db.prepare('VACUUM INTO ?').run(file)
      db.close()
      writeFileSync(join(OUT, 'book.db.gz'), gzipSync(readFileSync(file), { level: 9 }))
      writeFileSync(join(OUT, 'hashes.json'), JSON.stringify(hashes, null, 2) + '\n')
    } finally {
      vi.useRealTimers()
      rmSync(root, { recursive: true, force: true })
    }
  }, 300_000)
})
