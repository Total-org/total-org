// Phase 3b part 2 — tasks → plans (shapes in @shared/aiPlans; tables ai_plans / ai_plan_items,
// migration "plans"). A plan only GROUPS proposals; it adds no posting or sending path:
//   - remind_late: one item per customer whose oldest late bill is at least `minDays` days late —
//     the People page's own reminder (simplePeople.lateReminders / personReminded, recomputed when
//     sent); the user sends it (WhatsApp / copy) and it is logged exactly as on the person's page;
//   - book_bills: the open captured-bill drafts dated in `month` (existing ai_drafts rows; each is
//     approved like any other proposal — through voucher:save's own save — and is never part of
//     "Approve all", owner 8 Nov).
// No AI code is imported: Ask Total (src/main/assist/, no network) creates plans too.
import type { DB } from '../db/connection'
import type { PlanCreated, PlanParams, PlanPreview, PlanTask, QueuePlan } from '@shared/aiPlans'
import type { ReminderVia } from '@shared/simple/people'
import { AppError } from '@shared/errors/appError'
import { writeAudit } from './audit'
import { lateReminders, personReminded } from './simplePeople'

const monthRange = (m: string): { from: string; to: string } => {
  const [y, mo] = m.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` }
}

/** The open captured-bill drafts of a month: id + total (the bill drafts' own `total`). */
function monthBillDrafts(db: DB, month: string): { id: number; total: number }[] {
  const { from, to } = monthRange(month)
  return (
    db
      .prepare(
        `SELECT id, payload_json AS p FROM ai_drafts
         WHERE status = 'open' AND source = 'capture' AND json_extract(payload_json, '$.captureItemId') IS NOT NULL
           AND json_extract(payload_json, '$.bankLine') IS NULL AND json_extract(payload_json, '$.date') BETWEEN ? AND ?
         ORDER BY json_extract(payload_json, '$.date'), id`
      )
      .all(from, to) as { id: number; p: string }[]
  ).map((r) => ({ id: r.id, total: (JSON.parse(r.p) as { total?: number }).total ?? 0 }))
}

const unreadBills = (db: DB): number =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM capture_items WHERE status IN ('queued', 'pending', 'processing', 'needs_review')
           AND (draft_id IS NULL OR draft_id NOT IN (SELECT id FROM ai_drafts WHERE status = 'open'))`
      )
      .get() as { n: number }
  ).n

const paramsKey = (p: PlanParams): string => JSON.stringify({ minDays: p.minDays ?? null, month: p.month ?? null })

/** An open plan (some item still open) for the same task and parameters. */
function openPlanFor(db: DB, task: PlanTask, params: PlanParams): number | null {
  const rows = db.prepare('SELECT id, params_json AS p FROM ai_plans WHERE task = ? ORDER BY id DESC').all(task) as { id: number; p: string }[]
  for (const r of rows) {
    if (paramsKey(JSON.parse(r.p) as PlanParams) !== paramsKey(params)) continue
    if (openItems(db, r.id) > 0) return r.id
  }
  return null
}

/** Items still waiting: open reminders + bill drafts still open. */
function openItems(db: DB, planId: number): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM ai_plan_items i LEFT JOIN ai_drafts d ON d.id = i.draft_id
         WHERE i.plan_id = ? AND i.status = 'open' AND (i.kind = 'reminder' OR d.status = 'open')`
      )
      .get(planId) as { n: number }
  ).n
}

/** What the task would gather now (nothing stored). */
export function previewPlan(db: DB, task: PlanTask, params: PlanParams, today: string): PlanPreview {
  if (task === 'remind_late') {
    const late = lateReminders(db, today, params.minDays ?? 1)
    return { task, params, count: late.length, amount: late.reduce((s, r) => s + r.reminder.amount, 0), unread: 0, existingPlanId: openPlanFor(db, task, params) }
  }
  const bills = monthBillDrafts(db, params.month!)
  return { task, params, count: bills.length, amount: bills.reduce((s, b) => s + b.total, 0), unread: unreadBills(db), existingPlanId: openPlanFor(db, task, params) }
}

/** Store the plan with its proposals (one transaction, audited 'ai_plan'). Asking again while a
 *  plan for the same task is open returns it; a task with nothing to do is refused (`plan_nothing`). */
export function createPlan(
  db: DB,
  input: { task: PlanTask; params: PlanParams; question: string; source: 'ask-total' | 'chat'; threadId?: number | null; createdBy?: string | null },
  today: string
): PlanCreated {
  return db.transaction((): PlanCreated => {
    const existing = openPlanFor(db, input.task, input.params)
    if (existing) return { planId: existing, count: openItems(db, existing), existing: true }
    const items =
      input.task === 'remind_late'
        ? lateReminders(db, today, input.params.minDays ?? 1).map((r) => ({ kind: 'reminder' as const, partyId: r.ledgerId, draftId: null }))
        : monthBillDrafts(db, input.params.month!).map((b) => ({ kind: 'draft' as const, partyId: null, draftId: b.id }))
    if (!items.length) throw new AppError('plan_nothing', 'There is nothing to do for this task right now')
    const planId = Number(
      db
        .prepare('INSERT INTO ai_plans (task, params_json, question, source, thread_id, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(input.task, JSON.stringify(input.params), input.question.slice(0, 500), input.source, input.threadId ?? null, input.createdBy ?? null).lastInsertRowid
    )
    const ins = db.prepare('INSERT INTO ai_plan_items (plan_id, kind, draft_id, party_ledger_id) VALUES (?, ?, ?, ?)')
    for (const it of items) ins.run(planId, it.kind, it.draftId, it.partyId)
    writeAudit(db, 'ai_plan', planId, 'create', null, {
      task: input.task, params: input.params, question: input.question.slice(0, 500), source: input.source,
      items: items.map((i) => (i.kind === 'reminder' ? { reminder: i.partyId } : { draft: i.draftId }))
    })
    return { planId, count: items.length, existing: false }
  })()
}

interface ItemRow {
  id: number
  planId: number
  kind: 'draft' | 'reminder'
  partyId: number | null
  status: 'open' | 'done' | 'discarded'
}

function openItem(db: DB, itemId: number, kind: 'reminder' | null): ItemRow {
  const it = db
    .prepare('SELECT id, plan_id AS planId, kind, party_ledger_id AS partyId, status FROM ai_plan_items WHERE id = ?')
    .get(itemId) as ItemRow | undefined
  if (!it || (kind && it.kind !== kind)) throw new AppError('queue_not_found', 'This proposal is no longer there')
  if (it.status !== 'open') throw new AppError('queue_not_open', `This proposal is already ${it.status}`, { params: { status: it.status } })
  return it
}

/** A plan's reminder was sent by the user (WhatsApp / SMS / copied): logged through the person
 *  page's own path (personReminded — reminder_log + its audit row, figures as on `today`) and the
 *  item marked done, in one transaction. A customer with nothing late any more is refused there. */
export function planReminded(db: DB, itemId: number, via: ReminderVia, today: string): { logId: number } {
  return db.transaction(() => {
    const it = openItem(db, itemId, 'reminder')
    const { logId } = personReminded(db, it.partyId!, via, today)
    db.prepare("UPDATE ai_plan_items SET status = 'done', reminder_log_id = ?, done_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(logId, itemId)
    writeAudit(db, 'ai_plan', it.planId, 'update', { item: itemId, status: 'open' }, { item: itemId, status: 'done', reminderLogId: logId, via })
    return { logId }
  })()
}

/** Drop a plan's reminder (a bill draft is discarded through its own ai:draft:discard). */
export function discardPlanItem(db: DB, itemId: number): void {
  db.transaction(() => {
    const it = openItem(db, itemId, 'reminder')
    db.prepare("UPDATE ai_plan_items SET status = 'discarded', done_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(itemId)
    writeAudit(db, 'ai_plan', it.planId, 'update', { item: itemId, status: 'open' }, { item: itemId, status: 'discarded' })
  })()
}

/** For the queue: the plans that still have something open, the plan of each draft in one, and
 *  the open reminder items. */
export function queuePlans(db: DB): { plans: QueuePlan[]; draftPlan: Map<number, number>; reminders: { itemId: number; planId: number; partyId: number; createdAt: string }[] } {
  const rows = db
    .prepare('SELECT id, task, params_json AS p, question, source, created_at AS createdAt FROM ai_plans ORDER BY id DESC')
    .all() as { id: number; task: PlanTask; p: string; question: string; source: 'ask-total' | 'chat'; createdAt: string }[]
  const plans = rows
    .filter((r) => openItems(db, r.id) > 0)
    .map((r) => ({ key: `plan:${r.id}`, id: r.id, task: r.task, params: JSON.parse(r.p) as PlanParams, question: r.question, source: r.source, createdAt: r.createdAt }))
  const live = new Set(plans.map((p) => p.id))
  const items = db
    .prepare("SELECT i.id, i.plan_id AS planId, i.kind, i.draft_id AS draftId, i.party_ledger_id AS partyId, p.created_at AS createdAt FROM ai_plan_items i JOIN ai_plans p ON p.id = i.plan_id WHERE i.status = 'open'")
    .all() as { id: number; planId: number; kind: 'draft' | 'reminder'; draftId: number | null; partyId: number | null; createdAt: string }[]
  const draftPlan = new Map<number, number>()
  const reminders: { itemId: number; planId: number; partyId: number; createdAt: string }[] = []
  for (const i of items) {
    if (!live.has(i.planId)) continue
    if (i.kind === 'draft') draftPlan.set(i.draftId!, i.planId)
    else reminders.push({ itemId: i.id, planId: i.planId, partyId: i.partyId!, createdAt: i.createdAt })
  }
  return { plans, draftPlan, reminders }
}
