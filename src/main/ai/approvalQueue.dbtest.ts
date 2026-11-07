// Phase 3b — the approval queue through the real IPC registration (Electron mocked, the
// TOTAL_AI_MOCK demo provider): every kind of open proposal is listed; Approve saves through
// voucher:save's own save (the draft consumed, the editor's GST ledgers created on first use) or
// simple:post's (an Ask Total offer); a refused approval leaves no trace; a used proposal can't
// be approved twice.
import { TRUSTED_EVENT } from '../ipcSender.testutil'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3-multiple-ciphers'
import type { AiEvent } from '@shared/ai'
import type { QueueList, QueueProposal } from '@shared/aiQueue'

const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string; code?: string }>>()
const events: AiEvent[] = []

vi.mock('electron', () => ({
  app: { getVersion: () => '0.7.0-test', getPath: () => tmpdir(), isPackaged: false, on: () => {} },
  ipcMain: { handle: (ch: string, fn: (e: unknown, p: unknown) => Promise<{ ok: boolean }>) => handlers.set(ch.replace(/^total:/, ''), fn) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => '', showItemInFolder: () => {} },
  Notification: class {},
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_ch: string, e: AiEvent) => events.push(e) } }] },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../updater', () => ({ checkForUpdatesInteractive: async () => null }))

const DATA_DIR = mkdtempSync(join(tmpdir(), 'total-ai-queue-'))
process.env.TOTAL_DATA_DIR = DATA_DIR
process.env.TOTAL_SUPPRESS_SYNC_WARNING = '1'
process.env.TOTAL_AI_MOCK = '1'

async function call<T = unknown>(channel: string, payload?: unknown): Promise<{ ok: boolean; data?: T; error?: string; code?: string }> {
  const h = handlers.get(channel)
  if (!h) throw new Error(`no handler ${channel}`)
  return (await h(TRUSTED_EVENT, payload)) as { ok: boolean; data?: T; error?: string; code?: string }
}
async function ok<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  const r = await call<T>(channel, payload)
  if (!r.ok) throw new Error(`${channel}: ${r.error}`)
  return r.data as T
}
const until = async (pred: () => boolean, ms = 5000): Promise<void> => {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

let slug = ''
const T = '2025-08-14'
const companyDb = (readonly = true): Database.Database => new Database(join(DATA_DIR, 'companies', slug, 'company.db'), { readonly })
const count = (sql: string): number => {
  const db = companyDb()
  try {
    return (db.prepare(sql).get() as { n: number }).n
  } finally {
    db.close()
  }
}
const ids: Record<string, number> = {}
let mkLedger: (name: string, group: string, extra?: Record<string, unknown>) => Promise<number>

async function ask(text: string): Promise<void> {
  const sent = await ok<{ runId: string }>('ai:send', { text })
  await until(() => events.some((e) => e.runId === sent.runId && (e.type === 'done' || e.type === 'error')))
}
const queue = (): Promise<QueueList> => ok<QueueList>('ai:queue')
const newest = async (pred: (p: QueueProposal) => boolean): Promise<QueueProposal> => {
  const p = (await queue()).proposals.find(pred)
  if (!p) throw new Error('proposal not found')
  return p
}

const ipcModule = await import('../ipc')

beforeAll(async () => {
  ipcModule.registerIpc()
  const created = await ok<{ slug: string }>('company:create', {
    name: 'Queue Co', stateCode: '27', gstin: '27AAPFU0939F1ZV', gstRegistrationType: 'regular', address: 'Pune', booksFrom: 2025, email: null, phone: null, pan: null, tan: null
  })
  slug = created.slug
  await ok('company:open', { slug })
  const groups = await ok<{ id: number; name: string }[]>('master:groups:list')
  const gid = (n: string): number => groups.find((g) => g.name === n)!.id
  mkLedger = async (name: string, group: string, extra: Record<string, unknown> = {}): Promise<number> =>
    (await ok<{ id: number }>('master:ledgers:create', { name, groupId: gid(group), openingBalance: 0, gstin: null, stateCode: null, address: null, taxType: null, gstRate: null, hsn: null, tdsSectionId: null, pan: null, creditDays: null, exportType: null, ...extra })).id
  const mk = mkLedger
  ids.rent = await mk('Shop Rent', 'Indirect Expenses')
  ids.sales = await mk('Sales', 'Sales Accounts')
  ids.umbrella = await mk('Umbrella Retail', 'Sundry Debtors', { stateCode: '27', gstin: '27AABCD1234E1Z8' })
  ids.ramesh = await mk('Ramesh Traders', 'Sundry Debtors', { stateCode: '27' })
  const units = await ok<{ id: number; symbol: string }[]>('master:units:list')
  ids.widget = (await ok<{ id: number }>('master:stockItems:create', { name: 'Widget', unitId: units.find((u) => u.symbol === 'Nos')!.id, gstRate: 18, hsn: '8471', openingQtyMilli: 10_000, openingValue: 500_000 })).id
  await ok('ai:notice:accept')
  await ok('ai:settings:set', { enabled: true })
  await ok('ai:testConnection')
})

describe('approval queue', () => {
  it('lists a chat payment draft with its accounts; Approve saves it through the voucher save and consumes the draft', async () => {
    await ask('Pay 1,500 shop rent in cash')
    const p = await newest((x) => x.what === 'money_out')
    expect(p).toMatchObject({ type: 'draft', origin: 'chat', approve: 'voucher', amount: 150_000, unrequested: false, partyName: 'Shop Rent' })
    expect(p.lines.map((l) => [l.ledgerName, l.drCr, l.amount])).toEqual([['Shop Rent', 'dr', 150_000], ['Cash', 'cr', 150_000]])
    const before = count('SELECT COUNT(*) AS n FROM vouchers')
    const r = await ok<{ voucherIds: number[] }>('ai:queue:approve', { key: p.key, today: T })
    expect(r.voucherIds).toHaveLength(1)
    expect(count('SELECT COUNT(*) AS n FROM vouchers')).toBe(before + 1)
    const v = await ok<{ lines: { ledgerId: number; drCr: string; amount: number }[]; number: string }>('voucher:get', { id: r.voucherIds[0] })
    expect(v.lines.map((l) => [l.ledgerId, l.drCr, l.amount]).sort()).toEqual([[ids.rent, 'dr', 150_000], [p.lines[1]!.ledgerId, 'cr', 150_000]].sort())
    expect(await ok('ai:draft:get', { id: p.id })).toMatchObject({ status: 'consumed', voucherId: r.voucherIds[0] })
    expect((await queue()).proposals.find((x) => x.key === p.key)).toBeUndefined()
    // A second approval (another window) is refused and saves nothing.
    const again = await call('ai:queue:approve', { key: p.key, today: T })
    expect(again).toMatchObject({ ok: false, code: 'queue_not_open' })
    expect(count('SELECT COUNT(*) AS n FROM vouchers')).toBe(before + 1)
  })

  it('a refused approval (inside the lock) leaves no voucher, no GST ledger and no audit row; the draft stays open', async () => {
    await ask('sales invoice to Umbrella Retail for 2 Widget at 1000')
    const p = await newest((x) => x.what === 'sale')
    expect(p).toMatchObject({ origin: 'chat', approve: 'voucher', partyName: 'Umbrella Retail' })
    // 2 × ₹1,000 = ₹2,000 + CGST 9% ₹180 + SGST 9% ₹180 = ₹2,360.
    expect(p.amount).toBe(236_000)
    await ok('company:lock:set', { date: p.date })
    const audits = count('SELECT COUNT(*) AS n FROM audit_log')
    const ledgers = count('SELECT COUNT(*) AS n FROM ledgers')
    const vouchers = count('SELECT COUNT(*) AS n FROM vouchers')
    const refused = await call('ai:queue:approve', { key: p.key, today: T })
    expect(refused.ok).toBe(false)
    expect(refused.code).toBe('books_locked')
    expect(count('SELECT COUNT(*) AS n FROM audit_log')).toBe(audits)
    expect(count('SELECT COUNT(*) AS n FROM ledgers')).toBe(ledgers)
    expect(count('SELECT COUNT(*) AS n FROM vouchers')).toBe(vouchers)
    expect(await ok('ai:draft:get', { id: p.id })).toMatchObject({ status: 'open' })
    await ok('company:lock:set', { date: null })

    // Unlocked: the bill posts exactly what the draft rehearsed — the GST ledgers the editor would
    // create on first use are created (no CGST / SGST ledger existed in this company).
    const r = await ok<{ voucherIds: number[] }>('ai:queue:approve', { key: p.key, today: T })
    const v = await ok<{ lines: { ledgerId: number; drCr: string; amount: number }[]; billRefs: { name: string; amount: number }[]; number: string }>('voucher:get', { id: r.voucherIds[0] })
    const names = new Map((await ok<{ id: number; name: string }[]>('master:ledgers:list')).map((l) => [l.id, l.name]))
    expect(v.lines.map((l) => [names.get(l.ledgerId), l.drCr, l.amount]).sort()).toEqual(
      [['Umbrella Retail', 'dr', 236_000], ['Sales', 'cr', 200_000], ['CGST', 'cr', 18_000], ['SGST', 'cr', 18_000]].sort()
    )
    expect(v.billRefs.map((b) => [b.name, b.amount])).toEqual([[v.number, 236_000]])
    expect(await ok('ai:draft:get', { id: p.id })).toMatchObject({ status: 'consumed' })
  })

  it('an Ask Total offer is approved through simple:post (draft consumed); discard and memory suggestions', async () => {
    const asked = await ok<{ entry?: { missing: string | null } }>('assist:ask', { text: 'Ramesh Traders se 5000 mile', today: T })
    expect(asked.entry?.missing ?? null).toBeNull()
    const d = await ok<{ draftId: number }>('assist:draft', { text: 'Ramesh Traders se 5000 mile', today: T })
    const p = await newest((x) => x.key === `draft:${d.draftId}`)
    expect(p).toMatchObject({ origin: 'askTotal', approve: 'simple', what: 'money_in' })
    const r = await ok<{ voucherIds: number[] }>('ai:queue:approve', { key: p.key, today: T })
    expect(r.voucherIds.length).toBe(1)
    expect(await ok('ai:draft:get', { id: d.draftId })).toMatchObject({ status: 'consumed', voucherId: r.voucherIds[0] })
    const posts = count("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'simple_intent'")
    expect(posts).toBe(1)

    // Discard = the draft's own discard; it leaves the queue.
    await ask('Pay 700 shop rent in cash')
    const pay = await newest((x) => x.what === 'money_out')
    await ok('ai:draft:discard', { id: pay.id })
    expect((await queue()).proposals.some((x) => x.key === pay.key)).toBe(false)

    // A memory the assistant suggested: Approve makes it active (audited once).
    const w = companyDb(false)
    let memId = 0
    try {
      const { createMemory } = await import('./memory')
      memId = createMemory(w as never, { kind: 'style', text: 'Narrations in Hindi' }, { source: 'assistant', status: 'suggested', createdBy: 'test' }).id
    } finally {
      w.close()
    }
    const m = await newest((x) => x.key === `memory:${memId}`)
    expect(m).toMatchObject({ origin: 'memory', approve: 'memory', memoryText: 'Narrations in Hindi' })
    // A memory is accepted through its own channel (no posting right needed), never ai:queue:approve.
    expect((await call('ai:queue:approve', { key: m.key })).ok).toBe(false)
    await ok('ai:memory:setStatus', { id: memId, status: 'active' })
    expect((await queue()).proposals.some((x) => x.key === m.key)).toBe(false)
  })

  it('refuses a malformed key and a capture key (bills are opened, not approved)', async () => {
    expect((await call('ai:queue:approve', { key: 'capture:1' })).ok).toBe(false)
    expect((await call('ai:queue:approve', { key: 'draft:999999' })).code).toBe('queue_not_found')
  })

  it('lists the lines Approve would post today (balanced); a rate changed since the draft → changed, refused, nothing saved', async () => {
    await ask('sales invoice to Umbrella Retail for 1 Widget at 1000')
    const p = await newest((x) => x.what === 'sale' && x.amount === 118_000)
    const dr = p.lines.filter((l) => l.drCr === 'dr').reduce((a, l) => a + l.amount, 0)
    const cr = p.lines.filter((l) => l.drCr === 'cr').reduce((a, l) => a + l.amount, 0)
    // ₹1,000 + CGST 9% ₹90 + SGST 9% ₹90 = ₹1,180 on both sides.
    expect([dr, cr]).toEqual([118_000, 118_000])
    const units = await ok<{ id: number; symbol: string }[]>('master:units:list')
    const widget = { name: 'Widget', unitId: units.find((u) => u.symbol === 'Nos')!.id, hsn: '8471', openingQtyMilli: 10_000, openingValue: 500_000 }
    await ok('master:stockItems:update', { id: ids.widget, data: { ...widget, gstRate: 5 } })
    const now = await newest((x) => x.key === p.key)
    expect(now.approve).toBe('changed')
    // ₹1,000 + CGST 2.5% ₹25 + SGST 2.5% ₹25 = ₹1,050 — what would post now.
    expect(now.lines.find((l) => l.drCr === 'dr')?.amount).toBe(105_000)
    const before = count('SELECT COUNT(*) AS n FROM vouchers')
    expect(await call('ai:queue:approve', { key: p.key, today: T })).toMatchObject({ ok: false, code: 'queue_changed' })
    expect(count('SELECT COUNT(*) AS n FROM vouchers')).toBe(before)
    await ok('master:stockItems:update', { id: ids.widget, data: { ...widget, gstRate: 18 } })
    expect((await newest((x) => x.key === p.key)).approve).toBe('voucher')
    await ok('ai:draft:discard', { id: p.id })
  })

  it('a captured bill: clean = one click (attached + item saved); flagged = check; a number booked since = refused', async () => {
    ids.mohan ??= await mkLedger('Mohan Supplies', 'Sundry Creditors', { stateCode: '27' })
    ids.purchase ??= await mkLedger('Purchases', 'Purchase Accounts')
    const asCapture = async (invoiceNo: string, flagged: boolean): Promise<number> => {
      await ask('purchase invoice from Mohan Supplies for 1 Widget at 500')
      const d = await newest((x) => x.what === 'purchase' && x.origin === 'chat')
      const w = companyDb(false)
      try {
        // 1 × ₹500 + CGST ₹45 + SGST ₹45 = ₹590, as the bill prints it.
        const review = {
          mode: 'text', parsed: { invoiceNo, confidence: 'high', warnings: [] }, totals: { discrepancies: [] }, questions: [], suggestedParty: null,
          duplicates: [], assumptions: [], taxCheck: { computed: 9_000, printed: 9_000, computedTotal: 59_000, printedTotal: 59_000 }
        }
        const item = Number(w.prepare(`INSERT INTO capture_items (file_name, mime, size, sha256, stored_path, pages, text_layer, origin, status, review_json, supplier_ledger_id, invoice_no, invoice_date, total, draft_id, duplicate_kind)
          VALUES ('bill.pdf', 'application/pdf', 10, ?, 'x.pdf', 1, 1, 'picker', 'drafted', ?, ?, ?, ?, 59000, ?, ?)`)
          .run(`sha-${invoiceNo}`, JSON.stringify(review), ids.mohan, invoiceNo, d.date, d.id, flagged ? 'same_amount' : null).lastInsertRowid)
        const payload = JSON.parse((w.prepare('SELECT payload_json FROM ai_drafts WHERE id = ?').get(d.id) as { payload_json: string }).payload_json)
        w.prepare("UPDATE ai_drafts SET source = 'capture', origin = 'bill.pdf', payload_json = ? WHERE id = ?").run(JSON.stringify({ ...payload, captureItemId: item }), d.id)
      } finally {
        w.close()
      }
      return d.id
    }
    const clean = await asCapture('MS-1', false)
    expect(await newest((x) => x.key === `draft:${clean}`)).toMatchObject({ origin: 'capture', approve: 'voucher' })
    const flagged = await asCapture('MS-2', true)
    expect((await newest((x) => x.key === `draft:${flagged}`)).approve).toBe('check')
    expect(await call('ai:queue:approve', { key: `draft:${flagged}`, today: T })).toMatchObject({ ok: false, code: 'queue_check' })
    const r = await ok<{ voucherIds: number[] }>('ai:queue:approve', { key: `draft:${clean}`, today: T })
    expect(await ok('ai:draft:get', { id: clean })).toMatchObject({ status: 'consumed', voucherId: r.voucherIds[0] })
    expect(count(`SELECT COUNT(*) AS n FROM capture_items WHERE draft_id = ${clean} AND status = 'saved'`)).toBe(1)
    // A third bill whose number is the one just booked (its bill name = the voucher number).
    const v = await ok<{ number: string }>('voucher:get', { id: r.voucherIds[0] })
    const again = await asCapture(v.number, false)
    const vouchers = count('SELECT COUNT(*) AS n FROM vouchers')
    expect(await call('ai:queue:approve', { key: `draft:${again}`, today: T })).toMatchObject({ ok: false, code: 'queue_duplicate' })
    expect(count('SELECT COUNT(*) AS n FROM vouchers')).toBe(vouchers)
    for (const id of [flagged, again]) await ok('ai:draft:discard', { id })
  })

  it('a bank-line draft reconciles its line; a line matched meanwhile is line_done and refused', async () => {
    ids.hdfc ??= await mkLedger('HDFC Bank', 'Bank Accounts')
    const lineId = (() => {
      const w = companyDb(false)
      try {
        const imp = Number(w.prepare("INSERT INTO bank_statement_imports (bank_ledger_id, format, file_name, line_count) VALUES (?, 'csv', 'oct.csv', 1)").run(ids.hdfc).lastInsertRowid)
        return Number(w.prepare("INSERT INTO bank_statement_lines (import_id, bank_ledger_id, line_no, date, description, deposit, withdrawal, import_hash) VALUES (?, ?, 1, ?, 'RENT OCT', 0, 90000, 'h1')").run(imp, ids.hdfc, T).lastInsertRowid)
      } finally {
        w.close()
      }
    })()
    const bankDraft = async (): Promise<number> => {
      await ask('Pay 900 shop rent in cash')
      const d = await newest((x) => x.what === 'money_out' && x.amount === 90_000 && x.origin === 'chat')
      const cash = d.lines.find((l) => l.drCr === 'cr')!.ledgerId
      const w = companyDb(false)
      try {
        const p = JSON.parse((w.prepare('SELECT payload_json FROM ai_drafts WHERE id = ?').get(d.id) as { payload_json: string }).payload_json)
        const swap = <L extends { ledgerId: number | null }>(l: L): L => (l.ledgerId === cash ? { ...l, ledgerId: ids.hdfc! } : l)
        const payload = { ...p, date: T, lines: p.lines.map(swap), state: { ...p.state, date: T, rows: p.state.rows.map(swap) }, bankLine: { bankLedgerId: ids.hdfc, statementLineId: lineId } }
        w.prepare("UPDATE ai_drafts SET source = 'capture', origin = 'Statement line 1', payload_json = ? WHERE id = ?").run(JSON.stringify(payload), d.id)
      } finally {
        w.close()
      }
      return d.id
    }
    const first = await bankDraft()
    const second = await bankDraft()
    expect(await newest((x) => x.key === `draft:${first}`)).toMatchObject({ origin: 'bank', approve: 'voucher' })
    const r = await ok<{ voucherIds: number[] }>('ai:queue:approve', { key: `draft:${first}`, today: T })
    expect(count(`SELECT COUNT(*) AS n FROM bank_statement_matches WHERE statement_line_id = ${lineId} AND voucher_id = ${r.voucherIds[0]}`)).toBe(1)
    expect((await newest((x) => x.key === `draft:${second}`)).approve).toBe('line_done')
    const vouchers = count('SELECT COUNT(*) AS n FROM vouchers')
    expect(await call('ai:queue:approve', { key: `draft:${second}`, today: T })).toMatchObject({ ok: false, code: 'queue_line_done' })
    expect(count('SELECT COUNT(*) AS n FROM vouchers')).toBe(vouchers)
    await ok('ai:draft:discard', { id: second })
  })

  it('a viewer and an accountant without the posting right cannot approve', async () => {
    await ask('Pay 300 shop rent in cash')
    const p = await newest((x) => x.what === 'money_out' && x.amount === 30_000)
    const owner = await ok<{ id: number }>('users:save', { data: { name: 'Owner', pin: '1111', role: 'owner', active: true } })
    const viewer = await ok<{ id: number }>('users:save', { data: { name: 'Looker', pin: '3333', role: 'viewer', active: true } })
    const clerk = await ok<{ id: number }>('users:save', { data: { name: 'Clerk', pin: '2222', role: 'accountant', active: true, capabilities: { canPost: false } } })
    const vouchers = count('SELECT COUNT(*) AS n FROM vouchers')
    for (const [u, pin] of [[viewer.id, '3333'], [clerk.id, '2222']] as const) {
      await ok('auth:login', { userId: u, pin })
      expect((await call('ai:queue:approve', { key: p.key, today: T })).ok).toBe(false)
      await ok('auth:logout')
    }
    expect(count('SELECT COUNT(*) AS n FROM vouchers')).toBe(vouchers)
    await ok('auth:login', { userId: owner.id, pin: '1111' })
    expect((await ok<{ voucherIds: number[] }>('ai:queue:approve', { key: p.key, today: T })).voucherIds).toHaveLength(1)
  })
})
