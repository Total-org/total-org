import { describe, it, expect } from 'vitest'
import { allocateBills, buildReminder, type BillEvent } from './outstanding'

describe('allocateBills — refless legacy inference (byte-identical to the pre-refactor algorithm)', () => {
  it('one bill, no settlement: stays open in full', () => {
    const events: BillEvent[] = [{ voucherId: 1, date: '2025-05-01', number: 'INV-1', amount: 10000, refs: [] }]
    const { bills, unappliedCredit } = allocateBills(events, '2025-06-01', null)
    expect(bills).toHaveLength(1)
    expect(bills[0]).toMatchObject({ voucherId: 1, number: 'INV-1', amount: 10000, pending: 10000, ageDays: 31 })
    expect(unappliedCredit).toBe(0)
  })

  it('two bills, oldest settled first (FIFO), remainder stays open', () => {
    const events: BillEvent[] = [
      { voucherId: 1, date: '2025-05-01', number: 'INV-1', amount: 10000, refs: [] },
      { voucherId: 2, date: '2025-05-10', number: 'INV-2', amount: 5000, refs: [] },
      { voucherId: 3, date: '2025-05-15', number: 'RCPT-1', amount: -12000, refs: [] }
    ]
    const { bills, unappliedCredit } = allocateBills(events, '2025-06-01', null)
    expect(bills).toHaveLength(1)
    expect(bills[0]).toMatchObject({ number: 'INV-2', amount: 5000, pending: 3000 })
    expect(unappliedCredit).toBe(0)
  })

  it('a settlement larger than every open bill becomes an advance credit', () => {
    const events: BillEvent[] = [
      { voucherId: 1, date: '2025-05-01', number: 'INV-1', amount: 10000, refs: [] },
      { voucherId: 2, date: '2025-05-05', number: 'RCPT-1', amount: -15000, refs: [] }
    ]
    const { bills, unappliedCredit } = allocateBills(events, '2025-06-01', null)
    expect(bills).toHaveLength(0)
    expect(unappliedCredit).toBe(5000)
  })

  it('an advance credit nets off the next bill automatically', () => {
    const events: BillEvent[] = [
      { voucherId: 1, date: '2025-05-01', number: 'ADV', amount: -4000, refs: [] }, // advance receipt, no bill yet
      { voucherId: 2, date: '2025-05-10', number: 'INV-1', amount: 10000, refs: [] }
    ]
    const { bills, unappliedCredit } = allocateBills(events, '2025-06-01', null)
    expect(bills).toHaveLength(1)
    expect(bills[0]).toMatchObject({ number: 'INV-1', amount: 10000, pending: 6000 })
    expect(unappliedCredit).toBe(0)
  })

  it('a zero-amount event is a no-op', () => {
    const events: BillEvent[] = [{ voucherId: 1, date: '2025-05-01', number: 'X', amount: 0, refs: [] }]
    const { bills, unappliedCredit } = allocateBills(events, '2025-06-01', null)
    expect(bills).toHaveLength(0)
    expect(unappliedCredit).toBe(0)
  })

  it('ageDays and overdueDays are equal when there is no due date (matches the old age-from-bill-date bucketing)', () => {
    const events: BillEvent[] = [{ voucherId: 1, date: '2025-05-01', number: 'INV-1', amount: 10000, refs: [] }]
    const { bills } = allocateBills(events, '2025-07-15', null)
    expect(bills[0]!.ageDays).toBe(bills[0]!.overdueDays)
  })
})

describe('allocateBills — named bill refs', () => {
  it("'new' opens a named bill; 'against' settles it exactly by name", () => {
    const events: BillEvent[] = [
      {
        voucherId: 1, date: '2025-05-01', number: 'INV-1', amount: 10000,
        refs: [{ kind: 'new', name: 'INV-1', amount: 10000, dueDate: null }]
      },
      {
        voucherId: 2, date: '2025-05-20', number: 'RCPT-1', amount: -10000,
        refs: [{ kind: 'against', name: 'INV-1', amount: 10000, dueDate: null }]
      }
    ]
    const { bills } = allocateBills(events, '2025-06-01', null)
    expect(bills).toHaveLength(0)
  })

  it("a partial 'against' settlement leaves the named bill open for the remainder", () => {
    const events: BillEvent[] = [
      {
        voucherId: 1, date: '2025-05-01', number: 'INV-1', amount: 10000,
        refs: [{ kind: 'new', name: 'INV-1', amount: 10000, dueDate: null }]
      },
      {
        voucherId: 2, date: '2025-05-20', number: 'RCPT-1', amount: -4000,
        refs: [{ kind: 'against', name: 'INV-1', amount: 4000, dueDate: null }]
      }
    ]
    const { bills } = allocateBills(events, '2025-06-01', null)
    expect(bills).toHaveLength(1)
    expect(bills[0]).toMatchObject({ number: 'INV-1', pending: 6000 })
  })

  it("'against' a bill name that isn't open surfaces a warning instead of silently FIFO-ing (v0.3 #66)", () => {
    const events: BillEvent[] = [
      {
        voucherId: 1, date: '2025-05-01', number: 'INV-1', amount: 10000,
        refs: [{ kind: 'new', name: 'INV-1', amount: 10000, dueDate: null }]
      },
      {
        voucherId: 2, date: '2025-05-20', number: 'RCPT-1', amount: -3000,
        refs: [{ kind: 'against', name: 'UNKNOWN-99', amount: 3000, dueDate: null }]
      }
    ]
    const { bills, unappliedCredit, warnings } = allocateBills(events, '2025-06-01', null)
    // The named settlement no longer silently eats INV-1 — it stays fully open, the amount sits
    // as unapplied credit, and the mismatch is called out.
    expect(bills).toHaveLength(1)
    expect(bills[0]).toMatchObject({ number: 'INV-1', pending: 10000 })
    expect(unappliedCredit).toBe(3000)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('UNKNOWN-99')
  })

  it('refless settlements still FIFO with no warnings', () => {
    const events: BillEvent[] = [
      { voucherId: 1, date: '2025-05-01', number: 'INV-1', amount: 10000, refs: [] },
      { voucherId: 2, date: '2025-05-20', number: 'RCPT-1', amount: -3000, refs: [] }
    ]
    const { bills, warnings } = allocateBills(events, '2025-06-01', null)
    expect(bills[0]).toMatchObject({ number: 'INV-1', pending: 7000 })
    expect(warnings).toEqual([])
  })

  it('two named bills settled independently and out of order', () => {
    const events: BillEvent[] = [
      {
        voucherId: 1, date: '2025-05-01', number: 'INV-1', amount: 10000,
        refs: [{ kind: 'new', name: 'INV-1', amount: 10000, dueDate: null }]
      },
      {
        voucherId: 2, date: '2025-05-05', number: 'INV-2', amount: 6000,
        refs: [{ kind: 'new', name: 'INV-2', amount: 6000, dueDate: null }]
      },
      {
        voucherId: 3, date: '2025-05-20', number: 'RCPT-1', amount: -6000,
        refs: [{ kind: 'against', name: 'INV-2', amount: 6000, dueDate: null }]
      }
    ]
    const { bills } = allocateBills(events, '2025-06-01', null)
    expect(bills).toHaveLength(1)
    expect(bills[0]).toMatchObject({ number: 'INV-1', pending: 10000 })
  })
})

describe('allocateBills — refs follow the event sign (WP 9.1 fix)', () => {
  it("a receipt's 'new' ref is a named credit, not a bill owed", () => {
    const events: BillEvent[] = [
      { voucherId: 1, date: '2025-05-01', number: 'R1', amount: -1_00_000_00, refs: [{ kind: 'new', name: 'R1', amount: 1_00_000_00, dueDate: null }] }
    ]
    expect(allocateBills(events, '2025-06-01', null)).toEqual({ bills: [], unappliedCredit: 1_00_000_00, warnings: [] })
  })

  it("an invoice 'against' the advance uses it; the rest of the credit stays", () => {
    const events: BillEvent[] = [
      { voucherId: 1, date: '2025-05-01', number: 'R1', amount: -1_00_000_00, refs: [{ kind: 'new', name: 'R1', amount: 1_00_000_00, dueDate: null }] },
      { voucherId: 2, date: '2025-05-10', number: 'S1', amount: 60_000_00, refs: [{ kind: 'against', name: 'R1', amount: 60_000_00, dueDate: null }] }
    ]
    expect(allocateBills(events, '2025-06-01', null)).toEqual({ bills: [], unappliedCredit: 40_000_00, warnings: [] })
  })

  it('an invoice larger than the advance it is set against owes only the difference', () => {
    const events: BillEvent[] = [
      { voucherId: 1, date: '2025-05-01', number: 'R1', amount: -30_000, refs: [{ kind: 'new', name: 'R1', amount: 30_000, dueDate: null }] },
      { voucherId: 2, date: '2025-05-10', number: 'S1', amount: 50_000, refs: [{ kind: 'against', name: 'R1', amount: 50_000, dueDate: null }] }
    ]
    const r = allocateBills(events, '2025-06-01', null)
    expect(r.bills.map((b) => [b.number, b.pending])).toEqual([['S1', 20_000]])
    expect(r.unappliedCredit).toBe(0)
  })

  it("a credit note's own bill is a credit; a refund against it uses it up", () => {
    const events: BillEvent[] = [
      { voucherId: 1, date: '2025-05-01', number: 'S1', amount: 10_000, refs: [{ kind: 'new', name: 'S1', amount: 10_000, dueDate: null }] },
      { voucherId: 2, date: '2025-05-02', number: 'RC1', amount: -10_000, refs: [{ kind: 'against', name: 'S1', amount: 10_000, dueDate: null }] },
      { voucherId: 3, date: '2025-05-05', number: 'CN1', amount: -2_000, refs: [{ kind: 'new', name: 'CN1', amount: 2_000, dueDate: null }] }
    ]
    expect(allocateBills(events, '2025-06-01', null)).toEqual({ bills: [], unappliedCredit: 2_000, warnings: [] })
    events.push({ voucherId: 4, date: '2025-05-06', number: 'PY1', amount: 2_000, refs: [{ kind: 'against', name: 'CN1', amount: 2_000, dueDate: null }] })
    expect(allocateBills(events, '2025-06-01', null)).toEqual({ bills: [], unappliedCredit: 0, warnings: [] })
  })

  it('a named credit does not net off a refless bill (that path is unchanged)', () => {
    const events: BillEvent[] = [
      { voucherId: 1, date: '2025-05-01', number: 'R1', amount: -5_000, refs: [{ kind: 'new', name: 'R1', amount: 5_000, dueDate: null }] },
      { voucherId: 2, date: '2025-05-02', number: 'INV-1', amount: 8_000, refs: [] }
    ]
    const r = allocateBills(events, '2025-06-01', null)
    expect(r.bills.map((b) => [b.number, b.pending])).toEqual([['INV-1', 8_000]])
    expect(r.unappliedCredit).toBe(5_000)
  })
})

describe('allocateBills — an against ref on a positive event adds to the bill (audit A1)', () => {
  // Hand-worked: paise; "+" raises what the party owes on its side.
  const ev = (voucherId: number, date: string, number: string, amount: number, refs: BillEvent['refs'] = []): BillEvent => ({ voucherId, date, number, amount, refs })
  const r = (kind: 'new' | 'against', name: string, amount: number) => ({ kind, name, amount, dueDate: null })

  it('a debit note against an open invoice raises it: 11,800 + 1,180 = 12,980', () => {
    const { bills, unappliedCredit, warnings } = allocateBills([
      ev(1, '2025-05-01', 'S/1', 1_180_000, [r('new', 'S/1', 1_180_000)]),
      ev(2, '2025-05-20', 'DN/1', 118_000, [r('against', 'S/1', 118_000)])
    ], '2025-06-01', null)
    expect(bills.map((b) => [b.number, b.voucherId, b.date, b.amount, b.pending])).toEqual([['S/1', 1, '2025-05-01', 1_298_000, 1_298_000]])
    expect(unappliedCredit).toBe(0)
    expect(warnings).toEqual([])
  })

  it('a part-paid bill: 10,000 − 4,000 paid + 500 added = 4,500 + 2,000 = 6,500 pending, amount 10,500', () => {
    const { bills } = allocateBills([
      ev(1, '2025-05-01', 'S/1', 1_000_000, [r('new', 'S/1', 1_000_000)]),
      ev(2, '2025-05-10', 'R/1', -400_000, [r('against', 'S/1', 400_000)]),
      ev(3, '2025-05-20', 'J/1', 50_000, [r('against', 'S/1', 50_000)])
    ], '2025-06-01', null)
    expect(bills.map((b) => [b.number, b.amount, b.pending])).toEqual([['S/1', 1_050_000, 650_000]])
  })

  it('a bill paid in full opens again on its own date and due date, ahead of later bills', () => {
    const { bills, warnings } = allocateBills([
      ev(1, '2025-04-01', 'S/1', 100_000, [{ kind: 'new', name: 'S/1', amount: 100_000, dueDate: '2025-04-15' }]),
      ev(2, '2025-04-10', 'S/2', 300_000, [r('new', 'S/2', 300_000)]),
      ev(3, '2025-04-20', 'R/1', -100_000), // refless: oldest first → clears S/1
      ev(4, '2025-05-01', 'DN/1', 20_000, [r('against', 'S/1', 20_000)])
    ], '2025-06-01', null)
    // S/1: 1,000 − 1,000 + 200 = 200 open (amount 1,200), due 15 Apr → 47 days late on 1 Jun.
    expect(bills.map((b) => [b.number, b.date, b.dueDate, b.amount, b.pending, b.overdueDays])).toEqual([
      ['S/1', '2025-04-01', '2025-04-15', 120_000, 20_000, 47],
      ['S/2', '2025-04-10', null, 300_000, 300_000, 52]
    ])
    expect(warnings).toEqual([])
    // A later refless receipt of 200 now settles the re-opened S/1 first (oldest first).
    const after = allocateBills([
      ev(1, '2025-04-01', 'S/1', 100_000, [r('new', 'S/1', 100_000)]),
      ev(2, '2025-04-10', 'S/2', 300_000, [r('new', 'S/2', 300_000)]),
      ev(3, '2025-04-20', 'R/1', -100_000),
      ev(4, '2025-05-01', 'DN/1', 20_000, [r('against', 'S/1', 20_000)]),
      ev(5, '2025-05-05', 'R/2', -20_000)
    ], '2025-06-01', null)
    expect(after.bills.map((b) => [b.number, b.pending])).toEqual([['S/2', 300_000]])
  })

  it('advance credit on the account nets off the increase first, as off a new bill: 300 − 200 = 100', () => {
    const { bills, unappliedCredit } = allocateBills([
      ev(1, '2025-04-01', 'S/1', 100_000, [r('new', 'S/1', 100_000)]),
      ev(2, '2025-04-20', 'R/1', -120_000), // clears S/1, 200 on account
      ev(3, '2025-05-01', 'J/1', 30_000, [r('against', 'S/1', 30_000)])
    ], '2025-06-01', null)
    expect(bills.map((b) => [b.number, b.amount, b.pending])).toEqual([['S/1', 130_000, 10_000]])
    expect(unappliedCredit).toBe(0)
  })

  it('a named credit of that name is still used first (WP 9.1 unchanged)', () => {
    const { bills, unappliedCredit } = allocateBills([
      ev(1, '2025-04-01', 'R/1', -50_000, [r('new', 'ADV', 50_000)]),
      ev(2, '2025-04-10', 'S/1', 80_000, [r('against', 'ADV', 80_000)])
    ], '2025-06-01', null)
    // 800 − 500 advance = 300 open, named after the invoice.
    expect(bills.map((b) => [b.number, b.pending])).toEqual([['S/1', 30_000]])
    expect(unappliedCredit).toBe(0)
  })

  it('a name no bill has had opens a bill of that name and says so', () => {
    const { bills, warnings } = allocateBills([ev(7, '2025-05-01', 'J/9', 25_000, [r('against', 'X/1', 25_000)])], '2025-06-01', null)
    expect(bills.map((b) => [b.number, b.voucherId, b.pending])).toEqual([['X/1', 7, 25_000]])
    expect(warnings).toEqual(['J/9: adds to bill "X/1", which no bill has had — opened as a bill of its own'])
  })

  it('a used-up named credit\'s name: the extra is a bill named after the entry (as the excess over a credit is)', () => {
    const { bills, warnings } = allocateBills([
      ev(1, '2025-04-01', 'CN/1', -10_000, [r('new', 'CN/1', 10_000)]),
      ev(2, '2025-04-05', 'PY/1', 10_000, [r('against', 'CN/1', 10_000)]), // refund uses the credit up
      ev(3, '2025-04-06', 'PY/2', 4_000, [r('against', 'CN/1', 4_000)])
    ], '2025-06-01', null)
    expect(bills.map((b) => [b.number, b.pending])).toEqual([['PY/2', 4_000]])
    expect(warnings).toEqual(['PY/2: adds to bill "CN/1", which no bill has had — opened as a bill of its own, PY/2'])
  })

  it('a negative event against a bill still settles it (unchanged)', () => {
    const { bills } = allocateBills([
      ev(1, '2025-05-01', 'S/1', 1_000_000, [r('new', 'S/1', 1_000_000)]),
      ev(2, '2025-05-20', 'CN/1', -100_000, [r('against', 'S/1', 100_000)])
    ], '2025-06-01', null)
    expect(bills.map((b) => [b.number, b.amount, b.pending])).toEqual([['S/1', 1_000_000, 900_000]])
  })
})

describe('allocateBills — due dates', () => {
  it('explicit ref due date wins over party credit days', () => {
    const events: BillEvent[] = [
      {
        voucherId: 1, date: '2025-05-01', number: 'INV-1', amount: 10000,
        refs: [{ kind: 'new', name: 'INV-1', amount: 10000, dueDate: '2025-05-10' }]
      }
    ]
    const { bills } = allocateBills(events, '2025-06-01', 30)
    expect(bills[0]!.dueDate).toBe('2025-05-10')
    // overdue from 2025-05-10 to 2025-06-01 = 22 days
    expect(bills[0]!.overdueDays).toBe(22)
  })

  it('falls back to date + party credit days when no explicit due date is given', () => {
    const events: BillEvent[] = [
      { voucherId: 1, date: '2025-05-01', number: 'INV-1', amount: 10000, refs: [] }
    ]
    const { bills } = allocateBills(events, '2025-06-15', 15)
    expect(bills[0]!.dueDate).toBe('2025-05-16')
    // overdue from 2025-05-16 to 2025-06-15 = 30 days
    expect(bills[0]!.overdueDays).toBe(30)
  })

  it('has no due date at all when neither a ref date nor credit days is available', () => {
    const events: BillEvent[] = [
      { voucherId: 1, date: '2025-05-01', number: 'INV-1', amount: 10000, refs: [] }
    ]
    const { bills } = allocateBills(events, '2025-06-01', null)
    expect(bills[0]!.dueDate).toBeNull()
  })

  it('is not overdue before the due date', () => {
    const events: BillEvent[] = [
      { voucherId: 1, date: '2025-05-01', number: 'INV-1', amount: 10000, refs: [] }
    ]
    const { bills } = allocateBills(events, '2025-05-05', 30) // due 2025-05-31, well after asOn
    expect(bills[0]!.overdueDays).toBe(0)
  })
})

describe('buildReminder', () => {
  it('builds a subject/body/mailto summarizing the open bills', () => {
    const bills = allocateBills(
      [{ voucherId: 1, date: '2025-05-01', number: 'INV-1', amount: 25000, refs: [] }],
      '2025-06-01',
      null
    ).bills
    const r = buildReminder({ name: 'Demo Traders' }, { name: 'Umbrella Retail', email: 'ap@umbrella.test' }, bills)
    expect(r.subject).toContain('Demo Traders')
    expect(r.body).toContain('INV-1')
    expect(r.body).toContain('250.00')
    expect(r.mailto.startsWith('mailto:ap@umbrella.test?subject=')).toBe(true)
    expect(r.mailto).toContain(encodeURIComponent(r.subject))
  })

  it('leaves the mailto address blank (not "null") when the party has no email', () => {
    const r = buildReminder({ name: 'Demo Traders' }, { name: 'Umbrella Retail', email: null }, [])
    expect(r.mailto.startsWith('mailto:?subject=')).toBe(true)
  })
})
