import { describe, expect, it } from 'vitest'
import { cleanUpiId, isUpiId, normalizeUpiSettings, upiPayLink, upiSettingsSchema } from './upi'

describe('UPI ID (A10)', () => {
  it('accepts name@bank, cleans spaces and case', () => {
    expect(isUpiId('ramesh.traders@okhdfcbank')).toBe(true)
    expect(isUpiId(' Shop-1_2@YBL ')).toBe(true)
    expect(cleanUpiId(' Shop-1_2@YBL ')).toBe('shop-1_2@ybl')
  })
  it('refuses what is not a UPI ID', () => {
    for (const bad of ['', 'ramesh', '@ybl', 'r@', 'a@ybl', 'ram esh@1bank', 'x@y@z', 'ram&esh@ybl', '9876543210']) expect(isUpiId(bad)).toBe(false)
  })
  it('schema: blank clears, a bad id is refused, keys are strict', () => {
    expect(upiSettingsSchema.parse({ upiId: '' })).toEqual({ upiId: null })
    expect(upiSettingsSchema.parse({ upiId: null })).toEqual({ upiId: null })
    expect(upiSettingsSchema.parse({ upiId: 'Shop@YBL' })).toEqual({ upiId: 'shop@ybl' })
    expect(upiSettingsSchema.safeParse({ upiId: 'shop' }).success).toBe(false)
    expect(upiSettingsSchema.safeParse({ upiId: 'shop@ybl', x: 1 }).success).toBe(false)
  })
  it('stored meta: missing / broken = none', () => {
    expect(normalizeUpiSettings(null)).toEqual({ upiId: null })
    expect(normalizeUpiSettings({ upiId: 5 })).toEqual({ upiId: null })
    expect(normalizeUpiSettings({ upiId: 'bad' })).toEqual({ upiId: null })
    expect(normalizeUpiSettings({ upiId: 'shop@ybl' })).toEqual({ upiId: 'shop@ybl' })
  })
})

describe('upi://pay link (NPCI linking spec 1.6)', () => {
  it('hand-worked: ₹1,180.50 due on bill 12/25-26', () => {
    expect(upiPayLink({ upiId: 'ramesh@okhdfcbank', payeeName: 'Ramesh & Sons', amountPaise: 118050, billNo: '12/25-26' })).toBe(
      'upi://pay?pa=ramesh@okhdfcbank&pn=Ramesh%20%26%20Sons&am=1180.50&tn=Bill%2012%2F25-26&cu=INR'
    )
  })
  it('amount is two decimals of rupees from integer paise', () => {
    expect(upiPayLink({ upiId: 'a1@ybl', payeeName: 'A', amountPaise: 5, billNo: '1' })).toContain('&am=0.05&')
    expect(upiPayLink({ upiId: 'a1@ybl', payeeName: 'A', amountPaise: 100000, billNo: '1' })).toContain('&am=1000.00&')
  })
  it('nothing due or no valid id → no link', () => {
    expect(upiPayLink({ upiId: 'a1@ybl', payeeName: 'A', amountPaise: 0, billNo: '1' })).toBeNull()
    expect(upiPayLink({ upiId: 'a1@ybl', payeeName: 'A', amountPaise: -100, billNo: '1' })).toBeNull()
    expect(upiPayLink({ upiId: 'nope', payeeName: 'A', amountPaise: 100, billNo: '1' })).toBeNull()
  })
  it('Hindi payee names are percent-encoded UTF-8; the note is capped', () => {
    const l = upiPayLink({ upiId: 'a1@ybl', payeeName: 'राम', amountPaise: 100, billNo: 'X'.repeat(80) })!
    expect(l).toContain('pn=%E0%A4%B0%E0%A4%BE%E0%A4%AE')
    expect(decodeURIComponent(new URL(l.replace('upi://', 'https://x/')).searchParams.get('tn')!)).toHaveLength(50)
  })
})
