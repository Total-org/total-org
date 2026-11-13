/**
 * The updater's consent flow, free of Electron so it is unit-tested with fakes.
 *
 *   available -> (Download now | Later | Skip this version)
 *   Download now -> downloading -> ready -> (Restart to update | Install when I quit | Later)
 *
 * Nothing is downloaded or installed without a user action: `autoDownload` and
 * `autoInstallOnAppQuit` stay false (the latter flips only on "Install when I quit").
 * With "Check for updates automatically" off, launch makes no request at all; "Check now" still works.
 *
 * Audit A4 (SEC-5): a version is offered only when its release's signed manifest verifies
 * (`verifyRelease`, releaseManifest.ts), an engine download becomes "ready" only when the file's
 * SHA-512 is in that manifest, and a hand download opens the installer the manifest names on GitHub
 * — never a URL from the site's answer.
 *
 * Audit 2 SEC2-2 / SEC2-5: the hand download no longer goes through the browser. "Download now" on the
 * 'site' path (and an engine download / install that fails) downloads the manifest's installer IN MAIN
 * (`downloadInstaller` → installerDownload.ts), keeps it only when its size + SHA-512 match, and then
 * offers "Open it" / "Show in folder" ('checked'; the file is re-hashed before it is opened). A file
 * that doesn't match is deleted and the notice says so ('failed'); no page is opened. The engine's
 * download counts only when it matches an asset this platform may install BY NAME too
 * (`engineAssetNames`), not any signed asset of the release.
 */
import { bareVersion, isNewerVersion, type UpdateAction, type UpdateCheckResult, type UpdateNotice, type UpdateSettings, type UpdatesView } from '@shared/updates'
import { assetWithHash, type ManifestAsset, type ReleaseManifest } from './releaseManifest'
import { InstallerMismatch } from './installerDownload'

/** The slice of electron-updater's autoUpdater this flow uses. */
export interface UpdateEngine {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  /** Merged over electron-updater's own request headers (used to blank its install id). */
  requestHeaders?: Record<string, string> | null
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
  on(event: 'update-available' | 'update-downloaded' | 'error', listener: (arg: never) => void): unknown
}

export interface LatestInfo {
  version: string
}

/** electron-updater sends a random per-install id (`x-user-staging-id`, kept in userData/.updaterId) with
 *  every feed request, for staged roll-outs Total does not use. It is overridden with this constant so the
 *  request carries no identifier (electron-updater merges `requestHeaders` over its own — AppUpdater
 *  `computeFinalHeaders`, electron-updater 6.8). */
export const NEUTRAL_REQUEST_HEADERS: Readonly<Record<string, string>> = { 'x-user-staging-id': '00000000-0000-0000-0000-000000000000' }

/** The site's /api/latest first, then GitHub's API: plain GETs with no body. `fetchImpl` is injected
 *  so the "no request when off" rule is tested with a stubbed fetch. */
export function makeFetchLatest(
  fetchImpl: (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>,
  opts: { siteLatestUrl: string; githubRepo: string; releasesUrl: string; log(level: 'warn', message: string, extra?: Record<string, unknown>): void }
): () => Promise<LatestInfo | null> {
  return async () => {
    try {
      const res = await fetchImpl(opts.siteLatestUrl)
      if (res.ok) {
        // Only the version is read: what is downloaded comes from the signed manifest (A4).
        const data = (await res.json()) as { version?: string }
        if (typeof data.version === 'string' && data.version) return { version: data.version }
      }
    } catch (err) {
      // Site unreachable — try GitHub directly.
      opts.log('warn', 'updater', { error: String(err) })
    }
    try {
      const res = await fetchImpl(`https://api.github.com/repos/${opts.githubRepo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' }
      })
      if (!res.ok) return null
      const release = (await res.json()) as { tag_name?: string }
      if (typeof release.tag_name !== 'string' || !release.tag_name) return null
      return { version: release.tag_name }
    } catch (err) {
      opts.log('warn', 'updater', { error: String(err) })
      return null
    }
  }
}

export interface UpdaterDeps {
  engine: UpdateEngine
  currentVersion: string
  readSettings(): UpdateSettings
  writeSettings(patch: Partial<UpdateSettings>): UpdateSettings
  /** Site / GitHub version lookup. */
  fetchLatest(): Promise<LatestInfo | null>
  /** The release's signed manifest, verified (null = missing or does not verify — the version is not offered). */
  verifyRelease(version: string): Promise<ReleaseManifest | null>
  /** The installer a person installs by hand on this platform (the DMG / setup exe), or null. */
  installerFor(manifest: ReleaseManifest): ManifestAsset | null
  /** The asset names electron-updater may install on this platform (SEC2-5). */
  engineAssetNames(version: string): string[]
  /** Download that installer and keep it only when it IS the asset (throws InstallerMismatch otherwise). */
  downloadInstaller(manifest: ReleaseManifest, asset: ManifestAsset): Promise<string>
  /** SHA-512 (hex) of a downloaded file. */
  hashFile(path: string): Promise<string>
  /** Open a checked installer (the DMG mounts / the setup runs) — only after a user click. */
  openFile(path: string): void
  /** Show a checked installer in Finder / Explorer. */
  showFile(path: string): void
  /** Delete a file that turned out not to match. */
  removeFile(path: string): void
  publish(notice: UpdateNotice | null): void
  log(level: 'warn' | 'info', message: string, extra?: Record<string, unknown>): void
  /** Delay before the launch check (ms). */
  launchDelayMs?: number
  setTimer?(fn: () => void, ms: number): unknown
}

export function createUpdater(deps: UpdaterDeps) {
  let notice: UpdateNotice | null = null
  /** Verified manifests by bare version (a version is offered only once its manifest is here). */
  const verified = new Map<string, ReleaseManifest>()
  let fallbackDone = false
  /** The version the user chose "Install when I quit" for (its re-armed download must not re-show "ready"). */
  let onQuitVersion: string | null = null
  /** The version the user asked to install (now or on quit): an engine error after that means the
   *  install could not happen (unsigned macOS: Squirrel refuses the bundle) — hand over the release page. */
  let installVersion: string | null = null
  /** The installer Total downloaded and checked itself (SEC2-2), shown by the 'checked' notice. */
  let handFile: { version: string; path: string; asset: ManifestAsset } | null = null
  const timer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))

  const set = (next: UpdateNotice | null): void => {
    notice = next
    deps.publish(next)
  }

  const isSkipped = (version: string): boolean => deps.readSettings().skippedVersion === bareVersion(version)

  async function verifiedFor(version: string): Promise<ReleaseManifest | null> {
    const v = bareVersion(version)
    const known = verified.get(v)
    if (known) return known
    let m: ReleaseManifest | null = null
    try {
      m = await deps.verifyRelease(v)
    } catch (err) {
      deps.log('warn', 'updater', { error: String(err) })
    }
    if (m && m.version === v) {
      verified.set(v, m)
      return m
    }
    deps.log('warn', 'update-unverified', { version: v })
    return null
  }

  /** The hand download (SEC2-2): fetch the verified installer in main, keep it only when it matches. */
  async function handDownload(version: string): Promise<void> {
    const v = bareVersion(version)
    const m = verified.get(v)
    const asset = m ? deps.installerFor(m) : null
    if (!m || !asset) {
      deps.log('warn', 'update-unverified', { version: v, reason: 'no installer in the manifest' })
      set({ phase: 'failed', version: v, via: 'site', reason: 'unverified' })
      return
    }
    handFile = null
    set({ phase: 'downloading', version: v, via: 'site' })
    try {
      const path = await deps.downloadInstaller(m, asset)
      handFile = { version: v, path, asset }
      set({ phase: 'checked', version: v, via: 'site' })
    } catch (err) {
      const mismatch = err instanceof InstallerMismatch
      deps.log('warn', mismatch ? 'update-unverified' : 'updater', { version: v, file: 'installer', error: String(err) })
      set({ phase: 'failed', version: v, via: 'site', reason: mismatch ? 'unverified' : 'download' })
    }
  }

  /** "Open it": the file is hashed again first — one that changed since is deleted, never opened. */
  async function openChecked(f: { version: string; path: string; asset: ManifestAsset }): Promise<void> {
    let same = false
    try {
      same = (await deps.hashFile(f.path)) === f.asset.sha512
    } catch (err) {
      deps.log('warn', 'updater', { error: String(err) })
    }
    if (!same) {
      deps.log('warn', 'update-unverified', { version: f.version, file: 'installer changed' })
      try {
        deps.removeFile(f.path)
      } catch (err) {
        deps.log('warn', 'updater', { error: String(err) })
      }
      if (handFile === f) handFile = null
      set({ phase: 'failed', version: f.version, via: 'site', reason: 'unverified' })
      return
    }
    deps.openFile(f.path)
  }

  const background = (p: Promise<unknown>): void => {
    p.catch((err: unknown) => deps.log('warn', 'updater', { error: String(err) }))
  }

  /** Show the "available" notice. `force` = the user asked (Check now), so a skipped version still shows. */
  const offer = (version: string, via: 'engine' | 'site', force: boolean): boolean => {
    if (!force && isSkipped(version)) return false
    // A download already under way / finished is not replaced by a re-check.
    if (notice && notice.phase !== 'available' && notice.version === bareVersion(version)) return false
    set({ phase: 'available', version: bareVersion(version), via })
    return true
  }

  /** Compare against the site / GitHub release info and point at a download. */
  async function siteCheck(force: boolean): Promise<UpdateCheckResult> {
    const current = deps.currentVersion
    try {
      const latest = await deps.fetchLatest()
      if (!latest) return { status: 'error', current }
      if (!isNewerVersion(latest.version, current)) return { status: 'up-to-date', current }
      if (!(await verifiedFor(latest.version))) return { status: 'unverified', current, latest: latest.version }
      offer(latest.version, 'site', force)
      return { status: 'available', current, latest: latest.version }
    } catch (err) {
      deps.log('warn', 'updater', { error: String(err) })
      return { status: 'error', current }
    }
  }

  async function autoFallback(): Promise<void> {
    if (fallbackDone || !deps.readSettings().autoCheck) return
    fallbackDone = true
    await siteCheck(false)
  }

  return {
    /** Wire the engine and schedule the launch check (only when the setting is on). */
    init(): void {
      deps.engine.autoDownload = false
      deps.engine.autoInstallOnAppQuit = false
      deps.engine.requestHeaders = { ...(deps.engine.requestHeaders ?? {}), ...NEUTRAL_REQUEST_HEADERS }
      deps.engine.on('update-available', ((info: { version: string }) => {
        background(
          verifiedFor(info.version).then((m) => {
            if (m) offer(info.version, 'engine', false)
          })
        )
      }) as (arg: never) => void)
      deps.engine.on('update-downloaded', ((info: { version: string; downloadedFile?: string }) => {
        const version = bareVersion(info.version)
        background(
          (async () => {
            const m = await verifiedFor(version)
            let ok = false
            try {
              ok =
                !!m &&
                typeof info.downloadedFile === 'string' &&
                !!assetWithHash(m, await deps.hashFile(info.downloadedFile), deps.engineAssetNames(version))
            } catch (err) {
              // A file that can't be read is not verified (fail closed: install-on-quit is disarmed).
              deps.log('warn', 'updater', { error: String(err) })
            }
            if (!ok) {
              // The file is not the one the signed manifest names: never install it, by any path.
              deps.log('warn', 'update-unverified', { version, file: 'downloaded' })
              deps.engine.autoInstallOnAppQuit = false
              if (onQuitVersion === version) onQuitVersion = null
              if (installVersion === version) installVersion = null
              if (notice?.version === version && notice.phase !== 'available') set(null)
              return
            }
            if (onQuitVersion === version) return
            set({ phase: 'ready', version, via: 'engine' })
          })()
        )
      }) as (arg: never) => void)
      deps.engine.on('error', ((err: unknown) => {
        deps.log('warn', 'updater', { error: String(err) })
        if (installVersion) {
          // Installing (now, or arming "Install when I quit") failed — typical for an unsigned macOS
          // build. Offer Total's own checked download through the same notice; nothing starts by itself.
          const version = installVersion
          installVersion = null
          onQuitVersion = null
          deps.engine.autoInstallOnAppQuit = false
          set({ phase: 'available', version, via: 'site' })
          return
        }
        if (notice?.phase === 'downloading' && notice.via === 'engine') {
          // The engine could not fetch it (typical for unsigned builds): the user already asked for the
          // download, so Total fetches and checks the installer itself (SEC2-2).
          background(handDownload(notice.version))
          return
        }
        void autoFallback()
      }) as (arg: never) => void)
      if (!deps.readSettings().autoCheck) return
      timer(() => {
        // Re-read: the user may have switched it off during the delay.
        if (!deps.readSettings().autoCheck) return
        deps.engine.checkForUpdates().catch(() => void autoFallback())
      }, deps.launchDelayMs ?? 5_000)
    },

    /** "Check now": always a real check (via the site), whatever the automatic setting says. */
    async checkNow(): Promise<UpdateCheckResult> {
      fallbackDone = false
      return siteCheck(true)
    },

    view(): UpdatesView {
      return { settings: deps.readSettings(), notice, current: deps.currentVersion }
    },

    setAutoCheck(autoCheck: boolean): UpdatesView {
      deps.writeSettings({ autoCheck })
      return this.view()
    },

    act(action: UpdateAction): UpdatesView {
      const n = notice
      if (action === 'download' && (n?.phase === 'available' || n?.phase === 'failed')) {
        if (n.via === 'engine' && n.phase === 'available') {
          set({ ...n, phase: 'downloading' })
          deps.engine.downloadUpdate().catch((err: unknown) => {
            deps.log('warn', 'updater', { error: String(err) })
            // electron-updater also emits 'error' for the same failure (handled above); fall back once.
            if (notice?.phase !== 'downloading' || notice.via !== 'engine' || notice.version !== n.version) return
            background(handDownload(n.version))
          })
        } else {
          // 'site' (macOS always) or "Try again" after a failed one: Total's own checked download.
          background(handDownload(n.version))
        }
      } else if ((action === 'openInstaller' || action === 'showInstaller') && n?.phase === 'checked') {
        const f = handFile
        if (f && f.version === n.version) {
          if (action === 'showInstaller') deps.showFile(f.path)
          else background(openChecked(f))
        }
      } else if (action === 'skip' && n && (n.phase === 'available' || n.phase === 'failed')) {
        deps.writeSettings({ skippedVersion: n.version })
        set(null)
      } else if (action === 'install' && n?.phase === 'ready') {
        installVersion = n.version
        deps.engine.quitAndInstall()
      } else if (action === 'installOnQuit' && n?.phase === 'ready') {
        // electron-updater decides install-on-quit when a download FINISHES (BaseUpdater adds its quit
        // handler, MacUpdater hands the file to Squirrel only if the flag is on), so flipping the flag
        // after the download does nothing by itself. Re-run the download: the cached file is re-validated
        // (no second download) and its completion now arms install-on-quit.
        deps.engine.autoInstallOnAppQuit = true
        onQuitVersion = n.version
        installVersion = n.version
        set(null)
        deps.engine.downloadUpdate().catch((err: unknown) => deps.log('warn', 'updater', { error: String(err) }))
      }
      return this.view()
    }
  }
}

export type Updater = ReturnType<typeof createUpdater>
