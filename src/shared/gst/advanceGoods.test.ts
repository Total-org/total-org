import { describe, expect, it } from 'vitest'
import { goodsAdvanceMessage, goodsAdvanceParties, openAdvanceReceipts, rateLessAdvanceMessage, supplyKindOfHsn, type AdvanceParty, type AdvanceReceipt } from './advanceGoods'

const party = (id: number, goods: number, services: number, voucherIds = [id * 10]): AdvanceParty => ({
  partyId: id, partyName: `P${id}`, voucherIds, sales: { goods, services }
})

describe('supplyKindOfHsn', () => {
  it('chapter 99 is a service (SAC), any other code goods, the rest unknown', () => {
    expect(supplyKindOfHsn('998314')).toBe('services')
    expect(supplyKindOfHsn('9954')).toBe('services')
    expect(supplyKindOfHsn('8471')).toBe('goods')
    expect(supplyKindOfHsn(' 61091000 ')).toBe('goods')
    expect(supplyKindOfHsn('09')).toBeNull()
    expect(supplyKindOfHsn('')).toBeNull()
    expect(supplyKindOfHsn(null)).toBeNull()
    expect(supplyKindOfHsn('ABCD')).toBeNull()
  })
})

describe('goodsAdvanceParties', () => {
  it('flags a customer whose coded sales are goods only', () => {
    expect(goodsAdvanceParties([party(1, 3, 0)], { goods: 0, services: 5 }).map((p) => p.partyId)).toEqual([1])
  })
  it('never flags a customer with any service sale', () => {
    expect(goodsAdvanceParties([party(1, 3, 1)], { goods: 9, services: 0 })).toEqual([])
  })
  it('a customer with no coded sale follows the business', () => {
    expect(goodsAdvanceParties([party(1, 0, 0)], { goods: 4, services: 0 }).map((p) => p.partyId)).toEqual([1])
    expect(goodsAdvanceParties([party(1, 0, 0)], { goods: 4, services: 1 })).toEqual([])
    expect(goodsAdvanceParties([party(1, 0, 0)], { goods: 0, services: 0 })).toEqual([])
  })
})

describe('goodsAdvanceMessage', () => {
  it('counts the advances and names at most three customers', () => {
    const m = goodsAdvanceMessage([party(1, 1, 0, [1, 2]), party(2, 1, 0), party(3, 1, 0), party(4, 1, 0)])
    expect(m).toMatch(/^5 advances in Table 11A are from customers you sell goods to \(P1, P2, P3 and 1 more\)/)
    expect(m).toContain('Notification 66/2017-Central Tax')
    expect(goodsAdvanceMessage([party(1, 1, 0)])).toMatch(/^1 advance in Table 11A is from/)
  })
})

// R3 / FIG-G-2 — advances Table 11A leaves out for want of a rate on the account.
describe('openAdvanceReceipts', () => {
  const r = (voucherId: number, name: string, amount: number, partyId = 1): AdvanceReceipt => ({ partyId, partyName: `P${partyId}`, voucherId, name, amount })
  it('an advance the period’s invoices take in full is not open; a part, or another name, is', () => {
    const receipts = [r(1, 'ADV-1', 1_180_000), r(2, 'ADV-2', 500_000), r(3, 'ADV-1', 100_000, 2)]
    // ADV-1 of party 1 taken in full (₹11,800); ADV-2 half (₹2,500 of ₹5,000); party 2's ADV-1 untouched.
    const used = new Map([['1|ADV-1', 1_180_000], ['1|ADV-2', 250_000]])
    expect(openAdvanceReceipts(receipts, used).map((x) => x.voucherId)).toEqual([2, 3])
    expect(openAdvanceReceipts(receipts, new Map()).map((x) => x.voucherId)).toEqual([1, 2, 3])
  })
  it('two receipts of one name: the invoices take the first in the order given, then the second', () => {
    const receipts = [r(1, 'ADV', 600_000), r(2, 'ADV', 400_000)]
    expect(openAdvanceReceipts(receipts, new Map([['1|ADV', 600_000]])).map((x) => x.voucherId)).toEqual([2])
    expect(openAdvanceReceipts(receipts, new Map([['1|ADV', 700_000]])).map((x) => x.voucherId)).toEqual([2])
    expect(openAdvanceReceipts(receipts, new Map([['1|ADV', 1_000_000]]))).toEqual([])
    // More than the advances: nothing open, never negative.
    expect(openAdvanceReceipts(receipts, new Map([['1|ADV', 9_000_000]]))).toEqual([])
  })
})

describe('rateLessAdvanceMessage', () => {
  it('counts receipts, names up to three customers, and never says tax IS due', () => {
    const m = rateLessAdvanceMessage([party(1, 0, 1, [10, 11]), party(2, 0, 0), party(3, 0, 0), party(4, 1, 1)])
    expect(m).toMatch(/^5 advances received in this period are not in Table 11A, because the customer’s account has no GST rate \(P1, P2, P3 and 1 more\)\./)
    expect(m).toContain('If an advance is for a taxable service, its GST counts in the period you received it (s.13(2) CGST Act; rule 50')
    expect(m).toContain('Notification 66/2017-Central Tax')
    expect(m).not.toMatch(/GST is due|tax is due/)
    expect(rateLessAdvanceMessage([party(1, 0, 0)])).toMatch(/^1 advance received in this period is not in Table 11A/)
  })
})
