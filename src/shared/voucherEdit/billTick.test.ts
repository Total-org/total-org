import { describe, it, expect } from 'vitest'
import { raisesPartySide, tickBillAmount } from './billTick'

// Hand-worked (paise): the audit's COR-2 case and its neighbours.
describe('tickBillAmount — an entry that settles the bill (audit A1 / COR-2)', () => {
  it('receipt ₹5,000 already on bill A (₹5,000): ticking B (₹3,000) is refused, not ₹3,000 more', () => {
    expect(tickBillAmount(300_000, 500_000, [{ amount: 500_000 }])).toBe('full')
  })
  it('receipt ₹5,000 with ₹4,000 on A: B (₹3,000) takes the ₹1,000 left', () => {
    expect(tickBillAmount(300_000, 500_000, [{ amount: 400_000 }])).toBe(100_000)
  })
  it('receipt ₹5,000, nothing allocated: B (₹3,000) takes its whole ₹3,000', () => {
    expect(tickBillAmount(300_000, 500_000, [])).toBe(300_000)
  })
  it('no amount typed yet: the whole pending, as before', () => {
    expect(tickBillAmount(300_000, 0, [])).toBe(300_000)
    expect(tickBillAmount(300_000, 0, [{ amount: 100_000 }])).toBe(300_000)
  })
  it('over-allocated already (amount lowered after ticking): refused', () => {
    expect(tickBillAmount(300_000, 200_000, [{ amount: 500_000 }])).toBe('full')
  })
})

describe('tickBillAmount — an entry that raises the bill (review of #233)', () => {
  it('debit note ₹1,180 on S/1 with ₹300 pending: S/1 takes the whole ₹1,180 (pending is no limit)', () => {
    expect(tickBillAmount(30_000, 118_000, [], true)).toBe(118_000)
  })
  it('₹1,180 note with ₹1,000 already on another bill: the ₹180 left', () => {
    expect(tickBillAmount(30_000, 118_000, [{ amount: 100_000 }], true)).toBe(18_000)
  })
  it('all allocated → refused; no amount yet → asks for it', () => {
    expect(tickBillAmount(30_000, 118_000, [{ amount: 118_000 }], true)).toBe('full')
    expect(tickBillAmount(30_000, 0, [], true)).toBe('no_amount')
  })
})

describe('raisesPartySide', () => {
  it('a debit raises a customer; a credit raises a supplier', () => {
    expect(raisesPartySide('debtor', 'dr')).toBe(true)
    expect(raisesPartySide('debtor', 'cr')).toBe(false)
    expect(raisesPartySide('creditor', 'cr')).toBe(true)
    expect(raisesPartySide('creditor', 'dr')).toBe(false)
    // no party role (the engine treats it as the creditor side)
    expect(raisesPartySide(null, 'cr')).toBe(true)
  })
})
