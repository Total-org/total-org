// A10 (audit 2026-11 PROD-7 / PROD-8): the UPI ID setting, the pay QR on a sales bill's print
// (what is due as on today, from the Outstandings allocation) and the share facts. Figures are
// hand-worked: a ₹1,18,000 bill with ₹50,000 received on account leaves ₹68,000 due.
import { beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CompanyInfo, DrCr } from '@shared/domain'
import { seededDb, TEST_INFO } from '../db/testdb'
import { ensureCompanyTree } from '../paths'
import { createLedger } from './masters'
import { saveVoucher } from './vouchers'
import * as pt from './printTemplates'
import { getUpiSettings, setUpiSettings } from './upiSettings'
import { billShareFacts } from './billShare'

const INFO: CompanyInfo = { ...TEST_INFO, name: 'Sharma Stores', gstin: '27AAPFU0939F1ZV' }
const TODAY = '2026-11-08'

beforeAll(() => {
  process.env.TOTAL_DATA_DIR = mkdtempSync(join(tmpdir(), 'total-upi-test-'))
  ensureCompanyTree('upi-test')
})

function setup() {
  const db = seededDb()
  const groupId = (name: string): number => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id
  const vtId = (kind: string): number => (db.prepare('SELECT id FROM voucher_types WHERE kind = ?').get(kind) as { id: number }).id
  const buyer = createLedger(db, { name: 'Ramesh & Sons', groupId: groupId('Sundry Debtors'), stateCode: '27', phone: '98765 43210', email: 'ramesh@example.in' }).id
  const sales = createLedger(db, { name: 'Sales 18', groupId: groupId('Sales Accounts'), gstRate: 18 }).id
  const cgst = createLedger(db, { name: 'CGST', groupId: groupId('Duties & Taxes'), taxType: 'cgst' }).id
  const sgst = createLedger(db, { name: 'SGST', groupId: groupId('Duties & Taxes'), taxType: 'sgst' }).id
  const bank = createLedger(db, { name: 'HDFC Bank', groupId: groupId('Bank Accounts') }).id
  const post = (
    kind: string, date: string, partyId: number | null, lines: { ledgerId: number; drCr: DrCr; amount: number }[],
    billRefs: { kind: 'new' | 'against'; name: string; amount: number; dueDate: string | null }[] = []
  ) =>
    saveVoucher(db, {
      voucherTypeId: vtId(kind), date, partyLedgerId: partyId, reference: null, narration: null,
      lines: lines.map((l) => ({ ...l, costAllocations: [] })), inventory: [], billRefs, tds: null
    }).id
  // ₹1,00,000 + 9% + 9% = ₹1,18,000.
  const bill = post('sales', '2026-07-05', buyer, [
    { ledgerId: buyer, drCr: 'dr', amount: 11800000 },
    { ledgerId: sales, drCr: 'cr', amount: 10000000 },
    { ledgerId: cgst, drCr: 'cr', amount: 900000 },
    { ledgerId: sgst, drCr: 'cr', amount: 900000 }
  ])
  const receive = (amount: number, date = '2026-07-10') => post('receipt', date, null, [
    { ledgerId: bank, drCr: 'dr', amount },
    { ledgerId: buyer, drCr: 'cr', amount }
  ])
  return { db, bill, buyer, sales, cgst, sgst, bank, receive, post }
}

describe('UPI ID setting (meta upi, audited as a company update)', () => {
  it('cleans, stores, audits once; the same value again writes nothing; a bad one is refused', () => {
    const { db } = setup()
    const audits = () => db.prepare("SELECT before_json AS b, after_json AS a FROM audit_log WHERE entity = 'company' AND action = 'update'").all() as { b: string; a: string }[]
    expect(getUpiSettings(db)).toEqual({ upiId: null })
    expect(setUpiSettings(db, { upiId: null })).toEqual({ upiId: null })
    expect(audits()).toHaveLength(0)
    expect(setUpiSettings(db, { upiId: ' Sharma@YBL ' })).toEqual({ upiId: 'sharma@ybl' })
    expect(audits()).toHaveLength(1)
    expect(JSON.parse(audits()[0]!.b)).toEqual({ upi: null })
    expect(JSON.parse(audits()[0]!.a)).toEqual({ upi: { upiId: 'sharma@ybl' } })
    setUpiSettings(db, { upiId: 'sharma@ybl' })
    expect(audits()).toHaveLength(1)
    expect(() => setUpiSettings(db, { upiId: 'sharma' })).toThrow(expect.objectContaining({ code: 'upi_invalid' }))
    expect(getUpiSettings(db)).toEqual({ upiId: 'sharma@ybl' })
    expect(audits()).toHaveLength(1)
  })
})

describe('the UPI pay QR on a print', () => {
  it('no UPI ID → no upi on the document, and the HTML is the same as after setting and clearing one', () => {
    const { db, bill } = setup()
    const doc = pt.loadPrintDocument(db, INFO, bill)
    expect('upi' in doc).toBe(false)
    const before = pt.documentHtml(db, INFO, bill).html
    setUpiSettings(db, { upiId: 'sharma@ybl' })
    expect(pt.documentHtml(db, INFO, bill).html).not.toBe(before)
    setUpiSettings(db, { upiId: '' })
    expect(pt.documentHtml(db, INFO, bill).html).toBe(before)
  })
  it('asks for what is still due: ₹1,18,000 − ₹50,000 received = ₹68,000', () => {
    const { db, bill, receive } = setup()
    setUpiSettings(db, { upiId: 'sharma@ybl' })
    expect(pt.loadPrintDocument(db, INFO, bill)).toMatchObject({
      upi: { upiId: 'sharma@ybl', amountPaise: 11800000, link: expect.stringContaining('&am=118000.00&') }
    })
    receive(5000000)
    const doc = pt.loadPrintDocument(db, INFO, bill)
    expect(doc).toMatchObject({ upi: { amountPaise: 6800000 } })
    const number = (db.prepare('SELECT number FROM vouchers WHERE id = ?').get(bill) as { number: string }).number
    expect((doc as { upi: { link: string } }).upi.link).toBe(
      `upi://pay?pa=sharma@ybl&pn=Sharma%20Stores&am=68000.00&tn=${encodeURIComponent(`Bill ${number}`)}&cu=INR`
    )
    const html = pt.documentHtml(db, INFO, bill).html
    expect(html).toContain('data-upi-qr')
    expect(html).toContain('to pay ₹68,000.00 to sharma@ybl')
  })
  it('review #1: an invoice that opens two bills asks for both — ₹400 + ₹600 = ₹1,000', () => {
    const { db, buyer, sales, post } = setup()
    setUpiSettings(db, { upiId: 'sharma@ybl' })
    const two = post('sales', '2026-08-01', buyer, [{ ledgerId: buyer, drCr: 'dr', amount: 100000 }, { ledgerId: sales, drCr: 'cr', amount: 100000 }], [
      { kind: 'new', name: 'A', amount: 40000, dueDate: '2026-08-15' },
      { kind: 'new', name: 'B', amount: 60000, dueDate: '2026-09-15' }
    ])
    expect(pt.loadPrintDocument(db, INFO, two)).toMatchObject({ upi: { amountPaise: 100000 } })
    expect(billShareFacts(db, INFO, two, TODAY).duePaise).toBe(100000)
  })
  it('review #4: a sale to a non-customer account (Cash) gets no QR', () => {
    const { db, sales, bank, post } = setup()
    setUpiSettings(db, { upiId: 'sharma@ybl' })
    const toBank = post('sales', '2026-08-01', bank, [{ ledgerId: bank, drCr: 'dr', amount: 50000 }, { ledgerId: sales, drCr: 'cr', amount: 50000 }])
    expect('upi' in pt.loadPrintDocument(db, INFO, toBank)).toBe(false)
  })
  it('paid in full → no QR; a credit note → never', () => {
    const { db, bill, buyer, sales, cgst, sgst, receive, post } = setup()
    setUpiSettings(db, { upiId: 'sharma@ybl' })
    receive(11800000)
    expect('upi' in pt.loadPrintDocument(db, INFO, bill)).toBe(false)
    const note = post('credit_note', '2026-07-20', buyer, [
      { ledgerId: sales, drCr: 'dr', amount: 100000 },
      { ledgerId: cgst, drCr: 'dr', amount: 9000 },
      { ledgerId: sgst, drCr: 'dr', amount: 9000 },
      { ledgerId: buyer, drCr: 'cr', amount: 118000 }
    ])
    expect('upi' in pt.loadPrintDocument(db, INFO, note)).toBe(false)
  })
})

describe('share facts', () => {
  it('review #2: a walk-in sale ("Cash sale") greets nobody by name and has no contact', () => {
    const { db, sales, post } = setup()
    const groupId = (db.prepare("SELECT id FROM groups WHERE name = 'Sundry Debtors'").get() as { id: number }).id
    const walkIn = createLedger(db, { name: 'Cash sale', groupId, phone: '9000000000' }).id
    const v = post('sales', '2026-08-01', walkIn, [{ ledgerId: walkIn, drCr: 'dr', amount: 10000 }, { ledgerId: sales, drCr: 'cr', amount: 10000 }])
    expect(billShareFacts(db, INFO, v, TODAY)).toMatchObject({ partyName: null, whatsapp: null, email: null })
  })
  it('a sales bill: contact, total, due, UPI ID; a receipt is not shareable', () => {
    const { db, bill, receive } = setup()
    setUpiSettings(db, { upiId: 'sharma@ybl' })
    const r = receive(5000000)
    expect(billShareFacts(db, INFO, bill, TODAY, 'darwin')).toMatchObject({
      kind: 'sales', shareable: true, partyName: 'Ramesh & Sons', whatsapp: '98765 43210', email: 'ramesh@example.in',
      totalPaise: 11800000, duePaise: 6800000, upiId: 'sharma@ybl', businessName: 'Sharma Stores', shareSheet: true
    })
    expect(billShareFacts(db, INFO, bill, TODAY, 'win32').shareSheet).toBe(false)
    expect(billShareFacts(db, INFO, r, TODAY)).toMatchObject({ kind: 'receipt', shareable: false, duePaise: 0, upiId: null })
  })
  it('nothing due → no UPI ID in the message facts', () => {
    const { db, bill, receive } = setup()
    setUpiSettings(db, { upiId: 'sharma@ybl' })
    receive(11800000)
    expect(billShareFacts(db, INFO, bill, TODAY)).toMatchObject({ duePaise: 0, upiId: null })
  })
})
