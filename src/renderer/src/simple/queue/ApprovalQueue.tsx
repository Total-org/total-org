// Phase 3b — the approval queue in plain words (simple mode). Each proposal is one sentence with
// Approve / Edit / Discard; proposals made together get "Approve all". Approve saves through
// simple:post / voucher:save's own save in main (ai:queue:approve) — nothing posts by itself.
// The accountant view (accounts + Dr / Cr) is screens/ApprovalQueue.tsx.
import { formatPaise } from '@shared/money'
import { toPlainDate } from '@shared/dates'
import type { MessageKey } from '@shared/i18n'
import { mapError, type CaughtError } from '@shared/errors'
import { approvableTogether, groupProposals, oneClick, type QueueOrigin, type QueueProposal, type QueueWhat } from '@shared/aiQueue'
import { useT } from '../../lib/i18n'
import { useNav, useToasts } from '../../state/stores'
import { useCanSave, useCanWrite } from '../ViewerNote'
import { Badge, Banner, Button, Page, Panel, SkeletonRows } from '../../components/ui'
import { EmptyTeach } from '../help/EmptyTeach'
import { queueEditTarget, useQueueActions, useQueueList, type QueueOutcome } from '../../lib/approvalQueue'

const WHAT: Record<QueueWhat, MessageKey> = {
  sale: 'simple.queue.what.sale',
  purchase: 'simple.queue.what.purchase',
  money_in: 'simple.queue.what.moneyIn',
  money_out: 'simple.queue.what.moneyOut',
  move_money: 'simple.queue.what.moveMoney',
  return_sale: 'simple.queue.what.returnSale',
  return_purchase: 'simple.queue.what.returnPurchase',
  journal: 'simple.queue.what.journal',
  stock: 'simple.queue.what.stock',
  order: 'simple.queue.what.order',
  made: 'simple.queue.what.made',
  bill_to_read: 'simple.queue.what.billToRead',
  memory: 'simple.queue.what.memory'
}
const FROM: Record<QueueOrigin, MessageKey> = {
  chat: 'simple.queue.from.chat',
  capture: 'simple.queue.from.capture',
  bank: 'simple.queue.from.bank',
  gst2b: 'simple.queue.from.gst2b',
  askTotal: 'simple.queue.from.askTotal',
  memory: 'simple.queue.from.memory',
  other: 'simple.queue.from.other'
}
const CAPTURE: Record<string, MessageKey> = {
  queued: 'simple.queue.capture.queued',
  needs_review: 'simple.queue.capture.needsReview',
  failed: 'simple.queue.capture.failed'
}

type T = ReturnType<typeof useT>
const DISCARDED: MessageKey = 'simple.queue.discarded' // i18n-technical

/** The proposal in one plain sentence (amounts by money.ts, dates in the reader's language). */
export function proposalSentence(p: QueueProposal, t: T): string {
  const key = WHAT[p.what]
  return t(key, { // i18n-technical: keys from the typed tables above
    party: p.partyName ?? t('simple.queue.someone'),
    amount: formatPaise(p.amount ?? 0, { symbol: true }),
    file: p.fileName ?? '',
    text: p.memoryText ?? ''
  })
}

function errorText(o: QueueOutcome, t: T): string {
  const m = mapError(o.error as CaughtError, { simple: true, t })
  return [m.general, ...Object.values(m.fields)].filter(Boolean).join(' ')
}

type Actions = ReturnType<typeof useQueueActions>

function Card({ p, actions, canSave, canWrite, onDone }: { p: QueueProposal; actions: Actions; canSave: boolean; canWrite: boolean; onDone: (o: QueueOutcome, ok: MessageKey) => void }): React.JSX.Element {
  const t = useT()
  const nav = useNav()
  const { approve, discard } = actions
  const busy = actions.busy.has(p.key)
  const lbl = (k: MessageKey): string => t(k) // i18n-technical: keys from the typed tables above
  const okKey: MessageKey = p.type === 'memory' ? 'simple.queue.approvedMemory' : 'simple.queue.approved' // i18n-technical
  const editKey: MessageKey = p.type === 'capture' ? 'simple.queue.open' : 'simple.queue.edit' // i18n-technical
  const edit = queueEditTarget(p, true)
  // A draft needs the posting right; a memory and a discard only a non-viewer.
  const mayApprove = oneClick(p) && (p.type === 'memory' ? canWrite : canSave)
  return (
    <li className="space-y-2 border-b border-line px-panel py-3 last:border-b-0" data-testid={`queue-card-${p.key}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-body font-medium text-ink">{proposalSentence(p, t)}</span>
        <Badge tone="neutral">{lbl(FROM[p.origin])}</Badge>
      </div>
      {p.date && <p className="text-hint text-muted">{t('simple.queue.dated', { date: toPlainDate(p.date, t.lang) })}</p>}
      {p.captureStatus && CAPTURE[p.captureStatus] && <p className="text-hint text-muted">{lbl(CAPTURE[p.captureStatus]!)}</p>}
      {p.unrequested && <Banner tone="warning">{t('simple.queue.unrequested')}</Banner>}
      {p.approve === 'edit' && <p className="text-hint text-muted">{t('simple.queue.needsEdit')}</p>}
      {p.approve === 'manual_number' && <p className="text-hint text-muted">{t('simple.queue.manualNumber')}</p>}
      {p.approve === 'changed' && <Banner tone="warning">{t('simple.queue.changed')}</Banner>}
      {p.approve === 'check' && <Banner tone="warning">{t('simple.queue.check')}</Banner>}
      {p.approve === 'tds' && <Banner tone="warning">{t('simple.queue.tds')}</Banner>}
      {p.approve === 'line_done' && <p className="text-hint text-muted">{t('simple.queue.lineDone')}</p>}
      {p.assumptions.length > 0 && (
        <details className="text-hint text-muted">
          <summary className="cursor-pointer">{t('simple.queue.details')}</summary>
          <p className="mt-1 font-medium">{t('simple.queue.assumed')}</p>
          <ul className="list-disc pl-5">
            {p.assumptions.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </details>
      )}
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          {mayApprove && (
            <Button size="sm" variant="primary" loading={busy} data-testid={`queue-approve-${p.key}`}
              onClick={() => void approve(p).then((o) => onDone(o, okKey))}>
              {t('simple.queue.approve')}
            </Button>
          )}
          {edit && p.approve !== 'line_done' && (
            <Button size="sm" data-testid={`queue-edit-${p.key}`} onClick={() => nav.go(edit)}>
              {lbl(editKey)}
            </Button>
          )}
          {p.type !== 'capture' && (
            <Button size="sm" variant="ghost" disabled={busy} data-testid={`queue-discard-${p.key}`}
              onClick={() => void discard(p).then((o) => onDone(o, DISCARDED))}>
              {t('simple.queue.discard')}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

export function ApprovalQueue(): React.JSX.Element {
  const t = useT()
  const toast = useToasts()
  const canSave = useCanSave()
  const canWrite = useCanWrite()
  const { data, isLoading } = useQueueList()
  const actions = useQueueActions()
  const { busy, approveAll } = actions
  const proposals = data?.proposals ?? []
  const onDone = (o: QueueOutcome, ok: MessageKey): void => {
    if (o.ok) toast.push('success', t(ok)) // i18n-technical: a key from the cards' typed table
    else toast.push('error', errorText(o, t))
  }
  const runAll = async (items: readonly QueueProposal[]): Promise<void> => {
    const out = await approveAll(items)
    const done = out.filter((o) => o.ok).length
    if (done === out.length) toast.push('success', t('simple.queue.approved'))
    else toast.push('warning', t('simple.queue.approvedSome', { done, count: out.length }))
  }

  return (
    <Page data-testid="simple-approvals">
      <header className="mb-4 space-y-1">
        <h1 className="font-serif text-heading font-semibold tracking-tight text-ink">{t('simple.queue.title')}</h1>
        <p className="text-body text-muted">{t('simple.queue.intro')}</p>
      </header>
      {isLoading && <SkeletonRows rows={4} />}
      {data && proposals.length === 0 && <EmptyTeach
          testId="simple-approvals-empty"
          purpose={t('simple.queue.emptyBody')}
          help="getting-started" // i18n-technical
        />}
      {groupProposals(proposals).map((g) => {
        const together = g.items.filter((p) => approvableTogether(p) && (p.type === 'memory' ? canWrite : canSave))
        return (
          <Panel key={g.group ?? g.items[0]!.key} className="mb-3" testId={g.group ? `queue-group-${g.group}` : undefined}>
            {g.group && (
              <div className="flex items-center justify-between gap-2 border-b border-line px-panel py-2">
                <span className="text-small font-medium text-ink">{t('simple.queue.together', { count: g.items.length })}</span>
                {together.length > 1 && (
                  <Button size="sm" variant="primary" disabled={busy.size > 0} data-testid={`queue-approve-all-${g.group}`} onClick={() => void runAll(together)}>
                    {t('simple.queue.approveAll', { count: together.length })}
                  </Button>
                )}
              </div>
            )}
            <ul>
              {g.items.map((p) => <Card key={p.key} p={p} actions={actions} canSave={canSave} canWrite={canWrite} onDone={onDone} />)}
            </ul>
          </Panel>
        )
      })}
    </Page>
  )
}
