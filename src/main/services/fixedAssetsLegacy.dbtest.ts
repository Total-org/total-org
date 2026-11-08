// The fixed-asset register was removed (audit A13b). A book that used it still carries its
// depreciation / disposal journals, depreciation_runs rows and — for a GST disposal — the
// `fixedAssets.saleInvoices` meta link. They are written here the way the old register wrote them
// (saveVoucher for the vouchers, raw SQL for its own rows) and the rules that stay are checked:
// the journals can't be edited, only binned; a GST disposal journal and its tax invoice bin and
// restore as a pair; the s.18(6) extra tax is still added to the invoice in GSTR-1 / 3B; the cash
// flow adds the depreciation back; the year-end status still sees the runs.
// Figures are hand-worked in the comments (integer paise).
import { beforeEach, describe, expect, it } from 'vitest'
import type { DB } from '../db/connection'
import { seededDb } from '../db/testdb'
import { readCompanyInfo } from '../db/seed'
import { createLedger } from './masters'
import { deleteVoucher, getVoucher, restoreVoucher, saveVoucher } from './vouchers'
import { extractOutwardDocs, gstr1, gstr3b } from './gst'
import { cashFlow, DEPRECIATION_ADD_BACK } from './reports'
import { closePreview } from './yearEnd'
import { applyCapitalGoodsExtraTax, saleInvoiceOf, yearStatus } from './fixedAssets'
import type { VoucherInput } from '@shared/schemas'

const LEDGER_DEFAULTS = {
  gstin: null, stateCode: null, address: null, taxType: null, gstRate: null, hsn: null,
  tdsSectionId: null, pan: null, creditDays: null, exportType: null, openingBalance: 0
}
const R = (rupees: number): number => Math.round(rupees * 100)

const groupId = (db: DB, name: string): number => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id
function ledger(db: DB, name: string, group: string, over: { stateCode?: string; taxType?: 'cgst' | 'sgst' } = {}): number {
  return createLedger(db, { ...LEDGER_DEFAULTS, ...over, name, groupId: groupId(db, group) }).id
}
const vtype = (db: DB, kind: string): number => (db.prepare('SELECT id FROM voucher_types WHERE kind = ? ORDER BY is_system DESC, id LIMIT 1').get(kind) as { id: number }).id
type Line = { ledgerId: number; drCr: 'dr' | 'cr'; amount: number }
function input(db: DB, kind: string, date: string, lines: Line[], partyLedgerId: number | null = null, reference: string | null = null): VoucherInput {
  return {
    voucherTypeId: vtype(db, kind), date, partyLedgerId, narration: null, reference,
    lines: lines.map((l) => ({ ...l, costAllocations: [] })), inventory: [], billRefs: [], tds: null
  } as VoucherInput
}
const post = (db: DB, kind: string, date: string, lines: Line[], party: number | null = null, reference: string | null = null): number =>
  saveVoucher(db, input(db, kind, date, lines, party, reference)).id
const binned = (db: DB, id: number): boolean => getVoucher(db, id)!.deletedAt != null

let db: DB
let plant: number
let accDep: number
let depExpense: number
let buyer: number
let machine: number
let depJournal: number

beforeEach(() => {
  db = seededDb()
  plant = ledger(db, 'Plant and Machinery', 'Fixed Assets')
  accDep = ledger(db, 'Accumulated Depreciation - Plant and machinery', 'Fixed Assets')
  depExpense = ledger(db, 'Depreciation', 'Indirect Expenses')
  const bank = ledger(db, 'HDFC Bank', 'Bank Accounts')
  buyer = ledger(db, 'Shree Traders', 'Sundry Debtors', { stateCode: '27' })
  // ₹1,00,000 machine paid from the bank and put to use 1 Apr 2025 (15 years, 5 % residual, SLM).
  post(db, 'journal', '2025-04-01', [{ ledgerId: plant, drCr: 'dr', amount: R(100000) }, { ledgerId: bank, drCr: 'cr', amount: R(100000) }])
  const group = (db.prepare("SELECT id FROM fixed_asset_groups WHERE name = 'Plant and machinery'").get() as { id: number }).id
  machine = Number(db.prepare(
    `INSERT INTO fixed_assets (name, asset_group_id, ledger_id, purchase_date, put_to_use_date, cost_paise, residual_pct_bp,
       useful_life_months, method, basis_date) VALUES ('CNC lathe', ?, ?, '2025-04-01', '2025-04-01', ?, 500, 180, 'slm', '2025-04-01')`
  ).run(group, plant, R(100000)).lastInsertRowid)
  // FY 2025-26 run: (1,00,000 − 5,000) ÷ 15 = 6,333.33 (633,333 paise), one journal on 31 Mar 2026.
  depJournal = post(db, 'journal', '2026-03-31', [{ ledgerId: depExpense, drCr: 'dr', amount: 633333 }, { ledgerId: accDep, drCr: 'cr', amount: 633333 }])
  const run = Number(db.prepare(
    "INSERT INTO depreciation_runs (fy_start_year, period_from, period_to, basis, voucher_id) VALUES (2025, '2025-04-01', '2026-03-31', 'companies_act', ?)"
  ).run(depJournal).lastInsertRowid)
  db.prepare('INSERT INTO depreciation_lines (run_id, asset_id, opening_wdv, depreciation, closing_wdv, days_used) VALUES (?, ?, ?, ?, ?, 365)')
    .run(run, machine, R(100000), 633333, R(100000) - 633333)
})

describe('a depreciation journal from the removed register', () => {
  it('can only be binned, never edited; restoring it brings the run back', () => {
    const v = getVoucher(db, depJournal)!
    const edit = { ...input(db, 'journal', v.date, [{ ledgerId: depExpense, drCr: 'dr', amount: 700000 }, { ledgerId: accDep, drCr: 'cr', amount: 700000 }]) }
    expect(() => saveVoucher(db, edit, depJournal)).toThrow(/former fixed-asset register/)
    expect(getVoucher(db, depJournal)!.lines.map((l) => l.amount)).toEqual([633333, 633333])
    deleteVoucher(db, depJournal)
    expect(binned(db, depJournal)).toBe(true)
    expect(yearStatus(db, 2025)).toEqual({ fyStartYear: 2025, assetsInService: 1, coveredThrough: null, missing: true })
    restoreVoucher(db, depJournal)
    expect(binned(db, depJournal)).toBe(false)
  })

  it('the year-end status and the cash-flow add-back still read the run', () => {
    expect(yearStatus(db, 2025)).toEqual({ fyStartYear: 2025, assetsInService: 1, coveredThrough: '2026-03-31', missing: false })
    expect(closePreview(db, 2025).depreciation).toEqual(yearStatus(db, 2025))
    // FY 2026-27: in service, nothing run yet.
    expect(yearStatus(db, 2026)).toEqual({ fyStartYear: 2026, assetsInService: 1, coveredThrough: null, missing: true })
    const cf = cashFlow(db, '2025-04-01', '2026-03-31')
    const dep = cf.operating.find((r) => r.name === DEPRECIATION_ADD_BACK)!
    expect(dep.amount).toBe(633333)
    expect(dep.voucherIds).toEqual([depJournal])
  })

  it('a second run over a period posted again is not restored on top of it', () => {
    deleteVoucher(db, depJournal)
    const again = post(db, 'journal', '2026-03-31', [{ ledgerId: depExpense, drCr: 'dr', amount: 633333 }, { ledgerId: accDep, drCr: 'cr', amount: 633333 }])
    db.prepare("INSERT INTO depreciation_runs (fy_start_year, period_from, period_to, basis, voucher_id) VALUES (2025, '2025-04-01', '2026-03-31', 'companies_act', ?)").run(again)
    expect(() => restoreVoucher(db, depJournal)).toThrow(/has been posted again since/)
  })
})

describe('a GST disposal from the removed register (CGST Act s.18(6))', () => {
  let invoice: number
  let journal: number
  beforeEach(() => {
    const outCgst = ledger(db, 'Output CGST', 'Duties & Taxes', { taxType: 'cgst' })
    const outSgst = ledger(db, 'Output SGST', 'Duties & Taxes', { taxType: 'sgst' })
    const sale = ledger(db, 'Sale of Fixed Assets', 'Indirect Incomes')
    const s186 = ledger(db, 'GST on Sale of Capital Goods (s.18(6))', 'Indirect Expenses')
    const loss = ledger(db, 'Loss on Sale of Fixed Assets', 'Indirect Expenses')
    // Sold 15 Sep 2026 for ₹50,000 + GST 18 % (intra-state): CGST 4,500 + SGST 4,500 → ₹59,000.
    invoice = post(db, 'sales', '2026-09-15', [
      { ledgerId: buyer, drCr: 'dr', amount: R(59000) },
      { ledgerId: sale, drCr: 'cr', amount: R(50000) },
      { ledgerId: outCgst, drCr: 'cr', amount: R(4500) },
      { ledgerId: outSgst, drCr: 'cr', amount: R(4500) }
    ], buyer)
    // The s.18(6) amount was 12,600 against 9,000 on the value: extra 3,600 = CGST 1,800 + SGST 1,800.
    // Journal: Dr Sale 50,000 + Acc. dep. 6,333.33 + loss 43,666.67 + s.18(6) 3,600 = 1,03,600
    //          Cr Plant 1,00,000 + CGST 1,800 + SGST 1,800 = 1,03,600.
    journal = post(db, 'journal', '2026-09-15', [
      { ledgerId: sale, drCr: 'dr', amount: R(50000) },
      { ledgerId: accDep, drCr: 'dr', amount: 633333 },
      { ledgerId: plant, drCr: 'cr', amount: R(100000) },
      { ledgerId: loss, drCr: 'dr', amount: R(100000) - 633333 - R(50000) },
      { ledgerId: s186, drCr: 'dr', amount: R(3600) },
      { ledgerId: outCgst, drCr: 'cr', amount: R(1800) },
      { ledgerId: outSgst, drCr: 'cr', amount: R(1800) }
    ], null, 'Invoice 1')
    db.prepare("UPDATE fixed_assets SET disposal_date = '2026-09-15', disposal_voucher_id = ?, disposal_kind = 'sale', disposal_proceeds_paise = ?, status = 'disposed' WHERE id = ?")
      .run(journal, R(50000), machine)
    db.prepare("INSERT INTO meta (key, value) VALUES ('fixedAssets.saleInvoices', ?)").run(JSON.stringify({ [String(journal)]: invoice }))
  })

  it('GSTR-1 and GSTR-3B carry the extra tax on the tax invoice', () => {
    expect(saleInvoiceOf(db, journal)).toBe(invoice)
    const info = readCompanyInfo(db)
    // 4,500 + 1,800 = 6,300 per head on the invoice's ₹50,000 @ 18 %; the value stays ₹59,000.
    const docs = extractOutwardDocs(db, info, '2026-09-01', '2026-09-30')
    expect(docs.map((d) => [d.voucherId, d.items, d.invoiceValue])).toEqual([[invoice, [{ rate: 18, taxable: R(50000), cgst: R(6300), sgst: R(6300), igst: 0, cess: 0 }], R(59000)]])
    // applyCapitalGoodsExtraTax on its own: outside the journal's dates it adds nothing.
    expect(applyCapitalGoodsExtraTax(db, docs, '2026-10-01', '2026-10-31')).toEqual(docs)
    expect(gstr1(db, info, '2026-09-01', '2026-09-30', '092026').summary.find((x) => x.section === 'b2cs')).toMatchObject({ taxable: R(50000), cgst: R(6300), sgst: R(6300) })
    expect(gstr3b(db, info, '2026-09-01', '2026-09-30', '092026').outward).toMatchObject({ taxable: R(50000), cgst: R(6300), sgst: R(6300), igst: 0 })
  })

  it('neither half can be edited; binning one bins both; restoring the journal restores both', () => {
    const inv = getVoucher(db, invoice)!
    expect(() => saveVoucher(db, { ...inv, lines: inv.lines.map((l) => ({ ...l, costAllocations: [] })) } as unknown as VoucherInput, invoice)).toThrow(/posted by a fixed-asset disposal/)
    const j = getVoucher(db, journal)!
    expect(() => saveVoucher(db, { ...j, lines: j.lines.map((l) => ({ ...l, costAllocations: [] })) } as unknown as VoucherInput, journal)).toThrow(/former fixed-asset register/)

    const info = readCompanyInfo(db)
    // Disposed during FY 2026-27: covered by the disposal, no run needed.
    expect(yearStatus(db, 2026)).toMatchObject({ assetsInService: 1, missing: false })
    deleteVoucher(db, journal)
    expect([binned(db, journal), binned(db, invoice)]).toEqual([true, true])
    expect(extractOutwardDocs(db, info, '2026-09-01', '2026-09-30')).toEqual([])
    expect(yearStatus(db, 2026).missing).toBe(true) // the binned disposal no longer counts
    restoreVoucher(db, journal)
    expect([binned(db, journal), binned(db, invoice)]).toEqual([false, false])
    expect(gstr3b(db, info, '2026-09-01', '2026-09-30', '092026').outward).toMatchObject({ cgst: R(6300), sgst: R(6300) })

    // Binning the invoice bins the journal with it; the invoice alone may come back (an ordinary sale).
    deleteVoucher(db, invoice)
    expect([binned(db, journal), binned(db, invoice)]).toEqual([true, true])
    restoreVoucher(db, invoice)
    expect([binned(db, journal), binned(db, invoice)]).toEqual([true, false])
    expect(extractOutwardDocs(db, info, '2026-09-01', '2026-09-30')[0]!.items).toEqual([{ rate: 18, taxable: R(50000), cgst: R(4500), sgst: R(4500), igst: 0, cess: 0 }])
    const paired = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'voucher' AND after_json LIKE '%pairedWith%'").get() as { n: number }
    expect(paired.n).toBe(3)
  })
})
