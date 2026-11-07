// Phase 3b part 3 — the Ask panel's "To approve" tab: the approval queue inside the ONE panel, in
// both modes (the full list is the queue screen — Money → Things to approve, or the accountant's
// Approval queue).
import { DockedDrawer, Button } from '../../components/kit'
import { useT } from '../../lib/i18n'
import { useNav, type Screen } from '../../state/stores'
import { AskTabs, type AskTab } from './AskTabs'
import { AddBillsButton, QueueGroups } from './ApprovalQueue'

const FULL_SIMPLE: Screen = { name: 'simple-approvals' } // i18n-technical
const QUEUE_TAB: AskTab = 'queue' // i18n-technical
const FULL_ACCOUNTANT: Screen = { name: 'ai-queue' } // i18n-technical

export function QueueDrawer({ onClose, width, onResize, onTab, simple }: {
  onClose: () => void
  width: number
  onResize: (w: number) => void
  onTab: (tab: AskTab) => void
  simple: boolean
}): React.JSX.Element {
  const t = useT()
  const nav = useNav()
  const footer = (
    <div className="flex w-full items-center justify-between gap-2">
      <AddBillsButton />
      <Button size="sm" variant="ghost" data-testid="ask-queue-full" onClick={() => {
          // The full list needs the room: the panel steps aside (⌘J brings it back).
          onClose()
          nav.go(simple ? FULL_SIMPLE : FULL_ACCOUNTANT)
        }}>
        {t('simple.queue.openFull')} →
      </Button>
    </div>
  )
  return (
    <DockedDrawer title={t('simple.queue.title')} subtitle={t('simple.queue.intro')} onClose={onClose} width={width} onResize={onResize} testId="ask-queue-panel" header={<AskTabs active={QUEUE_TAB} onSelect={onTab} />} footer={footer}>
      <QueueGroups compact />
    </DockedDrawer>
  )
}
