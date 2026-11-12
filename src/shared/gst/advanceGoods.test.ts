import { describe, expect, it } from 'vitest'
import { goodsAdvanceMessage, goodsAdvanceParties, supplyKindOfHsn, type AdvanceParty } from './advanceGoods'

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
