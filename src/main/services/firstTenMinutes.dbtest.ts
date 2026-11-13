// Audit A7 / UX-9 — a fresh business is not nagged about GST months before it used Total.
// The audit's case: set up on 7 Nov 2026 "starting fresh" with the books from 1 Apr 2026, one ₹500
// bill with 18 % GST (₹45 CGST + ₹45 SGST, Maharashtra) → Home said "GST files for Oct 2026 are not
// prepared" and "Nothing to pay by 20 Nov", ignoring the ₹90 just collected (due 20 Dec).
// Figures hand-worked: monthly filer, state 27 — GSTR-1 due the 11th, GSTR-3B the 20th of the
// next month (shared/gst/filing.ts).
import { describe, expect, it } from 'vitest'
import { freshDb } from '../db/testdb'
import { readCompanyInfo } from '../db/seed'
import { applySetup } from './companySetup'
import { simpleHome, simpleHomeAttention } from './simpleHome'
import { simpleTaxes } from './simpleTaxes'
import { postIntent } from './simplePost'
import { dashSetup, userPartyCount } from './dashboard'
import { createLedger } from './masters'
import type { DB } from '../db/connection'

const TODAY = '2026-11-07'

function shop(startDate: string, fresh: boolean, bill = true): DB {
  const db = freshDb()
  applySetup(db, { name: 'Ramesh Stores', stateCode: '27', businessType: 'retail', gst: 'regular', gstin: '27AAPFU0939F1ZV', filing: 'monthly', stock: false, startDate, fresh }, TODAY)
  if (bill) {
    postIntent(db, readCompanyInfo(db), { clientId: 'first-bill-0001', kind: 'sale', date: TODAY, amount: { amount: 50000, gstRate: 18 }, payment: { how: 'cash' } }, TODAY)
  }
  return db
}

describe('audit A7 / UX-9: GST on Home starts with a fresh business’s first entry', () => {
  it('fresh, books from 1 Apr, first bill today: the tile is November so far — ₹90 due 20 Dec — and nothing about October', () => {
    const db = shop('2026-04-01', true)
    const company = readCompanyInfo(db)
    const home = simpleHome(db, company, { today: TODAY, backups: [] })
    expect(home.gst?.kind === 'regular' && home.gst.row).toMatchObject({
      period: '2026-11', from: '2026-11-01', to: TODAY, soFar: true,
      gstr1Due: '2026-12-11', gstr3bDue: '2026-12-20',
      outwardTax: 9000, liability: 9000, itc: 0, payable: 9000
    })
    const attention = simpleHomeAttention(db, company, TODAY)
    expect(attention.items.filter((i) => i.source === 'close')).toEqual([])
    // Review: the Taxes screen (and Ask Total, which answers through it) opens on Home's period —
    // ₹90 collected — and still offers the earlier months (nil returns are the owner's to file).
    const taxes = simpleTaxes(db, company, {}, TODAY)
    if (taxes.kind !== 'regular') throw new Error('regular expected')
    expect(taxes.period).toMatchObject({ period: '2026-11', soFar: true })
    expect(taxes.figures.collected).toBe(9000)
    expect(taxes.periods.map((p) => p.period)).toContain('2026-10')
  })

  it('fresh with nothing recorded yet: no month-end checks at all', () => {
    const db = shop('2026-04-01', true, false)
    const company = readCompanyInfo(db)
    expect(simpleHomeAttention(db, company, TODAY).items.filter((i) => i.source === 'close')).toEqual([])
    const home = simpleHome(db, company, { today: TODAY, backups: [] })
    expect(home.gst?.kind === 'regular' && home.gst.row).toMatchObject({ period: '2026-11', soFar: true, gstr3bDue: '2026-12-20' })
  })

  it('a business already running (not fresh) is reminded of October as before', () => {
    const db = shop('2026-04-01', false)
    const company = readCompanyInfo(db)
    const home = simpleHome(db, company, { today: TODAY, backups: [] })
    expect(home.gst?.kind === 'regular' && home.gst.row).toMatchObject({
      period: '2026-10', from: '2026-10-01', to: '2026-10-31', soFar: false, gstr1Due: '2026-11-11', gstr3bDue: '2026-11-20', liability: 0
    })
    expect(simpleHomeAttention(db, company, TODAY).items.some((i) => i.key === 'gst_returns')).toBe(true)
  })

  it('books that began this month: the running month shows ITS due dates (20 Dec), not the skipped month’s', () => {
    const db = shop('2026-11-01', false)
    const company = readCompanyInfo(db)
    const home = simpleHome(db, company, { today: TODAY, backups: [] })
    expect(home.gst?.kind === 'regular' && home.gst.row).toMatchObject({ period: '2026-11', soFar: true, gstr1Due: '2026-12-11', gstr3bDue: '2026-12-20', liability: 9000 })
    const taxes = simpleTaxes(db, company, {}, TODAY)
    expect(taxes.kind === 'regular' && taxes.period).toMatchObject({ period: '2026-11', soFar: true })
  })
})

describe('audit 2 UX2-2: the walk-in "Cash sale" is not the first customer', () => {
  it('a cash bill to the walk-in leaves "Add your first customer or supplier" open; a real customer ticks it', () => {
    const db = shop('2026-04-01', true)
    expect(db.prepare("SELECT COUNT(*) AS n FROM ledgers WHERE name = 'Cash sale'").get()).toEqual({ n: 1 })
    expect(dashSetup(db, readCompanyInfo(db), 0, 0).userLedgers).toBe(0)
    const debtors = (db.prepare("SELECT id FROM groups WHERE name = 'Sundry Debtors'").get() as { id: number }).id
    createLedger(db, { name: 'Sita Devi', groupId: debtors, openingBalance: 0, gstin: null, stateCode: '27', address: null, taxType: null, gstRate: null, hsn: null, tdsSectionId: null, pan: null, creditDays: null, exportType: null })
    expect(dashSetup(db, readCompanyInfo(db), 0, 0).userLedgers).toBe(1)
    expect(userPartyCount(db)).toBe(1)
    expect(simpleHome(db, readCompanyInfo(db), { today: TODAY, backups: [] }).setup.userLedgers).toBe(1)
  })

  it('review of #274: a bank account added for the first UPI sale is not a customer or supplier either', () => {
    const db = shop('2026-04-01', true, false)
    const banks = (db.prepare("SELECT id FROM groups WHERE name = 'Bank Accounts'").get() as { id: number }).id
    const hdfc = createLedger(db, { name: 'HDFC', groupId: banks, openingBalance: 0, gstin: null, stateCode: null, address: null, taxType: null, gstRate: null, hsn: null, tdsSectionId: null, pan: null, creditDays: null, exportType: null }).id
    postIntent(db, readCompanyInfo(db), { clientId: 'upi-bill-00001', kind: 'sale', date: TODAY, amount: { amount: 50000, gstRate: 18 }, payment: { how: 'upi', accountId: hdfc } }, TODAY)
    // The accountant's "Create your first ledger" (a customer, supplier or expense account) counts HDFC as before …
    expect(dashSetup(db, readCompanyInfo(db), 1, 0).userLedgers).toBe(1)
    // … simple Home's "Add your first customer or supplier" does not.
    expect(userPartyCount(db)).toBe(0)
    expect(simpleHome(db, readCompanyInfo(db), { today: TODAY, backups: [] }).setup.userLedgers).toBe(0)
  })
})
