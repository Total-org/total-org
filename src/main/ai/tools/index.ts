// The app's tool set: WP 5.1 read tools over the report services, WP 5.2 screen tools (current
// screen data, explain this, and the read tools the screens expose), the WP 5.5 assistants
// (close checklist, GSTR-2B mismatches, anomalies, the 2B draft), WP 5.4
// categorise_statement (capture/tools.ts), the WP 5.3 draft tools (every voucher kind —
// drafting/tools.ts), WP 5.6 `remember` (proposes a memory) and Phase 3b `plan_task` (a task →
// a plan of proposals in the approval queue).
import { READ_TOOLS } from './readTools'
import { SCREEN_TOOLS } from './screenTools'
import { ASSISTANT_TOOLS } from './assistantTools'
import { DRAFT_TOOLS } from '../drafting/tools'
import { rememberTool } from '../memory'
import { ToolRegistry } from './registry'
import { categoriseStatementTool } from '../capture/tools'
import { planTaskTool } from './planTools'

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry([...READ_TOOLS, ...SCREEN_TOOLS, ...ASSISTANT_TOOLS, categoriseStatementTool, ...DRAFT_TOOLS, rememberTool, planTaskTool])
}
