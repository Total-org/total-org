// IPC channels for the agent bridge (read-only CSV / JSON mirrors). Registered from ipc.ts with its
// `handle` (role gate + { ok, data | error } envelope); every payload is Zod-parsed here, every write
// channel is mapped in auditCoverage.ts. Split out of ipc.ts by audit A12 (HEALTH-4) — the handlers were
// moved, not rewritten (scripts/ipc-handlers-diff.mjs compares them with origin/main).
import { z } from 'zod'
import * as configSvc from './services/config'
import * as aiStore from './ai/store'
import * as agentBridge from './services/agentBridge'
import { agentBridgeConfigSchema, agentExportSchema } from '@shared/schemas'
import { auditExport, type IpcContext, type IpcHandle } from './ipcCommon'

export function registerAgentBridgeIpc(handle: IpcHandle, { requireCompany, canSeeProfitNow }: IpcContext): void {
  // ---------- agent bridge (read-only CSV/JSON mirrors, lane A) ----------
  handle('agent:exportMirror', (p) => {
    const input = agentExportSchema.parse(p ?? {})
    const c = requireCompany()
    const r = agentBridge.exportMirror(c.db, c.slug, { ...input, canSeeProfit: canSeeProfitNow() })
    auditExport(c.db, 'agent_mirror', { dir: r.dir, files: r.files.length })
    return r
  })
  handle('agent:getConfig', () => {
    const db = requireCompany().db
    // `locked`: a passphrase-locked business gets no mirror (Settings says so; audit A3).
    return { enabled: configSvc.getAgentBridgeEnabled(db), locked: !agentBridge.mirrorAllowed(db) }
  }, 'viewer')
  handle('agent:setConfig', (p) => {
    const { enabled } = agentBridgeConfigSchema.parse(p)
    const c = requireCompany()
    configSvc.setAgentBridgeEnabled(c.db, enabled)
    if (!enabled) agentBridge.cancelMirrorRefresh()
    return { enabled }
  }, 'owner')

  // Drafts the removed MCP server / agent inbox made (WP 5.7) stay readable until each is saved or
  // discarded — Settings → Agent access lists any that are left.
  handle('agent:drafts', (p) => {
    const { status } = z.object({ status: z.enum(['open', 'consumed', 'discarded']).optional() }).prefault({}).parse(p ?? {})
    return aiStore.listDrafts(requireCompany().db, status, undefined, ['mcp', 'inbox'])
  }, 'viewer')
}
