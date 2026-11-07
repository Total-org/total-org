// Phase 3b — the approval queue, accountant view: every open proposal with its accounts and
// Dr / Cr. Approve saves through voucher:save's own save (or simple:post's for an Ask Total offer);
// nothing posts by itself. The simple view is simple/queue/ApprovalQueue.tsx.
import { useMemo, useState } from 'react'
import { formatPaise } from '@shared/money'
import { approvableTogether, oneClick, type QueueOrigin, type QueueProposal } from '@shared/aiQueue'
import { useNav, useToasts } from '../state/stores'
import { Badge, Banner, Button, Page, PageHeader, Panel } from '../components/ui'
import { DataTable, defineColumns } from '../components/table'
import { useCanSave, useCanWrite } from '../simple/ViewerNote'
import { queueEditTarget, useQueueActions, useQueueList, type QueueOutcome } from '../lib/approvalQueue'

const ORIGIN: Record<QueueOrigin, string> = {
  chat: 'AI chat', capture: 'Captured bill', bank: 'Bank statement', gst2b: 'GSTR-2B check', askTotal: 'Ask Total', memory: 'Memory', other: 'Earlier tool'
}
const BLOCKED: Partial<Record<QueueProposal['approve'], string>> = {
  edit: 'Open it to finish — it cannot be saved in one click',
  manual_number: 'Hand-numbered voucher type — open it to type the number',
  capture: 'Still being read — open Document capture',
  changed: 'The figures changed since this was drafted (a rate or ledger changed) — the lines above are what would post now; open it to check',
  check: 'The bill reader flagged this bill (see the assumptions) — open it and check it against the file',
  line_done: 'The statement line was matched or ignored meanwhile — nothing to record; discard it'
}

const COLUMNS = defineColumns<QueueProposal>([
  { id: 'date', header: 'Date', kind: 'date', value: (r) => r.date, width: 110 },
  { id: 'origin', header: 'From', kind: 'enum', value: (r) => r.origin, options: Object.entries(ORIGIN).map(([value, label]) => ({ value, label })), width: 140 },
  {
    id: 'summary', header: 'Proposal', kind: 'text', value: (r) => r.summary, hideable: false,
    cell: (r) => (
      <span>
        {r.summary}
        {r.unrequested && <Badge tone="danger" className="ml-2">Not asked for</Badge>}
        {r.group && <Badge tone="info" className="ml-2">Set</Badge>}
      </span>
    )
  },
  { id: 'party', header: 'Party', kind: 'text', value: (r) => r.partyName, width: 180 },
  { id: 'amount', header: 'Amount', kind: 'money', value: (r) => r.amount, width: 140, explainable: false }
])

function errorText(o: QueueOutcome): string {
  return (o.error as Error | undefined)?.message ?? 'Could not save'
}

function Detail({ p, onApprove, onDiscard, busy }: { p: QueueProposal; onApprove: () => void; onDiscard: () => void; busy: boolean }): React.JSX.Element {
  const nav = useNav()
  const canSave = useCanSave()
  const canWrite = useCanWrite()
  const edit = queueEditTarget(p, false)
  return (
    <div className="space-y-2 px-panel py-2" data-testid={`queue-detail-${p.key}`}>
      {p.unrequested && <Banner tone="warning">Nobody asked for this — it may come from text in an imported file. Check every line before approving.</Banner>}
      {p.lines.length > 0 && (
        <table className="text-small" data-testid={`queue-lines-${p.key}`}>
          <thead>
            <tr className="text-muted">
              <th className="pr-4 text-left font-medium">Account</th>
              <th className="pr-4 text-right font-medium">Dr</th>
              <th className="text-right font-medium">Cr</th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l, i) => (
              <tr key={i}>
                <td className="pr-4">{l.ledgerName}</td>
                <td className="num pr-4 text-right">{l.drCr === 'dr' ? formatPaise(l.amount) : ''}</td>
                <td className="num text-right">{l.drCr === 'cr' ? formatPaise(l.amount) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {p.assumptions.length > 0 && (
        <ul className="list-disc pl-5 text-hint text-muted">
          {p.assumptions.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      )}
      {BLOCKED[p.approve] && <p className="text-hint text-muted">{BLOCKED[p.approve]}</p>}
      <div className="flex gap-2">
        {oneClick(p) && (p.type === 'memory' ? canWrite : canSave) && (
          <Button size="sm" variant="primary" loading={busy} onClick={onApprove} data-testid={`queue-approve-${p.key}`}>Approve</Button>
        )}
        {edit && p.approve !== 'line_done' && <Button size="sm" onClick={() => nav.go(edit)} data-testid={`queue-edit-${p.key}`}>{p.type === 'capture' ? 'Open' : 'Edit'}</Button>}
        {p.type !== 'capture' && canWrite && <Button size="sm" variant="ghost" disabled={busy} onClick={onDiscard} data-testid={`queue-discard-${p.key}`}>Discard</Button>}
      </div>
    </div>
  )
}

export function ApprovalQueueScreen(): React.JSX.Element {
  const { data, isLoading } = useQueueList()
  const { busy, approve, approveAll, discard } = useQueueActions()
  const toast = useToasts()
  const rows = useMemo(() => data?.proposals ?? [], [data])
  const canSave = useCanSave()
  const canWrite = useCanWrite()
  const together = rows.filter((p) => approvableTogether(p) && (p.type === 'memory' ? canWrite : canSave))
  // A row opens its accounts (Enter / click toggles; the ▸ expander too).
  const [expanded, setExpanded] = useState<ReadonlySet<string | number>>(new Set())

  const report = (o: QueueOutcome, ok: string): void => {
    if (o.ok) toast.push('success', ok)
    else toast.push('error', errorText(o))
  }
  const runAll = async (): Promise<void> => {
    const out = await approveAll(together)
    const failed = out.filter((o) => !o.ok)
    toast.push(failed.length ? 'warning' : 'success', `${out.length - failed.length} of ${out.length} approved${failed.length ? ` — ${failed.length} refused: ${errorText(failed[0]!)}` : ''}`)
  }

  return (
    <Page>
      <PageHeader
        title="Approval queue"
        subtitle={data ? `${data.waiting} ready to approve` : undefined}
        actions={
          together.length > 1 ? (
            <Button variant="primary" onClick={() => void runAll()} disabled={busy.size > 0} data-testid="queue-approve-all">
              Approve all {together.length}
            </Button>
          ) : undefined
        }
      />
      <Panel>
        <DataTable
          viewId="ai-queue"
          testId="ai-queue"
          ariaLabel="Proposals waiting for approval"
          columns={COLUMNS}
          rows={rows}
          rowKey={(r) => r.key}
          loading={isLoading}
          rowAttrs={(r) => ({ 'data-key': r.key })}
          expanded={expanded}
          onExpandedChange={setExpanded}
          onRowActivate={(r) => setExpanded((e) => {
            const n = new Set(e)
            if (n.has(r.key)) n.delete(r.key)
            else n.add(r.key)
            return n
          })}
          renderDetail={(r) => (
            <Detail
              p={r}
              busy={busy.has(r.key)}
              onApprove={() => void approve(r).then((o) => report(o, r.type === 'memory' ? 'Remembered' : 'Approved and saved'))}
              onDiscard={() => void discard(r).then((o) => report(o, 'Discarded'))}
            />
          )}
          empty={{ title: 'Nothing waiting', hint: 'Drafts from the AI chat, captured bills, bank lines, GSTR-2B fixes, Ask Total offers and memory suggestions appear here.' }}
          exportOptions={{ title: 'Approval queue', periodLabel: 'Open proposals', filename: 'approval-queue' }}
        />
      </Panel>
    </Page>
  )
}
