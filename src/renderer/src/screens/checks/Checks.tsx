// Analysis → Checks (A13c, audit 2026-11 PROD-4): ONE screen for what an accountant checks before
// closing a period — the month-end close checklist, anomalies and duplicates, the exception
// reports, stale trade documents (only while the trade cycle — feature `orders` — is on) and the
// GSTR-2B mismatches (registered businesses only, like the GSTR-2B screen). Each tab is the
// screen it replaced, unchanged: same services, IPC, figures, date control, saved views
// (DataTable viewIds) and options. The old names (`assistants`, `exceptions`, `stale-documents`)
// open the matching tab (lib/checksScreen.ts).
import { useNav, useSession } from '../../state/stores'
import { Page, TabBar } from '../../components/ui'
import { useFeatures } from '../../lib/useFeatures'
import { screenApplies } from '../../lib/screens'
import type { ChecksTab } from '../../lib/checksScreen'
import { AssistantsTab } from '../assistants/Assistants'
import { ExceptionsTab } from '../Exceptions'
import { StaleDocumentsTab } from '../TradeUnbilled'

const TABS: { id: ChecksTab; label: string }[] = [
  { id: 'close', label: 'Month-end close' },
  { id: 'anomalies', label: 'Anomalies' },
  { id: 'exceptions', label: 'Exceptions' },
  { id: 'stale', label: 'Stale documents' },
  { id: 'gst2b', label: 'GST 2B mismatches' }
]

/** The tabs this company sees: Stale documents only with `orders` on; GST 2B unless the business
 *  has never been GST-registered (review of #245: one whose registration was cancelled still
 *  reconciles its registered months — WP 8.0 dates the registration). */
export function useChecksTabs(): { id: ChecksTab; label: string }[] {
  const features = useFeatures()
  const regType = useSession((s) => s.info?.gstRegistrationType)
  const previous = useSession((s) => s.info?.gstPreviousRegistrationType)
  const everRegistered = screenApplies({ requiresGstRegistration: true }, regType) || (previous != null && previous !== 'unregistered')
  return TABS.filter((t) => (t.id !== 'stale' || features.orders) && (t.id !== 'gst2b' || everRegistered))
}

/** Why a tab a link asked for isn't shown here (said above the tab that opens instead). */
const HIDDEN_TAB_NOTE: Partial<Record<ChecksTab, string>> = {
  stale: 'Stale documents is part of quotations, orders and challans — turn it on in Settings → Features.',
  gst2b: 'GST 2B mismatches are only for a GST-registered business.'
}

export function ChecksScreen({ tab, period }: { tab?: ChecksTab; period?: string }): React.JSX.Element {
  const nav = useNav()
  const tabs = useChecksTabs()
  // A tab this company doesn't see (Stale documents with orders off, an old link) opens the first.
  const active: ChecksTab = tabs.some((t) => t.id === tab) ? tab! : tabs[0]!.id
  const hiddenNote = tab && tab !== active ? HIDDEN_TAB_NOTE[tab] : undefined
  const bar = (
    <TabBar
      screen="checks"
      label="Checks"
      tabs={tabs}
      active={active}
      onSelect={(t) => nav.replace({ name: 'checks', tab: t, ...(period ? { period } : {}) })}
    />
  )
  return (
    <Page width="wide">
      {hiddenNote && (
        <p role="status" className="mb-3 rounded-md border border-line bg-panel2 px-3 py-2 text-detail text-muted" data-testid="checks-hidden-tab">
          {hiddenNote}
        </p>
      )}
      {(active === 'close' || active === 'anomalies' || active === 'gst2b') && <AssistantsTab key={active} tab={active} period={period} tabs={bar} />}
      {active === 'exceptions' && <ExceptionsTab tabs={bar} />}
      {active === 'stale' && <StaleDocumentsTab tabs={bar} />}
    </Page>
  )
}
