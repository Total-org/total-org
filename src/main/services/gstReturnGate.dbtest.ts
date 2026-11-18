import { describe, it, expect } from 'vitest'
import { assertExportable, extractAdvances, gstr1, gstValidate, rateLessAdvanceIssue, rateLessAdvanceParties } from './gst'
import { simpleTaxes } from './simpleTaxes'
import { seededDb, TEST_INFO } from '../db/testdb'
import { createLedger } from './masters'
import { setGstProfile } from './config'
import { saveVoucher, deleteVoucher } from './vouchers'
import { AppError } from '@shared/errors'
import type { CompanyInfo, DrCr } from '@shared/domain'

// R3 of the 1.0 readiness review (docs/audit/2026-11-1.0-readiness.md):
//  - FIG-G-2: an advance from a customer whose account has no GST rate is left out of GSTR-1 Table 11A
//    — a WARNING (`advance_no_rate`) on the GSTR-1 checks and simple Taxes step 1; 11A is unchanged.
//  - FIG-G-3: GSTR-1 / GSTR-3B are refused for a period with no regular day (s.37(1), s.39(1) CGST
//    Act), dated by the registration in force (`returnRegistrationIn`), never today's.
// Every figure below is worked by hand: an advance of ₹11,800 received (tax-inclusive, rule 35).
const FROM = '2026-10-01'
const TO = '2026-10-31'
const ADVANCE = 1_180_000 // ₹11,800.00

function setup() {
  const db = seededDb()
  const groupId = (name: string): number => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id
  const vtId = (kind: string): number => (db.prepare('SELECT id FROM voucher_types WHERE kind = ?').get(kind) as { id: number }).id
  const L = (input: Parameters<typeof createLedger>[1]): number => createLedger(db, input).id
  const cash = (db.prepare("SELECT id FROM ledgers WHERE name = 'Cash'").get() as { id: number }).id
  const goodsSales = L({ name: 'Sales goods', groupId: groupId('Sales Accounts'), gstRate: 18, hsn: '8471' })
  const serviceSales = L({ name: 'Sales services', groupId: groupId('Sales Accounts'), gstRate: 18, hsn: '998314' })
  const cgst = L({ name: 'CGST', groupId: groupId('Duties & Taxes'), taxType: 'cgst' })
  const sgst = L({ name: 'SGST', groupId: groupId('Duties & Taxes'), taxType: 'sgst' })
  // A customer as the simple New account dialog makes one: no GST rate on the account.
  const customer = (name: string, gstRate: number | null = null): number => L({ name, groupId: groupId('Sundry Debtors'), stateCode: '27', gstRate })
  // Any other account with bill refs (no GST rate either).
  const account = (name: string, group: string): number => L({ name, groupId: groupId(group), stateCode: '27', gstRate: null })
  const save = (kind: string, date: string, party: number, lines: { ledgerId: number; drCr: DrCr; amount: number }[], refs: { kind: 'new' | 'against'; name: string; amount: number }[] = []) =>
    saveVoucher(db, {
      voucherTypeId: vtId(kind), date, partyLedgerId: party,
      lines: lines.map((l) => ({ ...l, costAllocations: [] })),
      inventory: [], billRefs: refs.map((r) => ({ ...r, dueDate: null })), tds: null
    })
  // ₹10,000 + CGST ₹900 + SGST ₹900 = ₹11,800 on a sales ledger; `against` = the advance it uses.
  const sale = (party: number, ledgerId: number, date: string, against?: { name: string; amount: number }, chargeGst = true) =>
    save('sales', date, party, chargeGst
      ? [
          { ledgerId: party, drCr: 'dr', amount: ADVANCE },
          { ledgerId, drCr: 'cr', amount: 1_000_000 },
          { ledgerId: cgst, drCr: 'cr', amount: 90_000 },
          { ledgerId: sgst, drCr: 'cr', amount: 90_000 }
        ]
      : [
          { ledgerId: party, drCr: 'dr', amount: 100_000 },
          { ledgerId, drCr: 'cr', amount: 100_000 }
        ],
    // What the advance doesn't cover stays due as the invoice's own bill.
    against ? [{ kind: 'against', ...against }, ...(against.amount < ADVANCE ? [{ kind: 'new' as const, name: `INV-${date}`, amount: ADVANCE - against.amount }] : [])] : [])
  const advance = (party: number, name: string, date = '2026-10-10') =>
    save('receipt', date, party, [
      { ledgerId: cash, drCr: 'dr', amount: ADVANCE },
      { ledgerId: party, drCr: 'cr', amount: ADVANCE }
    ], [{ kind: 'new', name, amount: ADVANCE }])
  return { db, goodsSales, serviceSales, customer, account, sale, advance }
}

const noRate = (s: ReturnType<typeof setup>, info: CompanyInfo = TEST_INFO) => gstValidate(s.db, info, FROM, TO).filter((i) => i.code === 'advance_no_rate')

describe('FIG-G-2 — an advance from a customer without a GST rate (warning only)', () => {
  it('S11c: a services business, a new customer with no rate pays ₹11,800 in October → warned; Table 11A stays empty', () => {
    const s = setup()
    // The business sells services (SAC 998314) to someone else; the new customer has no coded sale.
    s.sale(s.customer('Old Client', 18), s.serviceSales, '2026-09-05')
    const ravi = s.customer('Ravi Consulting')
    const a = s.advance(ravi, 'ADV-1')

    const issue = rateLessAdvanceIssue(s.db, TEST_INFO, FROM, TO)
    expect(issue).toMatchObject({ code: 'advance_no_rate', severity: 'warning', voucherIds: [a.id] })
    expect(issue!.message).toMatch(/^1 advance received in this period is not in Table 11A, because the customer’s account has no GST rate \(Ravi Consulting\)\./)
    // The advice the CA-style review asked for: never "is due", both returns, the 11B hand adjustment,
    // and what a rate on the account would do to filed months.
    expect(issue!.message).toContain('If an advance is for a taxable service')
    expect(issue!.message).toContain('Table 11A of GSTR-1 and to GSTR-3B')
    expect(issue!.message).toContain('Table 11B')
    expect(issue!.message).toContain('months already filed included')
    expect(noRate(s)).toEqual([issue])
    // A warning, never blocking — and 11A is exactly what it was: nothing for a customer without a rate.
    expect(() => assertExportable(s.db, TEST_INFO, FROM, TO, 'gstr1')).not.toThrow()
    expect(extractAdvances(s.db, TEST_INFO, FROM, TO)).toEqual([])
    expect(gstr1(s.db, TEST_INFO, FROM, TO, '102026').json.at).toBeUndefined()

    // The simple Taxes screen's step 1 reads the same list (October is the period it is asked for).
    const taxes = simpleTaxes(s.db, TEST_INFO, { period: '2026-10' }, '2026-11-18')
    expect(taxes.kind === 'regular' && taxes.advancesNoRate).toEqual({ receipts: 1, customers: ['Ravi Consulting'] })
  })

  it('a rated customer, a 0 % customer, a goods-only customer, a binned receipt → no warning', () => {
    const s = setup()
    s.advance(s.customer('Rated', 18), 'ADV-R')
    s.advance(s.customer('Nil rated', 0), 'ADV-0')
    // Goods only (HSN 8471, Notification 66/2017-CT): the advance carries no tax — `advance_goods`'s side.
    const goodsBuyer = s.customer('Goods Buyer')
    s.sale(goodsBuyer, s.goodsSales, '2026-09-05')
    s.advance(goodsBuyer, 'ADV-G')
    expect(noRate(s)).toEqual([])

    const services = s.customer('Service Buyer')
    s.sale(services, s.serviceSales, '2026-09-06')
    const binned = s.advance(services, 'ADV-B')
    expect(rateLessAdvanceParties(s.db, TEST_INFO, FROM, TO).map((p) => p.partyName)).toEqual(['Service Buyer'])
    deleteVoucher(s.db, binned.id)
    expect(noRate(s)).toEqual([])
    // Nothing to say → simple Taxes carries no field at all (its output reads as before R3).
    const taxes = simpleTaxes(s.db, TEST_INFO, { period: '2026-10' }, '2026-11-18')
    expect(taxes.kind === 'regular' && 'advancesNoRate' in taxes).toBe(false)
  })

  it('review of #290: only a customer’s advance — a supplier’s refund or a loan received with a New Ref is no supply', () => {
    const s = setup()
    s.sale(s.customer('Old Client', 18), s.serviceSales, '2026-09-05')
    // ₹11,800 in from a supplier (a refund booked as a New Ref) and from a lender (a loan with bill refs).
    s.advance(s.account('Supplier X', 'Sundry Creditors'), 'REF-1')
    s.advance(s.account('Loan from Y', 'Loans (Liability)'), 'LOAN-1')
    expect(rateLessAdvanceParties(s.db, TEST_INFO, FROM, TO)).toEqual([])
    expect(noRate(s)).toEqual([])
    // A customer's advance beside them still warns (S11c), naming only the customer.
    const a = s.advance(s.customer('Ravi Consulting'), 'ADV-1')
    expect(noRate(s).map((i) => i.voucherIds)).toEqual([[a.id]])
    expect(noRate(s)[0]!.message).toContain('(Ravi Consulting)')
  })

  it('an invoice of the same period that takes the whole advance → none; the same invoice next month → warned', () => {
    const s = setup()
    s.sale(s.customer('Old Client', 18), s.serviceSales, '2026-09-05')
    const ravi = s.customer('Ravi Consulting')
    const a = s.advance(ravi, 'ADV-1')
    // ₹11,800 invoiced on 25 Oct against ADV-1 (11A "for which invoice has not been issued").
    const inv = s.sale(ravi, s.serviceSales, '2026-10-25', { name: 'ADV-1', amount: ADVANCE })
    expect(noRate(s)).toEqual([])
    // The same invoice in November leaves October's advance open.
    deleteVoucher(s.db, inv.id)
    s.sale(ravi, s.serviceSales, '2026-11-02', { name: 'ADV-1', amount: ADVANCE })
    expect(noRate(s).map((i) => i.voucherIds)).toEqual([[a.id]])
  })

  it('an invoice taking ₹5,900 of the ₹11,800 leaves ₹5,900 open → warned', () => {
    const s = setup()
    s.sale(s.customer('Old Client', 18), s.serviceSales, '2026-09-05')
    const ravi = s.customer('Ravi Consulting')
    const a = s.advance(ravi, 'ADV-1')
    s.sale(ravi, s.serviceSales, '2026-10-25', { name: 'ADV-1', amount: 590_000 })
    expect(noRate(s).map((i) => i.voucherIds)).toEqual([[a.id]])
  })

  it('dated by the registration on the receipt’s day: unregistered / composition → none', () => {
    const s = setup()
    s.sale(s.customer('Old Client', 18), s.serviceSales, '2026-09-05')
    const ravi = s.customer('Ravi Consulting')
    s.advance(ravi, 'ADV-EARLY', '2026-10-10')
    expect(noRate(s, { ...TEST_INFO, gstRegistrationType: 'unregistered', gstin: null })).toEqual([])
    expect(noRate(s, { ...TEST_INFO, gstRegistrationType: 'composition' })).toEqual([])
    // Composition until 14 Oct, regular from 15 Oct: the 10 Oct advance is a composition day's; the
    // 20 Oct one is a regular day's.
    const movedIn: CompanyInfo = { ...TEST_INFO, gstRegistrationSince: '2026-10-15', gstPreviousRegistrationType: 'composition' }
    expect(rateLessAdvanceIssue(s.db, movedIn, FROM, TO)).toBeNull()
    const late = s.advance(ravi, 'ADV-LATE', '2026-10-20')
    expect(rateLessAdvanceIssue(s.db, movedIn, FROM, TO)?.voucherIds).toEqual([late.id])
  })
})

describe('FIG-G-3 — GSTR-1 / GSTR-3B only for a period with a regular day', () => {
  const notDue = (fn: () => void): AppError => {
    try {
      fn()
    } catch (e) {
      return e as AppError
    }
    throw new Error('expected a refusal')
  }

  it('a composition period: both exports refused with the reason (CMP-08 / GSTR-4); gstValidate blocks GSTR-1', () => {
    const s = setup()
    const comp: CompanyInfo = { ...TEST_INFO, gstRegistrationType: 'composition' }
    s.sale(s.customer('Walk-in'), s.goodsSales, '2026-10-05', undefined, false)
    for (const form of ['gstr1', 'gstr3b'] as const) {
      const err = notDue(() => assertExportable(s.db, comp, FROM, TO, form))
      expect(err).toBeInstanceOf(AppError)
      expect(err.code).toBe('gst_return_not_due')
      expect(err.message).toContain(`A composition dealer files CMP-08 and GSTR-4, not ${form === 'gstr1' ? 'GSTR-1' : 'GSTR-3B'}`)
    }
    expect(gstValidate(s.db, comp, FROM, TO).find((i) => i.code === 'composition')?.severity).toBe('blocking')
  })

  it('regular until 31 Oct, composition from 1 Nov (today’s type): October still exports, November is refused', () => {
    const s = setup()
    const movedAway: CompanyInfo = { ...TEST_INFO, gstRegistrationType: 'composition', gstRegistrationSince: '2026-11-01', gstPreviousRegistrationType: 'regular' }
    s.sale(s.customer('Client', 18), s.serviceSales, '2026-10-05')
    // Before R3 today's composition blocked October's GSTR-1 too (`composition` read today's type).
    expect(() => assertExportable(s.db, movedAway, FROM, TO, 'gstr1')).not.toThrow()
    expect(() => assertExportable(s.db, movedAway, FROM, TO, 'gstr3b')).not.toThrow()
    expect(gstValidate(s.db, movedAway, FROM, TO).filter((i) => i.code === 'composition' || i.code === 'not_regular_days')).toEqual([])
    expect(notDue(() => assertExportable(s.db, movedAway, '2026-11-01', '2026-11-30', 'gstr1')).code).toBe('gst_return_not_due')
  })

  it('composition until 14 Oct, regular from 15 Oct: October is a regular return (s.39(1) "part thereof"); the composition days’ bills are warned about', () => {
    const s = setup()
    const movedIn: CompanyInfo = { ...TEST_INFO, gstRegistrationSince: '2026-10-15', gstPreviousRegistrationType: 'composition' }
    const walkIn = s.customer('Walk-in')
    const early = s.sale(walkIn, s.goodsSales, '2026-10-05', undefined, false) // ₹1,000, no GST (composition day)
    s.sale(s.customer('Client', 18), s.serviceSales, '2026-10-20')
    // Today's type is regular, so October was offered before R3 too — with no word about the early bill.
    expect(() => assertExportable(s.db, movedIn, FROM, TO, 'gstr1')).not.toThrow()
    const off = gstValidate(s.db, movedIn, FROM, TO).filter((i) => i.code === 'not_regular_days')
    expect(off).toHaveLength(1)
    expect(off[0]).toMatchObject({ severity: 'warning', voucherIds: [early.id] })
    expect(off[0]!.message).toMatch(/^1 document is dated on days the company was under the composition scheme \(the registration changed on 15-Oct-26\)\./)
    expect(off[0]!.message).toContain('CMP-08 and GSTR-4')
    // September (wholly composition) is refused.
    expect(notDue(() => assertExportable(s.db, movedIn, '2026-09-01', '2026-09-30', 'gstr3b')).code).toBe('gst_return_not_due')
  })

  it('review of #290: a quarterly filer — composition until 14 Aug, regular from 15 Aug: July is part of a regular Jul–Sep return', () => {
    const s = setup()
    const movedIn: CompanyInfo = { ...TEST_INFO, gstRegistrationSince: '2026-08-15', gstPreviousRegistrationType: 'composition' }
    const julyFrom = '2026-07-01'
    const julyTo = '2026-07-31'
    const julyBill = s.sale(s.customer('Walk-in'), s.goodsSales, '2026-07-10', undefined, false) // ₹1,000, no GST (composition day)
    // Monthly filer: July alone has no regular day — refused, as each month is its own return.
    expect(notDue(() => assertExportable(s.db, movedIn, julyFrom, julyTo, 'gstr1')).code).toBe('gst_return_not_due')
    // Quarterly filer: July belongs to the Jul–Sep quarter, regular from 15 Aug ("for every quarter or
    // part thereof") — July's month export (the quarter bundle runs it per month) is not refused, no
    // `composition` blocker, and its composition-day bill is named as for a split month.
    setGstProfile(s.db, { filing: 'quarterly' })
    expect(() => assertExportable(s.db, movedIn, julyFrom, julyTo, 'gstr1')).not.toThrow()
    expect(() => assertExportable(s.db, movedIn, julyFrom, julyTo, 'gstr3b')).not.toThrow()
    const july = gstValidate(s.db, movedIn, julyFrom, julyTo)
    expect(july.find((i) => i.code === 'composition')).toBeUndefined()
    expect(july.find((i) => i.code === 'not_regular_days')).toMatchObject({ severity: 'warning', voucherIds: [julyBill.id] })
    // The Apr–Jun quarter has no regular day: still refused.
    expect(notDue(() => assertExportable(s.db, movedIn, '2026-06-01', '2026-06-30', 'gstr3b')).code).toBe('gst_return_not_due')
  })

  it('review of #290: a month before a NEW registration (regular from 15 Nov) is refused without calling it a cancellation', () => {
    const s = setup()
    const registered: CompanyInfo = { ...TEST_INFO, gstRegistrationSince: '2026-11-15', gstPreviousRegistrationType: 'unregistered' }
    const err = notDue(() => assertExportable(s.db, registered, FROM, TO, 'gstr1'))
    expect(err.code).toBe('gst_return_not_due')
    expect(err.message).toBe('The business was not registered for GST in this period — its registration took effect on 15-Nov-26 — so no GSTR-1 is due for it.')
    // November (registered from the 15th) is a regular return.
    expect(() => assertExportable(s.db, registered, '2026-11-01', '2026-11-30', 'gstr1')).not.toThrow()
  })

  it('a cancelled registration (unregistered from 1 Nov): October exports; November says no return and points to the CA for the final one', () => {
    const s = setup()
    const cancelled: CompanyInfo = { ...TEST_INFO, gstRegistrationType: 'unregistered', gstRegistrationSince: '2026-11-01', gstPreviousRegistrationType: 'regular' }
    expect(() => assertExportable(s.db, cancelled, FROM, TO, 'gstr3b')).not.toThrow()
    const err = notDue(() => assertExportable(s.db, cancelled, '2026-11-01', '2026-11-30', 'gstr3b'))
    expect(err.code).toBe('gst_return_not_due')
    expect(err.message).toBe('The business was not registered for GST on any day of this period, so no GSTR-3B is due for it. Ask your CA about the final return after a cancellation.')
    expect(gstValidate(s.db, cancelled, '2026-11-01', '2026-11-30').find((i) => i.code === 'not_registered')?.severity).toBe('blocking')
  })
})
