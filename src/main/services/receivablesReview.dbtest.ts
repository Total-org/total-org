// WP 4.2 review fixes: the "creates new credit" credit-hold rule on every path, old interest
// notes immutable (interest on overdue bills itself was removed, audit A13b), ledger-delete audit
// and a statement with an opening.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('./pdf', () => ({
  htmlToPdf: async (html: string) => Buffer.from(`%PDF-test ${html.length}`),
  writeExportPdf: async () => '/dev/null'
}))

import type { DB } from '../db/connection'
import { seededDb, TEST_INFO } from '../db/testdb'
import type { CompanyInfo } from '@shared/domain'
import { createLedger, deleteLedger } from './masters'
import { saveVoucher, getVoucher, CREDIT_HOLD_PREFIX, INTEREST_NOTE_IMMUTABLE } from './vouchers'
import { ledgerStatement } from './reports'
import { counterCheckout } from './counter'
import { pricingFixture } from './pricingFixture.testutil'
import { dc, item, tradeBooks } from './tradeFixture.testutil'
import * as rx from './receivables'

const COMPANY: CompanyInfo = { ...TEST_INFO, gstin: '27AAACT1234K1Z5', gstRegistrationType: 'regular' }

beforeAll(() => {
  process.env.TOTAL_DATA_DIR = mkdtempSync(join(tmpdir(), 'total-rx-review-'))
})

const groupId = (db: DB, name: string): number => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id
const vtId = (db: DB, kind: string): number => (db.prepare('SELECT id FROM voucher_types WHERE kind = ? ORDER BY id LIMIT 1').get(kind) as { id: number }).id

interface Books { db: DB; s18: number; s28c: number; s5: number; cgst: number; sgst: number; igst: number; cess: number; bank: number }

function books(): Books {
  const db = seededDb()
  const g = (n: string) => groupId(db, n)
  const s18 = createLedger(db, { name: 'Services 18', groupId: g('Sales Accounts'), gstRate: 18 }).id
  const s28c = createLedger(db, { name: 'Services 28 + cess', groupId: g('Sales Accounts'), gstRate: 28 }).id
  db.prepare('UPDATE ledgers SET cess_rate = 12 WHERE id = ?').run(s28c)
  const s5 = createLedger(db, { name: 'Services 5', groupId: g('Sales Accounts'), gstRate: 5 }).id
  return {
    db, s18, s28c, s5,
    cgst: createLedger(db, { name: 'Output CGST', groupId: g('Duties & Taxes'), taxType: 'cgst' }).id,
    sgst: createLedger(db, { name: 'Output SGST', groupId: g('Duties & Taxes'), taxType: 'sgst' }).id,
    igst: createLedger(db, { name: 'Output IGST', groupId: g('Duties & Taxes'), taxType: 'igst' }).id,
    cess: createLedger(db, { name: 'Output Cess', groupId: g('Duties & Taxes'), taxType: 'cess' }).id,
    bank: createLedger(db, { name: 'HDFC Bank', groupId: g('Bank Accounts') }).id
  }
}

function party(b: Books, name: string, opts: { state?: string | null; exportType?: 'sez_wp' | 'sez_wop' | 'exp_wp' | 'exp_wop' | null; opening?: number; creditDays?: number; graceDays?: number } = {}): number {
  return createLedger(b.db, {
    name, groupId: groupId(b.db, 'Sundry Debtors'), stateCode: opts.state === undefined ? '27' : opts.state, exportType: opts.exportType ?? null,
    openingBalance: opts.opening ?? 0, creditDays: opts.creditDays ?? 30, interestRateBp: 1800, interestGraceDays: opts.graceDays ?? 0
  }).id
}

/** A service invoice: taxable per sales ledger, tax as the GST engine computes it (posted lines
 *  don't drive the interest — the invoice's items and class do). */
function invoice(b: Books, partyId: number, date: string, parts: [ledgerId: number, taxable: number][], opts: { number?: string; posOverride?: string; billRef?: string } = {}): number {
  const total = parts.reduce((s, [, t]) => s + t, 0)
  return saveVoucher(b.db, {
    voucherTypeId: vtId(b.db, 'sales'), date, number: opts.number, partyLedgerId: partyId, posOverride: opts.posOverride ?? null,
    lines: [{ ledgerId: partyId, drCr: 'dr', amount: total }, ...parts.map(([l, t]) => ({ ledgerId: l, drCr: 'cr' as const, amount: t }))],
    billRefs: opts.billRef ? [{ kind: 'new', name: opts.billRef, amount: total, dueDate: null }] : []
  }).id
}

function receipt(b: Books, partyId: number, date: string, amount: number): void {
  saveVoucher(b.db, { voucherTypeId: vtId(b.db, 'receipt'), date, partyLedgerId: partyId, lines: [{ ledgerId: b.bank, drCr: 'dr', amount }, { ledgerId: partyId, drCr: 'cr', amount }] })
}


describe('statements', () => {
  it('statement with a non-zero opening equals the ledger statement', () => {
    const b = books()
    const p = party(b, 'Opening Statement', { opening: 25_000 })
    invoice(b, p, '2026-04-05', [[b.s18, 10_000]])
    receipt(b, p, '2026-05-01', 5_000)
    invoice(b, p, '2026-06-05', [[b.s18, 20_000]])
    const ls = ledgerStatement(b.db, p, '2026-05-01', '2026-06-30')
    const s = rx.statementData(b.db, COMPANY, p, '2026-05-01', '2026-06-30')
    expect(s.opening).toBe(ls.opening)
    expect(s.opening).toBe(25_000 + 10_000)
    expect([s.closing, s.rows.length]).toEqual([ls.closing, ls.rows.length])
    expect(s.openBills.reduce((a, x) => a + x.pending, 0) - s.unapplied).toBe(s.closing)
  })
})

describe('3. credit hold: every save that creates new credit is refused', () => {
  const sale = (b: Books, p: number, amount: number, extra: Record<string, unknown> = {}, id?: number) =>
    saveVoucher(b.db, { voucherTypeId: vtId(b.db, 'sales'), date: '2026-05-01', partyLedgerId: p, lines: [{ ledgerId: p, drCr: 'dr', amount }, { ledgerId: b.s18, drCr: 'cr', amount }], ...extra }, id)

  it('new / increased / moved onto the held party / optional→real / post-dated→dated', () => {
    const b = books()
    const held = party(b, 'Held')
    const other = party(b, 'Other')
    const kept = sale(b, held, 1000)
    const optional = sale(b, held, 1000, { isOptional: true })
    const pdc = sale(b, held, 1000, { postDated: true, date: '2026-12-01' })
    const onOther = sale(b, other, 1000)
    rx.setCreditHold(b.db, held, true, 'Overdue')
    expect(() => sale(b, held, 1000)).toThrow(CREDIT_HOLD_PREFIX)
    expect(() => sale(b, held, 1000, { postDated: true, date: '2026-12-02' })).toThrow(CREDIT_HOLD_PREFIX)
    sale(b, held, 900, {}, kept.id) // lowering passes
    expect(() => sale(b, held, 1500, {}, kept.id)).toThrow(CREDIT_HOLD_PREFIX)
    expect(() => sale(b, held, 1000, {}, onOther.id)).toThrow(CREDIT_HOLD_PREFIX)
    sale(b, held, 1000, { isOptional: true }, optional.id) // still optional: passes
    expect(() => sale(b, held, 1000, { isOptional: false }, optional.id)).toThrow(CREDIT_HOLD_PREFIX)
    expect(() => sale(b, held, 1000, { postDated: false, date: '2026-05-02' }, pdc.id)).toThrow(CREDIT_HOLD_PREFIX)
    // Not a hold kind → turned into a sale = new credit.
    const j = saveVoucher(b.db, { voucherTypeId: vtId(b.db, 'journal'), date: '2026-05-01', partyLedgerId: held, lines: [{ ledgerId: held, drCr: 'dr', amount: 100 }, { ledgerId: b.s18, drCr: 'cr', amount: 100 }] })
    expect(() => sale(b, held, 100, {}, j.id)).toThrow(CREDIT_HOLD_PREFIX)
    // The owner override lets one through.
    saveVoucher(b.db, { voucherTypeId: vtId(b.db, 'sales'), date: '2026-05-01', partyLedgerId: held, lines: [{ ledgerId: held, drCr: 'dr', amount: 10 }, { ledgerId: b.s18, drCr: 'cr', amount: 10 }] }, undefined, { creditHoldOverride: { reason: 'Owner approved' } })
  }, 20000)

  it('delivery challans to a held party are blocked (incl. a trade conversion saved as a challan)', () => {
    const t = tradeBooks()
    const widget = item(t.db, 'Widget', { opening: [100, 100_000] })
    dc(t, '2026-05-01', [{ item: widget, qty: 1, amount: 1000 }])
    rx.setCreditHold(t.db, t.buyer, true, 'Overdue')
    expect(() => dc(t, '2026-05-02', [{ item: widget, qty: 1, amount: 1000 }])).toThrow(CREDIT_HOLD_PREFIX)
  })

  it('counter billing goes through the same check', () => {
    const f = pricingFixture()
    rx.setCreditHold(f.db, f.umbrella, true, 'Overdue')
    expect(() => counterCheckout(f.db, TEST_INFO, { date: '2025-10-07', partyLedgerId: f.umbrella, lines: [{ itemId: f.pen, qtyMilli: 1000, ratePaise: 1000 }] })).toThrow(CREDIT_HOLD_PREFIX)
  })
})

describe('plausible items', () => {
  it('an interest debit note from before the cut (audit A13b) can only be binned, not edited', () => {
    const b = books()
    const p = party(b, 'Immutable Co')
    const inv = invoice(b, p, '2026-04-01', [[b.s18, 100_000]])
    const note = saveVoucher(b.db, {
      voucherTypeId: vtId(b.db, 'debit_note'), date: '2026-06-05', partyLedgerId: p,
      lines: [{ ledgerId: p, drCr: 'dr', amount: 1_746 }, { ledgerId: b.s18, drCr: 'cr', amount: 1_746 }]
    }).id
    // What the removed interest feature stored beside its note (old books carry these rows).
    b.db.prepare(
      `INSERT INTO interest_charges (party_ledger_id, bill_voucher_id, bill_ref, bill_key, period_from, period_to, days, principal_paise, rate_bp, interest_paise, gst_paise, debit_note_voucher_id)
       VALUES (?, ?, 'INV-1', ?, '2026-05-01', '2026-06-05', 36, 100000, 1800, 1746, 0, ?)`
    ).run(p, inv, `v:${inv}`, note)
    const v = getVoucher(b.db, note)!
    expect(() => saveVoucher(b.db, { ...v, narration: 'edited' } as never, v.id)).toThrow(INTEREST_NOTE_IMMUTABLE)
  })

  it('deleting a ledger records the reminders / follow-ups it took with it', () => {
    const b = books()
    const p = party(b, 'Deleted Co', { opening: 0 })
    rx.addFollowup(b.db, { ledgerId: p, billVoucherId: null, billRef: 'Opening', date: '2026-05-01', note: 'Called' })
    deleteLedger(b.db, p)
    const row = b.db.prepare("SELECT before_json AS b FROM audit_log WHERE entity = 'ledger' AND action = 'delete' AND entity_id = ?").get(p) as { b: string }
    expect(JSON.parse(row.b).cascaded).toEqual({ bill_followups: 1 })
  })
})
