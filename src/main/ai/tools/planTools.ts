// Phase 3b part 2 — the agent's `plan_task` tool: a task ("remind everyone 30 days late", "book
// October's bills") becomes ONE plan of proposals in the approval queue, through the same service
// Ask Total uses (services/aiPlans.ts). It groups proposals; nothing is sent or posted. A plan is
// made only when the user's own message, read by Ask Total's classifier, asks for that task —
// text inside a narration or a file can never start one.
import { z } from 'zod'
import { formatPaise } from '@shared/money'
import { PLAN_TASKS } from '@shared/aiPlans'
import { classify } from '../../assist/classify'
import { createPlan, previewPlan } from '../../services/aiPlans'
import { defineTool } from './registry'

const input = z
  .object({
    task: z.enum(PLAN_TASKS).describe("'remind_late' = a reminder to every customer late by at least minDays; 'book_bills' = the captured supplier bills of one month"),
    minDays: z.number().int().min(1).max(3650).optional().describe('remind_late: the oldest late bill is at least this many days late (default 1)'),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe("book_bills: the month, 'YYYY-MM'")
  })
  .strict()

export const planTaskTool = defineTool({
  name: 'plan_task',
  description:
    'Prepare a TASK the user asked for as a plan of proposals in the approval queue — reminders to every late customer, or booking one month of captured bills. ' +
    'Nothing is sent or recorded: the user sends each reminder and approves each bill. Use it only when the user asks for that task in their own message.',
  input,
  kind: 'draft',
  minRole: 'accountant',
  handler: (args, ctx) => {
    const asked = classify(ctx.userRequest ?? '', ctx.today)
    if (asked.kind !== 'task' || asked.task !== args.task) {
      return { data: { error: 'The user did not ask for this task in their message — do not prepare it.' }, sources: [] }
    }
    // The user's own words decide the parameters when they said them (never the model's guess).
    const params = asked.task === 'remind_late' ? { minDays: asked.minDays } : { month: asked.month }
    const preview = previewPlan(ctx.db, args.task, params, ctx.today)
    if (!preview.count) {
      return { data: { planned: 0, alreadyWaiting: preview.waiting, note: preview.waiting ? 'They are already waiting in the approval queue.' : 'Nothing to prepare for this right now.', unread: preview.unread }, sources: [] }
    }
    const p = createPlan(ctx.db, { task: args.task, params, question: ctx.userRequest ?? '', source: 'chat', threadId: ctx.threadId, createdBy: ctx.userName }, ctx.today)
    return {
      data: {
        planId: p.planId, proposals: p.added, waitingInQueue: p.count, amount: formatPaise(preview.amount, { symbol: true }), ...(preview.unread ? { stillBeingRead: preview.unread } : {}),
        note: 'Prepared as one group in the approval queue. Nothing was sent or recorded — the user approves each one.'
      },
      sources: [{ kind: 'screen', screen: 'ai-queue', label: 'Approval queue' }]
    }
  }
})
