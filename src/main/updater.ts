/**
 * Auto-update via GitHub Releases — with consent.
 *
 * Nothing is downloaded or installed without the user's say-so: electron-updater only CHECKS
 * (`autoDownload` / `autoInstallOnAppQuit` are false); a found version becomes an in-app notice
 * ("Download now / Later / Skip this version"), and a finished download another ("Restart to
 * update"). The flow lives in updaterCore.ts (unit-tested); this file wires it to Electron.
 * If the update engine errors (typical for unsigned macOS builds) the site / GitHub release
 * page is offered instead. "Check for updates automatically" (default on) and the skipped
 * version live in <dataRoot>/app-settings.json; when it is off no request is made at launch.
 *
 * Windows (WP 7.3): the NSIS build updates through electron-updater itself — it reads
 * latest.yml from the release and verifies the download's sha512; with no `publisherName`
 * configured it does not require a signature. latest.yml names the installer
 * `Total-Setup-<version>.exe` and the release asset must carry exactly that name (package.json
 * `nsis.artifactName`). A page opened for a manual download asks /api/download for this
 * platform (`?platform=win|mac`), and TOTAL_NO_UPDATE_CHECK=1 (scripted runs against a packaged
 * build — the Windows CI smoke) turns the launch check off.
 *
 * Audit A4: every version is checked against its release's signed manifest (total-manifest.json,
 * Ed25519, key pinned in releaseKeys.json — releaseManifest.ts) before it is offered; an engine
 * download is installed only when its SHA-512 is in that manifest; a hand download opens the
 * manifest's installer on GitHub; every URL handed to the OS passes `allowedUpdateUrl` (SEC-10).
 *
 * The app stays fully offline otherwise: this runs only in packaged builds and never blocks.
 */
import { app, BrowserWindow, shell } from 'electron'
import { createRequire } from 'module'
import { log } from './log'
import { GITHUB_REPO, SITE_URL } from '@shared/product'
import { type UpdateAction, type UpdateCheckResult, type UpdatesView } from '@shared/updates'
import { dataRoot } from './paths'
import { readUpdateSettings, writeUpdateSettings } from './services/appSettings'
import { createUpdater, makeFetchLatest, type Updater } from './updaterCore'
import { updateCheckDisabled } from '@shared/updateText'
import { allowedUpdateUrl } from '@shared/externalLinks'
import { installerFor, MANIFEST_ASSET, releaseAssetUrl, sha512File, verifyManifest, type ReleaseManifest } from './releaseManifest'

// Phase 5 speed: electron-updater (~45 ms to load) is required when the updater is first built —
// the launch check runs after the window is up — not when the app starts.
const requireHere = createRequire(typeof __filename === 'string' ? __filename : `${process.cwd()}/index.js`)
const autoUpdaterEngine = (): unknown => (requireHere('electron-updater') as { autoUpdater: unknown }).autoUpdater

const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`
/** The marketing site proxies release info for the private repo (see site/app/api/latest). */
const SITE_LATEST_URL = `${SITE_URL}/api/latest`

const fetchLatest = makeFetchLatest((url, init) => fetch(url, init), {
  siteLatestUrl: SITE_LATEST_URL,
  githubRepo: GITHUB_REPO,
  releasesUrl: RELEASES_URL,
  log: (level, message, extra) => log(level, message, extra)
})

/** The release's signed manifest from GitHub (never the site), verified; null + a log line otherwise. */
async function verifyRelease(version: string): Promise<ReleaseManifest | null> {
  const res = await fetch(releaseAssetUrl(GITHUB_REPO, version, MANIFEST_ASSET))
  if (!res.ok) {
    log('warn', 'update-unverified', { version, reason: `manifest ${res.status}` })
    return null
  }
  const check = verifyManifest(await res.text(), version)
  if (!check.ok) {
    log('warn', 'update-unverified', { version, reason: check.reason })
    return null
  }
  return check.manifest
}

function openUpdatePage(url: string): void {
  const safe = allowedUpdateUrl(url)
  if (!safe) log('warn', 'update-url-refused', { url: url.slice(0, 200) })
  void shell.openExternal(safe ?? RELEASES_URL)
}

/** A corrupt app-settings.json reads as the defaults; say so in the log once per run (it is read often). */
let corruptLogged = false
const onCorrupt = (error: string): void => {
  if (corruptLogged) return
  corruptLogged = true
  log('warn', 'app-settings-unreadable', { error })
}
const readSettings = (): ReturnType<typeof readUpdateSettings> => readUpdateSettings(dataRoot(), onCorrupt)

let updater: Updater | null = null
let actor: string | null = null

function publish(notice: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('total:updates:event', notice)
  }
}

function build(): Updater {
  updater ??= createUpdater({
    engine: autoUpdaterEngine() as never,
    currentVersion: app.getVersion(),
    releasesUrl: RELEASES_URL,
    readSettings,
    writeSettings: (patch) => writeUpdateSettings(dataRoot(), patch, actor, app.getVersion(), onCorrupt),
    fetchLatest,
    verifyRelease,
    installerUrl: (m) => {
      const asset = installerFor(m, process.platform)
      return asset ? releaseAssetUrl(GITHUB_REPO, m.version, asset.name) : null
    },
    hashFile: sha512File,
    openExternal: openUpdatePage,
    publish,
    log: (level, message, extra) => log(level, message, extra)
  })
  return updater
}

/** Interactive check from Settings → About / the simple Updates card ("Check now"). */
export async function checkForUpdatesInteractive(): Promise<UpdateCheckResult> {
  if (!app.isPackaged) return { status: 'dev', current: app.getVersion() }
  return build().checkNow()
}

/** The settings + the notice now showing (dev runs: the stored settings, never a notice). */
export function updatesView(): UpdatesView {
  if (!app.isPackaged) return { settings: readSettings(), notice: null, current: app.getVersion() }
  return build().view()
}

export function setAutoCheck(autoCheck: boolean, who: string | null): UpdatesView {
  actor = who
  if (!app.isPackaged) {
    writeUpdateSettings(dataRoot(), { autoCheck }, who, app.getVersion(), onCorrupt)
    return updatesView()
  }
  return build().setAutoCheck(autoCheck)
}

export function updateAction(action: UpdateAction, who: string | null): UpdatesView {
  actor = who
  if (!app.isPackaged) return updatesView()
  return build().act(action)
}

export function initUpdater(): void {
  if (!app.isPackaged) return
  // WP 7.3: scripted runs against a packaged build (the Windows CI smoke) never check.
  if (updateCheckDisabled(process.env)) return
  build().init()
}
