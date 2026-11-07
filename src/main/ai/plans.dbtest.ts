import { TRUSTED_EVENT } from '../ipcSender.testutil'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3-multiple-ciphers'
import { testFileDb } from '../db/testdb'
import type { AiEvent } from '@shared/ai'
import type { QueueList } from '@shared/aiQueue'
import type { AssistAnswer } from '@shared/assist'
import { addDaysISO, fyOf, todayISO } from '@shared/dates'

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

const DATA_DIR = mkdtempSync(join(tmpdir(), 'total-ai-plans-'))
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
const TODAY = todayISO()
const dbPath = (): string => join(DATA_DIR, 'companies', slug, 'company.db')
const count = (sql: string): number => {
  const db = new Database(dbPath(), { readonly: true })
  try {
    return (db.prepare(sql).get() as { n: number }).n
  } finally {
    db.close()
  }
}
const ids: Record<string, number> = {}
const queue = (): Promise<QueueList> => ok<QueueList>('ai:queue')

const ipcModule = await import('../ipc')

beforeAll(async () => {
  ipcModule.registerIpc()
  const early = addDaysISO(TODAY, -45)
  const created = await ok<{ slug: string }>('company:create', {
    name: 'Plans Co', stateCode: '27', gstin: null, gstRegistrationType: 'unregistered', address: 'Pune', booksFrom: Number(fyOf(early).from.slice(0, 4)), email: null, phone: null, pan: null, tan: null
  })
  slug = created.slug
  await ok('company:open', { slug })
  const groups = await ok<{ id: number; name: string }[]>('master:groups:list')
  const gid = (n: string): number => groups.find((g) => g.name === n)!.id
  const mk = async (name: string, group: string, extra: Record<string, unknown> = {}): Promise<number> =>
    (await ok<{ id: number }>('master:ledgers:create', { name, groupId: gid(group), openingBalance: 0, gstin: null, stateCode: '27', address: null, taxType: null, gstRate: null, hsn: null, tdsSectionId: null, pan: null, creditDays: null, exportType: null, ...extra })).id
  await mk('Sales', 'Sales Accounts')
  // One day to pay: a bill of 45 days ago is 44 days late, one of 10 days ago 9 days late.
  ids.ramesh = await mk('Ramesh Traders', 'Sundry Debtors', { creditDays: 1, phone: '9876543210' })
  ids.sita = await mk('Sita Stores', 'Sundry Debtors', { creditDays: 1 })
  const sale = (clientId: string, customerId: number, date: string, amount: number): Promise<unknown> =>
    ok('simple:post', { intent: { kind: 'sale', clientId, date, customerId, amount: { amount }, payment: { how: 'credit' } }, today: TODAY })
  await sale('plan-sale-00001', ids.ramesh, early, 1_200_000)
  await sale('plan-sale-00002', ids.sita, addDaysISO(TODAY, -10), 300_000)
})

describe('tasks → plans (Phase 3b part 2)', () => {
  it('Ask Total reads "remind everyone 30 days late" as a task with the People page\'s figures; nothing stored', async () => {
    const a = await ok<AssistAnswer>('assist:ask', { text: 'remind everyone 30 days late', today: TODAY })
    expect(a.intent).toBe('task')
    // Only Ramesh: ₹12,000 is 44 days late (Sita's ₹3,000 is 9 days late).
    expect(a.task?.preview).toMatchObject({ task: 'remind_late', params: { minDays: 30 }, totalCount: 1, totalAmount: 1_200_000, count: 1, amount: 1_200_000, waiting: 0, existingPlanId: null })
    expect(a.task?.canPlan).toBe(true)
    expect(a.sentences[0]).toContain('₹12,000.00')
    expect(count('SELECT COUNT(*) AS n FROM ai_plans')).toBe(0)
  })

  it('assist:plan stores ONE plan (audited); asking again returns it; the queue lists the reminder in the plan\'s group', async () => {
    const p = await ok<{ planId: number; count: number; existing: boolean }>('assist:plan', { text: 'remind everyone 30 days late', today: TODAY })
    expect(p).toMatchObject({ count: 1, added: 1, existing: false })
    expect(await ok('assist:plan', { text: 'Remind everyone 30 days late', today: TODAY })).toEqual({ planId: p.planId, count: 1, added: 0, existing: true })
    expect(count("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'ai_plan' AND action = 'create'")).toBe(1)
    const q = await queue()
    expect(q.plans.map((x) => [x.key, x.task, x.params.minDays, x.source])).toEqual([[`plan:${p.planId}`, 'remind_late', 30, 'ask-total']])
    const r = q.proposals.find((x) => x.type === 'reminder')!
    expect(r).toMatchObject({ group: `plan:${p.planId}`, partyName: 'Ramesh Traders', amount: 1_200_000, approve: 'reminder', origin: 'askTotal' })
    expect(r.reminder?.phone).toBe('9876543210')
    expect(r.reminder?.facts?.bills.map((b) => [b.pending, b.overdueDays])).toEqual([[1_200_000, 44]])
    // Not a task → refused, nothing stored.
    expect((await call('assist:plan', { text: 'who owes me', today: TODAY })).code).toBe('plan_nothing')
  })

  it('a reminder sent from the plan is logged as on the person\'s page; the item is done and cannot be sent twice', async () => {
    const r = (await queue()).proposals.find((x) => x.type === 'reminder')!
    const out = await ok<{ logId: number }>('ai:plan:reminded', { itemId: r.id, via: 'whatsapp', today: TODAY })
    expect(count(`SELECT COUNT(*) AS n FROM reminder_log WHERE id = ${out.logId} AND party_ledger_id = ${ids.ramesh} AND channel = 'whatsapp' AND amount_paise = 1200000`)).toBe(1)
    expect(count(`SELECT COUNT(*) AS n FROM ai_plan_items WHERE id = ${r.id} AND status = 'done' AND reminder_log_id = ${out.logId}`)).toBe(1)
    expect((await queue()).proposals.some((x) => x.key === r.key)).toBe(false)
    expect((await queue()).plans).toEqual([])
    expect((await call('ai:plan:reminded', { itemId: r.id, via: 'copied', today: TODAY })).code).toBe('queue_not_open')
  })

  it('a customer waits in ONE plan only; asking again tops the open plan up (audited); a dropped one is discarded', async () => {
    // Ramesh's 30-day reminder is done: "anything late" holds both customers.
    const p = await ok<{ planId: number; count: number; added: number }>('assist:plan', { text: 'sabko reminder bhejo jo late hain', today: TODAY })
    expect(p).toMatchObject({ count: 2, added: 2 })
    // Ramesh now waits in that plan: the 30-day task says so and offers nothing new (review of #229).
    const again = await ok<AssistAnswer>('assist:ask', { text: 'remind everyone 30 days late', today: TODAY })
    expect(again.task).toBeUndefined()
    expect(again.sentences.join(' ')).toContain('1 of them is already waiting in Things to approve')
    expect((await call('assist:plan', { text: 'remind everyone 30 days late', today: TODAY })).code).toBe('plan_nothing')
    expect((await queue()).proposals.filter((x) => x.type === 'reminder' && x.partyName === 'Ramesh Traders')).toHaveLength(1)
    // Sita is dropped (audited); asking the same task again adds her back to the SAME plan.
    const sita = (await queue()).proposals.find((x) => x.type === 'reminder' && x.partyName === 'Sita Stores')!
    await ok('ai:plan:discard', { itemId: sita.id })
    expect(count(`SELECT COUNT(*) AS n FROM ai_plan_items WHERE id = ${sita.id} AND status = 'discarded'`)).toBe(1)
    const top = await ok<{ planId: number; count: number; added: number; existing: boolean }>('assist:plan', { text: 'remind everyone who is late', today: TODAY })
    expect(top).toEqual({ planId: p.planId, count: 2, added: 1, existing: true })
    expect(count(`SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'ai_plan' AND entity_id = ${p.planId} AND action = 'update' AND after_json LIKE '%added%'`)).toBe(1)
    // "Anything late" says it in words without "1+ days".
    const any = await ok<AssistAnswer>('assist:ask', { text: 'remind everyone who is late', today: TODAY })
    expect(any.sentences[0]).toBe('2 customers have late bills, owing ₹15,000.00. I can prepare a reminder for each — you send them yourself.')
  })

  it('"book October\'s bills" with nothing captured says so; the agent prepares a plan only when asked, never twice', async () => {
    const a = await ok<AssistAnswer>('assist:ask', { text: "book October's bills", today: TODAY })
    expect(a.intent).toBe('task')
    expect(a.task).toBeUndefined()
    expect(a.sentences.join(' ')).toMatch(/No bill from Oct 20\d\d/)
    await ok('ai:notice:accept')
    await ok('ai:settings:set', { enabled: true })
    await ok('ai:testConnection')
    const send = async (text: string): Promise<void> => {
      const sent = await ok<{ runId: string }>('ai:send', { text })
      await until(() => events.some((e) => e.runId === sent.runId && (e.type === 'done' || e.type === 'error')))
    }
    // Both customers already wait in the Ask Total plan: the agent's plan_task adds nothing.
    const plansBefore = count('SELECT COUNT(*) AS n FROM ai_plans')
    await send('Remind everyone who is 30 days late')
    expect(count('SELECT COUNT(*) AS n FROM ai_plans')).toBe(plansBefore)
    // Drop them; the agent's 30-day plan then holds Ramesh (source chat).
    for (const r of (await queue()).proposals.filter((x) => x.type === 'reminder')) await ok('ai:plan:discard', { itemId: r.id })
    await send('Remind everyone who is 30 days late')
    expect(count("SELECT COUNT(*) AS n FROM ai_plans WHERE source = 'chat' AND task = 'remind_late' AND json_extract(params_json, '$.minDays') = 30")).toBe(1)
    expect((await queue()).proposals.filter((x) => x.type === 'reminder').map((x) => x.partyName)).toEqual(['Ramesh Traders'])
  })

  it('"book this month\'s bills" gathers the open captured-bill drafts of the month into one plan group', async () => {
    const w = testFileDb(dbPath())
    try {
      const item = Number(w.prepare("INSERT INTO capture_items (file_name, mime, size, sha256, stored_path, pages, text_layer, origin, status) VALUES ('b.pdf', 'application/pdf', 1, 'sha-plan', 'b.pdf', 1, 1, 'picker', 'drafted')").run().lastInsertRowid)
      const payload = { voucherTypeId: 1, voucherKind: 'purchase', date: TODAY, partyLedgerId: null, narration: null, reference: null, lines: [], total: 59_000, captureItemId: item }
      w.prepare("INSERT INTO ai_drafts (kind, summary, payload_json, source, origin) VALUES ('voucher', 'Bill', ?, 'capture', 'b.pdf')").run(JSON.stringify(payload))
      // A bill of last month is not part of it.
      w.prepare("INSERT INTO ai_drafts (kind, summary, payload_json, source, origin) VALUES ('voucher', 'Old bill', ?, 'capture', 'c.pdf')").run(JSON.stringify({ ...payload, date: addDaysISO(TODAY.slice(0, 8) + '01', -1), captureItemId: item }))
    } finally {
      w.close()
    }
    const a = await ok<AssistAnswer>('assist:ask', { text: "book this month's bills", today: TODAY })
    expect(a.task?.preview).toMatchObject({ task: 'book_bills', params: { month: TODAY.slice(0, 7) }, totalCount: 1, count: 1, amount: 59_000 })
    const p = await ok<{ planId: number; count: number }>('assist:plan', { text: "book this month's bills", today: TODAY })
    expect(p.count).toBe(1)
    const inPlan = (await queue()).proposals.filter((x) => x.group === `plan:${p.planId}`)
    expect(inPlan.map((x) => [x.type, x.origin, x.amount])).toEqual([['draft', 'capture', 59_000]])
  })
})
