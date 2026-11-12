// Audit A12 (HEALTH-4): what the per-area IPC files share with ipc.ts — the open company's shape,
// the `handle` signature (ipc.ts's role gate + { ok, data | error } envelope), the session
// accessors ipc.ts hands to them, and the small helpers several areas use. Moved out of ipc.ts.
import { app, BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import type { DB } from './db/connection'
import type { CompanyInfo } from '@shared/domain'
import type { CapabilityFlags } from '@shared/capabilities'
import type { Role } from './services/roles'
import { writeAudit } from './services/audit'
import { companyExportsDir } from './paths'
import { chooseExportPath, hermeticRun, type ExportTargetRequest } from './exportTarget'
import type { postIntent } from './services/simplePost'
import type { simpleIntentSchema } from '@shared/simple/intents'

export interface OpenCompany {
  slug: string
  db: DB
  info: CompanyInfo
  /** Cached usersExist(db) — recomputed only on open and after users:save/deactivate, so ordinary
   *  IPC calls (the vast majority) never pay for a COUNT query just to check the role gate. */
  usersExist: boolean
  /** WP 7.2: the file is encrypted (locked with a passphrase). */
  encrypted: boolean
}

export type Handler = (payload: unknown) => unknown | Promise<unknown>

/** ipc.ts's `handle`: registers `total:<channel>` behind the role gate (default accountant). */
export type IpcHandle = (channel: string, fn: Handler, minRole?: Role) => void

export interface SessionUser { id: number; name: string; role: Role; capabilities: CapabilityFlags | null }

/** The session state ipc.ts owns, read through accessors by the per-area files. */
export interface IpcContext {
  /** The open company, else 'No company is open'. */
  requireCompany: () => OpenCompany
  /** WP 7.2: the signed-in user's canSeeProfit (true with no users / no session). */
  canSeeProfitNow: () => boolean
  /** company:updateInfo is owner-only; in a company without users everyone may. */
  canChangeCompanyInfo: () => boolean
  /** The signed-in user, null with none. */
  sessionUser: () => SessionUser | null
}

/** simple:post's post (ipcSimple.ts), also used by the approval queue (ai:queue:approve, ipcVouchers.ts). */
export type PostSimpleIntent = (intent: z.infer<typeof simpleIntentSchema>, today: string | undefined, aiDraftId: number | undefined) => ReturnType<typeof postIntent>

export const idSchema = z.object({ id: z.number().int().positive() })
export const withIdSchema = <T extends z.ZodTypeAny>(schema: T) => z.object({ id: z.number().int().positive(), data: schema })

/** [lane-Q audit] one-line summary audit row for every file-export handler (task Q1 #90). */
export const auditExport = (db: DB, kind: string, detail: Record<string, unknown>): void =>
  writeAudit(db, 'export', 0, 'export', null, { kind, ...detail })

/** to-do §4: the labels PDF, CA pack and e-invoice JSON ask where to save (a native dialog that
 *  starts in `<company>/exports/` with the export's own name); hermetic runs skip it (exportTarget.ts). */
export const pickExportPath = (slug: string, req: Omit<ExportTargetRequest, 'exportsDir'>): Promise<string | null> =>
  chooseExportPath(
    { ...req, exportsDir: companyExportsDir(slug) },
    {
      hermetic: () => hermeticRun(process.env, app?.isPackaged ?? null),
      showSaveDialog: (opts) => {
        const win = BrowserWindow.getFocusedWindow?.()
        return win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts)
      }
    }
  )
