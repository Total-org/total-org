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

/** The tabs this company sees: Stale documents only with `orders` on, GST 2B only when the
 *  business is GST-registered (the GSTR-2B screen's own rule). */
export function useChecksTabs(): { id: ChecksTab; label: string }[] {
  const features = useFeatures()
  const regType = useSession((s) => s.info?.gstRegistrationType)
  return TABS.filter((t) => (t.id !== 'stale' || features.orders) && (t.id !== 'gst2b' || screenApplies({ requiresGstRegistration: true }, regType)))
}

export function ChecksScreen({ tab, period }: { tab?: ChecksTab; period?: string }): React.JSX.Element {
  const nav = useNav()
  const tabs = useChecksTabs()
  // A tab this company doesn't see (Stale documents with orders off, an old link) opens the first.
  const active: ChecksTab = tabs.some((t) => t.id === tab) ? tab! : tabs[0]!.id
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
      {(active === 'close' || active === 'anomalies' || active === 'gst2b') && <AssistantsTab key={active} tab={active} period={period} tabs={bar} />}
      {active === 'exceptions' && <ExceptionsTab tabs={bar} />}
      {active === 'stale' && <StaleDocumentsTab tabs={bar} />}
    </Page>
  )
}
