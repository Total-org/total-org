import { describe, expect, it } from 'vitest'
import { newPinProblem, OWNER_PIN_MIN_DIGITS, PIN_MAX_DIGITS, PIN_MIN_DIGITS } from './pinRules'
import { userInputSchema } from './schemas'

describe('PIN lengths (1.0 readiness SEC-13, decision Q7)', () => {
  it('an owner’s new PIN needs 6 digits: 5 is refused, 6 is fine', () => {
    expect(OWNER_PIN_MIN_DIGITS).toBe(6)
    expect(newPinProblem('12345', 'owner', null)).toBe('owner_pin_short')
    expect(newPinProblem('1234', 'owner', true)).toBe('owner_pin_short')
    expect(newPinProblem('123456', 'owner', null)).toBeNull()
    expect(newPinProblem('123456', 'owner', false)).toBeNull()
  })
  it('accountants and viewers keep the 4-digit floor (the schema’s)', () => {
    expect(newPinProblem('1234', 'accountant', null)).toBeNull()
    expect(newPinProblem('1234', 'viewer', true)).toBeNull()
    const parse = (pin: string): boolean => userInputSchema.safeParse({ name: 'A', role: 'viewer', pin }).success
    expect([PIN_MIN_DIGITS, PIN_MAX_DIGITS]).toEqual([4, 12])
    expect([parse('123'), parse('1234'), parse('1'.repeat(12)), parse('1'.repeat(13))]).toEqual([false, true, true, false])
  })
  it('an owner kept as owner without a new PIN keeps the stored one (old 4-digit PINs keep working)', () => {
    expect(newPinProblem(undefined, 'owner', true)).toBeNull()
  })
  it('making someone an owner needs a new 6-digit PIN at that moment', () => {
    expect(newPinProblem(undefined, 'owner', false)).toBe('owner_pin_needed')
    expect(newPinProblem('1234', 'owner', false)).toBe('owner_pin_short')
    // An owner made an accountant keeps their PIN.
    expect(newPinProblem(undefined, 'accountant', true)).toBeNull()
  })
})
