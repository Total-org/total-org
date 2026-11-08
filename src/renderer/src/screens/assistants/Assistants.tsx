// The WP 5.5 assistants — the month-end close checklist, GSTR-2B mismatch resolution, anomaly and
// duplicate detection — as tabs of Analysis → Checks (A13c; their own Assistants screen before).
// Every tab is computed by main (services/assistants.ts) and works with AI off; when the
// assistant is on, "Run with AI" opens the chat panel with the same assistant tool already run,
// so the answer starts from it.
import type { ReactNode } from 'react'
import { PageHeader } from '../../components/ui'
import { CloseTab } from './CloseTab'
import { Gst2bTab } from './Gst2bTab'
import { AnomaliesTab } from './AnomaliesTab'

export type AssistantTab = 'close' | 'gst2b' | 'anomalies'

const SUBTITLE: Record<AssistantTab, string> = {
  close: 'Everything to clear before the month is closed — computed from the books, with the screen that fixes each item.',
  gst2b: 'GSTR-2B against the purchase register: what is missing, what differs, and what to do — drafts only, nothing is posted.',
  anomalies: 'Possible duplicates and unusual entries, with the reason each was flagged.'
}

/** One assistant tab of Checks, with the page header (`tabs` = the Checks tab bar). */
export function AssistantsTab({ tab = 'close', period, tabs }: { tab?: AssistantTab; period?: string; tabs?: ReactNode }): React.JSX.Element {
  return (
    <>
      <PageHeader title="Checks" subtitle={SUBTITLE[tab]} tabs={tabs} />
      {tab === 'close' && <CloseTab initialPeriod={period} />}
      {tab === 'gst2b' && <Gst2bTab initialPeriod={period} />}
      {tab === 'anomalies' && <AnomaliesTab />}
    </>
  )
}
