/**
 * Audit A7 / UX-2: the sample shop behind the setup wizard's "Try with sample data" (simple mode).
 *
 * The 0.10 demo (`demoVouchers`, shared/demo.ts) stays exactly as it is for the full app's
 * "Sample data in the full app" — reportEquality, the upgrade test and many dbtests pin it. It
 * was never meant to be read by a shop owner: no openings, no prices, sales from empty stock
 * (costed at ₹0) and a "0 of 4 parts entered" card. This plan tells ONE believable story instead:
 *
 *  - the books begin on the 1st of the month two months back; on that day the shop had cash, a
 *    bank balance, stock on its shelves (at cost), one customer who still owed for an old bill and
 *    one supplier it still had to pay — entered through the same "What you had on day one" flow a
 *    real owner uses, so Home shows no openings card;
 *  - every product has a selling price; sales take it from the price list;
 *  - stock never goes below zero: a restock purchase is dated BEFORE the sale that needs it, so
 *    cost of goods sold is real;
 *  - customers pay after their credit days (one pays late, so "late" has something to show);
 *    suppliers are paid 20 days after their bill; rent, electricity and salary go out each month.
 *
 * Pure and deterministic in `today` — no DB. src/main/services/sampleShop.ts posts it through
 * the simple flows' own services (simple:post intents, openings), never a second posting path.
 */
import { addDaysISO } from './dates'
import { DEMO_CREDITORS, DEMO_DEBTORS, DEMO_ITEMS, type DemoItem, type DemoParty } from './demo'

export const SAMPLE_BANK = 'HDFC Bank'

/** Days a customer usually takes to pay (their credit days are 30 — Krishna pays late). */
export const SAMPLE_PAY_LAG: Record<string, number> = {
  'Umbrella Retail': 20,
  'Silverline Traders': 12,
  'Krishna Enterprises': 42
}
export const SAMPLE_CREDIT_DAYS = 30
/** A supplier's bill is paid this many days after its date. */
export const SAMPLE_SUPPLIER_LAG = 20

/** Which supplier restocks which product (Gujarat is in another state — IGST). */
export const SAMPLE_SUPPLIER_OF: Record<string, string> = {
  'Laptop 14"': 'Gujarat Components Pvt Ltd',
  'Wireless Mouse': 'Gujarat Components Pvt Ltd',
  'Office Chair': 'Gujarat Components Pvt Ltd',
  'A4 Paper Ream': 'Bharat Steel Suppliers',
  'Steel Filing Cabinet': 'Bharat Steel Suppliers',
  'Notebook Pack': 'Bharat Steel Suppliers'
}

/** On the shelf on day one, and how many a restock buys (whole units). */
export const SAMPLE_STOCK: Record<string, { opening: number; restock: number }> = {
  'Laptop 14"': { opening: 3, restock: 3 },
  'Wireless Mouse': { opening: 15, restock: 20 },
  'Office Chair': { opening: 6, restock: 8 },
  'A4 Paper Ream': { opening: 30, restock: 30 },
  'Steel Filing Cabinet': { opening: 3, restock: 3 },
  'Notebook Pack': { opening: 40, restock: 40 }
}

/** Monthly costs (paise) — paid from the bank unless `cash`. */
export const SAMPLE_COSTS = [
  { category: 'rent', day: 5, amount: 1000000, how: 'bank' },
  { category: 'electricity', day: 10, amount: 235000, how: 'cash' },
  { category: 'salary', day: 28, amount: 1500000, how: 'bank' }
] as const
export type SampleCostCategory = (typeof SAMPLE_COSTS)[number]['category']

export interface SampleLine {
  item: string
  qty: number
}

export type SampleEvent =
  | { kind: 'sale'; id: string; date: string; customer: string | null; lines: SampleLine[]; paid: 'cash' | 'upi' | 'credit' }
  | { kind: 'purchase'; id: string; date: string; supplier: string; billNo: string; lines: SampleLine[] }
  /** The customer pays that sale in full (into the bank). */
  | { kind: 'receipt'; id: string; date: string; sale: string }
  /** The shop pays that purchase in full (from the bank). */
  | { kind: 'payment'; id: string; date: string; purchase: string }
  /** A day-one bill settled (oldest first): a customer paying in, the shop paying a supplier. */
  | { kind: 'opening_in'; id: string; date: string; customer: string; amount: number }
  | { kind: 'opening_out'; id: string; date: string; supplier: string; amount: number }
  | { kind: 'cost'; id: string; date: string; category: SampleCostCategory; amount: number; how: 'bank' | 'cash' }
  /** Cash taken to the bank. */
  | { kind: 'deposit'; id: string; date: string; amount: number }

export interface SamplePlan {
  /** The day the books begin (the 1st of the month two months before today's). */
  booksBegin: string
  /** Day-one money (paise). */
  cash: number
  bank: number
  /** Day-one bills still open (dated before the books begin). */
  customerBills: { party: string; ref: string; date: string; amount: number }[]
  supplierBills: { party: string; ref: string; date: string; amount: number }[]
  /** Day-one stock: whole units per product, valued at its cost price. */
  stock: { item: string; qty: number }[]
  /** Everything after day one, in the order it happened (same day: purchases before sales). */
  events: SampleEvent[]
}

const ORDER: Record<SampleEvent['kind'], number> = {
  purchase: 0, opening_out: 1, payment: 2, cost: 3, sale: 4, opening_in: 5, receipt: 6, deposit: 7
}

/** What a credit customer buys, in turn. */
const CREDIT_BASKETS: SampleLine[][] = [
  [{ item: 'Laptop 14"', qty: 1 }, { item: 'Wireless Mouse', qty: 2 }],
  [{ item: 'Office Chair', qty: 2 }, { item: 'Notebook Pack', qty: 5 }],
  [{ item: 'Steel Filing Cabinet', qty: 1 }, { item: 'A4 Paper Ream', qty: 5 }],
  [{ item: 'Office Chair', qty: 1 }, { item: 'Wireless Mouse', qty: 3 }]
]

export function itemByName(name: string): DemoItem {
  const it = DEMO_ITEMS.find((i) => i.name === name)
  if (!it) throw new Error(`Sample item "${name}" not found`)
  return it
}

function monthsBack(date: string, n: number): string {
  const [y, m] = date.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 - n, 1))
  return d.toISOString().slice(0, 10)
}

export function sampleShopPlan(today: string): SamplePlan {
  const booksBegin = monthsBack(today, 2)
  const customers: DemoParty[] = DEMO_DEBTORS
  const days = (from: string, to: string): number => {
    const [a, b] = [from, to].map((s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))))
    return Math.round((b! - a!) / 86400000)
  }
  const span = days(booksBegin, today)

  // ---- sales: two walk-ins and two credit sales a week ----
  const sales: Extract<SampleEvent, { kind: 'sale' }>[] = []
  let n = 0
  for (let w = 0; 7 * w <= span; w++) {
    const at = (off: number): string | null => (7 * w + off <= span ? addDaysISO(booksBegin, 7 * w + off) : null)
    const walkIn = at(1)
    if (walkIn) sales.push({ kind: 'sale', id: `s${++n}`, date: walkIn, customer: null, paid: w % 2 === 0 ? 'cash' : 'upi', lines: [{ item: 'Notebook Pack', qty: 2 + (w % 3) }, { item: 'A4 Paper Ream', qty: 1 + (w % 2) }] })
    for (const [k, off] of [[0, 2], [1, 4]] as const) {
      const d = at(off)
      if (!d) continue
      const i = 2 * w + k
      sales.push({ kind: 'sale', id: `s${++n}`, date: d, customer: customers[i % customers.length]!.name, paid: 'credit', lines: CREDIT_BASKETS[i % CREDIT_BASKETS.length]! })
    }
    const walkIn2 = at(5)
    if (walkIn2) sales.push({ kind: 'sale', id: `s${++n}`, date: walkIn2, customer: null, paid: 'upi', lines: [{ item: 'Wireless Mouse', qty: 1 + (w % 2) }, { item: 'Office Chair', qty: 1 }] })
  }

  // ---- stock: a restock (dated 3 days before, never before the books) whenever a sale would
  //      leave less than 2 on the shelf; bills on the same day from the same supplier merge ----
  const onHand = new Map(DEMO_ITEMS.map((i) => [i.name, SAMPLE_STOCK[i.name]!.opening]))
  const purchases: Extract<SampleEvent, { kind: 'purchase' }>[] = []
  let p = 0
  for (const s of sales) {
    for (const l of s.lines) {
      if (onHand.get(l.item)! - l.qty < 2) {
        const date = addDaysISO(s.date, -3) < booksBegin ? booksBegin : addDaysISO(s.date, -3)
        const supplier = SAMPLE_SUPPLIER_OF[l.item]!
        const qty = Math.max(SAMPLE_STOCK[l.item]!.restock, l.qty)
        const same = purchases.find((x) => x.date === date && x.supplier === supplier)
        if (same) {
          const line = same.lines.find((x) => x.item === l.item)
          if (line) line.qty += qty
          else same.lines.push({ item: l.item, qty })
        } else {
          p++
          purchases.push({ kind: 'purchase', id: `p${p}`, date, supplier, billNo: `${supplier === 'Bharat Steel Suppliers' ? 'BSS' : 'GC'}/${100 + p}`, lines: [{ item: l.item, qty }] })
        }
        onHand.set(l.item, onHand.get(l.item)! + qty)
      }
      onHand.set(l.item, onHand.get(l.item)! - l.qty)
    }
  }

  // ---- money: customers pay after their usual days, suppliers after 20 days ----
  const events: SampleEvent[] = [...sales, ...purchases]
  for (const s of sales) {
    if (s.paid !== 'credit' || !s.customer) continue
    const date = addDaysISO(s.date, SAMPLE_PAY_LAG[s.customer] ?? SAMPLE_CREDIT_DAYS)
    if (date <= today) events.push({ kind: 'receipt', id: `r-${s.id}`, date, sale: s.id })
  }
  for (const pu of purchases) {
    const date = addDaysISO(pu.date, SAMPLE_SUPPLIER_LAG)
    if (date <= today) events.push({ kind: 'payment', id: `pay-${pu.id}`, date, purchase: pu.id })
  }

  // ---- day one ----
  const customerBills = [{ party: customers[0]!.name, ref: 'INV-482', date: addDaysISO(booksBegin, -25), amount: 3540000 }]
  const supplierBills = [{ party: DEMO_CREDITORS[0]!.name, ref: 'BSS/96', date: addDaysISO(booksBegin, -12), amount: 5900000 }]
  const settle = (off: number): string | null => (off <= span ? addDaysISO(booksBegin, off) : null)
  const inDate = settle(9)
  if (inDate) events.push({ kind: 'opening_in', id: 'o-in', date: inDate, customer: customerBills[0]!.party, amount: customerBills[0]!.amount })
  const outDate = settle(6)
  if (outDate) events.push({ kind: 'opening_out', id: 'o-out', date: outDate, supplier: supplierBills[0]!.party, amount: supplierBills[0]!.amount })

  // ---- monthly costs (salary paid at the end of the month) ----
  for (let m = booksBegin; m <= today; m = monthsBack(addDaysISO(m, 40), 0)) {
    for (const c of SAMPLE_COSTS) {
      const date = `${m.slice(0, 8)}${String(c.day).padStart(2, '0')}`
      if (date >= booksBegin && date <= today) events.push({ kind: 'cost', id: `c-${c.category}-${m.slice(0, 7)}`, date, category: c.category, amount: c.amount, how: c.how })
    }
  }
  // One trip to the bank with the counter's cash, half way through.
  const mid = settle(Math.floor(span / 2))
  if (mid && span >= 14) events.push({ kind: 'deposit', id: 'dep-1', date: mid, amount: 1500000 })

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : ORDER[a.kind] - ORDER[b.kind]))
  return {
    booksBegin,
    cash: 2500000,
    bank: 25000000,
    customerBills,
    supplierBills,
    stock: DEMO_ITEMS.map((i) => ({ item: i.name, qty: SAMPLE_STOCK[i.name]!.opening })),
    events
  }
}
