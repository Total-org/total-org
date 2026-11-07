// Phase 3b part 2 — tasks → plans. A task the user asks for ("remind everyone 30 days late",
// "book October's bills") becomes ONE plan of proposals that waits in the approval queue as one
// group (main/services/aiPlans.ts; migration "plans"). Ask Total understands the tasks without a
// key; the AI agent creates the same plans through its `plan_task` tool. Nothing is sent or posted
// by itself: a reminder is sent by the user (WhatsApp / copy) and logged as on the person's page; a
// bill is approved like any other proposal.
import { z } from 'zod'

export type PlanTask = 'remind_late' | 'book_bills'
export const PLAN_TASKS = ['remind_late', 'book_bills'] as const

export interface PlanParams {
  /** remind_late: the oldest late bill is at least this many days late (default 1). */
  minDays?: number
  /** book_bills: the bills' month, 'YYYY-MM'. */
  month?: string
}

/** What a task would gather now, before anything is stored (Ask Total's offer, the tool's reply). */
export interface PlanPreview {
  task: PlanTask
  params: PlanParams
  /** Everything the task matches now, and its amount (remind_late: what those customers owe late,
   *  paise; book_bills: the bills' totals). */
  totalCount: number
  totalAmount: number
  /** What a plan would ADD: matches not already waiting in an open plan. */
  count: number
  amount: number
  /** Matches already waiting in an open plan (never listed twice). */
  waiting: number
  /** book_bills: captured bills of any month still being read / waiting for answers (not in the plan). */
  unread: number
  /** An open plan for the same task and parameters (asking again returns it). */
  existingPlanId: number | null
}

export interface PlanCreated {
  planId: number
  /** Items the plan holds open now. */
  count: number
  /** Items this call added (a new plan: all of them; asked again: what matched since). */
  added: number
  /** true = the open plan for the same task was returned (nothing new stored). */
  existing: boolean
}

/** The queue's header for a plan's group. */
export interface QueuePlan {
  key: string
  id: number
  task: PlanTask
  params: PlanParams
  question: string
  source: 'ask-total' | 'chat'
  createdAt: string
}

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
export const planParamsSchema = z
  .object({ minDays: z.number().int().min(1).max(3650).optional(), month: month.optional() })
  .strict()

export const planTaskSchema = z
  .object({ task: z.enum(PLAN_TASKS), params: planParamsSchema.default({}) })
  .strict()
  .superRefine((v, ctx) => {
    if (v.task === 'book_bills' && !v.params.month) ctx.addIssue({ code: 'custom', path: ['params', 'month'], message: 'Which month?' })
  })

export const planRemindedSchema = z
  .object({ itemId: z.number().int().positive(), via: z.enum(['whatsapp', 'sms', 'copied']), today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
  .strict()
export const planItemSchema = z.object({ itemId: z.number().int().positive() }).strict()
