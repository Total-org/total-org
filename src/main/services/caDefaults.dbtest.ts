// Audit A8 (CA defaults pack): the reads behind two new defaults — the party picker's "used
// recently" order (UX-3) and the GST return period the return screens open on (UX-4, the same
// period the Compliance card names). Both are reads; neither changes a figure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { DB } from '../db/connection'
import { openCompanyDb, closeCompanyDb } from '../db/connection'
import { DEMO_COMPANY } from '@shared/demo'
import { fyOf, todayISO } from '@shared/dates'
import { createDemoCompany } from './demo'
import { dashGst, gstDuePeriod } from './dashboard'
import { deleteVoucher, recentParties, saveVoucher } from './vouchers'
import { setGstProfile } from './config'
import { setGstFiled } from './simpleTaxes'

let dataDir: string
let db: DB
const today = todayISO()
const info = { ...DEMO_COMPANY, booksFrom: fyOf(today).startYear }

const id = (sql: string, ...args: unknown[]): number => (db.prepare(sql).get(...args) as { id: number }).id
const ledger = (name: string): number => id('SELECT id FROM ledgers WHERE name = ?', name)
const vtype = (kind: string): number => id('SELECT id FROM voucher_types WHERE kind = ? ORDER BY id LIMIT 1', kind)
const header = {
  narration: null, reference: null, instrumentNo: null, instrumentDate: null,
  transporterId: null, vehicleNo: null, transportDistanceKm: null, currencyCode: null, exchangeRate: null
}
function post(kind: string, party: string, lines: [string, 'dr' | 'cr', number][]): number {
  return saveVoucher(db, {
    ...header,
    partyLedgerId: ledger(party),
    voucherTypeId: vtype(kind),
    date: today,
    lines: lines.map(([name, drCr, amount]) => ({ ledgerId: ledger(name), drCr, amount }))
  }).id
}

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'total-ca-defaults-'))
  process.env.TOTAL_DATA_DIR = dataDir
  db = openCompanyDb(createDemoCompany().slug)
})

afterAll(() => {
  closeCompanyDb(db)
  delete process.env.TOTAL_DATA_DIR
  rmSync(dataDir, { recursive: true, force: true })
})

describe('recentParties (UX-3)', () => {
  it('newest first per side, each party once, binned vouchers left out', () => {
    post('sales', 'Krishna Enterprises', [['Krishna Enterprises', 'dr', 10000], ['Sales A/c', 'cr', 10000]])
    post('credit_note', 'Silverline Traders', [['Sales A/c', 'dr', 5000], ['Silverline Traders', 'cr', 5000]])
    const binned = post('sales', 'Umbrella Retail', [['Umbrella Retail', 'dr', 7000], ['Sales A/c', 'cr', 7000]])
    post('purchase', 'Bharat Steel Suppliers', [['Purchase A/c', 'dr', 4000], ['Bharat Steel Suppliers', 'cr', 4000]])

    const sales = recentParties(db, 'sales')
    expect(sales.slice(0, 3)).toEqual([ledger('Umbrella Retail'), ledger('Silverline Traders'), ledger('Krishna Enterprises')])
    expect(new Set(sales).size).toBe(sales.length)

    deleteVoucher(db, binned)
    const after = recentParties(db, 'sales')
    expect(after[0]).toBe(ledger('Silverline Traders'))
    // Umbrella Retail still has older (demo) sales, so it stays — only further down.
    expect(after.indexOf(ledger('Umbrella Retail'))).toBeGreaterThan(1)

    const purchases = recentParties(db, 'purchase')
    expect(purchases[0]).toBe(ledger('Bharat Steel Suppliers'))
    // A purchase never names a customer here, nor a sale a supplier.
    expect(purchases).not.toContain(ledger('Krishna Enterprises'))
    expect(sales).not.toContain(ledger('Bharat Steel Suppliers'))

    // The walk is bounded to the newest vouchers by id: with a window of one, only the purchase
    // posted last is read — the purchase side has its supplier, the sales side nothing.
    expect(recentParties(db, 'purchase', 10, 500, 1)).toEqual([ledger('Bharat Steel Suppliers')])
    expect(recentParties(db, 'sales', 10, 500, 1)).toEqual([])
  })
})

describe('gstDuePeriod (UX-4)', () => {
  it('monthly: the month whose GSTR-3B is due next — October until 20 November, then November', () => {
    // GSTR-3B (monthly) is due on the 20th of the next month (shared/gst/filing.ts).
    expect(gstDuePeriod(db, info, '2026-11-07')).toMatchObject({ period: '2026-10', from: '2026-10-01', to: '2026-10-31', soFar: false })
    expect(gstDuePeriod(db, info, '2026-11-20')?.period).toBe('2026-10')
    expect(gstDuePeriod(db, info, '2026-11-21')?.period).toBe('2026-11')
  })

  it('is exactly the period (and dates) the Compliance card shows', () => {
    for (const day of ['2026-11-07', '2026-11-25', '2027-01-03']) {
      const card = dashGst(db, info, day)!
      expect(gstDuePeriod(db, info, day)).toEqual({
        period: card.period, from: card.from, to: card.to, quarterly: card.quarterly, soFar: card.soFar, gstr1Due: card.gstr1Due, gstr3bDue: card.gstr3bDue, gstr1Filed: card.gstr1Filed
      })
    }
  })

  it('quarterly: the quarter just ended while its GSTR-3B is near (its last month), else the running one', () => {
    setGstProfile(db, { filing: 'quarterly' })
    // Oct–Dec 2026: its GSTR-3B falls on 22 / 24 Jan 2027, within 45 days of 3 Jan.
    expect(gstDuePeriod(db, info, '2027-01-03')).toMatchObject({ period: '2026-12', from: '2026-10-01', quarterly: true })
    // On 7 Nov the next GSTR-3B (Oct–Dec) is more than 45 days away: the running quarter so far.
    expect(gstDuePeriod(db, info, '2026-11-07')).toMatchObject({ period: '2026-11', from: '2026-10-01', soFar: true })
    setGstProfile(db, { filing: 'monthly' })
  })

  it('UI-1: the GSTR-1 date is the named period\u2019s own — October\u2019s 11 Nov, not November\u2019s 11 Dec', () => {
    // 18 Nov: the next GSTR-3B (20 Nov) files October, so October is the period. GSTR-1 is due the
    // 11th of the next month (shared/gst/filing.ts): October's was 11 Nov — a week gone — and the
    // next GSTR-1 in the 45-day window (11 Dec) is November's, which is what the card used to say.
    expect(gstDuePeriod(db, info, '2026-11-18')).toMatchObject({ period: '2026-10', gstr1Due: '2026-11-11', gstr3bDue: '2026-11-20' })
    expect(gstDuePeriod(db, info, '2026-11-18')?.gstr1Filed).toBeUndefined()
    // On 7 Nov nothing has passed yet and the date is the same one.
    expect(gstDuePeriod(db, info, '2026-11-07')?.gstr1Due).toBe('2026-11-11')
  })

  it('UI-1: a GSTR-1 marked filed is said so (the card must not call it late); the 3B still open keeps the period', () => {
    const base = { period: '2026-10', form: 'gstr1' as const }
    setGstFiled(db, info, { ...base, arn: 'AA2710000001234', date: '2026-11-12' }, null, '2026-11-18')
    try {
      expect(gstDuePeriod(db, info, '2026-11-18')).toMatchObject({ period: '2026-10', gstr1Due: '2026-11-11', gstr1Filed: true })
    } finally {
      setGstFiled(db, info, { ...base, arn: null }, null, '2026-11-18')
    }
    expect(gstDuePeriod(db, info, '2026-11-18')?.gstr1Filed).toBeUndefined()
  })

  it('UI-1: once October\u2019s 3B is marked filed the card is November so far, with November\u2019s own GSTR-1 (11 Dec) and 3B (20 Dec)', () => {
    const f = { period: '2026-10', form: 'gstr3b' as const }
    setGstFiled(db, info, { ...f, arn: 'AA2710000009999', date: '2026-11-19' }, null, '2026-11-19')
    try {
      expect(gstDuePeriod(db, info, '2026-11-19')).toMatchObject({ period: '2026-11', soFar: true, gstr1Due: '2026-12-11', gstr3bDue: '2026-12-20' })
      expect(gstDuePeriod(db, info, '2026-11-19')?.gstr1Filed).toBeUndefined()
    } finally {
      setGstFiled(db, info, { ...f, arn: null }, null, '2026-11-19')
    }
  })

  it('UI-1: a quarterly filer\u2019s card carries the 13th after its quarter (Oct–Dec → 13 Jan), and the running quarter shows no date yet', () => {
    setGstProfile(db, { filing: 'quarterly' })
    try {
      expect(gstDuePeriod(db, info, '2027-01-03')).toMatchObject({ period: '2026-12', gstr1Due: '2027-01-13' })
      // 14 Jan: the quarter's GSTR-1 (13 Jan) has passed and its GSTR-3B (22 / 24 Jan) is still due.
      expect(gstDuePeriod(db, info, '2027-01-14')).toMatchObject({ period: '2026-12', gstr1Due: '2027-01-13' })
      // The running quarter lists its GSTR-1 once that date is inside the 45-day window: 13 Jan is
      // 43 days after 1 Dec (30 + 13), 44 days after 30 Nov, 45 after 29 Nov, 46 after 28 Nov —
      // while its 22 / 24 Jan GSTR-3B (≥ 52 days) is still not listed.
      expect(gstDuePeriod(db, info, '2026-11-28')).toMatchObject({ period: '2026-11', soFar: true, gstr1Due: null, gstr3bDue: null })
      expect(gstDuePeriod(db, info, '2026-11-29')).toMatchObject({ period: '2026-11', soFar: true, gstr1Due: '2027-01-13', gstr3bDue: null })
      expect(gstDuePeriod(db, info, '2026-12-01')).toMatchObject({ period: '2026-12', soFar: true, gstr1Due: '2027-01-13', gstr3bDue: null })
      // Otherwise (more than 45 days from the quarter's dates) no dates at all.
      expect(gstDuePeriod(db, info, '2026-11-07')).toMatchObject({ period: '2026-11', soFar: true, gstr1Due: null, gstr3bDue: null })
    } finally {
      setGstProfile(db, { filing: 'monthly' })
    }
  })

  it('only a regular registration has one', () => {
    expect(gstDuePeriod(db, { ...info, gstRegistrationType: 'composition' }, '2026-11-07')).toBeNull()
    expect(gstDuePeriod(db, { ...info, gstRegistrationType: 'unregistered' }, '2026-11-07')).toBeNull()
  })
})
