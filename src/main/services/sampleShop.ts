// Audit A7 / UX-2: "Try with sample data" (the setup wizard, simple mode) — a coherent sample shop.
//
// Built the way a real owner's company is: the setup wizard's own service (applySetup — preset
// accounts, features, GST profile, meta ui), products with selling prices (quickCreateItem, the
// plain New product dialog's service) holding their day-one stock, "What you had on day one"
// (applyOpenings — cash, bank, an old customer bill and an old supplier bill, the owner's money
// as the difference), then every entry of `sampleShopPlan` through simple:post's postIntent — the
// path Make a bill / Record a purchase / Money in / Money out / Move money use. No second posting
// path, nothing hand-built.
//
// The full app's "Sample data in the full app" stays createDemoCompany() (services/demo.ts),
// unchanged: reportEquality, the upgrade test and many dbtests pin its output.
import { existsSync, rmSync } from 'fs'
import type { DB } from '../db/connection'
import { openCompanyDb } from '../db/connection'
import { readCompanyInfo, writeCompanyInfo } from '../db/seed'
import { upsertCompany } from '../registry'
import { companyDbPath, companyDir, ensureCompanyTree, slugify } from '../paths'
import { applySetup } from './companySetup'
import { createLedger } from './masters'
import { quickCreateItem } from './quickCreate'
import { applyOpenings, openingsState, previewOpenings } from './openings'
import { postIntent } from './simplePost'
import { writeAudit } from './audit'
import { DEMO_COMPANY, DEMO_PARTIES, DEMO_ITEMS } from '@shared/demo'
import { SAMPLE_BANK, SAMPLE_CREDIT_DAYS, itemByName, sampleShopPlan, type SampleEvent } from '@shared/sampleShop'
import type { SimpleIntentInput } from '@shared/simple/intents'

const PHONES: Record<string, string> = {
  'Umbrella Retail': '9822011101',
  'Silverline Traders': '9822011102',
  'Krishna Enterprises': '9845011103',
  'Bharat Steel Suppliers': '9822011104',
  'Gujarat Components Pvt Ltd': '9825011105'
}

/** Fill a freshly set-up company with the sample shop's story (one transaction). */
export function fillSampleShop(db: DB, today: string): void {
  const plan = sampleShopPlan(today)
  db.transaction(() => {
    // ---- the business itself: details complete, so Home's first setup step is done ----
    const set = readCompanyInfo(db)
    const info = { ...set, address: DEMO_COMPANY.address, email: DEMO_COMPANY.email, phone: DEMO_COMPANY.phone, pan: DEMO_COMPANY.pan }
    writeCompanyInfo(db, info)
    writeAudit(db, 'company', 0, 'update', set, info)

    // ---- people ----
    const groupId = (name: string): number => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id
    const partyId = new Map<string, number>()
    for (const p of DEMO_PARTIES) {
      const l = createLedger(db, {
        name: p.name,
        groupId: groupId(p.kind === 'debtor' ? 'Sundry Debtors' : 'Sundry Creditors'),
        gstin: p.gstin,
        stateCode: p.stateCode,
        address: p.address,
        creditDays: SAMPLE_CREDIT_DAYS,
        phone: PHONES[p.name] ?? null
      })
      partyId.set(p.name, l.id)
    }

    // ---- products: a selling price each, and what was on the shelf on day one (at cost) ----
    const unitId = (name: string): number => (db.prepare('SELECT id FROM units WHERE name = ? COLLATE NOCASE').get(name) as { id: number }).id
    const itemId = new Map<string, number>()
    for (const it of DEMO_ITEMS) {
      const qty = plan.stock.find((s) => s.item === it.name)!.qty
      const r = quickCreateItem(db, {
        item: { name: it.name, unitId: unitId(it.unitName), hsn: it.hsn, gstRate: it.gstRate, openingQtyMilli: qty * 1000, openingValue: qty * it.costRatePaise },
        sellingPricePaise: it.saleRatePaise,
        purchasePricePaise: it.costRatePaise
      })
      itemId.set(it.name, r.item.id)
    }

    // ---- what the shop had on day one, through the owner's own openings flow ----
    const st = openingsState(db)
    const answers = {
      cash: { amount: plan.cash, base: st.cash.amount },
      banks: [{ ledgerId: null, name: SAMPLE_BANK, amount: plan.bank, base: null }],
      customers: plan.customerBills.map((b) => ({ ledgerId: partyId.get(b.party)!, base: 0, bills: [{ ref: b.ref, date: b.date, amount: b.amount }] })),
      suppliers: plan.supplierBills.map((b) => ({ ledgerId: partyId.get(b.party)!, base: 0, bills: [{ ref: b.ref, date: b.date, amount: b.amount }] }))
    }
    const preview = previewOpenings(db, answers)
    applyOpenings(db, { ...answers, confirmCapital: preview.capital.after })

    // ---- everything after day one, through simple:post ----
    const ledgerId = (sql: string, ...args: unknown[]): number => (db.prepare(sql).get(...args) as { id: number }).id
    const bankId = ledgerId('SELECT id FROM ledgers WHERE name = ?', SAMPLE_BANK)
    const cashId = st.cash.ledgerId
    const categoryId = (key: string): number => ledgerId('SELECT id FROM ledgers WHERE simple_category = ?', key)
    const posted = new Map<string, { voucherId: number; party: number; name: string; total: number }>()
    const billOf = (voucherId: number, party: number, side: 'dr' | 'cr'): { name: string; total: number } => {
      const total = (db.prepare(`SELECT SUM(amount) AS t FROM voucher_lines WHERE voucher_id = ? AND ledger_id = ? AND dr_cr = ?`).get(voucherId, party, side) as { t: number }).t
      const ref = db.prepare(`SELECT name FROM bill_refs WHERE voucher_id = ? AND kind = 'new' LIMIT 1`).get(voucherId) as { name: string } | undefined
      return { name: ref?.name ?? '', total }
    }
    const post = (e: SampleEvent, intent: Record<string, unknown>): number[] =>
      postIntent(db, readCompanyInfo(db), { clientId: `sample-${e.id}`, date: e.date, ...intent } as SimpleIntentInput, today).voucherIds

    for (const e of plan.events) {
      switch (e.kind) {
        case 'sale': {
          const customer = e.customer ? partyId.get(e.customer)! : undefined
          const ids = post(e, {
            kind: 'sale',
            ...(customer ? { customerId: customer } : {}),
            items: e.lines.map((l) => ({ itemId: itemId.get(l.item)!, qty: l.qty * 1000 })),
            payment: e.paid === 'credit' ? { how: 'credit' } : e.paid === 'cash' ? { how: 'cash', accountId: cashId } : { how: 'upi', accountId: bankId }
          })
          if (customer) posted.set(e.id, { voucherId: ids[0]!, party: customer, ...billOf(ids[0]!, customer, 'dr') })
          break
        }
        case 'purchase': {
          const supplier = partyId.get(e.supplier)!
          const ids = post(e, {
            kind: 'purchase',
            supplierId: supplier,
            billNo: e.billNo,
            items: e.lines.map((l) => ({ itemId: itemId.get(l.item)!, qty: l.qty * 1000, rate: itemByName(l.item).costRatePaise })),
            payment: { how: 'credit' }
          })
          posted.set(e.id, { voucherId: ids[0]!, party: supplier, ...billOf(ids[0]!, supplier, 'cr') })
          break
        }
        case 'receipt': {
          const s = posted.get(e.sale)!
          post(e, { kind: 'money_in', amount: s.total, into: { how: 'bank', accountId: bankId }, customerId: s.party, bills: [{ name: s.name, billId: s.voucherId }] })
          break
        }
        case 'payment': {
          const pu = posted.get(e.purchase)!
          post(e, { kind: 'money_out', amount: pu.total, from: { how: 'bank', accountId: bankId }, supplierId: pu.party, bills: [{ name: pu.name, billId: pu.voucherId }] })
          break
        }
        case 'opening_in':
          post(e, { kind: 'money_in', amount: e.amount, into: { how: 'bank', accountId: bankId }, customerId: partyId.get(e.customer)! })
          break
        case 'opening_out':
          post(e, { kind: 'money_out', amount: e.amount, from: { how: 'bank', accountId: bankId }, supplierId: partyId.get(e.supplier)! })
          break
        case 'cost':
          post(e, { kind: 'money_out', amount: e.amount, from: e.how === 'cash' ? { how: 'cash', accountId: cashId } : { how: 'bank', accountId: bankId }, payeeId: categoryId(e.category) })
          break
        case 'deposit':
          post(e, { kind: 'move_money', amount: e.amount, fromId: cashId, toId: bankId })
          break
      }
    }
  })()
}

/**
 * `company:createDemo { mode: 'simple' }`: a new "Demo Traders" folder set up as the wizard would
 * (a GST-registered trader that keeps stock, continuing business, simple mode) and filled with the
 * sample shop. Any failure removes the folder it created.
 */
export function createSampleShop(today: string): { slug: string } {
  let slug = slugify(DEMO_COMPANY.name)
  let n = 2
  while (existsSync(companyDbPath(slug))) slug = `${slugify(DEMO_COMPANY.name)}-${n++}`
  ensureCompanyTree(slug)
  let db: DB | null = null
  try {
    db = openCompanyDb(slug)
    const plan = sampleShopPlan(today)
    applySetup(db, {
      name: DEMO_COMPANY.name,
      stateCode: DEMO_COMPANY.stateCode,
      businessType: 'trader',
      gst: 'regular',
      gstin: DEMO_COMPANY.gstin,
      filing: 'monthly',
      stock: true,
      startDate: plan.booksBegin,
      fresh: false,
      mode: 'simple'
    }, today)
    fillSampleShop(db, today)
    db.close()
    db = null
    upsertCompany({ slug, name: DEMO_COMPANY.name, stateCode: DEMO_COMPANY.stateCode, gstin: DEMO_COMPANY.gstin, lastOpenedAt: null })
    return { slug }
  } catch (err) {
    try {
      db?.close()
    } catch {
      /* already closed */
    }
    rmSync(companyDir(slug), { recursive: true, force: true })
    throw err
  }
}
