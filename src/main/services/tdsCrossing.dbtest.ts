// FIG-B-1 (1.0 readiness review, package R2): a contractor's year crosses the s.194C ₹1,00,000
// aggregate on the fifth ₹25,000 sum. The earlier four become liable too (the s.194C(5) proviso
// reading — CA point `tds-aggregate-crossing`), so the suggestion on the fifth offers ₹1,25,000 ×
// 1 % = ₹1,250, the simple hint says the same, a ₹1,250 deduction clears the Eligible list, and a
// ₹250 one leaves the four earlier sums (₹1,000 of tax) on it. Every expected figure is worked by
// hand in the comment above it (integer paise). Rate rows: migration 020's 194C FY 2025-26 rows —
// 1 % individual / HUF (PAN 4th letter P), single > ₹30,000, year > ₹1,00,000.
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { seededDb } from '../db/testdb'
import type { DB } from '../db/connection'
import { readCompanyInfo } from '../db/seed'
import { ledgerInputSchema } from '@shared/schemas'
import { createLedger } from './masters'
import { saveVoucher } from './vouchers'
import { previewIntent } from './simplePost'
import { form26qData, tdsEligible } from './tdsWorkbench'
import { tdsSuggestion } from './tds'
import { previewPaymentRun } from './payables'

vi.mock('electron', () => ({
  app: { getVersion: () => '0.12.0-test', getPath: () => tmpdir(), isPackaged: false, on: () => {} },
  ipcMain: { handle: () => {} },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => '', showItemInFolder: () => {} },
  Notification: class {},
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../updater', () => ({ checkForUpdatesInteractive: async () => null }))
process.env.TOTAL_DATA_DIR = mkdtempSync(join(tmpdir(), 'total-tds-crossing-'))
process.env.TOTAL_SUPPRESS_SYNC_WARNING = '1'

const gid = (db: DB, name: string): number => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id
const lid = (db: DB, name: string): number => (db.prepare('SELECT id FROM ledgers WHERE name = ?').get(name) as { id: number }).id
const vt = (db: DB, kind: string): number => (db.prepare('SELECT id FROM voucher_types WHERE kind = ? ORDER BY id').get(kind) as { id: number }).id
const sec = (db: DB, code: string): number => (db.prepare('SELECT id FROM tds_sections WHERE code = ?').get(code) as { id: number }).id
const ledger = (db: DB, name: string, group: string, extra: Record<string, unknown> = {}): number =>
  createLedger(db, ledgerInputSchema.parse({ name, groupId: gid(db, group), ...extra })).id

const FIVE = ['2025-05-01', '2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01'] as const

function setup() {
  const db = seededDb()
  const party = ledger(db, 'Contractor R', 'Sundry Creditors', { tdsSectionId: sec(db, '194C'), pan: 'ABCPE1234F' })
  const work = ledger(db, 'Contract work', 'Indirect Expenses')
  const none = { narration: null, reference: null, billRefs: [], inventory: [] }
  const tds = (base: number, amount: number) => ({ sectionId: sec(db, '194C'), baseAmount: base, tdsAmount: amount, isManual: false, autoPayable: true })
  /** A ₹25,000 bill (journal: Dr work / Cr contractor), less `deduct` (base, amount) if given. */
  const bill = (date: string, deduct?: [number, number]) => saveVoucher(db, {
    ...none, voucherTypeId: vt(db, 'journal'), date, partyLedgerId: party,
    lines: [{ ledgerId: work, drCr: 'dr', amount: 25_000_00 }, { ledgerId: party, drCr: 'cr', amount: 25_000_00 - (deduct?.[1] ?? 0) }],
    tds: deduct ? tds(...deduct) : null
  })
  /** A ₹25,000 payment ahead of any bill (Dr contractor / Cr Cash less the TDS). */
  const pay = (date: string, deduct?: [number, number]) => saveVoucher(db, {
    ...none, voucherTypeId: vt(db, 'payment'), date, partyLedgerId: party,
    lines: [{ ledgerId: party, drCr: 'dr', amount: 25_000_00 }, { ledgerId: lid(db, 'Cash'), drCr: 'cr', amount: 25_000_00 - (deduct?.[1] ?? 0) }],
    tds: deduct ? tds(...deduct) : null
  })
  const eligible = () => tdsEligible(db, '2025-04-01', '2026-03-31').filter((r) => r.partyLedgerId === party)
  return { db, party, work, bill, pay, eligible }
}

describe('FIG-B-1 — bills: the fifth ₹25,000 bill crosses ₹1,00,000', () => {
  it('the suggestion on the crossing bill offers ₹1,250 (₹1,25,000 × 1 %), naming the ₹1,00,000 of 4 earlier bills', () => {
    const { db, party, bill } = setup()
    for (const d of FIVE.slice(0, 3)) bill(d)
    // The fourth bill does not cross (₹75,000 + ₹25,000 = ₹1,00,000 is not "exceeds"): no shortfall.
    expect(tdsSuggestion(db, party, 25_000_00, FIVE[3], { voucherKind: 'journal' })).toMatchObject({ crossing: null, thresholdCrossed: false })
    bill(FIVE[3])
    const s = tdsSuggestion(db, party, 25_000_00, '2025-09-01', { voucherKind: 'journal' })
    // own ₹25,000 + earlier 4 × ₹25,000 = ₹1,25,000; 1 % = ₹1,250. The threshold reads the bill's own
    // part: prior ₹1,00,000 + ₹25,000 > ₹1,00,000 → 'aggregate'.
    expect(s).toMatchObject({ basePaise: 1_25_000_00, tdsPaise: 1_250_00, thresholdCrossed: true, crossing: { earlierBasePaise: 1_00_000_00, earlierCount: 4 } })
    expect(s!.threshold).toMatchObject({ reason: 'aggregate', priorPaise: 1_00_000_00 })
  })

  it('a ₹1,250 deduction on the crossing bill is accepted by the save rules and clears the Eligible list', () => {
    const { db, bill, eligible } = setup()
    for (const d of FIVE.slice(0, 4)) bill(d)
    // Before: the four are below the limit — nothing listed.
    expect(eligible()).toEqual([])
    const fifth = bill('2025-09-01', [1_25_000_00, 1_250_00])
    expect(eligible()).toEqual([])
    // Form 26Q carries the one deduction on its base: ₹1,25,000, ₹1,250.
    const row = form26qData(db, 2025, 2).deductees.find((d) => d.voucherId === fifth.id)
    expect(row).toMatchObject({ amountPaise: 1_25_000_00, tdsPaise: 1_250_00 })
  })

  it('only ₹250 deducted on the crossing bill: the four earlier bills stay eligible (₹1,000), crossed by the fifth', () => {
    const { db, party, bill, eligible } = setup()
    for (const d of FIVE.slice(0, 4)) bill(d)
    const fifth = bill('2025-09-01', [25_000_00, 250_00])
    const rows = eligible()
    // 4 × (₹25,000 × 1 % = ₹250) = ₹1,000.
    expect(rows.map((r) => [r.date, r.basePaise, r.tdsPaise, r.reason, r.crossedByVoucherId])).toEqual(
      FIVE.slice(0, 4).map((d) => [d, 25_000_00, 250_00, 'aggregate_later', fifth.id])
    )
    expect(rows.reduce((s, r) => s + (r.tdsPaise ?? 0), 0)).toBe(1_000_00)
    // The year's aggregate is ₹1,25,000 — the sixth bill's suggestion reads that prior, no shortfall
    // (the four are already liable; they are not the sixth's to carry).
    const sixth = tdsSuggestion(db, party, 25_000_00, '2025-10-01', { voucherKind: 'journal' })
    expect(sixth).toMatchObject({ basePaise: 25_000_00, tdsPaise: 250_00, crossing: null })
    expect(sixth!.threshold.priorPaise).toBe(1_25_000_00)
  })

  it('the Eligible list marks the crossing bill with the whole figure while nothing is deducted', () => {
    const { bill, eligible } = setup()
    for (const d of FIVE) bill(d)
    const rows = eligible()
    // Five rows of ₹250; the fifth carries the crossing: 4 earlier, ₹1,00,000, and ₹1,25,000 × 1 % = ₹1,250.
    expect(rows.map((r) => r.tdsPaise)).toEqual([250_00, 250_00, 250_00, 250_00, 250_00])
    expect(rows[4]!.crossing).toEqual({ earlierCount: 4, earlierBasePaise: 1_00_000_00, tdsPaise: 1_250_00 })
    expect(rows.slice(0, 4).every((r) => r.crossing === undefined && r.crossedByVoucherId === rows[4]!.voucherId)).toBe(true)
  })

  it('books where every bill was deducted at the time list nothing, before and after', () => {
    const { bill, eligible } = setup()
    // Each ₹25,000 bill deducted on its own ₹25,000 (₹250): nothing open, nothing to list.
    for (const d of FIVE) bill(d, [25_000_00, 250_00])
    expect(eligible()).toEqual([])
  })
})

describe('FIG-B-1 — payments ahead of the bills (advances)', () => {
  it('the fifth ₹25,000 payment: suggestion ₹1,250; deducted, it clears the four earlier advances', () => {
    const { db, party, pay, eligible } = setup()
    for (const d of FIVE.slice(0, 4)) pay(d)
    expect(eligible()).toEqual([])
    const s = tdsSuggestion(db, party, 25_000_00, '2025-09-01', { voucherKind: 'payment' })
    // Own advance ₹25,000 (nothing billed) + the four earlier advances ₹1,00,000 = ₹1,25,000 → ₹1,250.
    expect(s).toMatchObject({ basePaise: 1_25_000_00, tdsPaise: 1_250_00, crossing: { earlierBasePaise: 1_00_000_00, earlierCount: 4 } })
    expect(s!.payment).toMatchObject({ undeductedBillsPaise: 0, advancePaise: 25_000_00, deductedAtCredit: false })
    pay('2025-09-01', [1_25_000_00, 1_250_00])
    expect(eligible()).toEqual([])
  })

  it('the simple Money out hint on the crossing payment says ₹1,250 and the 4 earlier payments', () => {
    const { db, party, pay } = setup()
    for (const d of FIVE.slice(0, 4)) pay(d)
    const pv = previewIntent(db, readCompanyInfo(db), { clientId: 'fig-b-1-hint-0001', kind: 'money_out', date: '2025-09-01', supplierId: party, amount: 25_000_00, from: { how: 'cash' } }, '2025-09-05')
    expect(pv.tds).toEqual([{ partyName: 'Contractor R', sectionCode: '194C', tdsPaise: 1_250_00, earlierCount: 4 }])
  })

  it('a payment run carries the shortfall on the crossing payment', () => {
    const { db, party, pay } = setup()
    for (const d of FIVE.slice(0, 4)) pay(d)
    const preview = previewPaymentRun(db, { date: '2025-09-01', kind: 'batch', items: [{ partyLedgerId: party, bankLedgerId: lid(db, 'Cash'), amount: 25_000_00, bills: [] }] })
    // ₹25,000 advance + ₹1,00,000 earlier = ₹1,25,000 base, ₹1,250 TDS; the bank pays ₹23,750.
    expect(preview.lines[0]!.tds).toMatchObject({ code: '194C', base: 1_25_000_00, amount: 1_250_00 })
    expect(preview.lines[0]!.bankAmount).toBe(23_750_00)
  })
})
