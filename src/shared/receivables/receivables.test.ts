import { describe, expect, it } from 'vitest'
import { addDaysIso, daysBetweenIso } from './interest'
import { ageingBucketIndex, ageingBuckets, mailtoLink, mergeTemplate, reminderBucketFor, reminderCadence, reminderFields } from './reminders'
import { collectionMonth, daysInMonth, dso, monthsBetween } from './collections'
import { DEFAULT_RECEIVABLES_CONFIG, parseReceivablesConfig, receivablesConfigSchema } from './config'
import { RECEIVABLES_SOURCES } from './sources'
import { renderDocument } from '../print/render'
import { sampleDocument } from '../print/sample'
import { CLASSIC_DEFAULT, MODERN_DEFAULT, RECEIPT_80MM_DEFAULT, printKindForVoucherKind } from '../printTemplates'
import type { CompanyInfo } from '../domain'

describe('day helpers and the interest rule record', () => {
  it('counts actual days, leap day included', () => {
    expect(daysBetweenIso('2028-02-28', '2028-03-01')).toBe(2)
    expect(daysBetweenIso('2026-05-07', '2026-05-01')).toBe(-6)
    expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('cites every rule and marks the open questions UNVERIFIED', () => {
    expect(RECEIVABLES_SOURCES.find((s) => s.id === 'cgst-15-2-d')!.citation).toContain('15(2)(d)')
    expect(RECEIVABLES_SOURCES.filter((s) => !s.verified).every((s) => s.rule.includes('UNVERIFIED') || s.id === 'no-gst-unregistered')).toBe(true)
  })
})

describe('ageing buckets and reminder letters', () => {
  it('buckets by days overdue: 0–30, 31–60, 61–90, 90+', () => {
    expect([0, 30, 31, 60, 61, 90, 91, 400].map(ageingBucketIndex)).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
    expect(ageingBuckets([{ pending: 5, overdueDays: 0 }, { pending: 7, overdueDays: 45 }, { pending: 1, overdueDays: 120 }])).toEqual([5, 7, 0, 1])
  })

  it('chooses gentle / firm / final by the oldest bill', () => {
    const cfg = DEFAULT_RECEIVABLES_CONFIG
    expect(reminderBucketFor(0, cfg)).toBeNull()
    expect(reminderBucketFor(1, cfg)).toBe('gentle')
    expect(reminderBucketFor(30, cfg)).toBe('gentle')
    expect(reminderBucketFor(31, cfg)).toBe('firm')
    expect(reminderBucketFor(61, cfg)).toBe('final')
    expect(reminderBucketFor(15, { firmFromDays: 10, finalFromDays: 20 })).toBe('firm')
  })

  it("doesn't send twice within N days", () => {
    expect(reminderCadence(null, '2026-05-10', 7)).toEqual({ allowed: true, nextAllowed: null })
    expect(reminderCadence('2026-05-05', '2026-05-10', 7)).toEqual({ allowed: false, nextAllowed: '2026-05-12' })
    expect(reminderCadence('2026-05-05', '2026-05-12', 7)).toEqual({ allowed: true, nextAllowed: null })
    expect(reminderCadence('2026-05-10', '2026-05-10', 0)).toEqual({ allowed: true, nextAllowed: null })
  })

  it('merges fields and leaves unknown tokens visible', () => {
    expect(mergeTemplate('Dear {party}, {amount} due — {nope}', { party: 'Mehta', amount: '₹5.00' })).toBe('Dear Mehta, ₹5.00 due — {nope}')
    const f = reminderFields({
      company: 'Acme', party: 'Mehta', asOn: '2026-05-10', totalPending: 9000,
      overdue: [
        { voucherId: 1, number: 'INV-1', date: '2026-03-01', amount: 5000, pending: 5000, ageDays: 70, dueDate: '2026-03-31', overdueDays: 40 },
        { voucherId: 2, number: 'INV-2', date: '2026-04-01', amount: 4000, pending: 1000, ageDays: 39, dueDate: '2026-04-30', overdueDays: 10 }
      ]
    })
    expect([f.amount, f.total, f.oldestBill, f.days]).toEqual(['₹60.00', '₹90.00', 'INV-1', '40'])
    expect(f.bills!.split('\n')).toHaveLength(2)
  })

  it('builds a mailto: link with encoded subject and body', () => {
    const m = mailtoLink('a@b.in', 'Hi & bye', 'Line 1\nLine 2')
    expect(m).toBe('mailto:a@b.in?subject=Hi%20%26%20bye&body=Line%201%0ALine%202')
    expect(mailtoLink(null, 's', 'b')).toBe('mailto:?subject=s&body=b')
  })

  it('config defaults parse, and the final letter must start after the firm one', () => {
    expect(parseReceivablesConfig({}).minDaysBetweenReminders).toBe(7)
    expect(parseReceivablesConfig('garbage' as unknown).interest.gstOnInterest).toBe(true)
    expect(() => receivablesConfigSchema.parse({ firmFromDays: 40, finalFromDays: 30 })).toThrow()
  })
})

describe('collection measures', () => {
  it('DSO and collection efficiency (received ÷ due)', () => {
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2028-02')).toBe(29)
    expect(dso(50_000, 100_000, 30)).toBe(15)
    expect(dso(50_000, 0, 30)).toBeNull()
    const m = collectionMonth({ month: '2026-05', opening: 100_000, sales: 50_000, closing: 70_000, closingNotDue: 30_000 })
    expect([m.collected, m.due, m.efficiency]).toEqual([80_000, 120_000, 0.6667])
    expect(m.dso).toBe(43.4)
    expect(collectionMonth({ month: '2026-05', opening: 0, sales: 10, closing: 10, closingNotDue: 10 }).efficiency).toBeNull()
    expect(monthsBetween('2026-11-15', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
  })
})

const COMPANY: CompanyInfo = {
  name: 'Acme Traders', stateCode: '27', gstin: '27AAACA1234A1Z5', gstRegistrationType: 'regular', address: '1 Main Road',
  booksFrom: 2026, email: null, phone: null, pan: null, tan: null
}

describe('statement and reminder print kinds', () => {
  it('are party documents, never a voucher kind’s form', () => {
    expect(printKindForVoucherKind('statement')).toBeNull()
    expect(printKindForVoucherKind('reminder')).toBeNull()
    expect(CLASSIC_DEFAULT.header.titles.statement).toBe('STATEMENT OF ACCOUNT')
  })

  it('render the sample statement and reminder in every style', () => {
    for (const t of [CLASSIC_DEFAULT, MODERN_DEFAULT, RECEIPT_80MM_DEFAULT]) {
      const s = renderDocument(t, sampleDocument(COMPANY, 'statement'))
      expect(s).toContain('STATEMENT OF ACCOUNT')
      expect(s).toContain('Opening balance')
      expect(s).toContain('Open bills as on')
      expect(s).toContain('Ageing (days overdue)')
      expect(s).toContain('HDFC0001234')
      expect(s).not.toContain("Receiver's signature")
      const r = renderDocument(t, sampleDocument(COMPANY, 'reminder'))
      expect(r).toContain('PAYMENT REMINDER')
      expect(r).toContain('INV-SAMPLE-1')
      expect(r).toContain('Second reminder')
    }
  })

  it('escapes party text', () => {
    const doc = sampleDocument(COMPANY, 'statement')
    if (doc.shape !== 'statement') throw new Error('shape')
    doc.statement.party.name = '<script>x</script>'
    expect(renderDocument(CLASSIC_DEFAULT, doc)).not.toContain('<script>x')
  })
})
