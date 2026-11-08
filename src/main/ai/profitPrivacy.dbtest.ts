// A3 / SEC-11 — a signed-in user whose canSeeProfit flag is off gets no profit figure from the AI
// layer: (1) other users' threads (which may hold profit_and_loss results and answers quoting
// them) are invisible and unusable to them; (2) explain_figure refuses P&L groups / lines and
// income / expense ledgers, and leaves the computed Closing Stock out of a balance sheet group;
// (3) manufacture_register drops the sale value and profit per row. Owners are unchanged.
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { seededDb, TEST_INFO } from '../db/testdb'
import type { DB } from '../db/connection'
import type { CompanyInfo } from '@shared/domain'
import type { AiEvent } from '@shared/ai'
import { stockItemInputSchema } from '@shared/schemas'
import { createLedger, createStockItem } from '../services/masters'
import { saveVoucher } from '../services/vouchers'
import { saveManufacture } from '../services/manufacture'
import { createSecretStore, insecureTestCipher } from '../services/secrets'
import type { Role } from '../services/roles'
import { MockProvider } from './mockProvider'
import { createToolRegistry } from './tools'
import type { ToolContext } from './tools/registry'
import { registerAiIpc } from './ipc'
import * as store from './store'

const INFO: CompanyInfo = { ...TEST_INFO, name: 'Profit Privacy Co' }
const PERIOD = { from: '2025-04-01', to: '2026-03-31' }
const HIDDEN = /Profit figures are not shown/

const groupId = (db: DB, name: string): number => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id
const typeId = (db: DB, kind: string): number => (db.prepare('SELECT id FROM voucher_types WHERE kind = ?').get(kind) as { id: number }).id
const ledger = (db: DB, name: string, group: string): number =>
  createLedger(db, {
    name, groupId: groupId(db, group), openingBalance: 0, gstin: null, stateCode: null, address: null, taxType: null,
    gstRate: null, hsn: null, tdsSectionId: null, pan: null, creditDays: null, exportType: null
  }).id
const item = (db: DB, name: string, openingQtyMilli = 0, openingValue = 0): number => {
  const unit = db.prepare('SELECT id FROM units ORDER BY id LIMIT 1').get() as { id: number }
  return createStockItem(db, stockItemInputSchema.parse({ name, unitId: unit.id, openingQtyMilli, openingValue })).id
}
const blank = {
  partyLedgerId: null, narration: null, reference: null, instrumentNo: null, instrumentDate: null, transporterId: null,
  vehicleNo: null, transportDistanceKm: null, posOverride: null, currencyCode: null, exchangeRate: null
}

/** Cash sale ₹5,000 (Sales Accounts), rent ₹2,000 (Indirect Expenses), and 2 chairs made from
 *  4 steel rods (opening 10 @ ₹150 = ₹1,500) + ₹300 labour, priced at ₹1,000 each:
 *  cost = 4 × 150 + 300 = ₹900, sale value ₹2,000, profit ₹1,100. */
function books(): { db: DB; cash: number; sales: number; rent: number; chair: number } {
  const db = seededDb()
  const cash = (db.prepare("SELECT id FROM ledgers WHERE name = 'Cash'").get() as { id: number }).id
  const sales = ledger(db, 'Counter Sales', 'Sales Accounts')
  const rent = ledger(db, 'Shop Rent', 'Indirect Expenses')
  const post = (kind: string, date: string, dr: number, cr: number, amount: number): void => {
    saveVoucher(db, { ...blank, voucherTypeId: typeId(db, kind), date, lines: [{ ledgerId: dr, drCr: 'dr', amount }, { ledgerId: cr, drCr: 'cr', amount }], inventory: [] })
  }
  post('receipt', '2025-05-10', cash, sales, 5_000_00)
  post('payment', '2025-05-11', rent, cash, 2_000_00)
  const steel = item(db, 'Steel Rod', 10_000, 1_500_00)
  const chair = item(db, 'Chair')
  saveManufacture(db, {
    date: '2025-06-10', finishedItemId: chair, qtyMilli: 2000, saleRatePaise: 1_000_00,
    raw: [{ stockItemId: steel, qtyMilli: 4000 }], labourPaise: 300_00, labourPosted: false, profitPaise: 1_100_00
  })
  return { db, cash, sales, rent, chair }
}

const ctxFor = (db: DB, canSeeProfit: boolean, over: Partial<ToolContext> = {}): ToolContext => ({
  db, company: INFO, role: 'accountant' as Role, userName: 'Asha', threadId: null, messageId: null, today: '2026-03-31', period: PERIOD, canSeeProfit, ...over
})

describe('explain_figure with profit hidden (A3 / SEC-11)', () => {
  it('refuses P&L groups, the " + " form with a P&L group, and income / expense ledgers; owners get them', async () => {
    const b = books()
    const registry = createToolRegistry()
    const run = (args: unknown, see: boolean) => registry.run('explain_figure', JSON.stringify(args), ctxFor(b.db, see))
    const cases: unknown[] = [
      { groupName: 'Sales Accounts', ...PERIOD },
      { groupName: 'Indirect Expenses', ...PERIOD },
      { groupName: 'Direct Expenses', ...PERIOD }, // a P&L group with nothing in it this year — still refused
      { groupName: 'Sales Accounts', asOn: '2026-03-31' }, // asked as a balance: still the P&L group
      { groupName: 'Cash-in-Hand + Sales Accounts', asOn: '2026-03-31' },
      { ledgerId: b.sales, ...PERIOD },
      { ledgerId: b.rent, ...PERIOD }
    ]
    for (const args of cases) {
      const r = await run(args, false)
      expect(r.ok, JSON.stringify(args)).toBe(false)
      if (!r.ok) expect(r.error).toMatch(HIDDEN)
    }
    // The owner (canSeeProfit on) gets the hand-worked figures.
    const salesOwner = await run({ groupName: 'Sales Accounts', ...PERIOD }, true)
    expect(salesOwner.ok).toBe(true)
    expect(JSON.stringify(salesOwner.ok ? salesOwner.data : null)).toContain('5,000.00')
    expect((await run({ ledgerId: b.rent, ...PERIOD }, true)).ok).toBe(true)
    // Not a profit figure: cash still explained for the flagged user (₹5,000 in − ₹2,000 out = ₹3,000).
    const cash = await run({ groupName: 'Cash-in-Hand', asOn: '2026-03-31' }, false)
    expect(cash.ok).toBe(true)
    expect(JSON.stringify(cash.ok ? cash.data : null)).toContain('3,000.00')
    expect((await run({ ledgerId: b.cash, ...PERIOD }, false)).ok).toBe(true)
  })

  it('a balance sheet group leaves the computed Closing Stock out of its breakdown', async () => {
    const b = books()
    const registry = createToolRegistry()
    // Closing stock on 31 Mar 2026: 6 rods × ₹150 = ₹900 + 2 chairs at ₹900 = ₹1,800.
    const owner = await registry.run('explain_figure', JSON.stringify({ groupName: 'Current Assets', asOn: '2026-03-31' }), ctxFor(b.db, true))
    expect(owner.ok).toBe(true)
    const ownerText = JSON.stringify(owner.ok ? owner.data : null)
    expect(ownerText).toMatch(/"kind":"computed"/)
    expect(ownerText).toContain('1,800.00')
    const hidden = await registry.run('explain_figure', JSON.stringify({ groupName: 'Current Assets', asOn: '2026-03-31' }), ctxFor(b.db, false))
    expect(hidden.ok).toBe(true)
    const data = (hidden.ok ? hidden.data : null) as { madeUpOf: { kind: string; name: string; amount: string }[]; computedLinesLeftOut?: number }
    expect(data.madeUpOf.some((c) => c.kind === 'computed')).toBe(false)
    expect(data.computedLinesLeftOut).toBe(1)
    expect(data.madeUpOf.map((c) => c.name)).toContain('Cash-in-Hand')
    // the computed node itself is refused
    const stock = await registry.run('explain_figure', JSON.stringify({ groupName: 'Stock-in-Hand', asOn: '2026-03-31' }), ctxFor(b.db, false))
    expect(stock.ok).toBe(false)
  })
})

describe('manufacture_register with profit hidden (A3 / SEC-11)', () => {
  it('drops sale value and profit per row; quantities and cost stay', async () => {
    const b = books()
    const registry = createToolRegistry()
    type Row = { qty: string; materials: string; labour: string; productionCost: string; saleValue?: string; profit?: string }
    const rows = async (see: boolean, via: 'tool' | 'screen'): Promise<Row[]> => {
      const r = via === 'tool'
        ? await registry.run('manufacture_register', '{}', ctxFor(b.db, see))
        : await registry.run('current_screen_data', '{}', ctxFor(b.db, see, { screen: { screen: 'manufacture-register', from: PERIOD.from, to: PERIOD.to } }))
      expect(r.ok).toBe(true)
      return ((r.ok ? r.data : null) as { rows: Row[] }).rows
    }
    const [owner] = await rows(true, 'tool')
    expect(owner).toMatchObject({ materials: '₹600.00', labour: '₹300.00', productionCost: '₹900.00', saleValue: '₹2,000.00', profit: '₹1,100.00' })
    for (const via of ['tool', 'screen'] as const) {
      const [row] = await rows(false, via)
      expect(row).toMatchObject({ materials: '₹600.00', labour: '₹300.00', productionCost: '₹900.00' })
      expect(row!.qty).toMatch(/^2\b/)
      expect(row).not.toHaveProperty('saleValue')
      expect(row).not.toHaveProperty('profit')
      expect(JSON.stringify(row)).not.toMatch(/2,000\.00|1,100\.00/)
    }
  })
})

describe('AI threads with profit hidden (A3 / SEC-11)', () => {
  type H = (p?: unknown) => unknown
  let db: DB
  let handlers: Map<string, H>
  let events: AiEvent[]
  let who: { name: string | null; role: Role; canSeeProfit: boolean | undefined }
  let provider: MockProvider
  let ownerThread: number
  let ashaThread: number
  const call = async (ch: string, p?: unknown): Promise<unknown> => handlers.get(ch)!(p)
  const done = async (runId: string): Promise<void> => {
    const t0 = Date.now()
    while (!events.some((e) => e.runId === runId && (e.type === 'done' || e.type === 'error'))) {
      if (Date.now() - t0 > 5000) throw new Error('timed out')
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  beforeEach(async () => {
    db = seededDb()
    handlers = new Map()
    events = []
    who = { name: 'Owner', role: 'owner', canSeeProfit: true }
    provider = new MockProvider([{ text: 'Noted.' }, { text: 'Noted again.' }], { models: ['mock-model'] })
    const secretsFile = join(mkdtempSync(join(tmpdir(), 'total-ai-profit-')), 'secrets.json')
    const secrets = createSecretStore({ filePath: () => secretsFile, cipher: insecureTestCipher() })
    registerAiIpc((ch, fn) => handlers.set(ch, fn as H), {
      company: () => ({ db, info: INFO, slug: 'profit-privacy', usersExist: true }),
      session: () => ({ name: who.name, role: who.role }),
      roleNow: () => who.role,
      canSeeProfit: () => who.canSeeProfit !== false,
      anyCompanyHasUsers: () => true,
      appAudit: () => {},
      secrets: () => secrets,
      emit: (e) => events.push(e),
      mock: () => true,
      providerFactory: () => provider
    })
    await call('ai:notice:accept')
    await call('ai:settings:set', { enabled: true, defaultModel: 'mock-model' })
    // The owner's old thread: a stored profit_and_loss result and an answer quoting the profit.
    ownerThread = store.createThread(db, 'What did we make?', 'Owner')
    store.addMessage(db, { threadId: ownerThread, role: 'user', content: 'What is the net profit this year?' })
    store.addMessage(db, { threadId: ownerThread, role: 'tool', content: '{"netProfit":"₹3,000.00"}', toolCallId: 'c1', toolName: 'profit_and_loss' })
    store.addMessage(db, { threadId: ownerThread, role: 'assistant', content: 'Net profit is ₹3,000.00.' })
    ashaThread = store.createThread(db, 'Cash today', 'Asha')
    store.addMessage(db, { threadId: ashaThread, role: 'user', content: 'How much cash?' })
    store.addMessage(db, { threadId: ashaThread, role: 'assistant', content: 'Cash is ₹3,000.00.' })
  })

  it('the owner (and anyone who may see profit) sees every thread, as before', async () => {
    expect(((await call('ai:threads')) as { id: number }[]).map((t) => t.id).sort()).toEqual([ownerThread, ashaThread].sort())
    who = { name: 'Ravi', role: 'accountant', canSeeProfit: true }
    expect(((await call('ai:threads')) as { id: number }[]).map((t) => t.id).sort()).toEqual([ownerThread, ashaThread].sort())
    const t = (await call('ai:thread', { id: ownerThread })) as { messages: { content: string }[] }
    expect(t.messages.map((m) => m.content)).toContain('Net profit is ₹3,000.00.')
  })

  it('a profit-hidden user sees only their own threads; every per-thread channel calls the others "not found"', async () => {
    who = { name: 'Asha', role: 'accountant', canSeeProfit: false }
    expect(((await call('ai:threads')) as { id: number }[]).map((t) => t.id)).toEqual([ashaThread])
    const mine = (await call('ai:thread', { id: ashaThread })) as { messages: { content: string }[] }
    expect(mine.messages.map((m) => m.content)).toEqual(['How much cash?', 'Cash is ₹3,000.00.'])

    await expect(call('ai:thread', { id: ownerThread })).rejects.toThrow('Conversation not found')
    await expect(call('ai:send', { threadId: ownerThread, text: 'and last year?' })).rejects.toThrow('Conversation not found')
    await expect(call('ai:regenerate', { threadId: ownerThread })).rejects.toThrow('Conversation not found')
    await expect(call('ai:thread:rename', { id: ownerThread, title: 'Mine now' })).rejects.toThrow('Conversation not found')
    await expect(call('ai:thread:pin', { id: ownerThread, pinned: true })).rejects.toThrow('Conversation not found')
    await expect(call('ai:thread:delete', { id: ownerThread })).rejects.toThrow('Conversation not found')
    expect(await call('ai:cancel', { threadId: ownerThread })).toEqual({ cancelled: false })
    // nothing went to the model, and the owner's thread is untouched
    expect(provider.requests).toHaveLength(0)
    expect(store.getThread(db, ownerThread)).toEqual({ id: ownerThread, title: 'What did we make?' })
    expect(store.listMessages(db, ownerThread)).toHaveLength(3)

    // continuing their own thread works, and its history carries none of the owner's thread
    const sent = (await call('ai:send', { threadId: ashaThread, text: 'And the bank?' })) as { runId: string; threadId: number }
    await done(sent.runId)
    expect(sent.threadId).toBe(ashaThread)
    expect(provider.requests).toHaveLength(1)
    const wire = JSON.stringify(provider.requests[0]!.input)
    expect(wire).toContain('How much cash?')
    expect(wire).not.toMatch(/Net profit|netProfit/)
    // a new thread is theirs and listed for them
    const fresh = (await call('ai:send', { text: 'Who owes us?' })) as { runId: string; threadId: number }
    await done(fresh.runId)
    expect(store.threadOwner(db, fresh.threadId)).toBe('Asha')
    expect(((await call('ai:threads')) as { id: number }[]).map((t) => t.id).sort()).toEqual([ashaThread, fresh.threadId].sort())
  })

  it('a profit-hidden session without a name sees no threads', async () => {
    who = { name: null, role: 'viewer', canSeeProfit: false }
    expect(await call('ai:threads')).toEqual([])
    await expect(call('ai:thread', { id: ashaThread })).rejects.toThrow('Conversation not found')
  })
})
