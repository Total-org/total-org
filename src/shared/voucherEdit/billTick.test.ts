import { describe, it, expect } from 'vitest'
import { tickBillAmount } from './billTick'

// Hand-worked (paise): the audit's COR-2 case and its neighbours.
describe('tickBillAmount (audit A1 / COR-2)', () => {
  it('receipt ₹5,000 already on bill A (₹5,000): ticking B (₹3,000) is refused, not ₹3,000 more', () => {
    expect(tickBillAmount(300_000, 500_000, [{ amount: 500_000 }])).toBeNull()
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
    expect(tickBillAmount(300_000, 200_000, [{ amount: 500_000 }])).toBeNull()
  })
})
