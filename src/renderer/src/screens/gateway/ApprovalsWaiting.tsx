// Phase 5 — the approval queue first-class in the full app too: the Dashboard says how many
// proposals wait (the same `ai:queue` list simple Home's card and the Ask panel's "To approve"
// tab read) and opens the full approval queue. Renders nothing while none waits.
import { useQueueList } from '../../lib/approvalQueue'
import { useNav } from '../../state/stores'

export function ApprovalsWaiting(): React.JSX.Element | null {
  const nav = useNav()
  const { data } = useQueueList()
  if (!data || data.waiting === 0) return null
  return (
    <button
      type="button"
      data-testid="gateway-approvals"
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-amber/50 bg-panel px-4 py-2.5 text-left shadow-elev-1 hover:bg-panel2"
      onClick={() => nav.go({ name: 'ai-queue' })}
    >
      <span className="text-detail font-medium text-ink">
        {data.waiting} {data.waiting === 1 ? 'proposal is' : 'proposals are'} waiting for approval
      </span>
      <span className="t-link shrink-0 text-hint font-medium">Open the approval queue →</span>
    </button>
  )
}
