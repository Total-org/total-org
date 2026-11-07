// Phase 3b — the approval queue's renderer half, shared by the accountant screen
// (screens/ApprovalQueue.tsx) and the simple one (simple/queue/ApprovalQueue.tsx): the list, and
// Approve / Edit / Discard / Approve all. Approve is ai:queue:approve for a draft (main saves
// through voucher:save's / simple:post's own save), ai:memory:setStatus for a memory; Discard is the proposal's own discard (ai:draft:discard,
// memory → archived); Edit opens the proposal where a person finishes it.
import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { aiApi, onAiEvent } from './aiClient'
import { useSession, type Screen } from '../state/stores'
import type { VoucherKind } from '@shared/domain'
import { approvableTogether, type QueueApproveResult, type QueueProposal } from '@shared/aiQueue'
import { reminderMessage, whatsappLink, type ReminderVia } from '@shared/simple/people'
import type { Language } from '@shared/i18n'

export const QUEUE_KEY = ['aiQueue'] as const

export function useQueueList(enabled = true): ReturnType<typeof useQuery<Awaited<ReturnType<typeof aiApi.queue>>>> {
  const queryClient = useQueryClient()
  // An AI answer may have proposed something (a draft, a memory, a plan): the queue — and the Ask
  // panel's "To approve" count — follow it as soon as the answer ends.
  useEffect(
    () =>
      onAiEvent((e) => {
        if (e.type === 'done' || e.type === 'error') void queryClient.invalidateQueries({ queryKey: QUEUE_KEY })
      }),
    [queryClient]
  )
  return useQuery({ queryKey: QUEUE_KEY, queryFn: () => aiApi.queue(), enabled, staleTime: 0, refetchOnMount: 'always' })
}

/** Where Edit opens a proposal. `simple`: the company is in simple mode — a chat draft / Ask Total
 *  offer opens its simple flow pre-filled (its first save consumes the draft); everything else
 *  opens the full editor (`aiDraftId`), whose save consumes it. */
export function queueEditTarget(p: QueueProposal, simple: boolean): Screen | null {
  if (p.type === 'capture') return { name: 'capture' }
  if (p.type === 'memory') return null
  // A plan's reminder: the customer's page (People — the bills, the phone number, the history).
  if (p.type === 'reminder') return p.reminder ? (simple ? { name: 'simple-person', id: p.reminder.partyId } : { name: 'ledger-statement', ledgerId: p.reminder.partyId }) : null
  // TDS is deducted in the full editor (owner, 8 Nov) — a chat draft that needs it opens there.
  if (simple && p.prefill && (p.approve !== 'tds' || p.origin === 'askTotal')) return { name: p.prefill.screen, ask: { draftId: p.id, prefill: p.prefill } } as Screen
  if (p.draftForm === 'tradeDoc' && p.voucherKind) return { name: 'trade-doc', kind: p.voucherKind, aiDraftId: p.id } as Screen
  return { name: 'voucher-entry', aiDraftId: p.id, ...(p.voucherKind ? { kindHint: p.voucherKind as VoucherKind } : {}) }
}

/** A plan's reminder message, in the reader's language — the People page's own words. */
export function reminderText(p: QueueProposal, company: string, lang: Language): string | null {
  const f = p.reminder?.facts
  if (!f || !p.partyName) return null
  return reminderMessage({ company, party: p.partyName, bucket: f.bucket, bills: f.bills, tone: f.tone ?? 'late' }, lang)
}

export interface QueueOutcome {
  key: string
  ok: boolean
  result?: QueueApproveResult
  error?: unknown
}

/** Approve / discard with one request at a time per proposal; after each the whole cache is
 *  refreshed (a saved voucher moves every figure). */
export function useQueueActions(): {
  busy: ReadonlySet<string>
  approve: (p: QueueProposal) => Promise<QueueOutcome>
  approveAll: (list: readonly QueueProposal[]) => Promise<QueueOutcome[]>
  discard: (p: QueueProposal) => Promise<QueueOutcome>
  /** Send a plan's reminder the way the person's page does — WhatsApp opens the OS browser with
   *  the message (the app sends nothing), a copy goes to the clipboard — then log it. */
  remind: (p: QueueProposal, via: ReminderVia, text: string) => Promise<QueueOutcome>
} {
  const queryClient = useQueryClient()
  const today = useSession((s) => s.workingDate)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const mark = (key: string, on: boolean): void =>
    setBusy((b) => {
      const n = new Set(b)
      if (on) n.add(key)
      else n.delete(key)
      return n
    })
  const run = useCallback(
    async (key: string, fn: () => Promise<QueueApproveResult | undefined>): Promise<QueueOutcome> => {
      mark(key, true)
      try {
        const result = await fn()
        return { key, ok: true, ...(result ? { result } : {}) }
      } catch (error) {
        return { key, ok: false, error }
      } finally {
        mark(key, false)
      }
    },
    []
  )
  const refresh = useCallback(() => queryClient.invalidateQueries(), [queryClient])
    // A memory suggestion is accepted through its own channel (no posting right needed); every
  // draft through ai:queue:approve (main saves it through voucher:save's / simple:post's save).
  const approveOne = useCallback(
    (p: QueueProposal) =>
      run(p.key, async () => {
        if (p.type === 'memory') {
          const m = await aiApi.setMemoryStatus(p.id, 'active')
          return { key: p.key, voucherIds: [], memoryId: m.id }
        }
        return aiApi.approveProposal(p.key, today)
      }),
    [run, today]
  )
  const approve = useCallback(
    async (p: QueueProposal) => {
      const r = await approveOne(p)
      await refresh()
      return r
    },
    [approveOne, refresh]
  )
  // One after another (each its own save and transaction — one refusal never stops the rest).
  const approveAll = useCallback(
    async (list: readonly QueueProposal[]) => {
      const out: QueueOutcome[] = []
      for (const p of list.filter(approvableTogether)) out.push(await approveOne(p))
      await refresh()
      return out
    },
    [approveOne, refresh]
  )
  const discard = useCallback(
    async (p: QueueProposal) => {
      const r = await run(p.key, async () => {
        if (p.type === 'memory') await aiApi.setMemoryStatus(p.id, 'archived')
        else if (p.type === 'draft') await aiApi.discardDraft(p.id)
        else if (p.type === 'reminder') await aiApi.planDiscard(p.id)
        return undefined
      })
      await refresh()
      return r
    },
    [run, refresh]
  )
  const remind = useCallback(
    async (p: QueueProposal, via: ReminderVia, text: string) => {
      const r = await run(p.key, async () => {
        if (via === 'whatsapp') window.open(whatsappLink(p.reminder?.whatsapp ?? p.reminder?.phone, text))
        else await navigator.clipboard.writeText(text)
        await aiApi.planReminded(p.id, via, today)
        return undefined
      })
      await refresh()
      return r
    },
    [run, refresh, today]
  )
  return { busy, approve, approveAll, discard, remind }
}
