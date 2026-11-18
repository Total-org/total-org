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
import { form26qData, tdsDeducted, tdsEligible } from './tdsWorkbench'
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
  /** A bill (journal: Dr work / Cr contractor) of `amount` (₹25,000 unless given), less `deduct` (base, TDS). */
  const bill = (date: string, deduct?: [number, number], amount = 25_000_00) => saveVoucher(db, {
    ...none, voucherTypeId: vt(db, 'journal'), date, partyLedgerId: party,
    lines: [{ ledgerId: work, drCr: 'dr', amount }, { ledgerId: party, drCr: 'cr', amount: amount - (deduct?.[1] ?? 0) }],
    tds: deduct ? tds(...deduct) : null
  })
  /** A payment of `amount` (₹25,000 unless given): Dr contractor / Cr Cash less the TDS. */
  const pay = (date: string, deduct?: [number, number], amount = 25_000_00) => saveVoucher(db, {
    ...none, voucherTypeId: vt(db, 'payment'), date, partyLedgerId: party,
    lines: [{ ledgerId: party, drCr: 'dr', amount }, { ledgerId: lid(db, 'Cash'), drCr: 'cr', amount: amount - (deduct?.[1] ?? 0) }],
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

describe('review of #289', () => {
  it('(1) a ₹40,000 crossing bill — over the ₹30,000 single limit — carries the four earlier bills: ₹1,400', () => {
    const { db, party, bill } = setup()
    for (const d of FIVE.slice(0, 4)) bill(d)
    // ₹40,000 + 4 × ₹25,000 = ₹1,40,000 × 1 % = ₹1,400. Its own test is the single limit.
    const s = tdsSuggestion(db, party, 40_000_00, '2025-09-01', { voucherKind: 'journal' })
    expect(s).toMatchObject({ basePaise: 1_40_000_00, tdsPaise: 1_400_00, crossing: { earlierBasePaise: 1_00_000_00, earlierCount: 4 } })
    expect(s!.threshold.reason).toBe('single')
  })

  it('(2) a deducted bill that uses up an advance counts it once: nothing crosses, nothing listed', () => {
    const { bill, pay, eligible } = setup()
    // Apr ₹25,000 + May ₹25,000 billed; June pays ₹75,000 (₹25,000 ahead); July bills ₹30,000 deducted
    // on ₹30,000 (₹300). The year: ₹25,000 + ₹25,000 + ₹25,000 + ₹5,000 = ₹80,000 — under ₹1,00,000.
    bill('2025-04-10'); bill('2025-05-10')
    pay('2025-06-10', undefined, 75_000_00)
    bill('2025-07-10', [30_000_00, 300_00], 30_000_00)
    expect(eligible()).toEqual([])
  })

  it('(2) the suggestion does not count an advance the crossing bill uses up twice: ₹1,100', () => {
    const { db, party, bill, pay } = setup()
    // Bills ₹30,000 + ₹30,000 + ₹20,000 (open); July pays ₹1,00,000 (₹20,000 ahead). August's ₹30,000
    // bill: ₹20,000 was paid ahead, ₹10,000 is new → ₹1,10,000 crosses. Its own ₹30,000 (the advance
    // inside) + the three bills ₹80,000 = ₹1,10,000 × 1 % = ₹1,100 (not ₹1,30,000 / ₹1,300).
    bill('2025-04-10', undefined, 30_000_00); bill('2025-05-10', undefined, 30_000_00); bill('2025-06-10', undefined, 20_000_00)
    pay('2025-07-10', undefined, 1_00_000_00)
    const s = tdsSuggestion(db, party, 30_000_00, '2025-08-10', { voucherKind: 'journal' })
    expect(s).toMatchObject({ basePaise: 1_10_000_00, tdsPaise: 1_100_00, crossing: { earlierBasePaise: 80_000_00, earlierCount: 3 } })
  })

  it('(3) a bill deduction that also covers a bill liable months before shows its late-deduction interest', () => {
    const { db, party, bill, eligible } = setup()
    // April ₹40,000 (liable at once: over ₹30,000), not deducted; May–July ₹20,000 each (₹1,00,000).
    bill('2025-04-10', undefined, 40_000_00)
    for (const d of ['2025-05-10', '2025-06-10', '2025-07-10']) bill(d, undefined, 20_000_00)
    // August ₹20,000 crosses: the suggestion = ₹20,000 + May–July ₹60,000 = ₹80,000 (April is not
    // this crossing's — it stays listed on its own).
    expect(tdsSuggestion(db, party, 20_000_00, '2025-08-10', { voucherKind: 'journal' })).toMatchObject({ basePaise: 80_000_00, tdsPaise: 800_00 })
    // Deducted on ₹1,20,000 (April too, ₹1,200): nothing left on Eligible; April's ₹400 of it was
    // deductible on 10 April — 10 Apr to 10 Aug = April…August, 5 months or part × 1 % = ₹20.
    const aug = bill('2025-08-10', [1_20_000_00, 1_200_00], 20_000_00)
    expect(eligible()).toEqual([])
    const row = tdsDeducted(db, '2025-04-01', '2026-03-31').find((r) => r.voucherId === aug.id)
    expect(row?.lateDeduction).toMatchObject({ deductibleOn: '2025-04-10', months: 5, interestPaise: 20_00 })
  })

  it('round 2: a liable advance used up by a bill deducted on its whole base leaves Eligible; the bill shows ₹15 late interest', () => {
    const { db, bill, pay, eligible } = setup()
    // 1 Apr: ₹50,000 paid ahead (over ₹30,000 — liable: ₹500). 1 Jun: the ₹50,000 bill, ₹500 deducted.
    pay('2025-04-01', undefined, 50_000_00)
    expect(eligible().map((r) => [r.basePaise, r.tdsPaise, r.reason])).toEqual([[50_000_00, 500_00, 'advance']])
    const jun = bill('2025-06-01', [50_000_00, 500_00], 50_000_00)
    expect(eligible()).toEqual([])
    // Deductible 1 Apr, deducted 1 Jun: April, May, June = 3 months (or part) × 1 % × ₹500 = ₹15.
    const row = tdsDeducted(db, '2025-04-01', '2026-03-31').find((r) => r.voucherId === jun.id)
    expect(row?.lateDeduction).toMatchObject({ deductibleOn: '2025-04-01', months: 3, interestPaise: 15_00 })
  })
})
