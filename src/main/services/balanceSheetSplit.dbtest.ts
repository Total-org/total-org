// R7 / FIG-B-2: the balance sheet's one "Profit & Loss A/c" line holds the profit of the earlier
// years that no closing journal has carried over AND this year's. It now says so: two `parts`,
// "Opening balance" (earlier years) and "Current period" (this year), that add up to the line.
// Nothing else moves — the line keeps its id, name, amount and an empty `children`, and every total
// stays; the parts live in their own field so a report read before the split is unchanged.
//
// Hand-worked books (never produced by running the app). Books from FY 2025-26, all in rupees:
//   FY1 (2025-26): purchases 10,000 (cash, 1 May) + a stored Dr opening of 5,000 on Purchase;
//                  sales 30,000 (credit, 1 Jun), debtor pays 20,000 (1 Aug).
//                  profit = 30,000 - (10,000 + 5,000) = 15,000
//   FY2 (2026-27): sales 8,000 cash (1 May 2026), rent 3,000 cash (1 Jun 2026).
//                  profit = 8,000 - 3,000 = 5,000
//   FY3 (2027-28): rent 7,000 cash (1 May 2027).   profit = -7,000
import { describe, it, expect } from 'vitest'
import { seededDb, TEST_INFO } from '../db/testdb'
import type { DB } from '../db/connection'
import { createLedger } from './masters'
import { saveVoucher } from './vouchers'
import { postClose } from './yearEnd'
import { balanceSheet, pnlLedgerAmounts, profitAndLoss } from './reports'
import type { BalanceSheet, StatementNode } from '@shared/reports'

const BOOKS_FROM = '2025-04-01'

function ledger(db: DB, name: string, groupName: string, openingBalance = 0): number {
  const group = db.prepare('SELECT id FROM groups WHERE name = ?').get(groupName) as { id: number }
  return createLedger(db, {
    name, groupId: group.id, openingBalance, gstin: null, stateCode: null, address: null,
    taxType: null, gstRate: null, hsn: null, tdsSectionId: null, pan: null, creditDays: null, exportType: null
  }).id
}

function journal(db: DB, date: string, dr: number, cr: number, amount: number): number {
  const vt = db.prepare("SELECT id FROM voucher_types WHERE kind = 'journal'").get() as { id: number }
  return saveVoucher(db, {
    voucherTypeId: vt.id, date, number: undefined, partyLedgerId: null, narration: null, reference: null,
    instrumentNo: null, instrumentDate: null, transporterId: null, vehicleNo: null, transportDistanceKm: null,
    currencyCode: null, exchangeRate: null,
    lines: [
      { ledgerId: dr, drCr: 'dr', amount, costAllocations: [] },
      { ledgerId: cr, drCr: 'cr', amount, costAllocations: [] }
    ],
    inventory: [], billRefs: [], tds: null
  }).id
}

function books(): DB {
  const db = seededDb()
  const cash = (db.prepare("SELECT id FROM ledgers WHERE name = 'Cash'").get() as { id: number }).id
  const purchase = ledger(db, 'Purchase', 'Purchase Accounts', 5_000_00)
  ledger(db, 'Capital', 'Capital Account', -5_000_00)
  const sales = ledger(db, 'Sales', 'Sales Accounts')
  const debtor = ledger(db, 'Debtor', 'Sundry Debtors')
  const rent = ledger(db, 'Rent', 'Indirect Expenses')
  journal(db, '2025-05-01', purchase, cash, 10_000_00)
  journal(db, '2025-06-01', debtor, sales, 30_000_00)
  journal(db, '2025-08-01', cash, debtor, 20_000_00)
  journal(db, '2026-05-01', cash, sales, 8_000_00)
  journal(db, '2026-06-01', rent, cash, 3_000_00)
  return db
}

const rentLedger = (db: DB): number => (db.prepare("SELECT id FROM ledgers WHERE name = 'Rent'").get() as { id: number }).id
const cashLedger = (db: DB): number => (db.prepare("SELECT id FROM ledgers WHERE name = 'Cash'").get() as { id: number }).id

const pnlLine = (bs: BalanceSheet): StatementNode | undefined => bs.liabilities.find((n) => n.name === 'Profit & Loss A/c')
const partsOf = (bs: BalanceSheet): Record<string, number> =>
  Object.fromEntries((pnlLine(bs)?.parts ?? []).map((p) => [p.name, p.amount]))

describe('balance sheet: Profit & Loss A/c split into Opening balance and Current period (FIG-B-2)', () => {
  it('an unclosed second year: 15,000 from FY1 + 5,000 from FY2', () => {
    const db = books()
    const bs = balanceSheet(db, BOOKS_FROM, '2027-03-31')
    // The line itself is exactly what it was: 15,000 + 5,000 = 20,000, no children, same id.
    expect(pnlLine(bs)).toMatchObject({ id: -3, kind: 'computed', amount: 20_000_00, children: [] })
    expect(bs.profitCurrentPeriod).toBe(20_000_00)
    expect(partsOf(bs)).toEqual({ 'Opening balance': 15_000_00, 'Current period': 5_000_00 })
    expect(bs.totalAssets).toBe(bs.totalLiabilities)
  })

  it('the earlier year closed by a closing journal: Retained Earnings holds FY1, the opening part is nil', () => {
    const db = books()
    postClose(db, TEST_INFO, 2025)
    const bs = balanceSheet(db, BOOKS_FROM, '2027-03-31')
    expect(pnlLine(bs)).toMatchObject({ id: -3, amount: 5_000_00, children: [] })
    expect(partsOf(bs)).toEqual({ 'Opening balance': 0, 'Current period': 5_000_00 })
    expect(bs.totalAssets).toBe(bs.totalLiabilities)
  })

  it('the first year of the books has no earlier years: everything is the current period', () => {
    const db = books()
    const bs = balanceSheet(db, BOOKS_FROM, '2026-03-31')
    expect(pnlLine(bs)).toMatchObject({ amount: 15_000_00, children: [] })
    expect(partsOf(bs)).toEqual({ 'Opening balance': 0, 'Current period': 15_000_00 })
  })

  it('the first day of a new unclosed year: nothing earned yet in it', () => {
    const db = books()
    const bs = balanceSheet(db, BOOKS_FROM, '2026-04-01')
    expect(pnlLine(bs)).toMatchObject({ amount: 15_000_00 })
    expect(partsOf(bs)).toEqual({ 'Opening balance': 15_000_00, 'Current period': 0 })
  })

  it('a loss in the current year: 20,000 earlier - 7,000 now = 13,000', () => {
    const db = books()
    journal(db, '2027-05-01', rentLedger(db), cashLedger(db), 7_000_00)
    const bs = balanceSheet(db, BOOKS_FROM, '2028-03-31')
    expect(pnlLine(bs)).toMatchObject({ amount: 13_000_00, children: [] })
    expect(partsOf(bs)).toEqual({ 'Opening balance': 20_000_00, 'Current period': -7_000_00 })
    expect(bs.totalAssets).toBe(bs.totalLiabilities)
  })

  it('a year closed as at its own last day: the line (and its parts) are gone', () => {
    const db = books()
    postClose(db, TEST_INFO, 2025)
    const bs = balanceSheet(db, BOOKS_FROM, '2026-03-31')
    expect(bs.profitCurrentPeriod).toBe(0)
    expect(pnlLine(bs)).toBeUndefined()
  })

  it('the parts come from the profit helpers: the current period is the P&L of this year, the opening one the earlier years', () => {
    const db = books()
    const bs = balanceSheet(db, BOOKS_FROM, '2027-03-31')
    const thisYear = profitAndLoss(db, '2026-04-01', '2027-03-31').netProfit
    const earlier = profitAndLoss(db, BOOKS_FROM, '2026-03-31').netProfit - pnlLedgerAmounts(db, BOOKS_FROM, '2026-03-31').closingTransfers
    expect(partsOf(bs)).toEqual({ 'Opening balance': earlier, 'Current period': thisYear })
    expect(thisYear).toBe(5_000_00)
    expect(earlier).toBe(15_000_00)
  })

  it('the parts always add up to the line', () => {
    const db = books()
    for (const asOn of ['2026-03-31', '2026-04-01', '2026-12-31', '2027-03-31']) {
      const line = pnlLine(balanceSheet(db, BOOKS_FROM, asOn))
      expect(line?.parts?.reduce((s, p) => s + p.amount, 0)).toBe(line?.amount)
    }
  })

  it('a balance sheet with no profit line has no parts anywhere, and the prior-year sheet carries its own', () => {
    const db = books()
    const bs = balanceSheet(db, BOOKS_FROM, '2027-03-31', true)
    const walk = (nodes: StatementNode[]): StatementNode[] => nodes.flatMap((n) => [n, ...walk(n.children)])
    const withParts = [...walk(bs.liabilities), ...walk(bs.assets)].filter((n) => n.parts)
    expect(withParts.map((n) => n.name)).toEqual(['Profit & Loss A/c'])
    expect(partsOf(bs.prior!)).toEqual({ 'Opening balance': 0, 'Current period': 15_000_00 })
  })
})
