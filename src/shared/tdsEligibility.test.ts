import { describe, it, expect } from 'vitest'
import {
  addTdsToLines, candidateSections, classifyTdsVoucher, crossingShortfalls, priorAggregate, removeTdsFromLines, tdsTargetIndex, undeductedCreditsBefore,
  walkTdsEvents, type TdsLedgerFacts, type WalkEvent
} from './tdsEligibility'
import type { TdsRateRow } from './tds'

const C194 = 7
const J194 = 8
const facts = (over: Partial<TdsLedgerFacts> = {}): TdsLedgerFacts => ({
  isDeducteeCandidate: false, tdsSectionId: null, deducteeKnown: false, defaultSectionId: null, isTax: false,
  isTdsPayable: false, isCashBank: false, ...over
})
const LEDGERS: Record<number, TdsLedgerFacts> = {
  1: facts({ isDeducteeCandidate: true, tdsSectionId: C194, deducteeKnown: true }), // contractor
  2: facts({ isDeducteeCandidate: true, deducteeKnown: true }), // consultant (no own section)
  3: facts({ isDeducteeCandidate: true }), // supplier, no PAN / type
  10: facts(), // labour expense
  11: facts({ defaultSectionId: J194 }), // professional fees
  20: facts({ isTax: true }), // CGST
  30: facts({ isCashBank: true }), // bank
  40: facts({ isTdsPayable: true })
}
const f = (id: number): TdsLedgerFacts | null => LEDGERS[id] ?? null

const row = (over: Partial<TdsRateRow> = {}): TdsRateRow => ({
  id: 1, sectionId: C194, effectiveFrom: '2025-04-01', effectiveTo: null, deducteeType: 'any', rateBp: 200,
  thresholdSinglePaise: 3000000, thresholdAnnualPaise: 10000000, thresholdBasis: 'fy', thresholdExcessOnly: false,
  returnCode: '94C', noPanRateBp: 2000, source: null, ...over
})
const ev = (voucherId: number, date: string, kind: WalkEvent['kind'], base: number, over: Partial<WalkEvent> = {}): WalkEvent => ({
  voucherId, date, kind, basePaise: base, grossPaise: base, entryBasePaise: null, exempt: false, ...over
})

describe('classifyTdsVoucher', () => {
  it('WP 2d: a debit note to a flagged party is a return event — base = its credits to non-tax ledgers', () => {
    const c = classifyTdsVoucher({
      kind: 'debit_note', partyLedgerId: 1,
      lines: [{ ledgerId: 1, drCr: 'dr', amount: 1180 }, { ledgerId: 10, drCr: 'cr', amount: 1000 }, { ledgerId: 20, drCr: 'cr', amount: 180 }]
    }, f)
    expect(c).toMatchObject({ eventKind: 'return', partyLedgerId: 1, basePaise: 1000, grossPaise: 1180 })
  })

  it('purchase to a flagged party: base = non-tax debits, gross = party credit', () => {
    const c = classifyTdsVoucher({
      kind: 'purchase', partyLedgerId: 1,
      lines: [{ ledgerId: 10, drCr: 'dr', amount: 1000 }, { ledgerId: 20, drCr: 'dr', amount: 180 }, { ledgerId: 1, drCr: 'cr', amount: 1180 }]
    }, f)
    expect(c).toMatchObject({ eventKind: 'credit', partyLedgerId: 1, sectionId: C194, sectionFrom: 'party', basePaise: 1000, grossPaise: 1180, expenseLedgerId: 10 })
  })

  it('journal: section from the debited ledger needs a known deductee type; payment debits the party', () => {
    const lines = [{ ledgerId: 11, drCr: 'dr' as const, amount: 5000 }, { ledgerId: 10, drCr: 'dr' as const, amount: 100 }, { ledgerId: 2, drCr: 'cr' as const, amount: 5100 }]
    expect(classifyTdsVoucher({ kind: 'journal', partyLedgerId: null, lines }, f)).toMatchObject({ sectionId: J194, sectionFrom: 'ledger', basePaise: 5000 })
    const noType = lines.map((l) => (l.ledgerId === 2 ? { ...l, ledgerId: 3 } : l))
    expect(classifyTdsVoucher({ kind: 'journal', partyLedgerId: null, lines: noType }, f)).toBeNull()
    expect(classifyTdsVoucher({ kind: 'payment', partyLedgerId: 2, lines: [{ ledgerId: 2, drCr: 'dr', amount: 900 }, { ledgerId: 30, drCr: 'cr', amount: 900 }] }, f))
      .toMatchObject({ eventKind: 'payment', sectionId: null, sectionFrom: 'credits', basePaise: 900 })
    expect(classifyTdsVoucher({ kind: 'sales', partyLedgerId: 1, lines }, f)).toBeNull()
  })

  it('a section override wins; candidates list the party section then ledger defaults', () => {
    const lines = [{ ledgerId: 11, drCr: 'dr' as const, amount: 5000 }, { ledgerId: 1, drCr: 'cr' as const, amount: 5000 }]
    expect(classifyTdsVoucher({ kind: 'journal', partyLedgerId: 1, lines }, f, J194)).toMatchObject({ sectionId: J194, sectionFrom: 'ledger' })
    expect(candidateSections({ kind: 'journal', lines }, 1, f)).toEqual([{ sectionId: C194, from: 'party' }, { sectionId: J194, from: 'ledger' }])
  })
})

describe('walkTdsEvents — eligibility reasons', () => {
  const rows = (): TdsRateRow | null => row()
  it('WP 2d (owner, 13 Nov): a purchase return lowers the aggregate for later bills, never undoes an earlier liability', () => {
    // s.194C here: ₹30,000 single, ₹1,00,000 a year. Four bills of ₹26,000 = ₹1,04,000 cross the year's
    // limit; a ₹10,000 debit note before the fourth leaves ₹94,000 — nothing is liable.
    const before = walkTdsEvents([ev(1, '2025-04-10', 'credit', 2600000), ev(2, '2025-05-10', 'credit', 2600000), ev(3, '2025-06-10', 'credit', 2600000), ev(4, '2025-06-20', 'return', 1000000), ev(5, '2025-07-10', 'credit', 2600000)], rows)
    expect(before.map((x) => x.reason)).toEqual([null, null, null, null, null])
    expect(before.map((x) => x.eventBasePaise)).toEqual([2600000, 2600000, 2600000, -1000000, 2600000])
    expect(before.map((x) => x.priorPaise)).toEqual([0, 2600000, 5200000, 7800000, 6800000])
    expect(priorAggregate(before, 'fy', '2025-08-01')).toBe(9400000)
    // The same return AFTER the fourth bill: the year's limit was crossed then — every bill stays liable,
    // and (review of #280) the return lowers nothing: a later ₹5,000 bill is liable as it always was.
    const after = walkTdsEvents([ev(1, '2025-04-10', 'credit', 2600000), ev(2, '2025-05-10', 'credit', 2600000), ev(3, '2025-06-10', 'credit', 2600000), ev(5, '2025-07-10', 'credit', 2600000), ev(6, '2025-07-20', 'return', 1000000), ev(7, '2025-08-10', 'credit', 500000)], rows)
    expect(after.map((x) => x.reason)).toEqual(['aggregate_later', 'aggregate_later', 'aggregate_later', 'aggregate', null, 'aggregate'])
    expect(after.map((x) => x.eventBasePaise)).toEqual([2600000, 2600000, 2600000, 2600000, 0, 500000])
    expect(after[5]!.eligibleBasePaise).toBe(500000)
    expect(priorAggregate(after, 'fy', '2025-09-01')).toBe(10900000)
    // Never below nil: a return bigger than what was credited takes the aggregate to nothing.
    expect(walkTdsEvents([ev(1, '2025-04-10', 'credit', 500000), ev(2, '2025-04-20', 'return', 900000)], rows)[1]!.eventBasePaise).toBe(-500000)
  })

  it('review of #280: a return never makes a payment an advance (it touches only the aggregate)', () => {
    // A ₹20,000 debit note on 5 Apr against LAST year's bill (nothing of this year to lower), then this
    // year's bills ₹26,000 × 3 + ₹10,000 = ₹88,000, each paid in full the next day: under ₹1,00,000,
    // no advance, nothing liable (before the fix the return made each payment a ₹20,000 "advance").
    const r = walkTdsEvents([
      ev(1, '2025-04-05', 'return', 2000000),
      ev(2, '2025-05-01', 'credit', 2600000), ev(3, '2025-05-02', 'payment', 2600000),
      ev(4, '2025-06-01', 'credit', 2600000), ev(5, '2025-06-02', 'payment', 2600000),
      ev(6, '2025-07-01', 'credit', 2600000), ev(7, '2025-07-02', 'payment', 2600000),
      ev(8, '2025-08-01', 'credit', 1000000), ev(9, '2025-08-02', 'payment', 1000000)
    ], rows)
    expect(r.every((x) => x.reason === null && x.eligibleBasePaise === 0)).toBe(true)
    expect(r.map((x) => x.eventBasePaise)).toEqual([0, 2600000, 0, 2600000, 0, 2600000, 0, 1000000, 0])
    expect(priorAggregate(r, 'fy', '2025-09-01')).toBe(8800000)
    // Within one year, the return refunded by cheque (a receipt — not an event): bill ₹30,000 paid,
    // ₹10,000 back, bills ₹30,000 + ₹30,000 + ₹15,000 paid in full: ₹30,000 − ₹10,000 + ₹75,000 = ₹95,000,
    // nothing liable (before the fix each later payment added a ₹10,000 "advance": ₹1,25,000, all liable).
    const refund = walkTdsEvents([
      ev(1, '2025-04-10', 'credit', 3000000), ev(2, '2025-04-11', 'payment', 3000000), ev(3, '2025-04-20', 'return', 1000000),
      ev(4, '2025-05-10', 'credit', 3000000), ev(5, '2025-05-11', 'payment', 3000000),
      ev(6, '2025-06-10', 'credit', 3000000), ev(7, '2025-06-11', 'payment', 3000000),
      ev(8, '2025-07-10', 'credit', 1500000), ev(9, '2025-07-11', 'payment', 1500000)
    ], rows)
    expect(refund.every((x) => x.eligibleBasePaise === 0)).toBe(true)
    expect(priorAggregate(refund, 'fy', '2025-08-01')).toBe(9500000)
  })

  it('single, aggregate and aggregate-crossed-later', () => {
    const r = walkTdsEvents([ev(1, '2025-04-10', 'credit', 2500000), ev(2, '2025-05-10', 'credit', 3500000), ev(3, '2025-06-10', 'credit', 2000000), ev(4, '2025-07-10', 'credit', 2500000)], rows)
    expect(r.map((x) => x.reason)).toEqual(['aggregate_later', 'single', 'aggregate_later', 'aggregate'])
    expect(r.map((x) => x.priorPaise)).toEqual([0, 2500000, 6000000, 8000000])
    expect(priorAggregate(r, 'fy', '2025-07-10', 4)).toBe(8000000)
    // A new voucher on the same date counts every event of that date.
    expect(priorAggregate(r, 'fy', '2025-07-10')).toBe(10500000)
  })

  it('below all limits: nothing; no thresholds: everything ("none")', () => {
    expect(walkTdsEvents([ev(1, '2025-04-10', 'credit', 100)], rows).every((x) => x.reason === null)).toBe(true)
    expect(walkTdsEvents([ev(1, '2025-04-10', 'credit', 100)], () => row({ thresholdSinglePaise: 0, thresholdAnnualPaise: 0 }))[0]!.reason).toBe('none')
  })

  it('exempt events add nothing; deducted events count but are not eligible', () => {
    const r = walkTdsEvents([ev(1, '2025-04-10', 'credit', 9000000, { exempt: true }), ev(2, '2025-05-10', 'credit', 9000000, { entryBasePaise: 9000000 }), ev(3, '2025-06-10', 'credit', 2000000)], rows)
    expect(r.map((x) => [x.eventBasePaise, x.reason])).toEqual([[0, null], [9000000, null], [2000000, 'aggregate']])
  })

  it('a payment that deducts covers undeducted bills oldest first; an advance consumes later credits', () => {
    const covered = walkTdsEvents([ev(1, '2025-04-10', 'credit', 4000000), ev(2, '2025-05-10', 'payment', 4000000, { entryBasePaise: 4000000 })], rows)
    expect(covered.map((x) => x.eligibleBasePaise)).toEqual([0, 0])
    expect(undeductedCreditsBefore(covered, '2025-06-01')).toBe(0)
    const adv = walkTdsEvents([ev(1, '2025-04-10', 'payment', 4000000), ev(2, '2025-05-10', 'credit', 4000000)], rows)
    expect(adv.map((x) => [x.reason, x.eventBasePaise])).toEqual([['advance', 4000000], [null, 0]])
  })

  it('excess-only rows (194Q) never back-fill earlier purchases and only the excess is liable', () => {
    const q = (): TdsRateRow => row({ rateBp: 10, thresholdSinglePaise: 0, thresholdAnnualPaise: 500000000, thresholdExcessOnly: true })
    const r = walkTdsEvents([ev(1, '2025-04-10', 'credit', 400000000), ev(2, '2025-05-10', 'credit', 200000000)], q)
    expect(r.map((x) => [x.reason, x.eligibleBasePaise])).toEqual([[null, 0], ['aggregate', 100000000]])
  })

  it('month basis (194-I): the aggregate restarts each month', () => {
    const m = (): TdsRateRow => row({ thresholdSinglePaise: 0, thresholdAnnualPaise: 5000000, thresholdBasis: 'month' })
    const r = walkTdsEvents([ev(1, '2025-04-10', 'credit', 3000000), ev(2, '2025-04-20', 'credit', 3000000), ev(3, '2025-05-10', 'credit', 3000000)], m)
    expect(r.map((x) => x.reason)).toEqual(['aggregate_later', 'aggregate', null])
  })
})

describe('walkTdsEvents — FIG-B-1: crossing the aggregate makes the earlier sums liable', () => {
  // s.194C, an individual contractor: 1 % (100 bp), single > ₹30,000, year > ₹1,00,000.
  const c194 = (): TdsRateRow => row({ rateBp: 100 })
  const shortfall = (r: ReturnType<typeof walkTdsEvents>, id: number): { basePaise: number; count: number } =>
    crossingShortfalls(r).get(id) ?? { basePaise: 0, count: 0 }

  it('crossing on the last bill: the earlier four are liable whether or not the fifth carries a deduction', () => {
    // 4 × ₹25,000 = ₹1,00,000 (not "exceeds"); the fifth ₹25,000 → ₹1,25,000 > ₹1,00,000: all five liable.
    const four = [1, 2, 3, 4].map((i) => ev(i, `2025-0${i + 4}-01`, 'credit', 2500000))
    // The fifth as the voucher being entered (no deduction): it crosses, and the shortfall it makes
    // liable = 4 × ₹25,000 = ₹1,00,000 → the suggestion's base ₹1,25,000 × 1 % = ₹1,250.
    const entered = walkTdsEvents([...four, ev(5, '2025-09-01', 'credit', 2500000)], c194)
    expect(shortfall(entered, 5)).toEqual({ basePaise: 10000000, count: 4 })
    expect(entered.map((x) => x.crossedBy)).toEqual([5, 5, 5, 5, undefined])
    // Only ₹250 deducted on the fifth (base ₹25,000): the four stay liable at ₹25,000 each (₹1,000 of tax).
    const short = walkTdsEvents([...four, ev(5, '2025-09-01', 'credit', 2500000, { entryBasePaise: 2500000 })], c194)
    expect(short.map((x) => [x.reason, x.eligibleBasePaise])).toEqual([
      ['aggregate_later', 2500000], ['aggregate_later', 2500000], ['aggregate_later', 2500000], ['aggregate_later', 2500000], [null, 0]
    ])
    expect(shortfall(short, 5)).toEqual({ basePaise: 10000000, count: 4 })
    // ₹1,250 deducted on the fifth (base ₹1,25,000): the ₹1,00,000 beyond its own sum covers the four;
    // only its own ₹25,000 adds to the aggregate (₹1,25,000, never ₹2,25,000).
    const full = walkTdsEvents([...four, ev(5, '2025-09-01', 'credit', 2500000, { entryBasePaise: 12500000 })], c194)
    expect(full.every((x) => x.eligibleBasePaise === 0)).toBe(true)
    expect(full.map((x) => x.eventBasePaise)).toEqual([2500000, 2500000, 2500000, 2500000, 2500000])
    expect(priorAggregate(full, 'fy', '2025-10-01')).toBe(12500000)
    expect(shortfall(full, 5)).toEqual({ basePaise: 0, count: 0 })
  })

  it('crossing on the last of five advance payments (no bills): the fifth payment carries the four', () => {
    // 4 × ₹25,000 paid ahead of any bill = ₹1,00,000; the fifth ₹25,000 → ₹1,25,000: all five liable.
    const four = [1, 2, 3, 4].map((i) => ev(i, `2025-0${i + 4}-01`, 'payment', 2500000))
    const entered = walkTdsEvents([...four, ev(5, '2025-09-01', 'payment', 2500000)], c194)
    expect(entered.map((x) => x.reason)).toEqual(['aggregate_later', 'aggregate_later', 'aggregate_later', 'aggregate_later', 'advance'])
    expect(shortfall(entered, 5)).toEqual({ basePaise: 10000000, count: 4 })
    // ₹1,250 deducted on the fifth payment (base ₹1,25,000): its own advance ₹25,000, the ₹1,00,000
    // beyond it covers the four earlier advances; the aggregate stays ₹1,25,000.
    const full = walkTdsEvents([...four, ev(5, '2025-09-01', 'payment', 2500000, { entryBasePaise: 12500000 })], c194)
    expect(full.every((x) => x.eligibleBasePaise === 0)).toBe(true)
    expect(full[4]!.eventBasePaise).toBe(2500000)
    expect(priorAggregate(full, 'fy', '2025-10-01')).toBe(12500000)
    // A ₹1,25,000 bill later is all covered by those advances: nothing more to deduct, nothing added.
    const billed = walkTdsEvents([...four, ev(5, '2025-09-01', 'payment', 2500000, { entryBasePaise: 12500000 }), ev(6, '2025-10-01', 'credit', 12500000)], c194)
    expect([billed[5]!.eventBasePaise, billed[5]!.eligibleBasePaise]).toEqual([0, 0])
  })

  it('crossing mid-year with earlier bills partly deducted', () => {
    // Apr bill ₹20,000 (undeducted); May payment ₹20,000 deducting on ₹10,000 of it (covers ₹10,000,
    // ₹10,000 left open; not an advance: paid ₹20,000 = credited ₹20,000); Jun bill ₹35,000 > ₹30,000
    // single → deducted on ₹35,000 at the time; Jul bill ₹20,000 (undeducted). Aggregate ₹75,000.
    // Aug bill ₹30,000 → ₹1,05,000 > ₹1,00,000: the open ₹10,000 of April and ₹20,000 of July become
    // liable (₹30,000, 2 sums); June was deducted. Suggestion base ₹30,000 + ₹30,000 = ₹60,000 → ₹600.
    const before = [
      ev(1, '2025-04-10', 'credit', 2000000), ev(2, '2025-05-10', 'payment', 2000000, { entryBasePaise: 1000000 }),
      ev(3, '2025-06-10', 'credit', 3500000, { entryBasePaise: 3500000 }), ev(4, '2025-07-10', 'credit', 2000000)
    ]
    const entered = walkTdsEvents([...before, ev(5, '2025-08-10', 'credit', 3000000)], c194)
    expect(shortfall(entered, 5)).toEqual({ basePaise: 3000000, count: 2 })
    expect(entered.map((x) => x.eligibleBasePaise)).toEqual([1000000, 0, 0, 2000000, 3000000])
    // ₹300 only on August's own ₹30,000: April's ₹10,000 and July's ₹20,000 stay eligible.
    const short = walkTdsEvents([...before, ev(5, '2025-08-10', 'credit', 3000000, { entryBasePaise: 3000000 })], c194)
    expect(short.map((x) => x.eligibleBasePaise)).toEqual([1000000, 0, 0, 2000000, 0])
    // ₹600 on ₹60,000: the ₹30,000 beyond August's own covers both; aggregate ₹20,000 + ₹35,000 +
    // ₹20,000 + ₹30,000 = ₹1,05,000 (the payment added nothing).
    const full = walkTdsEvents([...before, ev(5, '2025-08-10', 'credit', 3000000, { entryBasePaise: 6000000 })], c194)
    expect(full.every((x) => x.eligibleBasePaise === 0)).toBe(true)
    expect(priorAggregate(full, 'fy', '2025-09-01')).toBe(10500000)
  })

  it('a return before the crossing lowers the aggregate; after it, it lowers nothing and the shortfall stays', () => {
    // Bills ₹30,000 × 3, a ₹10,000 debit note, a ₹20,000 bill → ₹80,000 + ₹20,000 = ₹1,00,000: not
    // exceeded, nothing liable, no shortfall on the ₹20,000 bill.
    const lowered = [ev(1, '2025-05-01', 'credit', 3000000), ev(2, '2025-06-01', 'credit', 3000000), ev(3, '2025-07-01', 'credit', 3000000), ev(4, '2025-07-15', 'return', 1000000)]
    const atLimit = walkTdsEvents([...lowered, ev(5, '2025-08-01', 'credit', 2000000)], c194)
    expect(atLimit.every((x) => x.eligibleBasePaise === 0)).toBe(true)
    expect(shortfall(atLimit, 5)).toEqual({ basePaise: 0, count: 0 })
    // A ₹5,000 bill then → ₹1,05,000: the four bills before it become liable on their own sums
    // (₹30,000 × 3 + ₹20,000 = ₹1,10,000 — a return touches only the aggregate, WP 2d / Q56).
    const crossing = walkTdsEvents([...lowered, ev(5, '2025-08-01', 'credit', 2000000), ev(6, '2025-08-20', 'credit', 500000)], c194)
    expect(shortfall(crossing, 6)).toEqual({ basePaise: 11000000, count: 4 })
    // The return AFTER a crossing where only the crossing bill's own ₹20,000 was deducted: bills
    // ₹30,000 × 3 + ₹20,000 (deducted) = ₹1,10,000; a ₹10,000 return lowers nothing; the three
    // earlier bills (₹90,000) stay eligible, and a later ₹5,000 bill is liable on its own.
    const after = walkTdsEvents([
      ev(1, '2025-05-01', 'credit', 3000000), ev(2, '2025-06-01', 'credit', 3000000), ev(3, '2025-07-01', 'credit', 3000000),
      ev(4, '2025-08-01', 'credit', 2000000, { entryBasePaise: 2000000 }), ev(5, '2025-08-15', 'return', 1000000), ev(6, '2025-09-01', 'credit', 500000)
    ], c194)
    expect(after.map((x) => [x.reason, x.eligibleBasePaise])).toEqual([
      ['aggregate_later', 3000000], ['aggregate_later', 3000000], ['aggregate_later', 3000000], [null, 0], [null, 0], ['aggregate', 500000]
    ])
    expect(after[4]!.eventBasePaise).toBe(0)
  })

  it('month basis (194-I): the crossing reaches back within the month only', () => {
    // ₹50,000 a month: 10 Apr ₹30,000 (open), 20 Apr ₹30,000 → April ₹60,000 > ₹50,000: 10 Apr liable
    // (shortfall ₹30,000, 1 sum) whether or not 20 Apr carries a deduction; a 31 Mar ₹40,000 is another
    // month and stays out. 10 May ₹30,000: May starts at nil.
    const m = (): TdsRateRow => row({ rateBp: 1000, thresholdSinglePaise: 0, thresholdAnnualPaise: 5000000, thresholdBasis: 'month' })
    const events = [ev(1, '2025-03-31', 'credit', 4000000), ev(2, '2025-04-10', 'credit', 3000000)]
    const entered = walkTdsEvents([...events, ev(3, '2025-04-20', 'credit', 3000000), ev(4, '2025-05-10', 'credit', 3000000)], m)
    expect(shortfall(entered, 3)).toEqual({ basePaise: 3000000, count: 1 })
    expect(entered.map((x) => x.reason)).toEqual([null, 'aggregate_later', 'aggregate', null])
    const deducted = walkTdsEvents([...events, ev(3, '2025-04-20', 'credit', 3000000, { entryBasePaise: 3000000 })], m)
    expect(deducted.map((x) => x.eligibleBasePaise)).toEqual([0, 3000000, 0])
  })

  it('194Q (excess only): nothing earlier becomes liable, deducted or not', () => {
    // ₹40 lakh, then ₹20 lakh → ₹60 lakh: only the ₹10 lakh above ₹50 lakh is liable; the first purchase never.
    const q = (): TdsRateRow => row({ rateBp: 10, thresholdSinglePaise: 0, thresholdAnnualPaise: 500000000, thresholdExcessOnly: true })
    const entered = walkTdsEvents([ev(1, '2025-04-10', 'credit', 400000000), ev(2, '2025-05-10', 'credit', 200000000)], q)
    expect(shortfall(entered, 2)).toEqual({ basePaise: 0, count: 0 })
    const deducted = walkTdsEvents([ev(1, '2025-04-10', 'credit', 400000000), ev(2, '2025-05-10', 'credit', 200000000, { entryBasePaise: 200000000 })], q)
    expect(deducted.map((x) => [x.reason, x.eligibleBasePaise, x.crossedBy])).toEqual([[null, 0, undefined], [null, 0, undefined]])
  })

  it('review of #289 (1): a crossing sum over the ₹30,000 single limit reaches back too', () => {
    // 4 × ₹25,000 = ₹1,00,000, then ₹40,000 → ₹1,40,000 > ₹1,00,000. The ₹40,000 is liable on its
    // own (single) AND crosses the year: the four are liable — shortfall ₹1,00,000 of 4; the
    // suggestion = ₹40,000 + ₹1,00,000 = ₹1,40,000 × 1 % = ₹1,400.
    const r = walkTdsEvents([...[1, 2, 3, 4].map((i) => ev(i, `2025-0${i + 4}-01`, 'credit', 2500000)), ev(5, '2025-09-01', 'credit', 4000000)], c194)
    expect(r.map((x) => x.reason)).toEqual(['aggregate_later', 'aggregate_later', 'aggregate_later', 'aggregate_later', 'single'])
    expect(shortfall(r, 5)).toEqual({ basePaise: 10000000, count: 4 })
  })

  it('review of #289 (2): an advance a deducted bill uses up counts once in the aggregate', () => {
    // Apr ₹25,000, May ₹25,000 (open); June pays ₹75,000 = ₹50,000 billed + ₹25,000 advance; July
    // bills ₹30,000 deducted on ₹30,000 — ₹25,000 of it was the advance. Aggregate ₹25,000 + ₹25,000
    // + ₹25,000 + ₹5,000 = ₹80,000: nothing crosses, nothing is liable (the bill's deduction covers
    // the advance it used up).
    const r = walkTdsEvents([
      ev(1, '2025-04-10', 'credit', 2500000), ev(2, '2025-05-10', 'credit', 2500000),
      ev(3, '2025-06-10', 'payment', 7500000), ev(4, '2025-07-10', 'credit', 3000000, { entryBasePaise: 3000000 })
    ], c194)
    expect(r.every((x) => x.eligibleBasePaise === 0 && x.crossedBy === undefined)).toBe(true)
    expect(r.map((x) => x.eventBasePaise)).toEqual([2500000, 2500000, 2500000, 500000])
    expect(priorAggregate(r, 'fy', '2025-08-01')).toBe(8000000)
  })

  it('review of #289 (2): the shortfall leaves out the advance the crossing bill itself uses up', () => {
    // Bills ₹30,000 + ₹30,000 + ₹20,000 = ₹80,000 (open); July pays ₹1,00,000 → ₹20,000 advance;
    // ₹1,00,000 so far. August bill ₹30,000: ₹20,000 is the advance, ₹10,000 fresh → ₹1,10,000 crosses.
    // Liable: the three bills ₹80,000 + the advance ₹20,000; the advance is inside the bill's own
    // ₹30,000, so the shortfall is ₹80,000 of 3 and the suggestion ₹30,000 + ₹80,000 = ₹1,10,000 → ₹1,100.
    const before = [
      ev(1, '2025-04-10', 'credit', 3000000), ev(2, '2025-05-10', 'credit', 3000000), ev(3, '2025-06-10', 'credit', 2000000),
      ev(4, '2025-07-10', 'payment', 10000000)
    ]
    const entered = walkTdsEvents([...before, ev(5, '2025-08-10', 'credit', 3000000)], c194)
    expect(entered.map((x) => x.eventBasePaise)).toEqual([3000000, 3000000, 2000000, 2000000, 1000000])
    expect(entered[4]!.consumedFrom).toEqual([{ voucherId: 4, basePaise: 2000000 }])
    expect(shortfall(entered, 5)).toEqual({ basePaise: 8000000, count: 3 })
    // Deducted on ₹1,10,000: its own ₹30,000 covers the advance it used up, the ₹80,000 beyond covers
    // the three bills. Nothing left; the aggregate is ₹1,10,000.
    const full = walkTdsEvents([...before, ev(5, '2025-08-10', 'credit', 3000000, { entryBasePaise: 11000000 })], c194)
    expect(full.every((x) => x.eligibleBasePaise === 0)).toBe(true)
    expect(priorAggregate(full, 'fy', '2025-09-01')).toBe(11000000)
  })

  it('review of #289 (3): what a deduction carries beyond its own sum covers the sums it crossed, then liable ones (late)', () => {
    // April ₹40,000 (open, liable since April: over ₹30,000), May / June / July ₹20,000 each (open,
    // ₹1,00,000 so far). August ₹20,000 crosses: May–July liable (₹60,000 of 3). April is not the
    // crossing's: it stays on Eligible when August is deducted as suggested (₹20,000 + ₹60,000).
    const before = [ev(1, '2025-04-10', 'credit', 4000000), ev(2, '2025-05-10', 'credit', 2000000), ev(3, '2025-06-10', 'credit', 2000000), ev(4, '2025-07-10', 'credit', 2000000)]
    expect(shortfall(walkTdsEvents([...before, ev(5, '2025-08-10', 'credit', 2000000)], c194), 5)).toEqual({ basePaise: 6000000, count: 3 })
    const suggested = walkTdsEvents([...before, ev(5, '2025-08-10', 'credit', 2000000, { entryBasePaise: 8000000 })], c194)
    expect(suggested.map((x) => [x.reason, x.eligibleBasePaise])).toEqual([['single', 4000000], [null, 0], [null, 0], [null, 0], [null, 0]])
    expect(suggested[4]!.lateCover).toBeUndefined()
    // Deducted on ₹1,20,000 (April too): the ₹40,000 beyond the crossed sums covers April, liable since
    // 10 April — a late deduction.
    const all = walkTdsEvents([...before, ev(5, '2025-08-10', 'credit', 2000000, { entryBasePaise: 12000000 })], c194)
    expect(all.every((x) => x.eligibleBasePaise === 0)).toBe(true)
    expect(all[4]!.lateCover).toEqual([{ voucherId: 1, deductibleOn: '2025-04-10', basePaise: 4000000 }])
  })

  it('review of #289 (3): a base wider than the bill (GST included) never covers a sum still under the limit', () => {
    // April ₹20,000 (open, under the limits); May ₹40,000 deducted on ₹47,200 (GST included). The
    // ₹7,200 beyond May's own ₹40,000 has nothing crossed or liable to cover; the aggregate counts
    // May's ₹40,000 (₹60,000). June ₹25,000 → ₹85,000; July ₹25,000 → ₹1,10,000 crosses: April's whole
    // ₹20,000 and June's ₹25,000 are liable, crossed by July.
    const r = walkTdsEvents([
      ev(1, '2025-04-10', 'credit', 2000000), ev(2, '2025-05-10', 'credit', 4000000, { entryBasePaise: 4720000 }),
      ev(3, '2025-06-10', 'credit', 2500000), ev(4, '2025-07-10', 'credit', 2500000)
    ], c194)
    expect(r.map((x) => [x.reason, x.eligibleBasePaise])).toEqual([['aggregate_later', 2000000], [null, 0], ['aggregate_later', 2500000], ['aggregate', 2500000]])
    expect(priorAggregate(r, 'fy', '2025-08-01')).toBe(11000000)
  })

  it('review of #289 round 2: a bill deducted on its whole base covers a liable advance it used up (late)', () => {
    // 1 Apr: ₹50,000 paid ahead, not deducted — over ₹30,000, liable at once (advance). 1 Jun: the
    // ₹50,000 bill, deducted on ₹50,000: it used up the advance (fresh sum nil), and its deduction
    // covers that same ₹50,000 — deductible since 1 April, so late. The advance leaves Eligible.
    const r = walkTdsEvents([ev(1, '2025-04-01', 'payment', 5000000), ev(2, '2025-06-01', 'credit', 5000000, { entryBasePaise: 5000000 })], c194)
    expect(r.map((x) => [x.reason, x.eligibleBasePaise, x.eventBasePaise])).toEqual([[null, 0, 5000000], [null, 0, 0]])
    expect(r[1]!.consumedFrom).toEqual([{ voucherId: 1, basePaise: 5000000 }])
    expect(r[1]!.lateCover).toEqual([{ voucherId: 1, deductibleOn: '2025-04-01', basePaise: 5000000 }])
    // TCS shares the walk: an excess-only row (206C(1H)-style, ₹50 lakh) — a ₹60 lakh receipt ahead
    // (₹10 lakh above the limit liable), then the ₹60 lakh sale collected on ₹60 lakh: the receipt is covered.
    const h1 = (): TdsRateRow => row({ rateBp: 10, thresholdSinglePaise: 0, thresholdAnnualPaise: 500000000, thresholdExcessOnly: true })
    const t = walkTdsEvents([ev(1, '2025-04-01', 'payment', 600000000), ev(2, '2025-06-01', 'credit', 600000000, { entryBasePaise: 600000000 })], h1)
    expect(t.map((x) => x.eligibleBasePaise)).toEqual([0, 0])
    expect(walkTdsEvents([ev(1, '2025-04-01', 'payment', 600000000)], h1)[0]!.eligibleBasePaise).toBe(100000000)
  })

  it('review of #289 round 2: a base wider than the bill covers an earlier bill already liable (late)', () => {
    // April ₹40,000 (liable at once, over ₹30,000), not deducted; May ₹40,000 deducted on ₹47,200 (GST
    // included). The ₹7,200 beyond May's own ₹40,000 covers ₹7,200 of April (liable since April —
    // late): April stays on Eligible at ₹32,800. (Reading flagged in Q59: GST over-deducted on one
    // bill counted as a deduction for another.)
    const r = walkTdsEvents([ev(1, '2025-04-10', 'credit', 4000000), ev(2, '2025-05-10', 'credit', 4000000, { entryBasePaise: 4720000 })], c194)
    expect(r.map((x) => x.eligibleBasePaise)).toEqual([3280000, 0])
    expect(r[1]!.lateCover).toEqual([{ voucherId: 1, deductibleOn: '2025-04-10', basePaise: 720000 }])
  })

  it('books where every sum was deducted at the time are unchanged', () => {
    // Five ₹25,000 bills each deducted on its own ₹25,000: nothing open, nothing marked, aggregate ₹1,25,000.
    const r = walkTdsEvents([1, 2, 3, 4, 5].map((i) => ev(i, `2025-0${i + 4}-01`, 'credit', 2500000, { entryBasePaise: 2500000 })), c194)
    expect(r.map((x) => [x.reason, x.eligibleBasePaise, x.eventBasePaise])).toEqual(Array(5).fill([null, 0, 2500000]))
    expect(priorAggregate(r, 'fy', '2025-10-01')).toBe(12500000)
  })
})

describe('add / remove TDS on lines — the per-kind rule', () => {
  const isCash = (id: number): boolean => id === 30
  it('purchase/journal reduce the party credit and its new bill; payment reduces the bank', () => {
    const lines = [{ ledgerId: 10, drCr: 'dr' as const, amount: 1180 }, { ledgerId: 1, drCr: 'cr' as const, amount: 1180 }]
    const refs = [{ kind: 'new' as const, name: 'B1', amount: 1180, dueDate: null }]
    const a = addTdsToLines('purchase', lines, refs, { partyLedgerId: 1, tdsPaise: 20, isCashBank: isCash })
    expect(a).toMatchObject({ ok: true, lines: [{ amount: 1180 }, { amount: 1160 }], billRefs: [{ amount: 1160 }], targetLedgerId: 1 })
    const pay = [{ ledgerId: 1, drCr: 'dr' as const, amount: 1000 }, { ledgerId: 30, drCr: 'cr' as const, amount: 1000 }]
    expect(addTdsToLines('payment', pay, [], { partyLedgerId: 1, tdsPaise: 20, isCashBank: isCash })).toMatchObject({ ok: true, lines: [{ amount: 1000 }, { amount: 980 }] })
    expect(tdsTargetIndex('payment', pay, 1, isCash)).toBe(1)
  })

  it('refuses what it cannot do safely', () => {
    const lines = [{ ledgerId: 10, drCr: 'dr' as const, amount: 100 }, { ledgerId: 1, drCr: 'cr' as const, amount: 100 }]
    expect(addTdsToLines('purchase', lines, [], { partyLedgerId: 1, tdsPaise: 100, isCashBank: isCash })).toMatchObject({ ok: false })
    expect(addTdsToLines('sales', lines, [], { partyLedgerId: 1, tdsPaise: 1, isCashBank: isCash })).toMatchObject({ ok: false })
    const alloc = [{ ...lines[0]! }, { ...lines[1]!, costAllocations: [{ costCentreId: 1, amount: 100 }] }]
    expect(addTdsToLines('journal', alloc, [], { partyLedgerId: 1, tdsPaise: 1, isCashBank: isCash })).toMatchObject({ ok: false, error: expect.stringMatching(/cost-centre/) })
  })

  it('remove gives the payable credit back to the same line', () => {
    const lines = [{ ledgerId: 10, drCr: 'dr' as const, amount: 1180 }, { ledgerId: 1, drCr: 'cr' as const, amount: 1160 }, { ledgerId: 40, drCr: 'cr' as const, amount: 20 }]
    const refs = [{ kind: 'new' as const, name: 'B1', amount: 1160, dueDate: null }]
    const r = removeTdsFromLines('purchase', lines, refs, { partyLedgerId: 1, isPayableLine: (l) => l.ledgerId === 40, isCashBank: isCash })
    expect(r).toMatchObject({ ok: true, lines: [{ amount: 1180 }, { amount: 1180 }], billRefs: [{ amount: 1180 }], restoredPaise: 20 })
    expect(removeTdsFromLines('purchase', lines.slice(0, 2), refs, { partyLedgerId: 1, isPayableLine: (l) => l.ledgerId === 40, isCashBank: isCash })).toMatchObject({ ok: false })
  })
})
