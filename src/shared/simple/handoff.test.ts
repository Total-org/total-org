// Phase 5 — the hand-off's second step (followUpIntent): the money paid / received / refunded now,
// as a money intent set against the entry the first step saved. Hand-worked figures.
import { describe, expect, it } from 'vitest'
import { followUpIntent, moneyPartOf, type SimpleHandoff } from './handoff'
import type { IntentOpenBill } from './intents'

const BILLS: IntentOpenBill[] = [
  { name: 'S-1', date: '2025-07-01', pending: 50_000, voucherId: 51 },
  { name: 'S-7', date: '2025-08-14', pending: 11_800, voucherId: 70 }
]
const h = (kind: SimpleHandoff['kind'], intent: Record<string, unknown>, others: SimpleHandoff['others']): Pick<SimpleHandoff, 'kind' | 'intent' | 'others'> => ({
  kind, intent: { clientId: 'x-handoff-1', kind, ...intent } as never, others
})
const saved = { voucherId: 70, date: '2025-08-14', partyId: 10, openBills: BILLS }

describe('followUpIntent', () => {
  it('a sale part paid by UPI: money in for the customer, against the saved bill by id, for what was paid', () => {
    const r = followUpIntent(h('sale', { customerId: 10, payment: { how: 'upi', amount: '50', accountId: 3, reference: 'UTR9' }, narration: 'Diwali' }, [{ role: 'payment', kind: 'receipt', amount: 5000 }]), saved)
    expect(r).toEqual({
      kind: 'money_in', date: '2025-08-14', narration: 'Diwali', amount: 5000, into: { how: 'upi', accountId: 3, reference: 'UTR9' },
      customerId: 10, bills: [{ name: 'S-7', amount: 5000, billId: 70 }]
    })
  })

  it('never more than the saved bill still has open (the editor lowered it): ₹118 paid, ₹100 open → ₹100', () => {
    const r = followUpIntent(h('sale', { customerId: 10, payment: { how: 'cash' } }, [{ role: 'payment', kind: 'receipt', amount: 11_800 }]), {
      ...saved, openBills: [{ ...BILLS[1]!, pending: 10_000 }]
    })
    expect(r).toMatchObject({ kind: 'money_in', amount: 10_000, into: { how: 'cash' }, bills: [{ name: 'S-7', amount: 10_000, billId: 70 }] })
  })

  it('a purchase paid now: money out to the supplier against the saved bill', () => {
    const r = followUpIntent(h('purchase', { supplierId: 20, payment: { how: 'bank' } }, [{ role: 'payment', kind: 'payment', amount: 11_800 }]), { ...saved, partyId: 20 })
    expect(r).toEqual({ kind: 'money_out', date: '2025-08-14', amount: 11_800, from: { how: 'bank' }, supplierId: 20, bills: [{ name: 'S-7', amount: 11_800, billId: 70 }] })
  })

  it('returns refunded now: money out to the customer / in from the supplier for the refund', () => {
    expect(followUpIntent(h('return_sale', { billId: 5, refund: { how: 'cash' } }, [{ role: 'refund', kind: 'payment', amount: 2360 }]), saved)).toEqual({
      kind: 'money_out', date: '2025-08-14', amount: 2360, from: { how: 'cash' }, customerId: 10
    })
    expect(followUpIntent(h('return_purchase', { billId: 5, refund: { how: 'bank' } }, [{ role: 'refund', kind: 'receipt', amount: 1000 }]), { ...saved, partyId: 20 })).toEqual({
      kind: 'money_in', date: '2025-08-14', amount: 1000, into: { how: 'bank' }, supplierId: 20
    })
  })

  it('nothing to offer: on credit, no money part, no party, the saved bill settled or gone', () => {
    const paid = [{ role: 'payment' as const, kind: 'receipt' as const, amount: 5000 }]
    expect(followUpIntent(h('sale', { customerId: 10, payment: { how: 'credit' } }, []), saved)).toBeNull()
    expect(followUpIntent(h('sale', { customerId: 10, payment: { how: 'cash' } }, []), saved)).toBeNull()
    expect(followUpIntent(h('sale', { payment: { how: 'cash' } }, paid), { ...saved, partyId: null })).toBeNull()
    expect(followUpIntent(h('sale', { customerId: 10, payment: { how: 'cash' } }, paid), { ...saved, openBills: [BILLS[0]!] })).toBeNull()
    expect(followUpIntent(h('stock_count', {}, paid), saved)).toBeNull()
    expect(moneyPartOf({ others: [{ role: 'payment', kind: 'receipt', amount: 0 }] })).toBeNull()
  })
})
