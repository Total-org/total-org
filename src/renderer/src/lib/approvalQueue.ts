// Phase 3b — the approval queue's renderer half, shared by the accountant screen
// (screens/ApprovalQueue.tsx) and the simple one (simple/queue/ApprovalQueue.tsx): the list, and
// Approve / Edit / Discard / Approve all. Approve is ai:queue:approve for a draft (main saves
// through voucher:save's / simple:post's own save), ai:memory:setStatus for a memory; Discard is the proposal's own discard (ai:draft:discard,
// memory → archived); Edit opens the proposal where a person finishes it.
import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { aiApi } from './aiClient'
import { useSession, type Screen } from '../state/stores'
import type { VoucherKind } from '@shared/domain'
import { approvableTogether, type QueueApproveResult, type QueueProposal } from '@shared/aiQueue'

export const QUEUE_KEY = ['aiQueue'] as const

export function useQueueList(enabled = true): ReturnType<typeof useQuery<Awaited<ReturnType<typeof aiApi.queue>>>> {
  return useQuery({ queryKey: QUEUE_KEY, queryFn: () => aiApi.queue(), enabled })
}

/** Where Edit opens a proposal. `simple`: the company is in simple mode — a chat draft / Ask Total
 *  offer opens its simple flow pre-filled (its first save consumes the draft); everything else
 *  opens the full editor (`aiDraftId`), whose save consumes it. */
export function queueEditTarget(p: QueueProposal, simple: boolean): Screen | null {
  if (p.type === 'capture') return { name: 'capture' }
  if (p.type === 'memory') return null
  if (simple && p.prefill) return { name: p.prefill.screen, ask: { draftId: p.id, prefill: p.prefill } } as Screen
  if (p.draftForm === 'tradeDoc' && p.voucherKind) return { name: 'trade-doc', kind: p.voucherKind, aiDraftId: p.id } as Screen
  return { name: 'voucher-entry', aiDraftId: p.id, ...(p.voucherKind ? { kindHint: p.voucherKind as VoucherKind } : {}) }
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
        return undefined
      })
      await refresh()
      return r
    },
    [run, refresh]
  )
  return { busy, approve, approveAll, discard }
}
