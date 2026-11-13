import { describe, expect, it } from 'vitest'
import { billTaxClass, noteFollowsBill, zeroRatedClass, zeroRatedKind } from './zeroRated'

describe('zero-rated supplies (IGST Act s.7(5), s.16)', () => {
  it('reads the party flag', () => {
    expect(zeroRatedClass('sez_wp')).toEqual({ sez: true, withPayment: true })
    expect(zeroRatedClass('sez_wop')).toEqual({ sez: true, withPayment: false })
    expect(zeroRatedClass('exp_wp')).toEqual({ sez: false, withPayment: true })
    expect(zeroRatedClass('exp_wop')).toEqual({ sez: false, withPayment: false })
    expect(zeroRatedClass(null)).toBeNull()
    expect(zeroRatedClass(undefined)).toBeNull()
  })
  it('only outward bill kinds follow it', () => {
    expect(['sales', 'credit_note'].every((k) => zeroRatedKind(k as 'sales'))).toBe(true)
    expect(['purchase', 'debit_note', 'receipt', 'journal'].some((k) => zeroRatedKind(k as 'sales'))).toBe(false)
  })
  it('an SEZ unit in our own state is inter-state; without payment no tax', () => {
    expect(billTaxClass('27', 'sales', { stateCode: '27', exportType: 'sez_wp' }, null)).toMatchObject({ supply: 'inter', zeroTax: false })
    expect(billTaxClass('27', 'sales', { stateCode: '27', exportType: 'sez_wp' }, '27')).toMatchObject({ supply: 'inter', zeroTax: false })
    expect(billTaxClass('27', 'sales', { stateCode: '27', exportType: 'sez_wop' }, null)).toMatchObject({ supply: 'inter', zeroTax: true })
    expect(billTaxClass('27', 'credit_note', { stateCode: '96', exportType: 'exp_wop' }, null)).toMatchObject({ supply: 'inter', zeroTax: true })
  })
  it('everything else is decided by the place of supply, as before', () => {
    expect(billTaxClass('27', 'sales', { stateCode: '27', exportType: null }, null)).toEqual({ supply: 'intra', zeroTax: false, zeroRated: null })
    expect(billTaxClass('27', 'sales', { stateCode: '27' }, '29')).toEqual({ supply: 'inter', zeroTax: false, zeroRated: null })
    expect(billTaxClass('27', 'sales', undefined, null)).toEqual({ supply: 'intra', zeroTax: false, zeroRated: null })
    // An unflagged foreign buyer keeps its computed IGST (as the e-invoice does).
    expect(billTaxClass('27', 'sales', { stateCode: '96' }, null)).toEqual({ supply: 'inter', zeroTax: false, zeroRated: null })
    expect(billTaxClass('27', 'purchase', { stateCode: '27', exportType: 'sez_wop' }, null)).toEqual({ supply: 'intra', zeroTax: false, zeroRated: null })
  })
})

describe('owner Q4 (audit 2 COR2-3): noteFollowsBill — a return of a saved bill that charged GST the rule would not', () => {
  it('a "without payment" party: any tax on the bill is followed, at the supply it posted', () => {
    expect(noteFollowsBill('sales', 'sez_wop', { cgst: 9000, sgst: 9000, igst: 0 })).toBe('intra')
    expect(noteFollowsBill('sales', 'exp_wop', { cgst: 0, sgst: 0, igst: 18000 })).toBe('inter')
  })
  it('a "with payment" party: CGST + SGST is followed (the rule says IGST); IGST is what the rule gives — nothing to follow', () => {
    expect(noteFollowsBill('sales', 'sez_wp', { cgst: 9000, sgst: 9000, igst: 0 })).toBe('intra')
    expect(noteFollowsBill('sales', 'sez_wp', { cgst: 0, sgst: 0, igst: 18000 })).toBeNull()
  })
  it('no flag, no tax, or not a sale: today\'s rule', () => {
    expect(noteFollowsBill('sales', null, { cgst: 9000, sgst: 9000, igst: 0 })).toBeNull()
    expect(noteFollowsBill('sales', 'sez_wop', { cgst: 0, sgst: 0, igst: 0 })).toBeNull()
    expect(noteFollowsBill('purchase', 'sez_wop', { cgst: 9000, sgst: 9000, igst: 0 })).toBeNull()
  })
})
