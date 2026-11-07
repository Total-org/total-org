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
  const mk = async (name: string, group: string, extra: Record<string, unknown> = {}): Promise<number> =>
    (await ok<{ id: number }>('master:ledgers:create', { name, groupId: gid(group), openingBalance: 0, gstin: null, stateCode: null, address: null, taxType: null, gstRate: null, hsn: null, tdsSectionId: null, pan: null, creditDays: null, exportType: null, ...extra })).id
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
    expect(await ok('ai:queue:approve', { key: m.key })).toMatchObject({ memoryId: memId, voucherIds: [] })
    expect((await queue()).proposals.some((x) => x.key === m.key)).toBe(false)
    expect(await call('ai:queue:approve', { key: m.key })).toMatchObject({ ok: false, code: 'queue_not_open' })
  })

  it('refuses a malformed key and a capture key (bills are opened, not approved)', async () => {
    expect((await call('ai:queue:approve', { key: 'capture:1' })).ok).toBe(false)
    expect((await call('ai:queue:approve', { key: 'draft:999999' })).code).toBe('queue_not_found')
  })
})
