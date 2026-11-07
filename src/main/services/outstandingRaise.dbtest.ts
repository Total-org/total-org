// Audit 2026-11 A1 (COR-1): a bill-wise `against` reference on an entry that RAISES what a party
// owes (a debit note to a customer, a journal "Dr customer, against S/1", a credit note / journal
// that raises what you owe a supplier) adds to that bill, as in Tally — it used to LOWER it, so
// Outstandings was off from the ledger by twice the note. Every figure below is worked by hand in
// its comment (never produced by running the code): bills are integer paise.
import { describe, it, expect } from 'vitest'
import { seededDb } from '../db/testdb'
import { createLedger } from './masters'
import { saveVoucher } from './vouchers'
import { outstandingsWithAdvances, openBills, partyAllocation } from './analysis'
import type { VoucherInputParsed } from '@shared/schemas'

type DB = ReturnType<typeof seededDb>

function groupId(db: DB, name: string): number {
  return (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id
}

function ledger(db: DB, name: string, group: string): number {
  return createLedger(db, {
    name, groupId: groupId(db, group), openingBalance: 0, gstin: null, stateCode: null, address: null,
    taxType: null, gstRate: null, hsn: null, tdsSectionId: null, pan: null, creditDays: null, exportType: null
  }).id
}

function typeId(db: DB, kind: string): number {
  return (db.prepare('SELECT id FROM voucher_types WHERE kind = ? ORDER BY id LIMIT 1').get(kind) as { id: number }).id
}

/** One voucher: `dr` / `cr` ledger, `amount` both sides, the party and its bill refs. */
function post(db: DB, kind: string, o: { date: string; number: string; party: number; dr: number; cr: number; amount: number; refs: VoucherInputParsed['billRefs'] }): number {
  return saveVoucher(db, {
    voucherTypeId: typeId(db, kind), date: o.date, number: o.number, partyLedgerId: o.party,
    narration: null, reference: null, instrumentNo: null, instrumentDate: null, transporterId: null,
    vehicleNo: null, transportDistanceKm: null, currencyCode: null, exchangeRate: null,
    lines: [
      { ledgerId: o.dr, drCr: 'dr', amount: o.amount, costAllocations: [] },
      { ledgerId: o.cr, drCr: 'cr', amount: o.amount, costAllocations: [] }
    ],
    inventory: [], billRefs: o.refs, tds: null
  }).id
}

/** The party's ledger balance from its voucher lines (dr − cr) — what the trial balance shows. */
function ledgerNet(db: DB, id: number): number {
  return (db.prepare("SELECT COALESCE(SUM(CASE dr_cr WHEN 'dr' THEN amount ELSE -amount END), 0) AS n FROM voucher_lines WHERE ledger_id = ?").get(id) as { n: number }).n
}

const AS_ON = '2025-07-31'
const ref = (kind: 'new' | 'against', name: string, amount: number) => ({ kind, name, amount, dueDate: null })

describe('A1: an `against` ref on a debit to a customer adds to the bill (receivables)', () => {
  it('debit note DN/1 ₹1,180 against S/1 ₹11,800 → S/1 pending ₹12,980 = the ledger', () => {
    const db = seededDb()
    const a = ledger(db, 'Customer A', 'Sundry Debtors')
    const sales = ledger(db, 'Sales A/c', 'Sales Accounts')
    // S/1: Dr A 11,800.00 (new ref S/1).
    post(db, 'sales', { date: '2025-05-01', number: 'S/1', party: a, dr: a, cr: sales, amount: 1_180_000, refs: [ref('new', 'S/1', 1_180_000)] })
    // DN/1 (s.34 rate difference): Dr A 1,180.00, ticked against S/1.
    post(db, 'debit_note', { date: '2025-05-20', number: 'DN/1', party: a, dr: a, cr: sales, amount: 118_000, refs: [ref('against', 'S/1', 118_000)] })
    // By hand: 11,800 + 1,180 = 12,980.00 on S/1 — the ledger is 12,980.00 Dr.
    expect(ledgerNet(db, a)).toBe(1_298_000)
    const bills = openBills(db, a, AS_ON)
    expect(bills.map((b) => [b.number, b.amount, b.pending, b.date])).toEqual([['S/1', 1_298_000, 1_298_000, '2025-05-01']])
    const os = outstandingsWithAdvances(db, 'receivable', AS_ON)
    expect(os.parties.find((p) => p.ledgerId === a)?.pending).toBe(1_298_000)
    expect(os.advanceByParty.get(a) ?? 0).toBe(0)
    expect(partyAllocation(db, a, AS_ON).warnings).toEqual([])
  })

  it('a receipt of the whole ₹12,980 against S/1 then leaves nothing open and no advance', () => {
    const db = seededDb()
    const a = ledger(db, 'Customer A', 'Sundry Debtors')
    const sales = ledger(db, 'Sales A/c', 'Sales Accounts')
    const cash = (db.prepare("SELECT id FROM ledgers WHERE name = 'Cash'").get() as { id: number }).id
    post(db, 'sales', { date: '2025-05-01', number: 'S/1', party: a, dr: a, cr: sales, amount: 1_180_000, refs: [ref('new', 'S/1', 1_180_000)] })
    post(db, 'debit_note', { date: '2025-05-20', number: 'DN/1', party: a, dr: a, cr: sales, amount: 118_000, refs: [ref('against', 'S/1', 118_000)] })
    post(db, 'receipt', { date: '2025-06-10', number: 'R/1', party: a, dr: cash, cr: a, amount: 1_298_000, refs: [ref('against', 'S/1', 1_298_000)] })
    // By hand: 12,980 − 12,980 = 0 on S/1; the ledger is 0. (Before the fix: S/1 had 10,620 left,
    // the receipt's extra 2,360 went on account → a phantom ₹2,360 advance.)
    expect(ledgerNet(db, a)).toBe(0)
    expect(openBills(db, a, AS_ON)).toEqual([])
    const alloc = partyAllocation(db, a, AS_ON)
    expect(alloc.unappliedCredit).toBe(0)
    expect(alloc.warnings).toEqual([])
  })

  it('a journal "Dr A / Cr Freight recovered ₹500, against S/1" adds ₹500 to S/1', () => {
    const db = seededDb()
    const a = ledger(db, 'Customer A', 'Sundry Debtors')
    const sales = ledger(db, 'Sales A/c', 'Sales Accounts')
    const freight = ledger(db, 'Freight recovered', 'Indirect Incomes')
    post(db, 'sales', { date: '2025-05-01', number: 'S/1', party: a, dr: a, cr: sales, amount: 1_180_000, refs: [ref('new', 'S/1', 1_180_000)] })
    post(db, 'sales', { date: '2025-05-05', number: 'S/2', party: a, dr: a, cr: sales, amount: 200_000, refs: [ref('new', 'S/2', 200_000)] })
    post(db, 'journal', { date: '2025-05-25', number: 'J/1', party: a, dr: a, cr: freight, amount: 50_000, refs: [ref('against', 'S/1', 50_000)] })
    // By hand: S/1 11,800 + 500 = 12,300.00; S/2 2,000.00 untouched; ledger 11,800 + 2,000 + 500 = 14,300.00.
    expect(ledgerNet(db, a)).toBe(1_430_000)
    expect(openBills(db, a, AS_ON).map((b) => [b.number, b.pending])).toEqual([['S/1', 1_230_000], ['S/2', 200_000]])
  })

  it('a debit against a bill already paid in full re-opens it on its own date', () => {
    const db = seededDb()
    const a = ledger(db, 'Customer A', 'Sundry Debtors')
    const sales = ledger(db, 'Sales A/c', 'Sales Accounts')
    const cash = (db.prepare("SELECT id FROM ledgers WHERE name = 'Cash'").get() as { id: number }).id
    post(db, 'sales', { date: '2025-05-01', number: 'S/1', party: a, dr: a, cr: sales, amount: 100_000, refs: [ref('new', 'S/1', 100_000)] })
    post(db, 'sales', { date: '2025-05-10', number: 'S/2', party: a, dr: a, cr: sales, amount: 300_000, refs: [ref('new', 'S/2', 300_000)] })
    post(db, 'receipt', { date: '2025-05-15', number: 'R/1', party: a, dr: cash, cr: a, amount: 100_000, refs: [ref('against', 'S/1', 100_000)] })
    post(db, 'debit_note', { date: '2025-06-01', number: 'DN/1', party: a, dr: a, cr: sales, amount: 20_000, refs: [ref('against', 'S/1', 20_000)] })
    // By hand: S/1 1,000 − 1,000 = 0 (closed), then + 200 → 200.00 open, still dated 1 May and
    // ahead of S/2 (3,000.00) in the oldest-first order; ledger 1,000 + 3,000 − 1,000 + 200 = 3,200.00.
    expect(ledgerNet(db, a)).toBe(320_000)
    expect(openBills(db, a, AS_ON).map((b) => [b.number, b.date, b.amount, b.pending])).toEqual([
      ['S/1', '2025-05-01', 120_000, 20_000],
      ['S/2', '2025-05-10', 300_000, 300_000]
    ])
    expect(partyAllocation(db, a, AS_ON).warnings).toEqual([])
  })
})

describe('A1 mirrored: an `against` ref on a credit to a supplier adds to their bill (payables)', () => {
  it('credit note ₹590 to supplier B against P/1 ₹5,900 → P/1 pending ₹6,490 = the ledger', () => {
    const db = seededDb()
    const b = ledger(db, 'Supplier B', 'Sundry Creditors')
    const purchases = ledger(db, 'Purchase A/c', 'Purchase Accounts')
    // P/1: Cr B 5,900.00 (new ref P/1).
    post(db, 'purchase', { date: '2025-05-02', number: 'P/1', party: b, dr: purchases, cr: b, amount: 590_000, refs: [ref('new', 'P/1', 590_000)] })
    // A credit to B of 590.00 (their rate-difference debit note to us), ticked against P/1.
    post(db, 'credit_note', { date: '2025-05-22', number: 'CN/1', party: b, dr: purchases, cr: b, amount: 59_000, refs: [ref('against', 'P/1', 59_000)] })
    // By hand: 5,900 + 590 = 6,490.00 owed on P/1; the ledger is 6,490.00 Cr.
    expect(ledgerNet(db, b)).toBe(-649_000)
    expect(openBills(db, b, AS_ON).map((x) => [x.number, x.amount, x.pending])).toEqual([['P/1', 649_000, 649_000]])
    const os = outstandingsWithAdvances(db, 'payable', AS_ON)
    expect(os.parties.find((p) => p.ledgerId === b)?.pending).toBe(649_000)
    expect(os.advanceByParty.get(b) ?? 0).toBe(0)
  })

  it('a journal "Dr Freight / Cr B ₹300, against P/1" adds ₹300 to P/1; a payment of ₹6,200 then clears it', () => {
    const db = seededDb()
    const b = ledger(db, 'Supplier B', 'Sundry Creditors')
    const purchases = ledger(db, 'Purchase A/c', 'Purchase Accounts')
    const freight = ledger(db, 'Freight inward', 'Direct Expenses')
    const cash = (db.prepare("SELECT id FROM ledgers WHERE name = 'Cash'").get() as { id: number }).id
    post(db, 'purchase', { date: '2025-05-02', number: 'P/1', party: b, dr: purchases, cr: b, amount: 590_000, refs: [ref('new', 'P/1', 590_000)] })
    post(db, 'journal', { date: '2025-05-03', number: 'J/1', party: b, dr: freight, cr: b, amount: 30_000, refs: [ref('against', 'P/1', 30_000)] })
    // By hand: 5,900 + 300 = 6,200.00 owed on P/1.
    expect(openBills(db, b, AS_ON).map((x) => [x.number, x.pending])).toEqual([['P/1', 620_000]])
    post(db, 'payment', { date: '2025-06-01', number: 'PY/1', party: b, dr: b, cr: cash, amount: 620_000, refs: [ref('against', 'P/1', 620_000)] })
    // 6,200 − 6,200 = 0: nothing open, nothing paid ahead.
    expect(ledgerNet(db, b)).toBe(0)
    expect(openBills(db, b, AS_ON)).toEqual([])
    expect(partyAllocation(db, b, AS_ON).unappliedCredit).toBe(0)
  })
})
