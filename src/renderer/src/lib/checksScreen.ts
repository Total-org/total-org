// A13c (audit 2026-11 PROD-4): Analysis → Checks is ONE screen for the month-end close, anomalies,
// exception reports, stale documents and GST 2B mismatches. The three screens it replaced keep
// their names (saved links, chat answers, close-checklist fixes, help) — every navigation turns
// them into the matching Checks tab here, once (state/stores.ts nav.go / tryGo / replace), as the
// Day book's old links open Registers → All entries.
import type { Screen } from '../state/stores'

export type ChecksTab = 'close' | 'anomalies' | 'exceptions' | 'stale' | 'gst2b'

export const CHECKS_TABS: readonly ChecksTab[] = ['close', 'anomalies', 'exceptions', 'stale', 'gst2b']

/** The screen a navigation target opens: an old Assistants / Exceptions / Stale documents target
 *  becomes its Checks tab (Assistants keeps its tab and period); anything else is returned as is. */
export function canonicalScreen(s: Screen): Screen {
  switch (s.name) {
    case 'assistants':
      return { name: 'checks', ...(s.tab ? { tab: s.tab } : {}), ...(s.period ? { period: s.period } : {}) }
    case 'exceptions':
      return { name: 'checks', tab: 'exceptions' }
    case 'stale-documents':
      return { name: 'checks', tab: 'stale' }
    default:
      return s
  }
}
