// PR #191 re-review (fix-first):
//   1. Tally counts Physical Stock per godown; Total counts the whole item. A count that does not
//      cover every godown the item holds stock in must never lose stock: join the godown counts
//      into one item total when they cover them all, else skip the voucher with a warning.
//   2. A line split over godowns (BATCHALLOCATIONS) keeps each godown's share.
//   4. An Agst Ref naming no open bill reroutes only that part — the voucher's other refs stay.
//   5. Its warning says the bill was not found "as of this import".
import { describe, expect, it } from 'vitest'
import { seededDb } from '../db/testdb'
import { importTallyXml } from './tallyImport'
import { getVoucher } from './vouchers'
import { partyAllocation } from './analysis'
import { closingBalances } from './reports'
import { extractAdvanceAdjustments, extractAdvances, gstr1 } from './gst'
import { partyChangeRefusal } from './bulkEdit'
import { TEST_INFO } from '../db/testdb'
import * as stock from './stockAnalysis'
import {
  tallyBaseMasters, tallyCashSale, tallyCreditSale, tallyEnvelope, tallyItem, tallyLedger, tallyPhysicalStock, tallyPurchase, tallyReceipt, type TallyBatch
} from '../../shared/fixtures/tally/tallyXml'

function run(msgs: string[]) {
  const db = seededDb()
  const summary = importTallyXml(db, tallyEnvelope([...tallyBaseMasters, ...msgs]))
  const id = (no: string): number | undefined => (db.prepare('SELECT id FROM vouchers WHERE number = ?').get(no) as { id: number } | undefined)?.id
  const L = (name: string): number => (db.prepare('SELECT id FROM ledgers WHERE name = ?').get(name) as { id: number }).id
  const G = (name: string): number | undefined => (db.prepare('SELECT id FROM godowns WHERE name = ?').get(name) as { id: number } | undefined)?.id
  const closing = (item: string, asOn = '2026-04-30'): number => stock.stockSummary(db, asOn).find((r) => r.name === item)!.closingQtyMilli
  return { db, summary, id, L, G, closing }
}

// Bought 10 into Godown A and 5 into Godown B: Tally holds 15.
const bought = [tallyItem('Widget'),
  tallyPurchase('P-1', '20260401', 'Widget', 10, 1000, [{ godown: 'Godown A', qty: 10 }]),
  tallyPurchase('P-2', '20260401', 'Widget', 5, 500, [{ godown: 'Godown B', qty: 5 }])]
const count = (no: string, ...entries: TallyBatch[][]) => tallyPhysicalStock(no, '20260410', entries.map((counts) => ({ item: 'Widget', counts })))

describe('Tally import: Physical Stock per godown', () => {
  it('a count of one godown only is skipped — never 10 for a business holding 15', () => {
    const { summary, id, closing } = run([...bought, count('PS-A', [{ godown: 'Godown A', qty: 10 }])])
    expect(id('PS-A')).toBeUndefined()
    expect(summary.skipped).toBe(1)
    expect(summary.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/PS-A.*Widget.*Godown B/)]))
    expect(closing('Widget')).toBe(15_000)
  })

  it('godown counts covering every godown join into one count of the item (one entry or two)', () => {
    for (const ps of [count('PS-1', [{ godown: 'Godown A', qty: 10 }, { godown: 'Godown B', qty: 5 }]), count('PS-1', [{ godown: 'Godown A', qty: 10 }], [{ godown: 'Godown B', qty: 5 }])]) {
      const { db, id, closing, summary } = run([...bought, ps])
      expect(summary.skipped).toBe(0)
      expect(getVoucher(db, id('PS-1')!)!.inventory.map((l) => [l.isAbsolute, l.qtyMilli, l.godownId])).toEqual([[true, 15_000, null]])
      expect(closing('Widget')).toBe(15_000)
    }
    const short = run([...bought, count('PS-1', [{ godown: 'Godown A', qty: 8 }], [{ godown: 'Godown B', qty: 5 }])])
    expect(short.closing('Widget')).toBe(13_000)
  })

  it('a later count remembers the godowns an earlier joined count found', () => {
    const later = (counts: TallyBatch[]) => run([...bought,
      count('PS-1', [{ godown: 'Godown A', qty: 10 }, { godown: 'Godown B', qty: 5 }]),
      tallyCashSale('S-1', '20260412', 'Widget', 2, 300, 'Godown B'),
      tallyPhysicalStock('PS-2', '20260415', [{ item: 'Widget', counts }])])
    const onlyB = later([{ godown: 'Godown B', qty: 3 }])
    expect(onlyB.id('PS-2')).toBeUndefined()
    expect(onlyB.closing('Widget')).toBe(13_000)
    const both = later([{ godown: 'Godown A', qty: 9 }, { godown: 'Godown B', qty: 3 }])
    expect(both.closing('Widget')).toBe(12_000)
  })

  it('a count of 0 in one godown joins too (Godown A emptied, B 5 → 5)', () => {
    const { closing, summary } = run([...bought, count('PS-1', [{ godown: 'Godown A', qty: 0 }, { godown: 'Godown B', qty: 5 }])])
    expect(summary.skipped).toBe(0)
    expect(closing('Widget')).toBe(5_000)
  })

  it('a back-dated movement listed after a count, into a godown it does not count: the count is skipped (vouchers import in date order)', () => {
    const { summary, id, closing } = run([tallyItem('Widget'),
      tallyPurchase('P-1', '20260401', 'Widget', 10, 1000, [{ godown: 'Godown A', qty: 10 }]),
      count('PS-1', [{ godown: 'Godown A', qty: 10 }]),
      tallyPurchase('P-2', '20260405', 'Widget', 5, 500, [{ godown: 'Godown B', qty: 5 }])])
    expect(closing('Widget')).toBe(15_000)
    expect(id('PS-1')).toBeUndefined()
    expect(id('P-2')).toBeDefined()
    expect(summary.skipped).toBe(1)
    expect(summary.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/PS-1 skipped.*Widget.*Godown B/)]))
  })

  it('a back-dated movement into a counted godown keeps the count (Tally\'s count stands)', () => {
    const { db, closing } = run([tallyItem('Widget'),
      tallyPurchase('P-1', '20260401', 'Widget', 10, 1000, [{ godown: 'Godown A', qty: 10 }]),
      count('PS-1', [{ godown: 'Godown A', qty: 10 }]),
      tallyPurchase('P-2', '20260405', 'Widget', 5, 500, [{ godown: 'Godown A', qty: 5 }])])
    expect(db.prepare("SELECT deleted_at IS NULL AS live FROM vouchers WHERE number = 'PS-1'").get()).toEqual({ live: 1 })
    expect(closing('Widget')).toBe(10_000)
  })

  it('one godown (stock without a godown is Tally\'s Main Location) counts as before', () => {
    const { db, id, G, closing } = run([tallyItem('Widget', 4, 400), tallyPurchase('P-1', '20260401', 'Widget', 10, 1000, [{ godown: 'Main Location', qty: 10 }]),
      tallyPhysicalStock('PS-1', '20260410', [{ item: 'Widget', counts: [{ godown: 'Main Location', qty: 12 }] }])])
    expect(getVoucher(db, id('PS-1')!)!.inventory.map((l) => [l.qtyMilli, l.godownId])).toEqual([[12_000, G('Main Location')]])
    expect(closing('Widget')).toBe(12_000)
  })
})

describe('Tally import: a line split over godowns', () => {
  it('a zero part (no quantity, no amount) is left out, never a refused voucher', () => {
    const { db, summary, id, G } = run([tallyItem('Widget'), tallyPurchase('P-1', '20260401', 'Widget', 10, 1000, [{ godown: 'Godown A', qty: 10, rupees: 1000 }, { godown: 'Godown B', qty: 0, rupees: 0 }])])
    expect(summary).toMatchObject({ vouchers: 1, skipped: 0, warnings: [] })
    expect(getVoucher(db, id('P-1')!)!.inventory.map((l) => [l.godownId, l.qtyMilli, l.amount])).toEqual([[G('Godown A'), 10_000, 100_000]])
  })

  it('keeps each godown\'s share (the godown is created), amounts to the paisa', () => {
    const { db, id, G } = run([tallyItem('Widget'), tallyPurchase('P-1', '20260401', 'Widget', 15, 1500, [{ godown: 'Godown A', qty: 10, rupees: 1000 }, { godown: 'Godown B', qty: 5, rupees: 500 }])])
    expect(getVoucher(db, id('P-1')!)!.inventory.map((l) => [l.godownId, l.qtyMilli, l.amount])).toEqual([[G('Godown A'), 10_000, 100_000], [G('Godown B'), 5_000, 50_000]])
    const godownQty = (g: string) => stock.stockSummary(db, '2026-04-30', { godownId: G(g) }).find((r) => r.name === 'Widget')!.closingQtyMilli
    expect([godownQty('Godown A'), godownQty('Godown B')]).toEqual([10_000, 5_000])
  })
})

describe('Tally import: an Agst Ref naming no open bill', () => {
  it('reroutes only that part: the open bills oldest first, the rest on account — the advance stays, and 11A = Tally\'s', () => {
    const { db, summary, id, L } = run([tallyLedger('Cust', 'Sundry Debtors', 300),
      tallyReceipt('R-1', '20260405', 'Cust', 1000, [{ name: 'OLD-9', type: 'Agst Ref', rupees: 500 }, { name: 'ADV-1', type: 'Advance', rupees: 500 }]),
      tallyCreditSale('S-1', '20260410', 'Cust', 500, [{ name: 'ADV-1', type: 'Agst Ref', rupees: 500 }])])
    // The ₹200 the opening can't take rides on the rerouted ref (last): the engine settles it oldest
    // first, then holds it on account — never a NEW ref, which GSTR-1 11A would read as an advance.
    expect(getVoucher(db, id('R-1')!)!.billRefs).toEqual([
      { kind: 'new', name: 'ADV-1', amount: 50_000, dueDate: null },
      { kind: 'against', name: 'Opening', amount: 50_000, dueDate: null }
    ])
    // The sale drew on the advance, as in Tally.
    expect(getVoucher(db, id('S-1')!)!.billRefs).toEqual([{ kind: 'against', name: 'ADV-1', amount: 50_000, dueDate: null }])
    const a = partyAllocation(db, L('Cust'), '2026-04-30')
    expect(a.bills).toEqual([])
    expect(a.warnings).toEqual([])
    expect(a.unappliedCredit).toBe(20_000)
    expect(a.unappliedCredit).toBe(-closingBalances(db, '2026-04-30').get(L('Cust'))!)
    expect(summary.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/R-1.*OLD-9.*as of this import.*Opening.*₹200\.00 on account/)]))
    // GSTR-1 11A: Tally's one advance (ADV-1 ₹500), exactly as a file with just that advance gives.
    const twin = run([tallyLedger('Cust', 'Sundry Debtors', 300), tallyReceipt('R-1', '20260405', 'Cust', 500, [{ name: 'ADV-1', type: 'Advance', rupees: 500 }])])
    for (const d of [db, twin.db]) d.prepare("UPDATE ledgers SET gst_rate = 18, state_code = ? WHERE name = 'Cust'").run(TEST_INFO.stateCode)
    expect(extractAdvances(db, TEST_INFO, '2026-04-01', '2026-04-30')).toEqual(extractAdvances(twin.db, TEST_INFO, '2026-04-01', '2026-04-30'))
  })

  it('an unknown Agst Ref past every open bill is carried by the receipt\'s known ref — no advance appears', () => {
    const { db, id, L } = run([tallyLedger('Cust', 'Sundry Debtors'),
      tallyCreditSale('S-1', '20260401', 'Cust', 200, [{ name: 'S-1', type: 'New Ref', rupees: 200 }]),
      tallyReceipt('R-3', '20260405', 'Cust', 700, [{ name: 'S-1', type: 'Agst Ref', rupees: 200 }, { name: 'OLD-9', type: 'Agst Ref', rupees: 500 }])])
    expect(getVoucher(db, id('R-3')!)!.billRefs).toEqual([{ kind: 'against', name: 'S-1', amount: 70_000, dueDate: null }])
    db.prepare("UPDATE ledgers SET gst_rate = 18 WHERE name = 'Cust'").run()
    expect(extractAdvances(db, TEST_INFO, '2026-04-01', '2026-04-30')).toEqual([])
    const a = partyAllocation(db, L('Cust'), '2026-04-30')
    expect([a.bills, a.unappliedCredit, a.warnings]).toEqual([[], 50_000, []])
  })

  it('with no open bill at all, the receipt keeps no refs (oldest first, as before) — and names the advance it could not keep', () => {
    const { db, summary, id } = run([tallyLedger('Cust', 'Sundry Debtors'),
      tallyReceipt('R-4', '20260405', 'Cust', 500, [{ name: 'OLD-9', type: 'Agst Ref', rupees: 300 }, { name: 'ADV-2', type: 'Advance', rupees: 200 }])])
    expect(getVoucher(db, id('R-4')!)!.billRefs).toEqual([])
    const about = summary.warnings.filter((w) => w.includes('R-4'))
    expect(about).toHaveLength(1)
    expect(about[0]).toMatch(/OLD-9.*as of this import.*not imported/)
    expect(about[0]).not.toMatch(/settled/)
    expect(about[0]).toMatch(/ADV-2 \(₹200(\.00)?\) is not kept either/)
  })

  it('a supplier\'s refund (a receipt) Agst a missing advance keeps no refs — never a NEW ref on a receipt', () => {
    const { db, id } = run([tallyLedger('Kumar Steel', 'Sundry Creditors'),
      tallyReceipt('R-5', '20260405', 'Kumar Steel', 400, [{ name: 'ADV-K', type: 'Agst Ref', rupees: 400 }])])
    expect(getVoucher(db, id('R-5')!)!.billRefs).toEqual([])
    expect(db.prepare("SELECT COUNT(*) AS n FROM bill_refs br JOIN vouchers v ON v.id = br.voucher_id JOIN voucher_types vt ON vt.id = v.voucher_type_id WHERE vt.kind = 'receipt' AND br.kind = 'new'").get()).toEqual({ n: 0 })
  })

  it('a bill under its own number never takes the name of a bill still open (FY added, as simple mode does)', () => {
    const { db, id } = run([tallyLedger('Cust', 'Sundry Debtors'),
      tallyCreditSale('S-5', '20250501', 'Cust', 100, [{ name: 'S-5', type: 'New Ref', rupees: 100 }]),
      tallyCreditSale('S-5', '20260410', 'Cust', 400, [{ name: 'ADV-X', type: 'Agst Ref', rupees: 400 }])])
    const second = (db.prepare("SELECT id FROM vouchers WHERE number = 'S-5' ORDER BY date DESC").get() as { id: number }).id
    expect(id('S-5')).toBeDefined()
    expect(getVoucher(db, second)!.billRefs).toEqual([{ kind: 'new', name: 'S-5/26-27', amount: 40_000, dueDate: null }])
  })

  it('on a bill, an Agst Ref to an advance that is not there opens the bill under the entry\'s number', () => {
    const { db, id, L } = run([tallyLedger('Cust', 'Sundry Debtors'),
      tallyCreditSale('S-2', '20260410', 'Cust', 700, [{ name: 'ADV-X', type: 'Agst Ref', rupees: 400 }, { name: 'S-2', type: 'New Ref', rupees: 300 }])])
    expect(getVoucher(db, id('S-2')!)!.billRefs).toEqual([{ kind: 'new', name: 'S-2', amount: 70_000, dueDate: null }])
    expect(partyAllocation(db, L('Cust'), '2026-04-30').bills.map((b) => [b.number, b.pending])).toEqual([['S-2', 70_000]])
  })

  it('an Agst Ref\'s excess settles the next bill — a later Agst Ref to that bill is rerouted, never left as credit', () => {
    const { db, id, L } = run([tallyLedger('Cust', 'Sundry Debtors'),
      tallyCreditSale('S-1', '20260401', 'Cust', 500, [{ name: 'S-1', type: 'New Ref', rupees: 500 }]),
      tallyCreditSale('S-2', '20260402', 'Cust', 500, [{ name: 'S-2', type: 'New Ref', rupees: 500 }]),
      tallyCreditSale('S-3', '20260403', 'Cust', 500, [{ name: 'S-3', type: 'New Ref', rupees: 500 }]),
      tallyReceipt('R-1', '20260405', 'Cust', 1000, [{ name: 'S-1', type: 'Agst Ref', rupees: 1000 }]),
      tallyReceipt('R-2', '20260406', 'Cust', 300, [{ name: 'S-2', type: 'Agst Ref', rupees: 300 }])])
    // R-1's ₹500 over S-1 settled S-2 (oldest first, as the engine does), so R-2's S-2 goes to S-3.
    expect(getVoucher(db, id('R-1')!)!.billRefs).toEqual([{ kind: 'against', name: 'S-1', amount: 100_000, dueDate: null }])
    expect(getVoucher(db, id('R-2')!)!.billRefs).toEqual([{ kind: 'against', name: 'S-3', amount: 30_000, dueDate: null }])
    const a = partyAllocation(db, L('Cust'), '2026-04-30')
    expect(a.bills.map((b) => [b.number, b.pending])).toEqual([['S-3', 20_000]])
    expect(a.unappliedCredit).toBe(0)
  })

  it('one receipt naming the same bill twice keeps both refs in order — the excess of the second never eats a bill a ref between them names', () => {
    // Merging S-1's two refs into one (₹700, first) made its ₹200 excess settle S-2 before the
    // receipt's own S-2 ref did: Outstandings then warned "S-2 is not open" and held ₹200 as credit.
    const { db, id, L } = run([tallyLedger('Cust', 'Sundry Debtors'),
      tallyCreditSale('S-1', '20260401', 'Cust', 500, [{ name: 'S-1', type: 'New Ref', rupees: 500 }]),
      tallyCreditSale('S-2', '20260402', 'Cust', 200, [{ name: 'S-2', type: 'New Ref', rupees: 200 }]),
      tallyCreditSale('S-3', '20260403', 'Cust', 500, [{ name: 'S-3', type: 'New Ref', rupees: 500 }]),
      tallyReceipt('R-1', '20260405', 'Cust', 900, [{ name: 'S-1', type: 'Agst Ref', rupees: 300 }, { name: 'S-2', type: 'Agst Ref', rupees: 200 }, { name: 'S-1', type: 'Agst Ref', rupees: 400 }])])
    const a = partyAllocation(db, L('Cust'), '2026-04-30')
    expect([a.bills.map((b) => [b.number, b.pending]), a.unappliedCredit, a.warnings]).toEqual([[['S-3', 30_000]], 0, []])
    expect(getVoucher(db, id('R-1')!)!.billRefs).toEqual([
      { kind: 'against', name: 'S-1', amount: 30_000, dueDate: null },
      { kind: 'against', name: 'S-2', amount: 20_000, dueDate: null },
      { kind: 'against', name: 'S-1', amount: 40_000, dueDate: null }
    ])
  })

  it('a bill under its own number never takes the name of an advance already used up (FY added, as simple mode does)', () => {
    // The advance "S-7" was used up by S-6; a bill named S-7 would look settled by S-6's Agst Ref
    // to the advance (name-matched readers: bulk edit's party change, Undo's links).
    const { db, id, L } = run([tallyLedger('Cust', 'Sundry Debtors'), tallyLedger('Other', 'Sundry Debtors'),
      tallyReceipt('R-1', '20260401', 'Cust', 500, [{ name: 'S-7', type: 'Advance', rupees: 500 }]),
      tallyCreditSale('S-6', '20260402', 'Cust', 500, [{ name: 'S-7', type: 'Agst Ref', rupees: 500 }]),
      tallyCreditSale('S-7', '20260410', 'Cust', 400, [{ name: 'ADV-X', type: 'Agst Ref', rupees: 400 }])])
    const s7 = getVoucher(db, id('S-7')!)!
    expect(s7.billRefs).toEqual([{ kind: 'new', name: 'S-7/26-27', amount: 40_000, dueDate: null }])
    const a = partyAllocation(db, L('Cust'), '2026-04-30')
    expect([a.bills.map((b) => [b.number, b.pending]), a.unappliedCredit, a.warnings]).toEqual([[['S-7/26-27', 40_000]], 0, []])
    expect(partyChangeRefusal(db, s7, L('Other'))).toBeNull()
  })

  it('two missing advances on one bill (another ref between them) make ONE bill of the entry\'s number, never two of one name', () => {
    const { db, id, L } = run([tallyLedger('Cust', 'Sundry Debtors'),
      tallyReceipt('R-1', '20260401', 'Cust', 200, [{ name: 'ADV-OK', type: 'Advance', rupees: 200 }]),
      tallyCreditSale('S-9', '20260405', 'Cust', 350, [{ name: 'MISSING-A', type: 'Agst Ref', rupees: 100 }, { name: 'ADV-OK', type: 'Agst Ref', rupees: 200 }, { name: 'MISSING-B', type: 'Agst Ref', rupees: 50 }])])
    const refs = getVoucher(db, id('S-9')!)!.billRefs
    expect(refs.filter((r) => r.kind === 'new')).toEqual([{ kind: 'new', name: 'S-9', amount: 15_000, dueDate: null }])
    const a = partyAllocation(db, L('Cust'), '2026-04-30')
    expect([a.bills.map((b) => [b.number, b.pending]), a.unappliedCredit, a.warnings]).toEqual([[['S-9', 15_000]], 0, []])
  })

  it('a bill under its own number never takes the name of a bill already paid (FY added)', () => {
    const { db, id } = run([tallyLedger('Cust', 'Sundry Debtors'),
      tallyCreditSale('S-7', '20260401', 'Cust', 300, [{ name: 'S-7', type: 'New Ref', rupees: 300 }]),
      tallyReceipt('R-1', '20260402', 'Cust', 300, [{ name: 'S-7', type: 'Agst Ref', rupees: 300 }]),
      tallyCreditSale('S-7', '20260410', 'Cust', 400, [{ name: 'ADV-X', type: 'Agst Ref', rupees: 400 }])])
    const bills = (db.prepare("SELECT br.name FROM bill_refs br JOIN vouchers v ON v.id = br.voucher_id WHERE br.kind = 'new' AND v.date = '2026-04-10'").all() as { name: string }[]).map((r) => r.name)
    expect(bills).toEqual(['S-7/26-27'])
    void id
  })
})

// Owner, 13 Nov (audit 2 COR2-4, Q5): a debit note "Agst Ref" an invoice stays part of that invoice,
// as Tally shows it (the engine adds it to the bill — shared/outstanding.ts raiseNamed, audit A1).
const tallyDebitNote = (no: string, date: string, party: string, rupees: number, bills: { name: string; type: 'Agst Ref' | 'New Ref'; rupees: number }[]): string =>
  tallyCreditSale(no, date, party, rupees, bills).replace('VCHTYPE="Sales"', 'VCHTYPE="Debit Note"').replace('<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>', '<VOUCHERTYPENAME>Debit Note</VOUCHERTYPENAME>')

describe('Tally import (owner Q5): a debit note Agst Ref an invoice stays part of that invoice', () => {
  it('S/1 ₹11,800 + debit note DN/1 ₹1,180 against it = S/1 ₹12,980 — one bill, as Tally shows it; the party total ties', () => {
    const { db, id, L, summary } = run([tallyLedger('Cust', 'Sundry Debtors'),
      tallyCreditSale('S/1', '20260401', 'Cust', 11_800, [{ name: 'S/1', type: 'New Ref', rupees: 11_800 }]),
      tallyDebitNote('DN/1', '20260410', 'Cust', 1_180, [{ name: 'S/1', type: 'Agst Ref', rupees: 1_180 }])])
    expect(getVoucher(db, id('DN/1')!)!.billRefs).toEqual([{ kind: 'against', name: 'S/1', amount: 118_000, dueDate: null }])
    const a = partyAllocation(db, L('Cust'), '2026-04-30')
    expect([a.bills.map((b) => [b.number, b.amount, b.pending]), a.unappliedCredit, a.warnings]).toEqual([[['S/1', 1_298_000, 1_298_000]], 0, []])
    expect(a.bills[0]!.pending).toBe(closingBalances(db, '2026-04-30').get(L('Cust'))!)
    expect(summary.warnings.filter((w) => w.includes('DN/1'))).toEqual([])
  })

  it('a debit note against a bill paid in full reopens that bill (₹1,180 due on S/1), never a bill named after the note', () => {
    const { db, id, L } = run([tallyLedger('Cust', 'Sundry Debtors'),
      tallyCreditSale('S/1', '20260401', 'Cust', 11_800, [{ name: 'S/1', type: 'New Ref', rupees: 11_800 }]),
      tallyReceipt('R-1', '20260405', 'Cust', 11_800, [{ name: 'S/1', type: 'Agst Ref', rupees: 11_800 }]),
      tallyDebitNote('DN/1', '20260410', 'Cust', 1_180, [{ name: 'S/1', type: 'Agst Ref', rupees: 1_180 }])])
    expect(getVoucher(db, id('DN/1')!)!.billRefs).toEqual([{ kind: 'against', name: 'S/1', amount: 118_000, dueDate: null }])
    const a = partyAllocation(db, L('Cust'), '2026-04-30')
    expect([a.bills.map((b) => [b.number, b.pending]), a.unappliedCredit, a.warnings]).toEqual([[['S/1', 118_000]], 0, []])
  })

  it('a name the party has never had a bill of still opens a bill under the note\'s own number (as before)', () => {
    const { db, id, L } = run([tallyLedger('Cust', 'Sundry Debtors'),
      tallyDebitNote('DN/2', '20260410', 'Cust', 500, [{ name: 'NOPE-1', type: 'Agst Ref', rupees: 500 }])])
    expect(getVoucher(db, id('DN/2')!)!.billRefs).toEqual([{ kind: 'new', name: 'DN/2', amount: 50_000, dueDate: null }])
    expect(partyAllocation(db, L('Cust'), '2026-04-30').bills.map((b) => [b.number, b.pending])).toEqual([['DN/2', 50_000]])
  })

  it('review of #281: a SALE Agst Ref an invoice named like a used-up advance keeps the old path — GSTR-1 11B counts only the ₹500 advance', () => {
    const { db, id, L } = run([tallyLedger('Cust', 'Sundry Debtors'),
      tallyReceipt('R/1', '20260401', 'Cust', 500, [{ name: 'INV-10', type: 'Advance', rupees: 500 }]),
      tallyCreditSale('INV-10', '20260405', 'Cust', 1_000, [{ name: 'INV-10', type: 'Agst Ref', rupees: 500 }, { name: 'INV-10', type: 'New Ref', rupees: 500 }]),
      tallyCreditSale('INV-11', '20260410', 'Cust', 200, [{ name: 'INV-10', type: 'Agst Ref', rupees: 200 }])])
    expect(getVoucher(db, id('INV-11')!)!.billRefs).toEqual([{ kind: 'new', name: 'INV-11', amount: 20_000, dueDate: null }])
    db.prepare("UPDATE ledgers SET gst_rate = 18, state_code = ? WHERE name = 'Cust'").run(TEST_INFO.stateCode)
    // 11B: the ₹500 advance (gross, 18 % inclusive: 500 × 100 / 118 = ₹423.73), nothing more.
    const adj = extractAdvanceAdjustments(db, TEST_INFO, '2026-04-01', '2026-04-30')
    expect(adj.reduce((t, r) => t + r.taxable, 0)).toBe(42_373)
    void L
  })

  it('review of #281: the supplier mirror — a journal crediting the supplier Agst Ref P/1 (paid) adds to P/1, which opens again for ₹500', () => {
    // Tally's sign: a negative AMOUNT is a debit. P/1: Cr supplier ₹5,000 / Dr Purchase; payment: Dr supplier / Cr bank;
    // journal: Cr supplier ₹500 (freight added to P/1) / Dr Purchase.
    const crSupplier = (vt: string, no: string, date: string, rupees: number, bill: { name: string; type: 'New Ref' | 'Agst Ref' }) =>
      tallyReceipt(no, date, 'Kumar Steel', rupees, [{ ...bill, rupees }]).replace('VCHTYPE="Receipt"', `VCHTYPE="${vt}"`).replace('<VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>', `<VOUCHERTYPENAME>${vt}</VOUCHERTYPENAME>`).replace('<LEDGERNAME>HDFC Bank</LEDGERNAME>', '<LEDGERNAME>Purchase Account</LEDGERNAME>')
    const pay = tallyCreditSale('PY/1', '20260405', 'Kumar Steel', 5_000, [{ name: 'P/1', type: 'Agst Ref', rupees: 5_000 }])
      .replace('VCHTYPE="Sales"', 'VCHTYPE="Payment"').replace('<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>', '<VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>').replace('<LEDGERNAME>Sales Account</LEDGERNAME>', '<LEDGERNAME>HDFC Bank</LEDGERNAME>')
    const { db, id, L } = run([tallyLedger('Kumar Steel', 'Sundry Creditors'),
      crSupplier('Purchase', 'P/1', '20260401', 5_000, { name: 'P/1', type: 'New Ref' }), pay,
      crSupplier('Journal', 'J/1', '20260410', 500, { name: 'P/1', type: 'Agst Ref' })])
    expect(getVoucher(db, id('J/1')!)!.billRefs).toEqual([{ kind: 'against', name: 'P/1', amount: 50_000, dueDate: null }])
    const a = partyAllocation(db, L('Kumar Steel'), '2026-04-30')
    expect([a.bills.map((b) => [b.number, b.date, b.pending]), a.unappliedCredit, a.warnings]).toEqual([[['P/1', '2026-04-01', 50_000]], 0, []])
  })

  it('review of #281: an imported debit note against a B2CL invoice now goes to GSTR-1 9B CDNUR (typ B2CL), like a note keyed into Total', () => {
    const { db } = run([tallyLedger('Far Cust', 'Sundry Debtors'),
      tallyCreditSale('S/9', '20260401', 'Far Cust', 300_000, [{ name: 'S/9', type: 'New Ref', rupees: 300_000 }]),
      tallyDebitNote('DN/9', '20260410', 'Far Cust', 1_180, [{ name: 'S/9', type: 'Agst Ref', rupees: 1_180 }])])
    db.prepare("UPDATE ledgers SET state_code = '29' WHERE name = 'Far Cust'").run()
    db.prepare("UPDATE ledgers SET gst_rate = 18 WHERE name = 'Sales Account'").run()
    const cdnur = (gstr1(db, TEST_INFO, '2026-04-01', '2026-04-30', '042026').json.cdnur ?? []) as { typ: string; val: number }[]
    expect(cdnur.map((n) => [n.typ, n.val])).toEqual([['B2CL', 1180]])
  })

  it('review of #281 (round 2): a debit note Agst Ref an invoice named after its advance adds to that invoice — INV-10 ₹600 due, as Tally shows it', () => {
    // R/1 advance INV-10 ₹500; INV-10 ₹1,000 = Agst INV-10 ₹500 + New Ref INV-10 ₹500; DN/1 ₹100 Agst INV-10 → INV-10 ₹500 + ₹100.
    const { db, id, L, summary } = run([tallyLedger('Cust', 'Sundry Debtors'),
      tallyReceipt('R/1', '20260401', 'Cust', 500, [{ name: 'INV-10', type: 'Advance', rupees: 500 }]),
      tallyCreditSale('INV-10', '20260405', 'Cust', 1_000, [{ name: 'INV-10', type: 'Agst Ref', rupees: 500 }, { name: 'INV-10', type: 'New Ref', rupees: 500 }]),
      tallyDebitNote('DN/1', '20260410', 'Cust', 100, [{ name: 'INV-10', type: 'Agst Ref', rupees: 100 }])])
    expect(getVoucher(db, id('DN/1')!)!.billRefs).toEqual([{ kind: 'against', name: 'INV-10', amount: 10_000, dueDate: null }])
    const a = partyAllocation(db, L('Cust'), '2026-04-30')
    expect([a.bills.map((b) => [b.number, b.pending]), a.unappliedCredit, a.warnings]).toEqual([[['INV-10', 60_000]], 0, []])
    expect(summary.warnings.filter((w) => w.includes('DN/1'))).toEqual([])
  })
})
