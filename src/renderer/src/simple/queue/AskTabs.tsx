// Phase 3b part 3 — the ONE "Ask" panel's two tabs (audit PROD-1, owner 7 Nov): "Ask" (Total
// answers from the books first; the AI when a key is set) and "To approve" (the approval queue).
// The same strip heads every view of the panel in both modes (Ask Total, the AI conversation, the
// queue), so there is one door for everything the assistants do.
import { TabBar } from '../../components/kit'
import { useT } from '../../lib/i18n'
import { useQueueList } from '../../lib/approvalQueue'

export type AskTab = 'ask' | 'queue'
const ASK: AskTab = 'ask' // i18n-technical
const QUEUE: AskTab = 'queue' // i18n-technical

export function AskTabs({ active, onSelect }: { active: AskTab; onSelect: (tab: AskTab) => void }): React.JSX.Element {
  const t = useT()
  const { data } = useQueueList()
  const waiting = data?.waiting ?? 0
  return (
    <TabBar
      screen="ai-queue" // i18n-technical: the testid area (tab-ai-queue-ask / tab-ai-queue-queue)
      label={t('assist.tab.label')}
      tabs={[
        { id: ASK, label: t('assist.tab.ask') },
        { id: QUEUE, label: t('assist.tab.queue'), ...(waiting ? { count: waiting } : {}) }
      ]}
      active={active}
      onSelect={onSelect}
    />
  )
}
