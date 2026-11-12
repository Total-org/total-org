import { describe, expect, it } from 'vitest'
import { addDaysISO } from './dates'
import { DEMO_ITEMS } from './demo'
import { SAMPLE_STOCK, sampleShopPlan } from './sampleShop'

// Audit A7 / UX-2: the sample shop's plan, before anything is posted. Every "today" of two years
// (each day) gives a plan whose entries all fall inside the books, whose stock never goes below
// zero (purchases on a day count before that day's sales), and whose money moves only for bills
// that exist.
describe('sampleShopPlan', () => {
  it('begins on the 1st of the month two months back', () => {
    expect(sampleShopPlan('2026-11-12').booksBegin).toBe('2026-09-01')
    expect(sampleShopPlan('2027-01-31').booksBegin).toBe('2026-11-01')
    expect(sampleShopPlan('2026-04-01').booksBegin).toBe('2026-02-01')
  })

  it('is the same plan every time for the same day', () => {
    expect(sampleShopPlan('2026-11-12')).toEqual(sampleShopPlan('2026-11-12'))
  })

  it('every day of two years: dates inside the books, stock never below zero, payments only for bills made', () => {
    for (let today = '2026-01-01'; today <= '2027-12-31'; today = addDaysISO(today, 1)) {
      const plan = sampleShopPlan(today)
      const stock = new Map(DEMO_ITEMS.map((i) => [i.name, SAMPLE_STOCK[i.name]!.opening]))
      const seen = new Set<string>()
      let prev = plan.booksBegin
      for (const e of plan.events) {
        expect(e.date >= plan.booksBegin && e.date <= today, `${today}: ${e.id} on ${e.date}`).toBe(true)
        expect(e.date >= prev, `${today}: in date order`).toBe(true)
        prev = e.date
        if (e.kind === 'purchase') for (const l of e.lines) stock.set(l.item, stock.get(l.item)! + l.qty)
        if (e.kind === 'sale') {
          for (const l of e.lines) {
            stock.set(l.item, stock.get(l.item)! - l.qty)
            expect(stock.get(l.item)!, `${today}: ${l.item} after ${e.id}`).toBeGreaterThanOrEqual(0)
          }
        }
        if (e.kind === 'receipt') expect(seen.has(e.sale), `${today}: ${e.id}`).toBe(true)
        if (e.kind === 'payment') expect(seen.has(e.purchase), `${today}: ${e.id}`).toBe(true)
        seen.add(e.id)
      }
      expect(new Set(plan.events.map((e) => e.id)).size).toBe(plan.events.length)
      // Day-one bills are dated before the books begin.
      for (const b of [...plan.customerBills, ...plan.supplierBills]) expect(b.date < plan.booksBegin).toBe(true)
    }
  })

  it('mid-November: weekly sales, restocks, customers paying, monthly costs', () => {
    const plan = sampleShopPlan('2026-11-12')
    const count = (k: string): number => plan.events.filter((e) => e.kind === k).length
    expect(count('sale')).toBeGreaterThan(30)
    expect(count('purchase')).toBeGreaterThan(3)
    expect(count('receipt')).toBeGreaterThan(5)
    expect(count('payment')).toBeGreaterThan(1)
    // Rent on the 5th, electricity on the 10th of Sep, Oct, Nov; salary on 28 Sep and 28 Oct.
    expect(plan.events.filter((e) => e.kind === 'cost').map((e) => e.date)).toEqual([
      '2026-09-05', '2026-09-10', '2026-09-28', '2026-10-05', '2026-10-10', '2026-10-28', '2026-11-05', '2026-11-10'
    ])
  })
})
