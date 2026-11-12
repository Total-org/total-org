import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { checkSender, firstRefusalOf } from './ipcSender'
import { allowedHelpUrl } from '@shared/helpLinks'
import { nextRegistrationFacts } from '@shared/gst/registration'
import { copyFileSync, rmSync, unlinkSync, mkdtempSync, existsSync, appendFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, basename } from 'path'
import { z } from 'zod'
import { forgetFolderKey, isEncryptedFile, keyForPath, keyOfHandle, openDb, plainCopy, rekeyFile, removeDbFiles, rememberFolderKey } from './db/encryption'
import { DEFAULT_SCRYPT, WrongPassphraseError, newDataKey, unwrapKeyAsync, wrapKeyAsync, type ScryptParams } from './db/keyEnvelope'
import { insecureTestCipherAllowed } from './services/secrets'
import { assertNotThrottled, dropRememberedKey, hasRememberedKey, noteRightPassphrase, noteWrongPassphrase, readEnvelope, readEnvelopes, removeEnvelope, storeRememberedKey, unlockCompanyKey, unlockWithRememberedKey, writeEnvelope } from './services/companyKeys'
import { commitConvertedCopy, convertBackups, convertCompanyFiles, fileConversionPending, markFileConversion, prepareConvertedCopy, removeLeftoverCopies, resumeFileConversion } from './services/dbEncryption'
import { settleOpenBackup, snapshotOnOpen, type OpenBackupSettled } from './services/backupOpen'
import { checkBackupIfDue, latestBackupCheck, listBackupChecks, recordBackupCheck, verifyBackupFileAsync } from './services/backupVerify'
import { AUTO_LOCK_CHOICES, IdleClock, getAutoLockMinutes, setAutoLockMinutes } from './services/sessionLock'
import { capabilityAllows, channelCapabilities } from './capabilities'
import { effectiveCapabilities, type Capability, type CapabilityFlags } from '@shared/capabilities'
import type { BackupCheck } from '@shared/backupCheck'
import type { SecurityView } from '@shared/security'
import { quietWaitMs } from './quietWait'
import type { DB } from './db/connection'
import { backupCompany, closeCompanyDb, openCompanyDb, stashBackupAttachments } from './db/connection'
import { assertNotNewer } from './db/migrate'
import * as attachments from './services/attachments'
import { embedAttachments, restoreAttachmentFiles, restoreAttachmentFilesAt, type RestoreFilesResult, type StashResult } from './db/attachmentBackup'
import { listBackupsIn, restoreCompanyDb, rollbackRestore, backupStamp, runWeeklyIntegrityCheckAsync, type BackupInfo } from './db/backup'
import { checkIntegrity, checkIntegrityAsync, QUICK_CHECK_TIMED_OUT } from './db/integrity'
import { stopAllChecks, stopChecks, stopChecksUnder } from './db/checkHost'
import { encryptFile, decryptFile } from './db/crypt'
import { readCompanyInfo, seedCompany, writeCompanyInfo } from './db/seed'
import { readRegistry, removeCompany, touchLastOpened, upsertCompany } from './registry'
import { companyAttachmentsDir, companyBackupAttachmentsDir, companyBackupsDir, companyDbPath, companyDir, companyExportsDir, dataRoot, ensureCompanyTree, slugify } from './paths'
import { log, revealLogs } from './log'
import { checkForUpdatesInteractive, setAutoCheck, updateAction, updatesView } from './updater'
import { UPDATE_ACTIONS, updatesCanSet, type UpdatesCanSet } from '@shared/updates'
import { backupFileSchema, companyCreateSchema, isoDate, notifyDeadlinesSchema, passphraseSchema, rendererLogSchema } from '@shared/schemas'
import { todayISO } from '@shared/dates'
import { AppError, structuredOf, type StructuredError } from '@shared/errors'
import { zod3Issues } from '@shared/zodMessages'
import * as configSvc from './services/config'
import * as vouchers from './services/vouchers'
import { homeAsOn } from './services/simpleHome'
import * as nic from './services/nic'
import { companySlugSchema } from '@shared/schemas'
import { registerPayrollStatutoryIpc } from './ipcPayrollStatutory'
import { registerPricingIpc } from './ipcPricing'
import { registerReportsIpc } from './ipcReports'
import { registerAiIpc, aiRuns, type AppKeyAuditEntry } from './ai/ipc'
import { useAiProviderSource } from './ai/providerConfig'
import { readAiProviderSetting, writeAiProviderSetting } from './services/appSettings'
import { registerCaptureIpc, captureOnCompanyOpen, captureOnCompanyClose, resumeCapture } from './ai/capture/ipc'
import { registerAssistantsIpc } from './ipcAssistants'
import { registerGatewayIpc } from './ipcGateway'
import { resetGatewaySessions } from './gstGateway'
import { registerAskTotalIpc } from './assist/ipc'
import { classify as classifyAsk } from './assist/classify'
import { assistAskSchema, type AssistAnswer } from '@shared/assist'
import { translator } from '@shared/i18n'
import { companyLanguage } from './i18n'
import { aiMockAllowed } from './ai/env'
import { appSecretStore } from './services/secretStore'
import type { AiEvent } from '@shared/ai'
import { registerReceivablesIpc } from './ipcReceivables'
import { UI_MODES, uiPatchSchema } from '@shared/simple/uiMode'
import { registerPayablesIpc } from './ipcPayables'
import { registerBankingIpc } from './ipcBanking'
import { registerCashFinanceIpc } from './ipcCashFinance'
import { registerWorkspaceIpc } from './ipcWorkspace'
import { registerDataRootIpc } from './ipcDataRoot'
import { registerDataImportIpc, clearLoadedImports } from './ipcDataImport'
import { registerSimpleIpc } from './ipcSimple'
import { registerVouchersIpc } from './ipcVouchers'
import { registerMastersIpc } from './ipcMasters'
import { registerTradeIpc } from './ipcTrade'
import { registerInventoryIpc } from './ipcInventory'
import { registerReportScreensIpc } from './ipcReportScreens'
import { registerGstIpc } from './ipcGst'
import { registerTdsIpc } from './ipcTds'
import { registerBankRecoIpc } from './ipcBankReco'
import { registerPrintingIpc } from './ipcPrinting'
import { registerPayrollIpc } from './ipcPayroll'
import { registerImportExportIpc } from './ipcImportExport'
import { registerNicIpc } from './ipcNic'
import { registerAuditIpc } from './ipcAudit'
import { registerAgentBridgeIpc } from './ipcAgentBridge'
import * as agentBridge from './services/agentBridge'
import { MASTERS_CHANGED_EVENT, changedEntitiesOf } from './masterEvents'
import { createDemoCompany } from './services/demo'
import { setAuditContext, writeAudit, pruneAudit, verifyAudit, runAsAuditUser, osAuditUser, SYSTEM_AUDIT_USER } from './services/audit'
import * as users from './services/users'
import { assertDeleteAuthorized, auditCompanyDeletion } from './services/companyDelete'
import { roleAllows, type Role } from './services/roles'
import { userInputSchema, authLoginSchema } from '@shared/schemas'
import type { CompanyInfo } from '@shared/domain'
import { auditExport, idSchema, type Handler, type IpcContext, type OpenCompany } from './ipcCommon'

export type { OpenCompany } from './ipcCommon'

let current: OpenCompany | null = null

/** WP 7.2: the passphrase KDF cost — the real one, except in a hermetic test run that already
 *  uses the insecure test cipher (TOTAL_INSECURE_TEST_SECRETS + TOTAL_DATA_DIR, never packaged),
 *  where the cheapest cost the envelope accepts keeps e2e fast. */
function scryptParams(): ScryptParams {
  return insecureTestCipherAllowed(process.env, app.isPackaged) ? { N: 2 ** 14, r: 8, p: 1 } : DEFAULT_SCRYPT
}

/** WP 7.2: the session's idle clock (auto-lock minutes from the open company's meta). */
const idleClock = new IdleClock(null)

/** WP 7.2: wrong passphrases per company slug — 5 in a row lock the prompt for 30 seconds (in
 *  memory: the passphrase cannot be checked against anything inside the locked file). */
// The wrong-passphrase counter is shared with total-cli (companyKeys.ts).


/** The signed-in user for the currently-open company, or null before login / after logout.
 *  Cleared whenever the company itself closes (see closeCurrentCompany). */
let sessionUser: { id: number; name: string; role: Role; capabilities: CapabilityFlags | null } | null = null

/** WP 7.2 follow-up: the screen lock of a business WITHOUT users (⌘L / its idle minutes) — a
 *  privacy screen: every gated channel is refused until `session:unlock`, which asks for the
 *  business's passphrase when the passphrase lock is on and otherwise just resumes. In memory
 *  only (a restart opens unlocked, as a company without users always did). */
let privacyLock: 'manual' | 'idle' | null = null

/** "Remember on this computer" ticked at the passphrase prompt of a business WITH people: the key
 *  is stored only once an OWNER signs in to this open (auth:login); any other sign-in, or closing
 *  the business, drops the request. In memory only — the key itself is the folder's session key. */
let pendingRemember: string | null = null

/** What the lock screen asks for: a PIN (people), the passphrase, or nothing (a privacy screen). */
type LockKind = 'pin' | 'passphrase' | 'privacy'
const lockKindOf = (c: OpenCompany): LockKind => (c.usersExist ? 'pin' : c.encrypted ? 'passphrase' : 'privacy')

function lockPrivacy(reason: 'manual' | 'idle'): void {
  if (!current || current.usersExist || privacyLock) return
  try {
    writeAudit(current.db, 'user', 0, 'logout', null, { lock: reason, noUsers: true })
  } catch (err) {
    log('warn', 'session-lock-audit-failed', { error: err instanceof Error ? err.message : String(err) })
  }
  privacyLock = reason
  const kind = lockKindOf(current)
  for (const w of BrowserWindow.getAllWindows?.() ?? []) if (!w.isDestroyed()) w.webContents.send('total:session:locked', { reason, kind })
}

/** WP 7.2: sign the session out because of a lock (⌘L / idle); audited as the user's logout with
 *  the reason, and every window told so it shows the PIN screen. */
function lockSession(reason: 'manual' | 'idle'): void {
  if (!current || !sessionUser) return
  try {
    writeAudit(current.db, 'user', sessionUser.id, 'logout', null, { lock: reason })
  } catch (err) {
    log('warn', 'session-lock-audit-failed', { error: err instanceof Error ? err.message : String(err) })
  }
  sessionUser = null
  for (const w of BrowserWindow.getAllWindows?.() ?? []) if (!w.isDestroyed()) w.webContents.send('total:session:locked', { reason, kind: 'pin' })
}

/** IPC calls running now, and when the last one started or ended (Date.now()) — the deferred
 *  backup check waits for a quiet moment (see scheduleBackupCheck). */
let ipcInFlight = 0
let lastIpcAt = 0
/** The open's restore check copies, migrates and verifies the whole file on the main thread
 *  (~1–2 s at 100k on a fast machine, far more on a loaded one): it waits until no IPC call has
 *  run for this long, so the screen that just opened (Home) gets its reads answered first. */
export const BACKUP_CHECK_QUIET_MS = 2_000
/** …but never longer than this after the backup, however busy the app is. */
export const BACKUP_CHECK_LATEST_MS = 60_000

/** WP 7.2: the automatic restore check of a backup that was just written — deferred a few
 *  seconds so it never delays the reply that triggered the backup, then (launch to Home) until
 *  the app is quiet — no IPC call for BACKUP_CHECK_QUIET_MS — or BACKUP_CHECK_LATEST_MS have
 *  passed, so Home's reads are not queued behind it; skipped when not due (at most daily for
 *  automatic backups) or when the company was closed meanwhile. What it checks is unchanged. */
export function scheduleBackupCheck(db: DB, dest: string, tag: string): void {
  const scheduledAt = Date.now()
  const later = (ms: number): void => {
    const t = setTimeout(tick, ms)
    t.unref?.()
  }
  const tick = (): void => {
    const wait = quietWaitMs({
      now: Date.now(), scheduledAt, inFlight: ipcInFlight, lastActivityAt: lastIpcAt,
      quietMs: BACKUP_CHECK_QUIET_MS, latestMs: BACKUP_CHECK_LATEST_MS
    })
    if (wait > 0) later(wait)
    else void run()
  }
  const run = async (): Promise<void> => {
    const t0 = performance.now()
    try {
      // The check itself runs in the check worker; main only records the verdict.
      const check = await checkBackupIfDue(db, dest, tag, todayISO(), SYSTEM_AUDIT_USER)
      if (check && !check.ok) log('warn', 'backup-check-failed', { file: check.file, error: check.error })
    } catch (err) {
      log('warn', 'backup-check-error', { error: err instanceof Error ? err.message : String(err) })
    }
    // Wall time of the check (off the main thread where the worker file exists) — the launch trace shows it.
    if (TRACE_IPC) console.log(`[ipc] (timer) backup check ${(performance.now() - t0).toFixed(0)} ms`)
  }
  later(3_000)
}

/** To-do §4: the open backup's second half (services/backupOpen.ts) — its quick_check verdict,
 *  then the prune and the bin purge — running after company:open replied. One at a time: a new
 *  open, a close, a restore, a delete, a lock change or a data-folder move cancels it first. */
interface OpenFollowUp {
  db: DB
  dest: string
  /** The copy whose quick_check runs now (the open's own, or an earlier one being re-checked). */
  checking: string
  cancelled: boolean
  done: Promise<OpenBackupSettled | null>
}
let openFollowUp: OpenFollowUp | null = null

/** Tests (and the launch trace): the pending open follow-up, or null. */
export function pendingOpenFollowUp(): Promise<OpenBackupSettled | null> | null {
  return openFollowUp?.done ?? null
}

/** Cancel the open follow-up: it writes, prunes and purges nothing more, and its quick_check is
 *  stopped (stopChecks on the backup it reads) and waited for. */
async function cancelOpenFollowUp(): Promise<void> {
  const f = openFollowUp
  if (!f) return
  f.cancelled = true
  // PR #175 review: the check running may be the re-check of an EARLIER copy, not this open's.
  await Promise.all([stopChecks(f.dest), f.checking !== f.dest ? stopChecks(f.checking) : undefined])
  await f.done
}

/** The signed-in user's view of themselves (auth:login / auth:current): role, flags and the
 *  effective capabilities the gate applies. */
function sessionView(u: { id: number; name: string; role: Role; capabilities: CapabilityFlags | null }): { id: number; name: string; role: Role; capabilities: CapabilityFlags | null; can: Record<Capability, boolean> } {
  return { ...u, can: effectiveCapabilities(u.role, u.capabilities) }
}

/** Whether the current session may see profit figures (dashboards / Home leave them out otherwise). */
export function canSeeProfitNow(): boolean {
  if (!current?.usersExist || !sessionUser) return true
  return effectiveCapabilities(sessionUser.role, sessionUser.capabilities).canSeeProfit
}

/** company:updateInfo is owner-only; in a company without users everyone may. */
function canChangeCompanyInfo(): boolean {
  return !current?.usersExist || sessionUser?.role === 'owner'
}

function requireCompany(): OpenCompany {
  if (!current) throw new Error('No company is open')
  return current
}

/** Accessor for the currently-open company, used by the backup scheduler (backup-scheduler.ts). */
export function getCurrentCompany(): OpenCompany | null {
  return current
}

/** Move a file into place. Copy+delete rather than fs.renameSync, since the source (os.tmpdir())
 *  and destination (~/Documents/total) may be on different filesystems (EXDEV). */
function renameFile(src: string, dest: string): void {
  rmSync(dest, { force: true })
  copyFileSync(src, dest)
  unlinkSync(src)
}

/** Whether a company file (not the open one) has active users — read-only peek for the AI key guard. */
function companyHasUsers(dbPath: string): boolean {
  if (!existsSync(dbPath)) return false
  try {
    const d = openDb(dbPath, { readonly: true, fileMustExist: true })
    try {
      return ((d.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get() as { n: number }).n ?? 0) > 0
    } finally {
      d.close()
    }
  } catch {
    // Unreadable (encrypted, older schema): assume users exist — the safe answer for the guard.
    return true
  }
}

/** Whether any company in the data root other than the open one (every company when none is open —
 *  the company-select screen) has active users. ONE helper for every app-wide setting guarded by the
 *  AI-key rule: the shared AI key (ai:key:set) and the update setting (app:updates:set / act). */
function otherCompanyHasUsers(): boolean {
  return readRegistry().companies.some((co) => co.slug !== current?.slug && companyHasUsers(companyDbPath(co.slug)))
}

/** App-level, append-only record of API key changes (WP 5.1) — beside secrets.json, outside
 *  every company (the key is shared by all of them). */
function appendAiKeyAudit(entry: AppKeyAuditEntry): void {
  appendFileSync(join(dataRoot(), 'ai-key-audit.jsonl'), `${JSON.stringify({ ...entry, appVersion: app.getVersion() })}\n`, { mode: 0o600 })
}

export function closeCurrentCompany(opts: { keepKey?: boolean } = {}): void {
  // WP 7.2: a business locked with a passphrase asks for it again on its next open — its key is
  // forgotten with the handle (a restore / a lock change reopens it at once and keeps it).
  if (current && !opts.keepKey) forgetFolderKey(companyDir(current.slug))
  idleClock.setMinutes(null)
  privacyLock = null
  pendingRemember = null
  // Stop any pending mirror refresh before the handle closes under it.
  agentBridge.cancelMirrorRefresh()
  // The cached NIC login belongs to this company's identity — never carry it into the next one.
  nic.resetNicSession()
  resetGatewaySessions()
  // In-flight AI answers belong to this company's handle — stop them before it closes.
  aiRuns.cancelAll()
  // WP 5.4: the capture queue runner and the capture-inbox watcher, too.
  captureOnCompanyClose()
  // WP 6.3: a file loaded into the import wizard never carries over to another company.
  clearLoadedImports()
  // To-do §4: the open backup's verdict no longer belongs to an open company — nothing more is
  // pruned or purged (its quick_check may finish on its own; a quit leaves the copy unverified).
  if (openFollowUp) openFollowUp.cancelled = true
  if (current) {
    closeCompanyDb(current.db)
    current = null
  }
  sessionUser = null
}

/** Channels reachable before a company is open, or otherwise never role-gated: the company
 *  picker, the auth flow itself (you have to be able to call auth:login before you're "in"),
 *  logging, and the encrypted-backup import dialog. Everything else is gated by `handle`'s
 *  `minRole` — but only once a company is open AND that company actually has users (see below). */
const UNGATED_CHANNELS = new Set([
  // WP 7.2 follow-up: the unlock of a business without users (it refuses one with users).
  'session:unlock',
  'company:list',
  'company:create',
  'company:createDemo',
  'company:delete',
  'company:open',
  'company:current',
  // "Remember on this computer" at the picker: presence of a remembered key, and Forget (which only
  // takes the convenience away — the passphrase still opens the books).
  'company:remembered',
  'company:forgetRemembered',
  // Deliberate: a locked session (or one with no session at all) must still be able to back
  // out to the company picker rather than getting stuck behind the gate it can't pass.
  'company:close',
  'auth:users',
  'auth:login',
  'auth:logout',
  'auth:current',
  'log:renderer',
  'log:reveal',
  'backup:importEncrypted',
  'app:info'
])

/** Every registered channel and its minimum role — read by the audit-coverage registry dbtest
 *  (auditCoverage.dbtest.ts) so a new write channel cannot ship without an audit mapping. */
export const CHANNEL_ROLES = new Map<string, Role>()

/** The ungated channels (exported for the same registry test — several of them write). */
export const UNGATED_CHANNEL_NAMES: ReadonlySet<string> = UNGATED_CHANNELS

/** WP 7.2: channel → the capability flag that governs it (capabilities.ts), built once. */
let capabilityMap: Map<string, Capability> | null = null
export function channelCapabilityMap(): Map<string, Capability> {
  capabilityMap ??= channelCapabilities(UNGATED_CHANNELS)
  return capabilityMap
}

/** The structured fields of a failed call (WP 8.5): an AppError's own; a Zod failure as
 *  'invalid_input' with one 'zod.<code>' issue per path (the `data` wrapper of `{ id, data }` /
 *  voucher:save payloads stripped); a UNIQUE clash on a name column as 'duplicate_name'. */
export function ipcStructuredError(err: unknown): Partial<StructuredError> {
  const own = structuredOf(err)
  if (own) return own
  if (err instanceof z.ZodError) {
    return {
      code: 'invalid_input',
      issues: zod3Issues(err.issues).map((i) => {
        const path = i.path[0] === 'data' ? i.path.slice(1) : i.path
        return { code: `zod.${i.code}`, ...(path.length ? { field: path.join('.') } : {}), message: `${i.path.map(String).join('.')}: ${i.message}` }
      })
    }
  }
  const sqlite = err as { code?: unknown; message?: unknown }
  if (sqlite?.code === 'SQLITE_CONSTRAINT_UNIQUE' && typeof sqlite.message === 'string') {
    const column = /UNIQUE constraint failed: \w+\.(\w+)/.exec(sqlite.message)?.[1]
    if (column === 'name') return { code: 'duplicate_name', field: 'name' }
  }
  return {}
}

/** WP 7.1: TOTAL_IPC_TRACE=1 (scratch data dir only) prints each handler's duration to stdout —
 *  scripts/perf-launch.mjs reads it to say where opening a big company goes. Channel names only. */
const TRACE_IPC = process.env.TOTAL_IPC_TRACE === '1' && !!process.env.TOTAL_DATA_DIR

/** to-do §4: after a write that can change masters, every window refetches those cached lists
 *  (masterEvents.ts) — so a screen sees an item created elsewhere without being reopened. The
 *  feature cleanup adds 'features' for a write that can make a hidden feature used. */
function notifyMastersChanged(channel: string): void {
  const entities = changedEntitiesOf(channel)
  if (!entities.length) return
  // The write has committed: a window that is going away must never turn it into a failed call
  // (the renderer would show an error for a saved change and a retry would save it twice).
  try {
    for (const w of BrowserWindow.getAllWindows?.() ?? []) if (!w.isDestroyed()) w.webContents.send(MASTERS_CHANGED_EVENT, { entities })
  } catch (err) {
    log('warn', 'masters-changed', { channel, error: err instanceof Error ? err.message : String(err) })
  }
}

function handle(channel: string, fn: Handler, minRole: Role = 'accountant'): void {
  CHANNEL_ROLES.set(channel, minRole)
  ipcMain.handle(`total:${channel}`, async (event, payload: unknown) => {
    // D7: only the app's own renderer (main frame, out/renderer/index.html or the dev server) may
    // call — checked before anything else, the payload included (ipcSender.ts).
    const sender = checkSender(event)
    if (!sender.ok) {
      const seen = firstRefusalOf(event, sender.reason)
      if (seen.first) log('warn', 'ipc-sender-refused', { channel, reason: sender.reason, scheme: seen.scheme, host: seen.host, senderId: seen.senderId })
      return { ok: false, error: 'You do not have permission to do that', code: 'not_permitted' }
    }
    const t0 = TRACE_IPC ? performance.now() : 0
    ipcInFlight++
    lastIpcAt = Date.now()
    try {
      // Role gating is a no-op until a company is open AND that company has at least one user
      // (usersExist is cached on `current` — see OpenCompany — to avoid a COUNT query per call).
      // A brand-new company with zero users is intentionally wide open: that's how the very
      // first (owner) user gets created via users:save without a chicken-and-egg deadlock.
      // WP 7.2: an idle session past its auto-lock minutes is locked here, before the gate — main
      // decides, so a renderer that missed the lock event cannot keep using the session.
      if (current && current.usersExist && sessionUser && idleClock.due()) lockSession('idle')
      if (current && !current.usersExist && !privacyLock && idleClock.due()) lockPrivacy('idle')
      // A business without users whose screen is locked: everything but the ungated channels
      // (the picker, session:unlock) waits for session:unlock.
      if (!UNGATED_CHANNELS.has(channel) && current && !current.usersExist && privacyLock) {
        throw new AppError('session_locked', 'Locked — unlock first')
      }
      if (!UNGATED_CHANNELS.has(channel) && current && current.usersExist) {
        if (!sessionUser) {
          // Distinct from the role-denied case below: the renderer can route this specifically
          // to the lock screen instead of a generic permission toast.
          throw new AppError('session_locked', 'Locked — sign in first')
        }
        // WP 7.2: a channel governed by a capability flag follows the user's flag (none set = the
        // role, exactly as before); every other channel follows the role alone.
        const cap = channelCapabilityMap().get(channel)
        const allowed = cap ? capabilityAllows(sessionUser.role, sessionUser.capabilities, cap, minRole) : roleAllows(sessionUser.role, minRole)
        if (!allowed) {
          throw new AppError('not_permitted', 'You do not have permission to do that')
        }
      }
      const data = await fn(payload)
      notifyMastersChanged(channel)
      if (TRACE_IPC) console.log(`[ipc] ${channel} ${(performance.now() - t0).toFixed(0)} ms`)
      return { ok: true, data }
    } catch (err) {
      if (TRACE_IPC) console.log(`[ipc] ${channel} failed ${(performance.now() - t0).toFixed(0)} ms`)
      const message = err instanceof z.ZodError
        ? zod3Issues(err.issues).map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ')
        : err instanceof Error
          ? err.message
          : String(err)
      // Never log payloads — only the channel name and the error message.
      log('error', 'ipc-handler', { channel, error: message })
      // WP 8.5: the structured part (code / field / params / issues) rides next to the message
      // so a screen can show a plain message under the field; `error` is unchanged.
      return { ok: false, error: message, ...ipcStructuredError(err) }
    } finally {
      ipcInFlight--
      lastIpcAt = Date.now()
    }
  })
}

export function registerIpc(): void {
  // WP 3.8 user attribution: the signed-in user (id + name). With no session the writer falls back
  // to the OS login ('os:<name>') — only reachable in a company without users, since a company
  // with users refuses every gated channel until someone signs in.
  setAuditContext({ appVersion: app.getVersion(), getUserName: () => sessionUser?.name ?? null, getUserId: () => sessionUser?.id ?? null })

  // WP 7.2: the auto-lock fires on its own too (not only at the next call), so the PIN screen
  // comes back while the app sits idle.
  const idleTimer = setInterval(() => {
    if (current && current.usersExist && sessionUser && idleClock.due()) lockSession('idle')
    if (current && !current.usersExist && !privacyLock && idleClock.due()) lockPrivacy('idle')
  }, 15_000)
  idleTimer.unref?.()

  // Audit A12: the session state the per-area files (ipcSimple.ts, ipcVouchers.ts …) read.
  const ctx: IpcContext = { requireCompany, canSeeProfitNow, canChangeCompanyInfo, sessionUser: () => sessionUser }

  // ---------- payroll statutory (WP 3.7) — channels live in ipcPayrollStatutory.ts ----------
  registerPayrollStatutoryIpc(handle, () => requireCompany())
  registerPricingIpc(handle, () => requireCompany())
  // ---------- comparatives, ratios (WP 6.2) ----------
  registerReportsIpc(handle, () => requireCompany())
  // ---------- AI agent (WP 5.1) — channels live in ai/ipc.ts; events stream on 'total:ai:event' ----------
  useAiProviderSource({
    read: () => readAiProviderSetting(dataRoot()),
    write: (next, who) => writeAiProviderSetting(dataRoot(), next, who, app.getVersion())
  })
  registerAiIpc(handle, {
    company: () => requireCompany(),
    session: () => (sessionUser ? { name: sessionUser.name, role: sessionUser.role } : { name: null, role: 'owner' }),
    // A company with users and nobody signed in has no role (the run stops at its next tool call).
    roleNow: () => (sessionUser ? sessionUser.role : current?.usersExist ? null : 'owner'),
    canSeeProfit: canSeeProfitNow,
    secrets: () => appSecretStore(),
    anyCompanyHasUsers: otherCompanyHasUsers,
    appAudit: (entry) => appendAiKeyAudit(entry),
    emit: (e: AiEvent) => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('total:ai:event', e)
    },
    mock: () => aiMockAllowed(process.env, app.isPackaged)
  })
  // ---------- document capture (WP 5.4) — channels live in ai/capture/ipc.ts ----------
  registerCaptureIpc(handle, {
    company: () => requireCompany(),
    session: () => (sessionUser ? { name: sessionUser.name, role: sessionUser.role } : { name: null, role: 'owner' }),
    secrets: () => appSecretStore(),
    mock: () => aiMockAllowed(process.env, app.isPackaged)
  })
  // ---------- assistants (WP 5.5): close checklist, anomalies, GSTR-2B mismatches — ipcAssistants.ts ----------
  registerAssistantsIpc(handle, () => requireCompany(), () => sessionUser?.name ?? osAuditUser())
  // ---------- GST gateway (Phase 4): IRN / e-way bill / GSTR-1 / 3B / 2B through one adapter — ipcGateway.ts ----------
  registerGatewayIpc(handle, () => requireCompany(), () => sessionUser?.name ?? osAuditUser())
  // ---------- Ask Total (WP 10.1): deterministic answers + entry drafts, no key — assist/ipc.ts ----------
  // WP 7.2: a profit question from a user who may not see profit gets the redaction note — the
  // deterministic classifier reads the question exactly as assist:ask does (Hinglish included).
  const askTotalHandle = (channel: string, fn: Handler, minRole?: Role): void =>
    handle(channel, channel === 'assist:ask' ? (p) => profitHiddenAnswer(p) ?? fn(p) : fn, minRole)
  const profitHiddenAnswer = (payload: unknown): AssistAnswer | null => {
    if (canSeeProfitNow()) return null
    const q = assistAskSchema.parse(payload)
    const intent = classifyAsk(q.text, homeAsOn(q.today, todayISO()))
    if (intent.kind !== 'figure' || intent.measure !== 'profit') return null
    const t = translator(q.lang ?? companyLanguage(requireCompany().db))
    return { intent: 'figure', answeredBy: 'total', sentences: [t('assist.profitHidden')], figures: [], links: [], understood: true }
  }
  registerAskTotalIpc(askTotalHandle, {
    company: () => requireCompany(),
    roleNow: () => (sessionUser ? sessionUser.role : current?.usersExist ? null : 'owner'),
    userNow: () => sessionUser?.id ?? null
  })
  // ---------- receivables (WP 4.2) — channels live in ipcReceivables.ts ----------
  registerReceivablesIpc(handle, () => requireCompany())
  // ---------- payables (WP 4.3) — channels live in ipcPayables.ts ----------
  registerPayablesIpc(handle, () => requireCompany())
  // ---------- banking depth (WP 4.1) — channels live in ipcBanking.ts ----------
  registerBankingIpc(handle, () => requireCompany())
  // ---------- cash and finance (WP 4.4) — channels live in ipcCashFinance.ts ----------
  registerCashFinanceIpc(handle, () => requireCompany())
  // ---------- bulk edit, attachments, party notes (WP 6.4) — channels live in ipcWorkspace.ts ----------
  registerWorkspaceIpc(handle, () => requireCompany(), canSeeProfitNow)
  // Settings → "Where Total keeps your books" (app-level, owner where the company has users).
  registerDataRootIpc(handle, {
    closeCompany: async () => {
      closeCurrentCompany()
      // Every background check, not only the company file's: backup checks read files in the folder too.
      await stopAllChecks()
    },
    who: () => sessionUser?.name ?? null
  })
  // ---------- Excel export, import wizard, books workbook (WP 6.3) — ipcDataImport.ts ----------
  registerDataImportIpc(handle, () => requireCompany(), { canChangeCompanyInfo, userName: () => sessionUser?.name ?? null })

  // ---------- company ----------
  handle('company:list', () => readRegistry())

  handle('company:create', (payload) => {
    // WP 8.1: `mode` picks the company's mode; omitted = accountant (the default until the WP 8.3
    // setup wizard), which writes no `ui` meta at all — a missing key means accountant.
    const { mode, ...input } = companyCreateSchema.extend({ mode: z.enum(UI_MODES).optional() }).parse(payload)
    let slug = slugify(input.name)
    let n = 2
    while (existsSync(companyDbPath(slug))) slug = `${slugify(input.name)}-${n++}`
    ensureCompanyTree(slug)
    const db = openCompanyDb(slug)
    const info: CompanyInfo = { ...input }
    seedCompany(db, info)
    writeAudit(db, 'company', 0, 'create', null, info)
    if (mode === 'simple') configSvc.setUi(db, { mode })
    db.close()
    upsertCompany({ slug, name: input.name, stateCode: input.stateCode, gstin: input.gstin, lastOpenedAt: null })
    return { slug }
  })

  // ---------- simple mode flows (WP 8.3 – 9.9) — ipcSimple.ts ----------
  const { postSimpleIntent } = registerSimpleIpc(handle, ctx)

  // WP 8.3: `mode` 'simple' = the wizard's "Try with sample data" (D2); omitted = accountant, as before.
  handle('company:createDemo', (payload) =>
    createDemoCompany(z.object({ mode: z.enum(UI_MODES).optional() }).optional().parse(payload)?.mode)
  )

  handle('company:delete', async (payload) => {
    const { slug, confirmName, pin, passphrase } = z
      .object({
        slug: companySlugSchema,
        confirmName: z.string(),
        pin: z.string().regex(/^\d{4,12}$/, 'PIN must be 4-12 digits').optional(),
        passphrase: z.string().max(1024).optional()
      })
      .parse(payload)
    const reg = readRegistry()
    const company = reg.companies.find((c) => c.slug === slug)
    if (!company) throw new Error('Company not found')
    if (confirmName !== company.name) throw new Error('Company name does not match')
    // Audit A3 (SEC-8): company:delete is ungated (the picker deletes before anything is open), so
    // the privacy screen of a business without people must refuse it itself — unlock first, or
    // switch business (which closes the books and forgets their key).
    if (privacyLock) throw new AppError('session_locked', 'This business is locked — unlock it, or switch business, before deleting one')
    // WP 7.2 review: a business locked with a passphrase cannot be read for its owners' PINs until
    // it is unlocked — without this, locking the books took away the PIN that protects the delete
    // (the unreadable file was treated as "no users"). The passphrase is asked first (throttled
    // like opening); once it opens the file the PIN check below runs as for any business.
    // Audit A3 (SEC-8): ALWAYS — a key already in memory (the business is open) or remembered on
    // this computer never stands in for the passphrase when the books and every backup go.
    const keyWasKnown = keyForPath(companyDbPath(slug)) !== null
    // (No key file anywhere = nobody can ever read these books again: nothing left to protect.)
    if (readEnvelopes(companyDir(slug), slug, appSecretStore()).length) await unlockFolderIfNeeded(slug, passphrase, { useRemembered: false, evenIfKnown: true })
    // The name check above protects nothing by itself — it's readable off the same screen it's
    // typed into. If this company has users, an active owner's PIN is required too.
    try {
      assertDeleteAuthorized(companyDbPath(slug), pin)
    } catch (err) {
      // A refused delete leaves the business as locked as it was.
      if (!keyWasKnown) forgetFolderKey(companyDir(slug))
      throw err
    }
    // [lane-Q audit] durable record in the app log (survives the rmSync) + best-effort tombstone
    // row inside the DB itself.
    auditCompanyDeletion(companyDbPath(slug), slug, sessionUser?.name ?? null)
    log('warn', 'company-deleted', { slug, user: sessionUser?.name ?? null })
    if (current?.slug === slug) {
      // To-do §4: the open backup's pending check is stopped with the rest (stopChecksUnder below).
      await cancelOpenFollowUp()
      closeCurrentCompany()
    }
    forgetFolderKey(companyDir(slug))
    // WP 7.1 review: a background check (the weekly integrity_check, a backup's restore check) may
    // still hold a file in the folder open.
    await stopChecksUnder(companyDir(slug))
    rmSync(companyDir(slug), { recursive: true, force: true })
    removeCompany(slug)
    // Secrets live outside the company folder; drop them so a future company reusing this slug
    // starts clean. Best-effort — a secret-store failure must not fail a completed delete.
    try {
      nic.deleteNicSecrets(slug)
    } catch (err) {
      log('warn', 'company-delete-secrets-failed', { slug, error: err instanceof Error ? err.message : String(err) })
    }
    return null
  })

  handle('company:open', async (payload) => {
    const { slug, passphrase, remember } = z
      .object({ slug: companySlugSchema, passphrase: z.string().max(1024).optional(), remember: z.boolean().optional() })
      .parse(payload)
    // Audit A3 (SEC-3): only a business on this computer's list — never a folder elsewhere on disk.
    knownSlug(slug)
    if (!existsSync(companyDbPath(slug))) throw new Error('Company database not found')
    // WP 7.2: a business locked with a passphrase needs it (its key is unwrapped and remembered
    // for this open); a plaintext one opens exactly as before — no prompt, nothing asked. The
    // business open until now is closed first (its key forgotten).
    closeCurrentCompany()
    const via = await unlockFolderIfNeeded(slug, passphrase)
    const opened = await openCompanyNow(slug)
    // "Remember on this computer" (ticked at the prompt, the passphrase just proved right): stored
    // at once in a business without people (whoever opens it is its owner), else once an owner
    // signs in (auth:login). Never fails the open.
    let rememberResult: 'saved' | 'pending' | 'unavailable' | undefined
    if (remember && via === 'passphrase' && current?.slug === slug) {
      if (!current.usersExist) rememberResult = rememberOpenKey(current, null)
      else {
        pendingRemember = slug
        rememberResult = 'pending'
      }
    }
    return { ...opened, openedWith: via ?? undefined, ...(rememberResult ? { remember: rememberResult } : {}) }
  })

  /** Audit A3 (SEC-3): refuse a slug that is not in the registry (company:delete checks it itself). */
  function knownSlug(slug: string): void {
    if (!readRegistry().companies.some((c) => c.slug === slug)) throw new Error('Company not found')
  }

  /** Store the open company's key as remembered on this computer, audited ('security', no key in
   *  the row). 'unavailable' without secure storage. */
  function rememberOpenKey(c: OpenCompany, user: string | null): 'saved' | 'unavailable' {
    const key = keyOfHandle(c.db)
    if (!key) return 'unavailable'
    const had = hasRememberedKey(c.slug, appSecretStore())
    try {
      storeRememberedKey(c.slug, key, appSecretStore())
    } catch (err) {
      log('warn', 'remember-key-unavailable', { slug: c.slug, error: err instanceof Error ? err.message : String(err) })
      return 'unavailable'
    }
    if (!had) writeAudit(c.db, 'security', 0, 'update', { rememberedOnThisComputer: false }, { rememberedOnThisComputer: true }, user ? { user } : {})
    return 'saved'
  }

  /**
   * Throttled passphrase unlock of a company folder (no-op when plaintext or already unlocked).
   * Without a passphrase the key remembered on this computer is tried first (accepted only once it
   * opens the file); a remembered key that no longer does is dropped and `remembered_key_stale`
   * asks for the passphrase. Returns how the folder was unlocked (null = nothing to unlock).
   */
  async function unlockFolderIfNeeded(slug: string, passphrase: string | undefined, opts: { useRemembered?: boolean; evenIfKnown?: boolean } = {}): Promise<'passphrase' | 'remembered' | null> {
    const dbPath = companyDbPath(slug)
    // `evenIfKnown` (company:delete, audit A3): the passphrase is checked although the key is
    // already in memory — the key it gives is the same one, remembered again.
    if (!isEncryptedFile(dbPath) || (keyForPath(dbPath) && !opts.evenIfKnown)) return null
    if (!passphrase && opts.useRemembered !== false) {
      const r = unlockWithRememberedKey(slug, dbPath, appSecretStore())
      if (r.key) {
        rememberFolderKey(companyDir(slug), r.key)
        return 'remembered'
      }
      if (r.dropped) {
        log('warn', 'remembered-key-dropped', { slug })
        throw new AppError('remembered_key_stale', 'The passphrase remembered on this computer no longer opens these books, so Total forgot it — type the passphrase', { field: 'passphrase' })
      }
    }
    const key = await unlockCompanyKey({
      slug, dbPath, companyDir: companyDir(slug), passphrase, store: appSecretStore(),
      onWrong: (fails) => log('warn', 'passphrase-wrong', { slug, fails })
    })
    rememberFolderKey(companyDir(slug), key)
    return 'passphrase'
  }

  // "Remember on this computer" from the company picker: which businesses have a remembered key
  // (presence only — never the key), and Forget. Forgetting only takes a convenience away (the
  // passphrase still opens the books), so the picker may do it before anyone signs in; it is
  // audited inside the books when the remembered key still opens them.
  handle('company:remembered', () => readRegistry().companies.map((c) => c.slug).filter((slug) => hasRememberedKey(slug, appSecretStore())))
  handle('company:forgetRemembered', (payload) => {
    const { slug } = z.object({ slug: companySlugSchema }).strict().parse(payload)
    knownSlug(slug)
    if (current?.slug === slug) {
      // The open business: Settings → Security's Forget (owner) is the way.
      if (current.usersExist && sessionUser?.role !== 'owner') throw new AppError('not_permitted', 'You do not have permission to do that')
      forgetRememberedOf(current, sessionUser?.name ?? null)
      return null
    }
    const key = readRememberedKeyOf(slug)
    if (!key) return null
    let db: DB | null = null
    try {
      db = openDb(companyDbPath(slug), { key, fileMustExist: true })
      writeAudit(db, 'security', 0, 'update', { rememberedOnThisComputer: true }, { rememberedOnThisComputer: false, from: 'picker' })
    } catch (err) {
      log('warn', 'forget-remembered-audit-failed', { slug, error: err instanceof Error ? err.message : String(err) })
    } finally {
      db?.close()
    }
    dropRememberedKey(slug, appSecretStore())
    return null
  })
  const readRememberedKeyOf = (slug: string): Buffer | null => (hasRememberedKey(slug, appSecretStore()) ? unlockWithRememberedKey(slug, companyDbPath(slug), appSecretStore()).key : null)
  /** Forget the open company's remembered key, audited when there was one. */
  function forgetRememberedOf(c: OpenCompany, user: string | null): void {
    pendingRemember = null
    if (dropRememberedKey(c.slug, appSecretStore())) {
      writeAudit(c.db, 'security', 0, 'update', { rememberedOnThisComputer: true }, { rememberedOnThisComputer: false }, user ? { user } : {})
    }
  }

  /** Open `slug` as the current company (the key, if any, already remembered) and run the
   *  on-open housekeeping — company:open, and the passphrase on / off flows that reopen the file. */
  /** The open backup's second half, after company:open replied (see openCompanyNow). */
  function startOpenFollowUp(db: DB, slug: string, dest: string): void {
    const f: OpenFollowUp = { db, dest, checking: dest, cancelled: false, done: Promise.resolve(null) }
    const stillCurrent = (): boolean => !f.cancelled && current?.db === db
    f.done = new Promise<void>((r) => setImmediate(r)).then(async () => {
      const t0 = performance.now()
      try {
        const settled = await settleOpenBackup(db, slug, dest, { stillCurrent, onCheck: (p) => { f.checking = p } })
        if (TRACE_IPC) console.log(`[ipc] (after reply) open backup check ${settled.verdict} ${(performance.now() - t0).toFixed(0)} ms`)
        if (settled.verdict === 'damaged') log('warn', 'backup-on-open-failed', { slug, error: 'quick_check failed — the snapshot was discarded' })
        else if (settled.verdict === 'unverified') log('warn', 'backup-on-open-unverified', { slug, file: basename(dest) })
        for (const r of settled.rechecked) if (r.verdict !== 'ok') log('warn', 'backup-recheck', { slug, file: r.file, verdict: r.verdict })
        if (!stillCurrent()) return settled
        if (settled.verdict === 'ok') openHousekeeping(db, slug)
        // WP 7.2: the automatic restore check (at most daily, again after a failure).
        if (settled.verdict === 'ok' || settled.verdict === 'unverified') scheduleBackupCheck(db, dest, 'open')
        return settled
      } catch (err) {
        log('warn', 'backup-on-open-check-error', { slug, error: err instanceof Error ? err.message : String(err) })
        return null
      } finally {
        if (openFollowUp === f) openFollowUp = null
      }
    })
    openFollowUp = f
  }

  /** What rests on a backup that passed its quick_check: the bin purge (binned over 30 days) and,
   *  WP 6.4, the attachments of purged records (and stored files nothing references). Runs as
   *  'system' in the audit trail — nobody asked for it — and never fails anything. */
  function openHousekeeping(db: DB, slug: string): void {
    try {
      const purged = runAsAuditUser(SYSTEM_AUDIT_USER, () => vouchers.purgeOldDeleted(db, 30))
      if (purged > 0) log('info', 'bin-purge', { purged })
    } catch (err) {
      // e.g. an over-age binned voucher still referenced by payroll_runs — housekeeping must
      // never block opening the company.
      log('warn', 'bin-purge-failed', { slug, error: err instanceof Error ? err.message : String(err) })
    }
    try {
      const swept = runAsAuditUser(SYSTEM_AUDIT_USER, () => attachments.sweepAttachments(db, companyAttachmentsDir(slug)))
      if (swept.rowsRemoved || swept.filesRemoved) log('info', 'attachments-sweep', { ...swept })
    } catch (err) {
      log('warn', 'attachments-sweep-failed', { slug, error: err instanceof Error ? err.message : String(err) })
    }
  }

  /** What the last open's file-conversion resume did (convertOpenCompany reports it). */
  let lastFileResume: { converted: number; failed: string[] } | null = null
  async function openCompanyNow(slug: string, opts: { keepKey?: boolean } = {}): Promise<{ slug: string; info: CompanyInfo; integrity: ReturnType<typeof checkIntegrity>; locked: boolean; ui: ReturnType<typeof configSvc.getUi>; encrypted: boolean }> {
    closeCurrentCompany({ keepKey: opts.keepKey ?? true })
    // To-do §4: a previous open's backup check still running is stopped before this one starts.
    await cancelOpenFollowUp()
    // WP 7.2 review: what an interrupted lock change / restore / export left beside the books
    // (a plaintext copy, when the lock was being taken off) goes before the books open.
    try {
      removeLeftoverCopies(companyDbPath(slug), companyBackupsDir(slug), companyExportsDir(slug))
    } catch (err) {
      log('warn', 'leftover-copies-not-removed', { slug, error: err instanceof Error ? err.message : String(err) })
    }
    const t0 = performance.now()
    const mark = (step: string): void => {
      if (TRACE_IPC) console.log(`[ipc] company:open/${step} ${(performance.now() - t0).toFixed(0)} ms`)
    }
    const db = openCompanyDb(slug)
    mark('db')
    const info = readCompanyInfo(db)
    current = { slug, db, info, usersExist: users.usersExist(db), encrypted: keyOfHandle(db) !== null }
    idleClock.setMinutes(getAutoLockMinutes(db))
    // A lock change interrupted while its files were being converted: finish it toward the books'
    // own form (the key is known now — the books just opened with it).
    lastFileResume = null
    try {
      const resumed = resumeFileConversion(companyDir(slug), keyOfHandle(db))
      lastFileResume = resumed
      if (resumed) log(resumed.failed.length ? 'warn' : 'info', 'security-files-resumed', { slug, converted: resumed.converted, failed: resumed.failed.length })
    } catch (err) {
      log('warn', 'security-files-resume-failed', { slug, error: err instanceof Error ? err.message : String(err) })
    }
    // Audit A3: a business locked with a passphrase keeps no plaintext agent mirror on disk.
    if (agentBridge.removeMirrorIfLocked(db, slug)) log('info', 'agent-mirror-removed-locked', { slug })
    // Online backup needs an open handle, so this runs after open (not before, as it used to).
    // A backup failure here must never fail — or desync — the open itself.
    // To-do §4 (PR #118 review): only the SNAPSHOT is waited for here — it is what protects the
    // books. Its quick_check runs after the reply (in the check worker, tracked under the backup),
    // and what rests on a good backup waits for that verdict: the prune of older backups and the
    // bin purge + attachment sweep (services/backupOpen.ts). No snapshot → none of them this time.
    const snapshotDone = snapshotOnOpen(db, slug).then(
      (dest) => {
        mark('snapshot')
        return dest
      },
      (err: unknown) => {
        log('warn', 'backup-on-open-failed', { slug, error: err instanceof Error ? err.message : String(err) })
        return null
      }
    )
    const integrityDone = checkIntegrityAsync(db, companyDbPath(slug)).finally(() => mark('integrity'))
    const dest = await snapshotDone
    const integrity = await integrityDone
    if (!integrity.ok) {
      log('warn', 'integrity', { slug, quickCheck: integrity.quickCheck, unbalanced: integrity.unbalancedVoucherIds })
    } else if (integrity.quickCheck === QUICK_CHECK_TIMED_OUT) {
      // The open went on without the quick_check (OPEN_QUICK_CHECK_TIMEOUT_MS); the weekly
      // integrity_check below still covers the file.
      log('warn', 'integrity-quick-check-timeout', { slug })
    }
    // [lane-Q] scheduled weekly FULL integrity check (task Q3 #99) — the check above is the cheap
    // quick_check; this one is `PRAGMA integrity_check`, throttled to once per 7 days via meta.
    // WP 7.1: it only ever logs, so it runs in a worker thread and the open does not wait for it.
    void runWeeklyIntegrityCheckAsync(db, companyDbPath(slug)).then((weekly) => {
      if (weekly?.ran && !weekly.ok) log('warn', 'integrity-weekly-failed', { slug, detail: weekly.detail })
    })
    if (dest) startOpenFollowUp(db, slug, dest)
    // Post-dated vouchers whose date has arrived flip into the books (audited per voucher).
    // PDCs dated inside a locked period are refused, not silently posted — they stay in the
    // PDC register until the lock is lifted (v0.3 review F3).
    const { matured, blockedByLock, blockedByHold } = runAsAuditUser(SYSTEM_AUDIT_USER, () => vouchers.maturePostDated(db, todayISO()))
    mark('mature')
    if (matured.length > 0) log('info', 'pdc-mature', { count: matured.length, ids: matured })
    if (blockedByLock.length > 0) {
      log('warn', 'pdc-mature-blocked-by-lock', { count: blockedByLock.length, ids: blockedByLock })
    }
    if (blockedByHold?.length) log('warn', 'pdc-mature-blocked-by-hold', { count: blockedByHold.length, ids: blockedByHold })
    // [lane-Q audit, WP 3.8] retention: only when the company is NOT flagged audit-trail-required
    // (default: required → never pruned) and a window is set; never inside the s.128(5) floor.
    // pruneAudit logs its own 'prune' row as 'system'.
    const auditKeepDays = configSvc.getAuditKeepDays(db)
    if (auditKeepDays !== null) {
      try {
        const prunedAudit = pruneAudit(db, auditKeepDays)
        if (prunedAudit > 0) log('info', 'audit-prune', { pruned: prunedAudit, keepDays: auditKeepDays })
      } catch (err) {
        log('warn', 'audit-prune-failed', { slug, error: err instanceof Error ? err.message : String(err) })
      }
    }
    mark('prune')
    touchLastOpened(slug)
    // WP 5.4: interrupted capture work back to the approved queue; the capture inbox watched.
    try {
      captureOnCompanyOpen({ slug, db, usersExist: current.usersExist })
    } catch (err) {
      log('warn', 'capture-open-failed', { slug, error: err instanceof Error ? err.message : String(err) })
    }
    mark('capture')
    return { slug, info, integrity, locked: current.usersExist, ui: configSvc.getUi(db), encrypted: current.encrypted }
  }

  handle('company:close', () => {
    closeCurrentCompany()
    return null
  })

  handle('company:current', () =>
    current
      ? {
          slug: current.slug,
          info: current.info,
          locked: (current.usersExist && !sessionUser) || (!current.usersExist && !!privacyLock),
          lockKind: lockKindOf(current),
          ui: configSvc.getUi(current.db),
          encrypted: current.encrypted
        }
      : null
  )

  // ---------- company mode (WP 8.1): meta `ui` — simple / accountant, setup answers, language ----------
  // Read with the open payload too; `ui:get` refreshes it. `ui:mode:set` (plan §6) is owner-only to
  // change (everyone in a company without users), audited as a company update.
  handle('ui:get', () => configSvc.getUi(requireCompany().db), 'viewer')
  handle('ui:mode:set', (payload) => configSvc.setUi(requireCompany().db, uiPatchSchema.parse(payload)), 'owner')

  handle('company:updateInfo', (payload) => {
    const c = requireCompany()
    const before = c.info
    const input = companyCreateSchema.parse(payload)
    // WP 8.0: a changed registration takes effect from the given date (default today) and keeps
    // the type it replaces, so vouchers and returns of the earlier months keep their GST.
    const { gstRegistrationSince, gstPreviousRegistrationType: _prev, ...rest } = input
    const info: CompanyInfo = {
      ...rest,
      ...nextRegistrationFacts(before, input.gstRegistrationType, gstRegistrationSince, todayISO()),
      // WP 8.3: set by setup, not edited here.
      ...(before.booksBeginDate ? { booksBeginDate: before.booksBeginDate } : {})
    }
    writeCompanyInfo(c.db, info)
    c.info = info
    upsertCompany({ slug: c.slug, name: info.name, stateCode: info.stateCode, gstin: info.gstin, lastOpenedAt: new Date().toISOString() })
    writeAudit(c.db, 'company', 0, 'update', before, info)
    return info
  }, 'owner')

  const runManualBackup = async (): Promise<{ path: string; check: BackupCheck | null }> => {
    const c = requireCompany()
    const path = await backupCompany(c.db, c.slug, 'manual', sessionUser?.name ?? osAuditUser())
    // WP 7.2: a backup the user asked for is restore-checked at once (the answer comes back with it).
    let check: BackupCheck | null = null
    try {
      check = await checkBackupIfDue(c.db, path, 'manual', todayISO())
    } catch (err) {
      log('warn', 'backup-check-error', { error: err instanceof Error ? err.message : String(err) })
    }
    return { path, check }
  }
  // 'company:backup' is kept as an alias of 'backup:run' for existing callers.
  handle('company:backup', runManualBackup)

  handle('company:revealExports', () => {
    const c = requireCompany()
    shell.openPath(companyExportsDir(c.slug))
    return null
  })

  handle('company:lock:get', () => ({ date: vouchers.getLockDate(requireCompany().db) }), 'viewer')
  handle('company:lock:set', (payload) => {
    const { date } = z.object({ date: isoDate.nullable() }).parse(payload)
    vouchers.setLockDate(requireCompany().db, date)
    return { date }
  }, 'owner')

  // ---------- year-end close, vouchers (save / undo / bin / approval queue), outstanding bills — ipcVouchers.ts ----------
  registerVouchersIpc(handle, ctx, postSimpleIntent)

  // ---------- backups: list/run/restore + encrypted export/import ----------
  handle('backup:list', (): BackupInfo[] => {
    const c = requireCompany()
    return listBackupsIn(companyBackupsDir(c.slug))
  }, 'viewer')

  handle('backup:run', runManualBackup)

  // Gate polish: "Show in Finder" for the simple Backups screen — a backup file of THIS company
  // (by name, the restore's own file schema, so nothing outside its backups folder) or the folder.
  handle('backup:reveal', (payload) => {
    const { file } = z.object({ file: backupFileSchema.optional() }).strict().parse(payload ?? {})
    const dir = companyBackupsDir(requireCompany().slug)
    const path = file ? join(dir, file) : dir
    if (file && existsSync(path)) shell.showItemInFolder(path)
    else void shell.openPath(dir)
    return null
  }, 'viewer')

  handle('backup:restore', async (payload) => {
    const { file } = z.object({ file: backupFileSchema }).parse(payload)
    const c = requireCompany()
    const { slug } = c
    // closeCurrentCompany() below clears the session — remember who asked for the restore.
    const restoredBy = sessionUser?.name ?? osAuditUser()
    const backupPath = join(companyBackupsDir(slug), file)
    const dbPath = companyDbPath(slug)

    // Validates the chosen backup (quick_check + shape), takes a pre-restore safety snapshot,
    // and atomically swaps it into place. Throws — leaving the live DB completely untouched —
    // if the backup fails validation. `current`/`c.db` are still fully intact at that point,
    // since we haven't closed anything yet.
    // WP 7.1 review: no background check may hold the live file open while it is swapped.
    // To-do §4: nor may the open backup's pending check prune / purge around the swap.
    await cancelOpenFollowUp()
    await stopChecks(dbPath)
    // WP 7.2: a business locked with a passphrase keeps its lock — a plaintext backup (one made
    // before the lock, if converting it failed) is restored through an encrypted copy of itself.
    const liveKey = keyOfHandle(c.db)
    let source = backupPath
    let tempSource: string | null = null
    if (liveKey && !isEncryptedFile(backupPath)) {
      tempSource = `${backupPath}.restore-tmp`
      removeDbFiles(tempSource)
      copyFileSync(backupPath, tempSource)
      // A scratch copy: restoreCompanyDb quick-checks it (assertValidCompanyDb) before the swap,
      // and swapInPlace fsyncs what it puts in place. A failed rekey leaves no temp behind.
      try {
        rekeyFile(tempSource, null, liveKey, 'scratch')
      } catch (err) {
        removeDbFiles(tempSource)
        throw err
      }
      source = tempSource
    }
    let preRestoreSnapshotPath: string
    try {
      preRestoreSnapshotPath = restoreCompanyDb(c.db, dbPath, source, companyBackupsDir(slug)).preRestoreSnapshotPath
    } catch (err) {
      // restoreCompanyDb closes the live handle before the swap; when the swap itself fails (a
      // copy / fsync / rename error) the books on disk are untouched — reopen them so the app is
      // never left holding a closed database (CodeRabbit on #197). The original error still goes up.
      if (!c.db.open) {
        try {
          const db = openCompanyDb(slug, { preUpgradeCopy: false })
          current = { slug, db, info: readCompanyInfo(db), usersExist: users.usersExist(db), encrypted: keyOfHandle(db) !== null }
        } catch (reopenErr) {
          current = null
          log('error', 'backup-restore-swap-reopen-failed', { slug, error: reopenErr instanceof Error ? reopenErr.message : String(reopenErr) })
        }
      }
      throw err
    } finally {
      if (tempSource) removeDbFiles(tempSource)
    }
    // WP 6.4: the pre-restore snapshot's attachments are still in the live store — keep copies,
    // so restoring that snapshot later brings them back too.
    try {
      stashBackupAttachments(slug, preRestoreSnapshotPath)
    } catch (err) {
      log('warn', 'backup-restore-stash-failed', { slug, error: err instanceof Error ? err.message : String(err) })
    }

    closeCurrentCompany({ keepKey: true })
    const reopen = (): OpenCompany => {
      // Migrates if the backup predates the current schema — with no pre-upgrade copy: the file
      // came from a backup that is still in the backups folder (and a pre-restore snapshot was taken).
      const db = openCompanyDb(slug, { preUpgradeCopy: false })
      const info = readCompanyInfo(db)
      return { slug, db, info, usersExist: users.usersExist(db), encrypted: keyOfHandle(db) !== null }
    }

    try {
      current = reopen()
    } catch (err) {
      // The swap already happened on disk, but the result won't open (e.g. a corrupted or
      // incompatible backup that still passed quick_check). Roll back to the pre-restore
      // snapshot so the app is never left with no company open and no path back.
      const message = err instanceof Error ? err.message : String(err)
      log('error', 'backup-restore-reopen-failed', { slug, error: message })
      try {
        rollbackRestore(dbPath, preRestoreSnapshotPath)
        current = reopen()
      } catch (rollbackErr) {
        current = null
        const rollbackMessage = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
        log('error', 'backup-restore-rollback-failed', { slug, error: rollbackMessage })
        // Distinct from the happy-rollback message below — that one is a true statement only
        // when the rollback actually succeeded. Here it didn't: the live DB is not usable and
        // there is no company open, but the pre-restore snapshot this function took before
        // touching anything is still sitting in the backups folder, untouched.
        throw new Error(
          `Restore failed and automatic rollback also failed — this company may be unavailable. ` +
            `A pre-restore snapshot exists in the backups folder (${basename(preRestoreSnapshotPath)}); ` +
            `reopen or restore it manually.`
        )
      }
      throw new Error(`Restore failed and was rolled back to the pre-restore snapshot: ${message}`)
    }

    try {
      touchLastOpened(slug)
    } catch {
      // Best-effort — the restore itself already succeeded regardless of this.
    }
    idleClock.setMinutes(getAutoLockMinutes(current.db))
    const integrity = checkIntegrity(current.db)
    if (!integrity.ok) {
      log('warn', 'integrity', { slug, quickCheck: integrity.quickCheck, unbalanced: integrity.unbalancedVoucherIds })
    }
    // WP 3.8: the restored file carries the backup's own audit trail and hash chain. Verify it,
    // then record the restore itself on top of it (the live trail up to the restore survives in
    // the pre-restore snapshot).
    const auditChain = verifyAudit(current.db)
    // WP 6.4: the restored books' attachments, back into the live store from the backups' copies.
    let attachmentFiles: RestoreFilesResult = { restored: 0, present: 0, missing: [], refused: [] }
    try {
      attachmentFiles = restoreAttachmentFiles(current.db, companyAttachmentsDir(slug), companyBackupAttachmentsDir(slug))
    } catch (err) {
      log('warn', 'backup-restore-attachments-failed', { slug, error: err instanceof Error ? err.message : String(err) })
    }
    writeAudit(current.db, 'backup', 0, 'restore', null, {
      file, preRestoreSnapshot: basename(preRestoreSnapshotPath), chainOk: auditChain.ok, chainRows: auditChain.rows,
      chainHeadId: auditChain.headId, chainFirstBreak: auditChain.firstBreak?.rowId ?? null,
      attachmentsRestored: attachmentFiles.restored, attachmentsMissing: attachmentFiles.missing.length, attachmentsRefused: attachmentFiles.refused.length
    }, { user: restoredBy })
    // closeCurrentCompany() above already cleared sessionUser, so this is realistically always
    // `current.usersExist` — spelled out in full to match the other two locked-flag call sites.
    return {
      info: current.info, integrity, locked: current.usersExist && !sessionUser, auditChain,
      attachments: { restored: attachmentFiles.restored, missing: attachmentFiles.missing.length, refused: attachmentFiles.refused.length }
    }
  }, 'owner')

  handle('backup:exportEncrypted', async (payload) => {
    const { passphrase } = z.object({ passphrase: passphraseSchema }).parse(payload)
    const c = requireCompany()
    const tempPath = join(companyExportsDir(c.slug), `.export-tmp-${backupStamp()}.db`)
    // WP 7.2: the snapshot inside is plaintext (a locked business's file is decrypted into it) —
    // the .totalbak is protected by ITS passphrase, and imports anywhere without the company key.
    plainCopy(c.db, tempPath)
    // WP 6.4: the encrypted file carries the attachments (a blob table inside the snapshot).
    let embedded: StashResult
    try {
      embedded = embedAttachments(tempPath, companyAttachmentsDir(c.slug))
    } catch (err) {
      unlinkSync(tempPath)
      throw err
    }
    const destPath = join(companyExportsDir(c.slug), `total-${c.slug}-${backupStamp()}.totalbak`)
    try {
      await encryptFile(tempPath, destPath, passphrase)
    } finally {
      unlinkSync(tempPath)
    }
    auditExport(c.db, 'encrypted_backup', { path: destPath, attachments: embedded.copied, attachmentsMissing: embedded.missing.length })
    shell.showItemInFolder(destPath)
    return { path: destPath }
  }, 'owner')

  // No requireCompany() — importing an encrypted backup works with no company open.
  handle('backup:importEncrypted', async (payload) => {
    const { passphrase } = z.object({ passphrase: passphraseSchema }).parse(payload)
    const picked = await dialog.showOpenDialog({
      title: 'Choose a Total encrypted backup',
      filters: [{ name: 'Total backup', extensions: ['totalbak'] }],
      properties: ['openFile']
    })
    if (picked.canceled || !picked.filePaths[0]) return null

    const tempDir = mkdtempSync(join(tmpdir(), 'total-import-'))
    const tempDbPath = join(tempDir, 'restored.db')
    try {
      await decryptFile(picked.filePaths[0], tempDbPath, passphrase)
    } catch {
      throw new Error('Wrong passphrase or corrupted file')
    }

    let info: CompanyInfo
    try {
      const check = openDb(tempDbPath, { readonly: true, key: null })
      try {
        const result = check.pragma('quick_check') as Array<{ quick_check: string }>
        if (result[0]?.quick_check !== 'ok') throw new Error('bad')
        info = readCompanyInfo(check)
        // Upgrade guard: a backup from a NEWER Total is refused before it becomes a company.
        assertNotNewer(check)
      } finally {
        check.close()
      }
    } catch (err) {
      if (err instanceof AppError && err.code === 'db_newer_version') throw err
      throw new Error("This file doesn't look like a Total company backup")
    }

    let slug = slugify(info.name)
    let n = 2
    while (existsSync(companyDbPath(slug))) slug = `${slugify(info.name)}-${n++}`
    ensureCompanyTree(slug)
    // WP 6.4: the embedded attachments (hash-checked) into the new company's store.
    let importedFiles: RestoreFilesResult = { restored: 0, present: 0, missing: [], refused: [] }
    try {
      importedFiles = restoreAttachmentFilesAt(tempDbPath, companyAttachmentsDir(slug), null)
    } catch (err) {
      log('warn', 'import-encrypted-attachments-failed', { slug, error: err instanceof Error ? err.message : String(err) })
    }

    const dbPath = companyDbPath(slug)
    try {
      renameFile(tempDbPath, dbPath)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }

    upsertCompany({ slug, name: info.name, stateCode: info.stateCode, gstin: info.gstin, lastOpenedAt: new Date().toISOString() })
    // WP 3.8: record the import in the imported company's own trail (opening migrates it first).
    try {
      const imported = openCompanyDb(slug)
      try {
        const chain = verifyAudit(imported)
        writeAudit(imported, 'backup', 0, 'restore', null, {
          file: basename(picked.filePaths[0]), encrypted: true, chainOk: chain.ok, chainRows: chain.rows, chainFirstBreak: chain.firstBreak?.rowId ?? null,
          attachmentsRestored: importedFiles.restored, attachmentsMissing: importedFiles.missing.length, attachmentsRefused: importedFiles.refused.length
        }, { user: osAuditUser() })
      } finally {
        closeCompanyDb(imported)
      }
    } catch (err) {
      log('warn', 'import-encrypted-audit-failed', { slug, error: err instanceof Error ? err.message : String(err) })
    }
    return { slug, name: info.name }
  })

  // ---------- masters, search, cost centres, features + invoice print config, currencies + BOM — ipcMasters.ts ----------
  registerMastersIpc(handle, ctx)

  // ---------- trade cycle: kinds, numbering, quotations / orders, links, reports, returns, closure — ipcTrade.ts ----------
  registerTradeIpc(handle, ctx)

  // ---------- inventory: godowns, batches, stock analysis, stock visibility, manufacture — ipcInventory.ts ----------
  registerInventoryIpc(handle, ctx)

  // ---------- reports (TB, P&L, BS, registers …), analysis, intelligence, report print / export — ipcReportScreens.ts ----------
  registerReportScreensIpc(handle, ctx)

  // ---------- GST returns, validation panel + 3B adjustments, GST expansion (2B, IMS, GSTR-9, ITC-04, RCM, ITC reversal) — ipcGst.ts ----------
  registerGstIpc(handle, ctx)

  // ---------- TDS, the TDS screen and TCS — ipcTds.ts ----------
  registerTdsIpc(handle, ctx)

  // ---------- banking: bank ledgers, reconciliation, CSV import, bank rules, BRS — ipcBankReco.ts ----------
  registerBankRecoIpc(handle, ctx)

  // ---------- e-documents, invoice printing and sharing, print templates, cheque printing — ipcPrinting.ts ----------
  registerPrintingIpc(handle, ctx)

  // ---------- payroll (employees, pay heads, runs) — ipcPayroll.ts ----------
  registerPayrollIpc(handle, ctx)

  // ---------- CSV master import, Tally import, CA export pack + Tally XML export — ipcImportExport.ts ----------
  registerImportExportIpc(handle, ctx)

  // ---------- live filing through the NIC APIs (e-invoice / e-way bill) — ipcNic.ts ----------
  registerNicIpc(handle, ctx)

  // ---------- the edit log and its retention — ipcAudit.ts ----------
  registerAuditIpc(handle, ctx)

  // ---------- auth + users ----------
  // auth:* itself is in UNGATED_CHANNELS (see `handle`) — you have to be able to call
  // auth:login before you're "in". users:list/save/deactivate are owner-only, *except* that
  // users:save is reachable with no session at all while the company has zero users: that's
  // how the first (forced-owner) account gets created without a chicken-and-egg deadlock —
  // see the UNGATED_CHANNELS / `current.usersExist` gate in `handle`.
  handle('auth:users', () => users.listLoginNames(requireCompany().db))
  handle('auth:login', (p) => {
    const { userId, pin } = authLoginSchema.parse(p)
    const c = requireCompany()
    const result = users.login(c.db, userId, pin)
    sessionUser = result
    idleClock.touch()
    // "Remember on this computer" ticked at this open's passphrase prompt: only an owner keeps it.
    if (pendingRemember === c.slug) {
      pendingRemember = null
      if (result.role === 'owner' && c.encrypted) rememberOpenKey(c, result.name)
    }
    resumeCapture()
    return sessionView(result)
  })
  handle('auth:logout', () => {
    // [lane-Q audit] logout audit row (task Q1 #90) — only meaningful with a live session.
    if (current && sessionUser) writeAudit(current.db, 'user', sessionUser.id, 'logout', null, null)
    sessionUser = null
    return null
  })
  handle('auth:current', () => (sessionUser ? sessionView(sessionUser) : null))

  handle('users:list', () => users.listUsers(requireCompany().db), 'owner')
  handle('users:save', (p) => {
    const { data, id } = z.object({ data: userInputSchema, id: z.number().int().positive().optional() }).parse(p)
    const c = requireCompany()
    const bootstrap = id === undefined && !c.usersExist
    const before = id ? users.getUser(c.db, id) : null
    const saved = users.saveUser(c.db, data, id)
    c.usersExist = users.usersExist(c.db)
    // The bootstrap owner (the very first user of a fresh company) is auto-authenticated as
    // themselves — they just proved they're standing at the machine by creating the account,
    // and forcing them to immediately re-enter the PIN they picked a second ago would be theatre.
    if (bootstrap) {
      sessionUser = { id: saved.id, name: saved.name, role: saved.role, capabilities: saved.capabilities }
      idleClock.touch()
    }
    writeAudit(c.db, 'user', saved.id, id ? 'update' : 'create', before, saved)
    return { ...saved, locked: c.usersExist && !sessionUser }
  }, 'owner')
  handle('users:deactivate', (p) => {
    const { id } = idSchema.parse(p)
    const c = requireCompany()
    const before = users.getUser(c.db, id)
    users.deactivateUser(c.db, id)
    c.usersExist = users.usersExist(c.db)
    writeAudit(c.db, 'user', id, 'update', before, { ...before, active: false })
    return null
  }, 'owner')

  // ---------- WP 7.2 security: screen lock, passphrase lock, backup checks ----------
  // The session lock: ⌘L (session:lock) and the idle auto-lock sign the user out — the PIN screen
  // (auth:login) is the only way back, and the gate above refuses everything else meanwhile.
  handle('session:activity', () => {
    idleClock.touch()
    return null
  }, 'viewer')
  handle('session:lock', () => {
    const c = requireCompany()
    // WP 7.2 follow-up: a business without users locks too — a privacy screen (its passphrase,
    // when the passphrase lock is on, or a plain Unlock) instead of the PIN screen.
    if (!c.usersExist) lockPrivacy('manual')
    else lockSession('manual')
    return { locked: true, kind: lockKindOf(c) }
  }, 'viewer')
  // The unlock of a business WITHOUT users (with users it is auth:login). Ungated; the passphrase
  // (when the business has the passphrase lock on) is throttled like opening; audited as a login.
  handle('session:unlock', async (p) => {
    const { passphrase } = z.object({ passphrase: z.string().max(1024).optional() }).strict().parse(p ?? {})
    const c = requireCompany()
    if (c.usersExist) throw new AppError('unlock_needs_pin', 'This business has people with PINs — sign in with yours', { field: 'pin' })
    if (!privacyLock) return { locked: false }
    if (c.encrypted) {
      if (!passphrase) throw new AppError('passphrase_required', 'Type the passphrase of this business to unlock', { field: 'passphrase' })
      const now = Date.now()
      assertNotThrottled(c.slug, now)
      try {
        await assertPassphrase(c, passphrase, 'passphrase')
      } catch (err) {
        if (!(err instanceof AppError) || err.code !== 'wrong_passphrase') throw err
        log('warn', 'passphrase-wrong', { slug: c.slug, fails: noteWrongPassphrase(c.slug, now) })
        throw err
      }
      noteRightPassphrase(c.slug)
    }
    const reason = privacyLock
    privacyLock = null
    idleClock.touch()
    writeAudit(c.db, 'user', 0, 'login', null, { lock: reason, noUsers: true, passphrase: c.encrypted })
    return { locked: false }
  })

  const securityView = (): SecurityView => {
    const c = requireCompany()
    return {
      encrypted: c.encrypted,
      keyFile: c.encrypted && !!readEnvelope(companyDir(c.slug), c.slug, appSecretStore()),
      usersExist: c.usersExist,
      autoLockMinutes: getAutoLockMinutes(c.db),
      autoLockChoices: [...AUTO_LOCK_CHOICES],
      lastCheck: latestBackupCheck(c.db),
      remembered: c.encrypted && hasRememberedKey(c.slug, appSecretStore()),
      rememberPending: pendingRemember === c.slug
    }
  }
  handle('security:get', () => securityView(), 'viewer')
  // Settings → Security: forget the key remembered on this computer (owner; audited).
  handle('security:remember:forget', () => {
    const c = requireCompany()
    forgetRememberedOf(c, sessionUser?.name ?? null)
    return securityView()
  }, 'owner')
  handle('security:autoLock:set', (p) => {
    const { minutes } = z
      .object({ minutes: z.number().int().refine((m) => (AUTO_LOCK_CHOICES as readonly number[]).includes(m), 'Pick one of the offered minutes').nullable() })
      .strict()
      .parse(p)
    const c = requireCompany()
    setAutoLockMinutes(c.db, minutes)
    idleClock.setMinutes(minutes)
    return securityView()
  }, 'owner')

  const passphrasePair = z.object({ passphrase: passphraseSchema, confirm: z.string().max(1024) }).strict()
  /** Turn the passphrase lock on (`to` = a new key) or off (`to` = null) for the open company:
   *  a normal backup first, then the verified copy (services/dbEncryption.ts) swapped in and the
   *  company reopened, then every backup converted. The signed-in user stays signed in. */
  const convertOpenCompany = async (to: Buffer | null, auditAfter: Record<string, unknown>): Promise<{ backupsConverted: number; backupsFailed: string[]; filesConverted: number; filesFailed: string[] }> => {
    const c = requireCompany()
    const { slug } = c
    const by = sessionUser?.name ?? osAuditUser()
    const keepUser = sessionUser
    const from = keyOfHandle(c.db)
    // To-do §4: the open backup's pending check prunes nothing while the backups are converted.
    await cancelOpenFollowUp()
    await backupCompany(c.db, slug, to ? 'pre-encrypt' : 'pre-decrypt', by)
    // WP 7.2 review: no background check (the weekly integrity_check) may hold the live file open
    // while it is swapped — on Windows the rename fails, and its read snapshot keeps the WAL alive.
    await stopChecks(companyDbPath(slug))
    const tmp = prepareConvertedCopy({
      db: c.db,
      dbPath: companyDbPath(slug),
      to,
      asOn: todayISO(),
      audit: { before: { encrypted: !!from }, after: { encrypted: !!to, ...auditAfter }, user: by }
    })
    // The files (attachments, capture): taking the lock off decrypts them now, while the key is in
    // hand. Either way the conversion is marked before the swap, so the reopen (and, after a
    // crash, the next open) finishes it toward the books' form (dbEncryption.resumeFileConversion)
    // — putting the lock on encrypts them there, right after the swap.
    let files = { converted: 0, failed: [] as string[] }
    try {
      if (!to) files = convertCompanyFiles(companyDir(slug), from, null)
      markFileConversion(companyDir(slug), to ? 'encrypted' : 'plain')
    } catch (err) {
      removeDbFiles(tmp)
      throw err
    }
    closeCurrentCompany({ keepKey: true })
    try {
      commitConvertedCopy(tmp, companyDbPath(slug))
    } catch (err) {
      // The original is untouched (the rename is the commit): open it again as it was — the
      // reopen's resume puts the files back in the books' form.
      removeDbFiles(tmp)
      await openCompanyNow(slug, { keepKey: true })
      sessionUser = keepUser
      throw err
    }
    if (to) rememberFolderKey(companyDir(slug), to)
    else forgetFolderKey(companyDir(slug))
    await openCompanyNow(slug, { keepKey: true })
    sessionUser = keepUser
    idleClock.touch()
    if (to) files = lastFileResume ?? convertCompanyFiles(companyDir(slug), null, to)
    if (files.failed.length) log('warn', 'security-files-not-converted', { slug, failed: files.failed.length })
    // The older backups follow the books: none is left plaintext behind a locked business (or
    // encrypted behind an unlocked one, where no key would open it any more).
    // A backup's restore check still copying one of them would hold it open (Windows: the rename fails).
    await stopChecksUnder(companyBackupsDir(slug))
    const conv = convertBackups(companyBackupsDir(slug), from, to)
    if (conv.failed.length) log('warn', 'security-backups-not-converted', { slug, failed: conv.failed.length })
    return { backupsConverted: conv.converted, backupsFailed: conv.failed, filesConverted: files.converted, filesFailed: files.failed }
  }

  /** The passphrase opens the open company's key (passphrase off / change), else wrong_passphrase. */
  const assertPassphrase = async (c: OpenCompany, passphrase: string, field: string): Promise<Buffer> => {
    const envs = readEnvelopes(companyDir(c.slug), c.slug, appSecretStore())
    const key = keyOfHandle(c.db)
    let unwrapped: Buffer | null = null
    for (const env of envs) {
      try {
        unwrapped = await unwrapKeyAsync(env, passphrase)
      } catch {
        unwrapped = null
      }
      if (unwrapped && key && unwrapped.equals(key)) break
    }
    if (!unwrapped || !key || !unwrapped.equals(key)) throw new AppError('wrong_passphrase', 'That passphrase is not right', { field })
    return key
  }

  handle('security:passphrase:on', async (p) => {
    const { passphrase, confirm } = passphrasePair.parse(p)
    if (confirm !== passphrase) throw new AppError('passphrase_mismatch', 'The two passphrases are not the same', { field: 'confirm' })
    const c = requireCompany()
    if (c.encrypted) throw new AppError('security_already_locked', 'This business is already locked with a passphrase')
    // Files review: a key file an earlier lock-off left behind (some backup or file could not be
    // converted and is still encrypted under ITS key) is used again when this passphrase opens it
    // — those leftovers then open as before once the lock is on. While a FILE is still waiting on
    // that key (the `.files-converting` marker), a passphrase that does not open it is refused:
    // a new key would lose the file for good (the user's own attachment, not a backup).
    let key: Buffer | null = null
    const leftover = readEnvelopes(companyDir(c.slug), c.slug, appSecretStore())
    for (const env of leftover) {
      try {
        key = await unwrapKeyAsync(env, passphrase)
        break
      } catch (err) {
        if (!(err instanceof WrongPassphraseError)) throw err
      }
    }
    if (!key && leftover.length && fileConversionPending(companyDir(c.slug))) {
      throw new AppError('security_files_pending', 'Some files are still locked with the passphrase this business had before (taking the lock off could not convert them). Lock it with that passphrase, so they open again', { field: 'passphrase' })
    }
    key ??= newDataKey()
    // A key remembered for an earlier lock of this business can never open the new file.
    dropRememberedKey(c.slug, appSecretStore())
    const env = await wrapKeyAsync(key, passphrase, scryptParams())
    // The key file goes first: from the moment the file is encrypted it must be there.
    const { mirrored } = writeEnvelope(companyDir(c.slug), c.slug, env, appSecretStore())
    try {
      const out = await convertOpenCompany(key, { cipher: 'sqlcipher-4', kdf: `scrypt N=${env.N} r=${env.r} p=${env.p}`, keyCopyInSecureStorage: mirrored })
      return { ...securityView(), ...out, mirrored }
    } catch (err) {
      // Nothing was swapped in (the copy failed its check): the key file goes again.
      // Decided by the FILE, never by `current` (null when the reopen after the swap failed): an
      // encrypted file must never lose its key file.
      if (!isEncryptedFile(companyDbPath(c.slug))) removeEnvelope(companyDir(c.slug), c.slug, appSecretStore())
      throw err
    }
  }, 'owner')

  handle('security:passphrase:off', async (p) => {
    const { passphrase } = z.object({ passphrase: z.string().min(1).max(1024) }).strict().parse(p)
    const c = requireCompany()
    if (!c.encrypted) throw new AppError('security_not_locked', 'This business is not locked with a passphrase')
    await assertPassphrase(c, passphrase, 'passphrase')
    const hadRemembered = hasRememberedKey(c.slug, appSecretStore())
    const out = await convertOpenCompany(null, hadRemembered ? { rememberedOnThisComputer: false } : {})
    // Nothing to remember once the books are plaintext (recorded in the conversion's audit row).
    if (hadRemembered && !isEncryptedFile(companyDbPath(c.slug))) dropRememberedKey(c.slug, appSecretStore())
    // The key goes only once nothing needs it: the books are plaintext AND every backup was
    // converted — a backup left encrypted (it failed to convert) still opens with this passphrase.
    // Files that could not be decrypted keep it too.
    if (!isEncryptedFile(companyDbPath(c.slug)) && out.backupsFailed.length === 0 && out.filesFailed.length === 0) removeEnvelope(companyDir(c.slug), c.slug, appSecretStore())
    else log('warn', 'security-key-kept', { slug: c.slug, backupsFailed: out.backupsFailed.length, filesFailed: out.filesFailed.length })
    return { ...securityView(), ...out }
  }, 'owner')

  handle('security:passphrase:change', async (p) => {
    const { current: old, passphrase, confirm } = z
      .object({ current: z.string().min(1).max(1024), passphrase: passphraseSchema, confirm: z.string().max(1024) })
      .strict()
      .parse(p)
    if (confirm !== passphrase) throw new AppError('passphrase_mismatch', 'The two passphrases are not the same', { field: 'confirm' })
    const c = requireCompany()
    if (!c.encrypted) throw new AppError('security_not_locked', 'This business is not locked with a passphrase')
    const before = readEnvelope(companyDir(c.slug), c.slug, appSecretStore())
    const key = await assertPassphrase(c, old, 'current')
    // Only the wrapping changes: the books and every backup keep the same key.
    const next = await wrapKeyAsync(key, passphrase, scryptParams())
    const { mirrored } = writeEnvelope(companyDir(c.slug), c.slug, next, appSecretStore())
    writeAudit(c.db, 'security', 0, 'update', { passphraseSetAt: before?.createdAt ?? null }, { passphraseSetAt: next.createdAt, keyCopyInSecureStorage: mirrored })
    return securityView()
  }, 'owner')

  // Backup checks: the list (Settings → Backups) and "Check now" on the newest (or a named) backup.
  handle('backup:checks', () => listBackupChecks(requireCompany().db), 'viewer')
  handle('backup:check', async (p) => {
    const { file } = z.object({ file: backupFileSchema.optional() }).strict().parse(p ?? {})
    const c = requireCompany()
    const name = file ?? listBackupsIn(companyBackupsDir(c.slug))[0]?.file
    if (!name) throw new Error('There is no backup to check yet — take one first')
    const path = join(companyBackupsDir(c.slug), name)
    if (!existsSync(path)) throw new Error('Backup file not found')
    const check = await verifyBackupFileAsync(path, { asOn: todayISO(), key: isEncryptedFile(path) ? keyOfHandle(c.db) : null })
    if (!c.db.open) throw new Error('The business was closed before the check finished')
    return recordBackupCheck(c.db, check)
  })

  // ---------- logging ----------
  handle('log:renderer', (p) => {
    const { message, stack, componentStack, screen } = rendererLogSchema.parse(p)
    log('error', 'renderer-error', { message, stack, componentStack, screen })
    return null
  })
  handle('log:reveal', () => {
    revealLogs()
    return null
  })

  // ---------- app info + updates ----------
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }))
  handle('app:checkUpdates', () => checkForUpdatesInteractive(), 'viewer')
  // Update consent: app-level (the setting and the notice belong to the whole app, not a company),
  // so changing it or answering a notice is owner-only wherever the open company has users.
  handle('app:updates:get', () => updatesView(), 'viewer')
  const updatesVerdict = (): UpdatesCanSet => {
    const usersExist = !!current?.usersExist
    return updatesCanSet({
      companyHasUsers: usersExist,
      isOwner: sessionUser?.role === 'owner',
      anyOtherCompanyHasUsers: !usersExist && otherCompanyHasUsers()
    })
  }
  // The AI-key rule: no users here -> refused while another company has users, else only with an explicit confirmation.
  const guardUpdates = (confirmNoUsers: boolean): string | null => {
    const v = updatesVerdict()
    if (v.reason === 'other_company_has_users') throw new AppError('updates_other_company_has_users', 'Another company on this computer has users — open it and sign in as its owner to change the update setting.')
    if (!v.allowed) throw new AppError('updates_owner_only', 'Only the owner can change this.')
    if (v.reason === 'needs_confirmation') {
      if (!confirmNoUsers) throw new AppError('updates_confirm_no_users', 'No company on this computer has users, so anyone using it can change the update setting. Confirm to continue.')
      return 'no sign-ins (confirmed)'
    }
    return null
  }
  handle('app:updates:canSet', (p) => {
    z.object({}).strict().prefault({}).parse(p ?? {})
    return updatesVerdict()
  }, 'viewer')
  handle('app:updates:set', (p) => {
    const { autoCheck, confirmNoUsers } = z.object({ autoCheck: z.boolean(), confirmNoUsers: z.boolean().default(false) }).strict().parse(p)
    const mode = guardUpdates(confirmNoUsers)
    return setAutoCheck(autoCheck, sessionUser?.name ?? mode)
  }, 'owner')
  handle('app:updates:act', (p) => {
    const { action, confirmNoUsers } = z.object({ action: z.enum(UPDATE_ACTIONS), confirmNoUsers: z.boolean().default(false) }).strict().parse(p)
    const mode = guardUpdates(confirmNoUsers)
    return updateAction(action, sessionUser?.name ?? mode)
  }, 'owner')
  // WP 10.3: a help article's link to the GST portal / CBIC — the allow-list again here, so the
  // renderer can never open anything else through it.
  handle('help:openLink', async (p) => {
    const { url } = z.object({ url: z.string().max(500) }).strict().parse(p)
    // Open the parser's normalised form, never the raw string (the OS URL parser may read odd
    // input — a backslash, spaces — differently from the WHATWG one that checked it).
    const safe = allowedHelpUrl(url)
    if (!safe) throw new Error('Help links open only the GST portal or CBIC')
    await shell.openExternal(safe)
  }, 'viewer')

  // ---------- the agent bridge (read-only CSV / JSON mirrors) — ipcAgentBridge.ts ----------
  registerAgentBridgeIpc(handle, ctx)

  // ---------- compliance-deadline notifications ----------
  // The renderer computes *which* deadlines to notify about (pure `src/shared/compliance.ts`,
  // driven off the dashboard data it already has) and hands over ready-to-show title/body pairs;
  // this just applies the once-per-day guard and pops native OS notifications.
  handle('app:notifyDeadlines', (p) => {
    const { items } = notifyDeadlinesSchema.parse(p)
    const db = requireCompany().db
    if (configSvc.shouldNotifyDeadlinesToday(db, todayISO())) {
      for (const item of items) {
        const n = new Notification({ title: item.title, body: item.body })
        // Electron 42+ shows macOS notifications through UNNotification, which needs a code-signed
        // app: an unsigned build gets `failed` instead (the deadlines are still on Home / Taxes).
        n.on('failed', (_e, error) => log('warn', 'deadline notification not shown', { error }))
        n.show()
      }
    }
    return null
  }, 'viewer')
}
