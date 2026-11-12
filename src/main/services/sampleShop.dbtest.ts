// Audit A7 / UX-2: the wizard's "Try with sample data" is a coherent sample shop. Built on several
// "todays" (mid-year, the first day of a FY, just after a FY turns, a month's 1st), it must:
// balance, have its day-one figures entered (no openings card), a selling price on every product,
// stock never below zero on any day, a real cost of goods in every month that sold something,
// cash and bank never below zero, some customer late and something still to pay — and the full
// app's sample (createDemoCompany() without a mode) must stay the 0.10 demo.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openCompanyDb } from '../db/connection'
import { readCompanyInfo } from '../db/seed'
import { createDemoCompany } from './demo'
import { createSampleShop } from './sampleShop'
import { trialBalance, profitAndLoss } from './reports'
import { openingsState } from './openings'
import { stockList } from './simpleStock'
import { simpleHome, simpleHomeAttention } from './simpleHome'
import { getUi } from './config'
import { IN_BOOKS } from './vouchers'
import { doingLines } from '@shared/simple/reports'
import { addDaysISO, fyOf } from '@shared/dates'
import { sampleShopPlan } from '@shared/sampleShop'
import type { DB } from '../db/connection'

let dataDir: string
beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'total-sample-shop-'))
  process.env.TOTAL_DATA_DIR = dataDir
  process.env.TOTAL_SUPPRESS_SYNC_WARNING = '1'
})
afterAll(() => {
  delete process.env.TOTAL_DATA_DIR
  rmSync(dataDir, { recursive: true, force: true })
})
afterEach(() => {
  vi.useRealTimers()
})


function build(today: string): { db: DB; slug: string } {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${today}T10:00:00`))
  const { slug } = createSampleShop(today)
  return { db: openCompanyDb(slug), slug }
}

/** Every day from the books' first day to today: each product's quantity at the end of the day. */
function minStockByItem(db: DB, from: string, today: string): Map<string, number> {
  const items = db.prepare('SELECT id, name, opening_qty_milli AS q FROM stock_items').all() as { id: number; name: string; q: number }[]
  const moves = db
    .prepare(
      `SELECT v.date, il.stock_item_id AS item, SUM(CASE il.direction WHEN 'in' THEN il.qty_milli ELSE -il.qty_milli END) AS d
         FROM inventory_lines il JOIN vouchers v ON v.id = il.voucher_id
        WHERE il.moves_stock = 1 AND ${IN_BOOKS} GROUP BY v.date, il.stock_item_id ORDER BY v.date`
    )
    .all() as { date: string; item: number; d: number }[]
  const out = new Map<string, number>()
  for (const it of items) {
    let q = it.q
    let min = q
    for (let d = from; d <= today; d = addDaysISO(d, 1)) {
      for (const m of moves) if (m.item === it.id && m.date === d) q += m.d
      min = Math.min(min, q)
    }
    out.set(it.name, min)
  }
  return out
}

/** The lowest end-of-day balance of a ledger (dr-positive) from its opening on. */
function minBalance(db: DB, ledgerId: number): number {
  const opening = (db.prepare('SELECT opening_balance AS o FROM ledgers WHERE id = ?').get(ledgerId) as { o: number }).o
  const rows = db
    .prepare(
      `SELECT v.date, SUM(CASE vl.dr_cr WHEN 'dr' THEN vl.amount ELSE -vl.amount END) AS d
         FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id
        WHERE vl.ledger_id = ? AND ${IN_BOOKS} GROUP BY v.date ORDER BY v.date`
    )
    .all(ledgerId) as { date: string; d: number }[]
  let bal = opening
  let min = bal
  for (const r of rows) {
    bal += r.d
    min = Math.min(min, bal)
  }
  return min
}

const TODAYS = ['2026-11-12', '2027-04-01', '2027-04-17', '2026-12-01']

describe('the sample shop (audit A7 / UX-2)', () => {
  for (const today of TODAYS) {
    it(`tells one believable story as on ${today}`, () => {
      const { db } = build(today)
      try {
        const info = readCompanyInfo(db)
        const plan = sampleShopPlan(today)
        expect(info.booksBeginDate).toBe(plan.booksBegin)
        expect(info.gstRegistrationType).toBe('regular')
        expect(info.address && info.phone && info.pan).toBeTruthy()
        expect(getUi(db)).toMatchObject({ mode: 'simple', startedFresh: false, setup: { businessType: 'trader', gst: 'regular', stock: true } })

        // Day one is entered: no "Enter what you had on day one" card, every part holds a figure.
        const st = openingsState(db)
        expect(st.appliedAt).not.toBeNull()
        expect(st.progress.done).toBe(st.progress.total)

        // The books balance.
        const tb = trialBalance(db, today)
        expect(tb.totalDebit).toBe(tb.totalCredit)
        expect(tb.totalDebit).toBeGreaterThan(0)

        // Every product has a selling price, and none is below zero on ANY day (so a sale is never
        // costed at ₹0 — the audit's "Office Chair −3 Nos worth ₹15,000").
        const list = stockList(db, today)
        expect(list.rows).toHaveLength(6)
        for (const r of list.rows) {
          expect(r.sellingPrice, r.name).toBeGreaterThan(0)
          expect(r.qtyMilli, r.name).toBeGreaterThanOrEqual(0)
          expect(r.value, r.name).toBeGreaterThanOrEqual(0)
        }
        expect(list.negativeCount ?? 0).toBe(0)
        for (const [name, min] of minStockByItem(db, plan.booksBegin, today)) expect(min, name).toBeGreaterThanOrEqual(0)

        // Every month that sold something has a real cost of goods (and a profit on them).
        for (let m = plan.booksBegin; m <= today; m = `${addDaysISO(m, 40).slice(0, 7)}-01`) {
          const end = addDaysISO(`${addDaysISO(m, 40).slice(0, 7)}-01`, -1)
          const to = end < today ? end : today
          const lines = doingLines(profitAndLoss(db, m, to))
          if (lines.sales === 0) continue
          expect(lines.costOfGoods, m).toBeGreaterThan(0)
          expect(lines.profitOnGoods, m).toBeGreaterThan(0)
          expect(lines.costOfGoods, m).toBeLessThan(lines.sales)
        }

        // Cash and bank never run below zero.
        const money = db.prepare(`SELECT l.id, l.name FROM ledgers l JOIN groups g ON g.id = l.group_id WHERE g.name IN ('Cash-in-Hand', 'Bank Accounts')`).all() as { id: number; name: string }[]
        expect(money.length).toBeGreaterThanOrEqual(2)
        for (const l of money) expect(minBalance(db, l.id), l.name).toBeGreaterThanOrEqual(0)

        // Home: who owes / whom you owe hold something, nothing nags about stock.
        const home = simpleHome(db, info, { today, backups: [] })
        expect(home.receivables.total).toBeGreaterThan(0)
        expect(home.cash.total).toBeGreaterThan(0)
        const attention = simpleHomeAttention(db, info, today)
        expect(attention.items.map((i) => i.key)).not.toContain('negative_stock')
        expect(attention.items.map((i) => i.key)).not.toContain('low_stock')
      } finally {
        db.close()
      }
    })
  }

  it('mid-year it has a customer paying late, bills still to pay and a profit for the year so far', () => {
    const today = '2026-11-12'
    const { db } = build(today)
    try {
      const info = readCompanyInfo(db)
      const home = simpleHome(db, info, { today, backups: [] })
      expect(home.receivables.overdueBills).toBeGreaterThan(0)
      expect(home.payables.total).toBeGreaterThan(0)
      expect(home.profit.year.netProfit).toBeGreaterThan(0)
      expect(home.profit.year.lines.costOfGoods).toBeGreaterThan(0)
      // GST: a regular registration with output tax this period.
      expect(home.gst?.kind).toBe('regular')
      expect(fyOf(info.booksBeginDate!).startYear).toBe(info.booksFrom)
    } finally {
      db.close()
    }
  })

  it('the full app’s sample (no mode) is still the 0.10 demo: no setup, no openings, no price list', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-12T10:00:00'))
    const { slug } = createDemoCompany()
    const db = openCompanyDb(slug)
    try {
      expect(db.prepare("SELECT value FROM meta WHERE key = 'ui'").get()).toBeUndefined()
      expect(db.prepare('SELECT COUNT(*) AS n FROM price_levels').get()).toEqual({ n: 0 })
      expect(db.prepare('SELECT COUNT(*) AS n FROM vouchers').get()).toEqual({ n: 40 })
    } finally {
      db.close()
    }
  })
})
