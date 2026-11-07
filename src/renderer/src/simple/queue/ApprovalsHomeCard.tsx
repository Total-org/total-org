// Phase 3b: Home's "N things wait for your approval" — shown only while the queue holds a proposal
// Approve can save in one click; opens Money → Things to approve.
import { useT } from '../../lib/i18n'
import { useNav } from '../../state/stores'
import { useQueueList } from '../../lib/approvalQueue'

const QUEUE = { name: 'simple-approvals' } as const // i18n-technical

export function ApprovalsHomeCard(): React.JSX.Element | null {
  const t = useT()
  const nav = useNav()
  const { data } = useQueueList()
  if (!data || data.waiting === 0) return null
  return (
    <button
      type="button"
      data-testid="simple-home-approvals"
      className="mt-5 flex w-full items-center justify-between gap-3 rounded-lg border border-amber/50 bg-panel p-panel text-left shadow-elev-1 hover:bg-panel2"
      onClick={() => nav.go(QUEUE)}
    >
      <span className="text-detail font-medium text-ink">{t('simple.queue.homeWaiting', { count: data.waiting })}</span>
      <span className="shrink-0 text-hint text-blue">{t('simple.queue.open')} →</span>
    </button>
  )
}
