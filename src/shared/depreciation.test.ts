// The fixed-asset register's depreciation engine was removed (audit A13b); these are the helpers
// that stay (capitalGoodsGst.ts, the year-end depreciation status).
import { describe, expect, it } from 'vitest'
import { addMonths, daysInclusive, lifeEndDate, mulDivRound } from './depreciation'

describe('helpers', () => {
  it('counts days inclusively and adds calendar months', () => {
    expect(daysInclusive('2025-04-01', '2026-03-31')).toBe(365)
    expect(daysInclusive('2027-04-01', '2028-03-31')).toBe(366)
    expect(daysInclusive('2025-04-02', '2025-04-01')).toBe(0)
    expect(addMonths('2025-01-31', 1)).toBe('2025-02-28')
    expect(addMonths('2025-04-01', 120)).toBe('2035-04-01')
    expect(lifeEndDate('2025-04-01', 120)).toBe('2035-03-31')
  })

  it('rounds half away from zero, exactly, beyond 2^53 intermediates', () => {
    expect(mulDivRound(1, 1, 2)).toBe(1)
    expect(mulDivRound(-1, 1, 2)).toBe(-1)
    expect(mulDivRound(1, 1, 3)).toBe(0)
    expect(mulDivRound(9_000_000_000_000, 999_999, 1_000_000)).toBe(8_999_991_000_000)
    expect(() => mulDivRound(2 ** 53, 1, 1)).toThrow(/safe integers/)
  })
})
