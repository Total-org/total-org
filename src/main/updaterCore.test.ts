import { describe, expect, it, vi } from 'vitest'
import { createUpdater, makeFetchLatest, NEUTRAL_REQUEST_HEADERS, type UpdateEngine, type UpdaterDeps } from './updaterCore'
import type { UpdateNotice, UpdateSettings } from '@shared/updates'
import type { ReleaseManifest } from './releaseManifest'
import { InstallerMismatch } from './installerDownload'

type Listener = (arg: never) => void

const GOOD_HASH = 'a'.repeat(128)
const OTHER_HASH = 'c'.repeat(128)
/** A verified manifest for `version` whose installer has GOOD_HASH (the wiring's real check is releaseManifest.test.ts);
 *  `latest.yml` stands for another signed asset this platform must NOT install (SEC2-5). */
const manifestFor = (version: string): ReleaseManifest => ({
  version: version.replace(/^v/, ''),
  assets: [
    { name: `Total-Setup-${version.replace(/^v/, '')}.exe`, size: 1, sha256: 'b'.repeat(64), sha512: GOOD_HASH },
    { name: 'latest.yml', size: 1, sha256: 'd'.repeat(64), sha512: OTHER_HASH }
  ]
})
/** What the fake checked download does: keep the file, report a mismatch, or fail on the network. */
type HandResult = 'ok' | 'mismatch' | 'network' | 'disk' | 'manual'
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function setup(
  opts: { settings?: Partial<UpdateSettings>; latest?: { version: string } | null; current?: string; signed?: (v: string) => boolean; fileHash?: string; hand?: HandResult } = {}
) {
  let settings: UpdateSettings = { autoCheck: true, skippedVersion: null, ...opts.settings }
  const listeners = new Map<string, Listener>()
  const timers: (() => void)[] = []
  const engine = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    requestHeaders: null as Record<string, string> | null,
    checkForUpdates: vi.fn(async () => undefined),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    on: (ev: string, fn: Listener) => void listeners.set(ev, fn)
  } satisfies UpdateEngine
  const published: (UpdateNotice | null)[] = []
  /** Files the user opened / was shown / that were deleted, and the installers downloaded. */
  const opened: string[] = []
  const shown: string[] = []
  const removed: string[] = []
  const downloads: string[] = []
  /** With hand 'manual': each download waits here until the test settles it. */
  const pending: { name: string; resolve(p: string): void; reject(e: Error): void }[] = []
  let hand: HandResult = opts.hand ?? 'ok'
  let fileHash = opts.fileHash ?? GOOD_HASH
  const fetchLatest = vi.fn(async () => (opts.latest === undefined ? null : opts.latest))
  let hashThrows = false
  const verifyRelease = vi.fn(async (v: string) => ((opts.signed ?? (() => true))(v) ? manifestFor(v) : null))
  const deps: UpdaterDeps = {
    engine,
    currentVersion: opts.current ?? '0.12.0',
    readSettings: () => settings,
    writeSettings: (patch) => (settings = { ...settings, ...patch }),
    fetchLatest,
    verifyRelease,
    installerFor: (m) => m.assets.find((a) => a.name.endsWith('.exe')) ?? null,
    engineAssetNames: (v) => [`Total-Setup-${v}.exe`],
    downloadInstaller: async (_m, asset) => {
      downloads.push(asset.name)
      if (hand === 'mismatch') throw new InstallerMismatch('SHA-512 differs')
      if (hand === 'network') throw new Error('ECONNRESET')
      if (hand === 'disk') throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
      if (hand === 'manual') return new Promise<string>((resolve, reject) => pending.push({ name: asset.name, resolve, reject }))
      return `/Downloads/${asset.name}`
    },
    hashFile: async () => {
      if (hashThrows) throw new Error('EBUSY')
      return fileHash
    },
    openFile: (p) => void opened.push(p),
    showFile: (p) => void shown.push(p),
    removeFile: (p) => void removed.push(p),
    publish: (n) => void published.push(n),
    log: () => {},
    setTimer: (fn) => void timers.push(fn)
  }
  const u = createUpdater(deps)
  /** Emit an engine event and let the manifest check (async) settle. */
  const emit = async (ev: string, arg: unknown): Promise<void> => {
    ;(listeners.get(ev) as (a: unknown) => void)(arg)
    await flush()
    await flush()
  }
  return {
    u,
    engine,
    emit,
    timers,
    published,
    opened,
    shown,
    removed,
    downloads,
    pending,
    fetchLatest,
    verifyRelease,
    settings: () => settings,
    hashFails: () => void (hashThrows = true),
    setHand: (r: HandResult) => void (hand = r),
    setFileHash: (h: string) => void (fileHash = h)
  }
}

describe('update consent flow', () => {
  it('never downloads or installs on its own: both engine flags are forced off', async () => {
    const t = setup()
    t.u.init()
    expect(t.engine.autoDownload).toBe(false)
    expect(t.engine.autoInstallOnAppQuit).toBe(false)
  })

  it('available -> download now -> downloaded -> restart', async () => {
    const t = setup()
    t.u.init()
    await t.emit('update-available', { version: '0.13.0' })
    expect(t.u.view().notice).toEqual({ phase: 'available', version: '0.13.0', via: 'engine' })
    expect(t.engine.downloadUpdate).not.toHaveBeenCalled()

    t.u.act('download')
    expect(t.engine.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(t.u.view().notice?.phase).toBe('downloading')

    await t.emit('update-downloaded', { version: '0.13.0', downloadedFile: '/tmp/Total-Setup-0.13.0.exe' })
    expect(t.u.view().notice).toEqual({ phase: 'ready', version: '0.13.0', via: 'engine' })
    expect(t.engine.quitAndInstall).not.toHaveBeenCalled()

    t.u.act('install')
    expect(t.engine.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('"install when I quit" is the only thing that turns on install-on-quit', async () => {
    const t = setup()
    t.u.init()
    await t.emit('update-available', { version: '0.13.0' })
    t.u.act('download')
    await t.emit('update-downloaded', { version: '0.13.0', downloadedFile: '/tmp/Total-Setup-0.13.0.exe' })
    expect(t.engine.autoInstallOnAppQuit).toBe(false)
    t.u.act('installOnQuit')
    expect(t.engine.autoInstallOnAppQuit).toBe(true)
    expect(t.engine.quitAndInstall).not.toHaveBeenCalled()
  })

  it('"install when I quit" re-arms the finished download (electron-updater only arms install-on-quit when a download completes) without showing "ready" again', async () => {
    const t = setup()
    t.u.init()
    await t.emit('update-available', { version: '0.13.0' })
    t.u.act('download')
    await t.emit('update-downloaded', { version: '0.13.0', downloadedFile: '/tmp/Total-Setup-0.13.0.exe' })
    t.u.act('installOnQuit')
    // The flag is on BEFORE the second downloadUpdate call (the cached file completes it and arms the quit handler).
    expect(t.engine.downloadUpdate).toHaveBeenCalledTimes(2)
    await t.emit('update-downloaded', { version: '0.13.0', downloadedFile: '/tmp/Total-Setup-0.13.0.exe' })
    expect(t.u.view().notice).toBeNull()
  })

  it('"Later" after the download leaves install-on-quit off', async () => {
    const t = setup()
    t.u.init()
    await t.emit('update-available', { version: '0.13.0' })
    t.u.act('download')
    await t.emit('update-downloaded', { version: '0.13.0', downloadedFile: '/tmp/Total-Setup-0.13.0.exe' })
    // "Later" is renderer-only: main is never told, so nothing changes here.
    expect(t.engine.autoInstallOnAppQuit).toBe(false)
    expect(t.engine.quitAndInstall).not.toHaveBeenCalled()
  })

  it('an install that fails (unsigned macOS) turns into the release-page notice, never a silent nothing', async () => {
    const t = setup({ settings: { autoCheck: false } })
    t.u.init()
    await t.emit('update-available', { version: '0.13.0' })
    t.u.act('download')
    await t.emit('update-downloaded', { version: '0.13.0', downloadedFile: '/tmp/Total-Setup-0.13.0.exe' })
    t.u.act('install')
    await t.emit('error', new Error('Code signature did not pass validation'))
    expect(t.u.view().notice).toEqual({ phase: 'available', version: '0.13.0', via: 'site' })
    expect(t.downloads).toEqual([])
    t.u.act('download')
    await flush()
    expect(t.downloads).toEqual(['Total-Setup-0.13.0.exe'])
    expect(t.u.view().notice).toEqual({ phase: 'checked', version: '0.13.0', via: 'site' })
    expect(t.opened).toEqual([]) // shown only, opened only on a click
  })

  it('a failed "install when I quit" also falls back and turns install-on-quit off again', async () => {
    const t = setup()
    t.u.init()
    await t.emit('update-available', { version: '0.13.0' })
    t.u.act('download')
    await t.emit('update-downloaded', { version: '0.13.0', downloadedFile: '/tmp/Total-Setup-0.13.0.exe' })
    t.u.act('installOnQuit')
    await t.emit('error', new Error('squirrel'))
    expect(t.engine.autoInstallOnAppQuit).toBe(false)
    expect(t.u.view().notice).toEqual({ phase: 'available', version: '0.13.0', via: 'site' })
  })

  it('a failed engine download falls back to ONE checked download (electron-updater both emits error and rejects)', async () => {
    const t = setup()
    t.u.init()
    await t.emit('update-available', { version: '0.13.0' })
    let reject: (e: Error) => void = () => {}
    t.engine.downloadUpdate.mockImplementationOnce(() => new Promise((_r, j) => (reject = j)))
    t.u.act('download')
    await t.emit('error', new Error('boom'))
    reject(new Error('boom'))
    await flush()
    await flush()
    expect(t.downloads).toEqual(['Total-Setup-0.13.0.exe'])
    expect(t.u.view().notice).toEqual({ phase: 'checked', version: '0.13.0', via: 'site' })
    expect(t.opened).toEqual([])
  })

  it('blanks electron-updater\'s per-install id header', () => {
    const t = setup()
    t.u.init()
    expect(t.engine.requestHeaders).toEqual(NEUTRAL_REQUEST_HEADERS)
    expect(NEUTRAL_REQUEST_HEADERS['x-user-staging-id']).toMatch(/^0{8}-0{4}-0{4}-0{4}-0{12}$/)
  })

  it('actions that do not fit the phase do nothing', async () => {
    const t = setup()
    t.u.init()
    t.u.act('download')
    t.u.act('install')
    t.u.act('skip')
    expect(t.engine.downloadUpdate).not.toHaveBeenCalled()
    expect(t.engine.quitAndInstall).not.toHaveBeenCalled()
    expect(t.settings().skippedVersion).toBeNull()
  })

  it('skip this version is remembered: automatic checks stay quiet, a newer one shows, Check now still shows it', async () => {
    const t = setup({ latest: { version: '0.13.0' } })
    t.u.init()
    await t.emit('update-available', { version: '0.13.0' })
    t.u.act('skip')
    expect(t.settings().skippedVersion).toBe('0.13.0')
    expect(t.u.view().notice).toBeNull()

    await t.emit('update-available', { version: 'v0.13.0' })
    expect(t.u.view().notice).toBeNull()

    await t.emit('update-available', { version: '0.14.0' })
    expect(t.u.view().notice?.version).toBe('0.14.0')

    t.u.act('skip')
    const r = await t.u.checkNow() // the user asked: shown even though 0.13.0 was skipped
    expect(r.status).toBe('available')
    expect(t.u.view().notice?.version).toBe('0.13.0')
  })

  it('the site fallback downloads in main (no engine download, no browser), same notice', async () => {
    const t = setup({ latest: { version: 'v0.13.0' } })
    t.u.init()
    await t.emit('error', new Error('no signature'))
    await vi.waitFor(() => expect(t.u.view().notice).toEqual({ phase: 'available', version: '0.13.0', via: 'site' }))
    t.u.act('download')
    expect(t.u.view().notice).toEqual({ phase: 'downloading', version: '0.13.0', via: 'site' })
    await flush()
    expect(t.downloads).toEqual(['Total-Setup-0.13.0.exe'])
    expect(t.engine.downloadUpdate).not.toHaveBeenCalled()
    expect(t.u.view().notice).toEqual({ phase: 'checked', version: '0.13.0', via: 'site' })
  })

  it('a failed engine download hands over to the checked download', async () => {
    const t = setup()
    t.engine.downloadUpdate.mockRejectedValueOnce(new Error('boom'))
    t.u.init()
    await t.emit('update-available', { version: '0.13.0' })
    t.u.act('download')
    await vi.waitFor(() => expect(t.u.view().notice).toEqual({ phase: 'checked', version: '0.13.0', via: 'site' }))
    expect(t.downloads).toEqual(['Total-Setup-0.13.0.exe'])
  })

  it('Check now reports up-to-date / error', async () => {
    expect((await setup({ latest: { version: '0.12.0' } }).u.checkNow()).status).toBe('up-to-date')
    expect((await setup({ latest: null }).u.checkNow()).status).toBe('error')
  })
})

describe('signed release manifest (audit A4)', () => {
  it('a version whose manifest is missing / does not verify is never offered by the engine', async () => {
    const t = setup({ signed: () => false })
    t.u.init()
    await t.emit('update-available', { version: '0.13.0' })
    expect(t.u.view().notice).toBeNull()
    expect(t.verifyRelease).toHaveBeenCalledWith('0.13.0')
    t.u.act('download')
    expect(t.engine.downloadUpdate).not.toHaveBeenCalled()
  })

  it('Check now says "unverified" and shows no notice when the newer version is not signed', async () => {
    const t = setup({ latest: { version: '0.13.0' }, signed: (v) => v !== '0.13.0' })
    const r = await t.u.checkNow()
    expect(r).toEqual({ status: 'unverified', current: '0.12.0', latest: '0.13.0' })
    expect(t.u.view().notice).toBeNull()
  })

  it('an up-to-date check needs no manifest (older releases stay as they are)', async () => {
    const t = setup({ latest: { version: '0.12.0' }, signed: () => false })
    expect((await t.u.checkNow()).status).toBe('up-to-date')
    expect(t.verifyRelease).not.toHaveBeenCalled()
  })

  it('a download whose SHA-512 is not in the manifest never becomes "ready" and is never installed', async () => {
    const t = setup({ fileHash: 'c'.repeat(128) })
    t.u.init()
    await t.emit('update-available', { version: '0.13.0' })
    t.u.act('download')
    await t.emit('update-downloaded', { version: '0.13.0', downloadedFile: '/tmp/evil.exe' })
    expect(t.u.view().notice).toBeNull()
    t.u.act('install')
    t.u.act('installOnQuit')
    expect(t.engine.quitAndInstall).not.toHaveBeenCalled()
    expect(t.engine.autoInstallOnAppQuit).toBe(false)
  })

  it('a re-armed "install when I quit" whose file no longer matches turns install-on-quit off again', async () => {
    const t = setup()
    t.u.init()
    await t.emit('update-available', { version: '0.13.0' })
    t.u.act('download')
    await t.emit('update-downloaded', { version: '0.13.0', downloadedFile: '/tmp/a.exe' })
    t.u.act('installOnQuit')
    expect(t.engine.autoInstallOnAppQuit).toBe(true)
    await t.emit('update-downloaded', { version: '0.13.0' }) // no file to check = not verified
    expect(t.engine.autoInstallOnAppQuit).toBe(false)
  })

  it('a hash that cannot be computed fails closed: install-on-quit disarmed, no stuck "downloading"', async () => {
    const t = setup()
    t.u.init()
    await t.emit('update-available', { version: '0.13.0' })
    t.u.act('download')
    await t.emit('update-downloaded', { version: '0.13.0', downloadedFile: '/tmp/a.exe' })
    t.u.act('installOnQuit')
    expect(t.engine.autoInstallOnAppQuit).toBe(true)
    t.hashFails()
    await t.emit('update-downloaded', { version: '0.13.0', downloadedFile: '/tmp/a.exe' })
    expect(t.engine.autoInstallOnAppQuit).toBe(false)

    const f = setup()
    f.hashFails()
    f.u.init()
    await f.emit('update-available', { version: '0.13.0' })
    f.u.act('download')
    await f.emit('update-downloaded', { version: '0.13.0', downloadedFile: '/tmp/a.exe' })
    expect(f.u.view().notice).toBeNull()
  })

  it('a download event without a file is not verified', async () => {
    const t = setup()
    t.u.init()
    await t.emit('update-available', { version: '0.13.0' })
    t.u.act('download')
    await t.emit('update-downloaded', { version: '0.13.0' })
    expect(t.u.view().notice).toBeNull()
  })

  it('the site fallback downloads the installer the manifest names, never the site\'s answer', async () => {
    const t = setup({ latest: { version: '0.13.0' } })
    await t.u.checkNow()
    t.u.act('download')
    await flush()
    expect(t.downloads).toEqual(['Total-Setup-0.13.0.exe'])
  })

  it('SEC2-5: an engine download that matches another signed asset (not this platform\'s installer) is never "ready"', async () => {
    const t = setup({ fileHash: OTHER_HASH })
    t.u.init()
    await t.emit('update-available', { version: '0.13.0' })
    t.u.act('download')
    await t.emit('update-downloaded', { version: '0.13.0', downloadedFile: '/tmp/Total-Setup-0.13.0.exe' })
    expect(t.u.view().notice).toBeNull()
    t.u.act('install')
    expect(t.engine.quitAndInstall).not.toHaveBeenCalled()
  })
})

describe('the checked hand download (audit 2 SEC2-2)', () => {
  const checked = async (opts: Parameters<typeof setup>[0] = {}) => {
    const t = setup({ latest: { version: '0.13.0' }, ...opts })
    await t.u.checkNow()
    t.u.act('download')
    await flush()
    return t
  }

  it('nothing is downloaded before the click; after it the file is shown / opened only on a click', async () => {
    const t = setup({ latest: { version: '0.13.0' } })
    await t.u.checkNow()
    expect(t.downloads).toEqual([])
    t.u.act('download')
    await flush()
    expect(t.u.view().notice).toEqual({ phase: 'checked', version: '0.13.0', via: 'site' })
    expect(t.opened).toEqual([])
    t.u.act('showInstaller')
    expect(t.shown).toEqual(['/Downloads/Total-Setup-0.13.0.exe'])
    t.u.act('openInstaller')
    await flush()
    expect(t.opened).toEqual(['/Downloads/Total-Setup-0.13.0.exe'])
    expect(t.removed).toEqual([])
  })

  it('a download that does not match the manifest says so and opens nothing; Try again downloads again', async () => {
    const t = await checked({ hand: 'mismatch' })
    expect(t.u.view().notice).toEqual({ phase: 'failed', version: '0.13.0', via: 'site', reason: 'unverified' })
    t.u.act('openInstaller')
    t.u.act('showInstaller')
    await flush()
    expect(t.opened).toEqual([])
    expect(t.shown).toEqual([])
    t.setHand('ok')
    t.u.act('download')
    await flush()
    expect(t.downloads).toEqual(['Total-Setup-0.13.0.exe', 'Total-Setup-0.13.0.exe'])
    expect(t.u.view().notice?.phase).toBe('checked')
  })

  it('a network failure is told apart from a mismatch', async () => {
    const t = await checked({ hand: 'network' })
    expect(t.u.view().notice).toEqual({ phase: 'failed', version: '0.13.0', via: 'site', reason: 'download' })
  })

  it('a file changed after the check is deleted, never opened', async () => {
    const t = await checked()
    t.setFileHash('e'.repeat(128))
    t.u.act('openInstaller')
    await flush()
    expect(t.opened).toEqual([])
    expect(t.removed).toEqual(['/Downloads/Total-Setup-0.13.0.exe'])
    expect(t.u.view().notice).toEqual({ phase: 'failed', version: '0.13.0', via: 'site', reason: 'unverified' })
    t.u.act('showInstaller')
    expect(t.shown).toEqual([])
  })

  it('a hash that cannot be computed before opening fails closed', async () => {
    const t = await checked()
    t.hashFails()
    t.u.act('openInstaller')
    await flush()
    expect(t.opened).toEqual([])
    expect(t.u.view().notice?.phase).toBe('failed')
  })

  it('a release whose manifest names no installer for this computer downloads nothing', async () => {
    const t = setup({ latest: { version: '0.13.0' } })
    await t.u.checkNow()
    t.setHand('ok')
    // The manifest is verified, but the platform rule finds no installer in it.
    const m = await t.verifyRelease.mock.results[0]!.value
    m.assets = m.assets.filter((a: { name: string }) => !a.name.endsWith('.exe'))
    t.u.act('download')
    await flush()
    expect(t.downloads).toEqual([])
    expect(t.u.view().notice).toEqual({ phase: 'failed', version: '0.13.0', via: 'site', reason: 'noInstaller' })
  })

  it('a disk / folder error is told apart from the internet (review of #270)', async () => {
    const t = await checked({ hand: 'disk' })
    expect(t.u.view().notice).toEqual({ phase: 'failed', version: '0.13.0', via: 'site', reason: 'save' })
  })

  it('an older download that ends after a newer one started never replaces it (review of #270)', async () => {
    const t = setup({ latest: { version: '0.13.0' }, hand: 'manual' })
    await t.u.checkNow()
    t.u.act('download') // 0.13.0, still running
    await flush()
    // A newer release is found and downloaded while 0.13.0 is still coming in.
    t.fetchLatest.mockResolvedValueOnce({ version: '0.13.1' })
    await t.u.checkNow()
    expect(t.u.view().notice).toEqual({ phase: 'available', version: '0.13.1', via: 'site' })
    t.u.act('download')
    await flush()
    expect(t.pending.map((p) => p.name)).toEqual(['Total-Setup-0.13.0.exe', 'Total-Setup-0.13.1.exe'])
    t.pending[1]!.resolve('/D/Total-Setup-0.13.1.exe')
    await flush()
    t.pending[0]!.resolve('/D/Total-Setup-0.13.0.exe')
    await flush()
    expect(t.u.view().notice).toEqual({ phase: 'checked', version: '0.13.1', via: 'site' })
    expect(t.removed).toEqual(['/D/Total-Setup-0.13.0.exe'])
    t.u.act('showInstaller')
    expect(t.shown).toEqual(['/D/Total-Setup-0.13.1.exe'])
  })

  it('an older download that fails late leaves a newer notice alone', async () => {
    const t = setup({ latest: { version: '0.13.0' }, hand: 'manual' })
    await t.u.checkNow()
    t.u.act('download')
    await flush()
    t.fetchLatest.mockResolvedValueOnce({ version: '0.13.1' })
    await t.u.checkNow()
    t.pending[0]!.reject(new Error('ECONNRESET'))
    await flush()
    expect(t.u.view().notice).toEqual({ phase: 'available', version: '0.13.1', via: 'site' })
  })

  it('skip still works on a failed notice; actions out of phase do nothing', async () => {
    const t = await checked({ hand: 'network' })
    t.u.act('skip')
    expect(t.settings().skippedVersion).toBe('0.13.0')
    expect(t.u.view().notice).toBeNull()
    t.u.act('openInstaller')
    t.u.act('showInstaller')
    await flush()
    expect(t.opened).toEqual([])
    expect(t.shown).toEqual([])
  })
})

describe('"Check for updates automatically" gate', () => {
  it('on: the launch check runs after the delay', async () => {
    const t = setup()
    t.u.init()
    expect(t.timers).toHaveLength(1)
    t.timers[0]!()
    expect(t.engine.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('off: no check is scheduled or made at launch, and an engine error makes no site request', async () => {
    const t = setup({ settings: { autoCheck: false }, latest: { version: '9.9.9' } })
    t.u.init()
    expect(t.timers).toHaveLength(0)
    await t.emit('error', new Error('x'))
    expect(t.engine.checkForUpdates).not.toHaveBeenCalled()
    expect(t.fetchLatest).not.toHaveBeenCalled()
  })

  it('switched off during the launch delay: the delayed check does not run', async () => {
    const t = setup()
    t.u.init()
    t.u.setAutoCheck(false)
    t.timers[0]!()
    expect(t.engine.checkForUpdates).not.toHaveBeenCalled()
    expect(t.u.view().settings.autoCheck).toBe(false)
  })

  it('off: Check now still works when the user asks', async () => {
    const t = setup({ settings: { autoCheck: false }, latest: { version: '0.13.0' } })
    t.u.init()
    expect((await t.u.checkNow()).status).toBe('available')
    expect(t.fetchLatest).toHaveBeenCalledTimes(1)
  })
})

describe('no request when off: the three network paths stubbed', () => {
  // electron-updater's feed (engine.checkForUpdates), the site's /api/latest and api.github.com (both
  // through the real makeFetchLatest with a stubbed fetch).
  function wired(autoCheck: boolean) {
    const fetchImpl = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes('api.github.com') ? { tag_name: 'v0.13.0' } : { version: '0.13.0' })
    }))
    const fetchLatest = makeFetchLatest(fetchImpl, {
      siteLatestUrl: 'https://site.test/api/latest',
      githubRepo: 'o/r',
      releasesUrl: 'https://github.com/o/r/releases/latest',
      log: () => {}
    })
    const listeners = new Map<string, (a: unknown) => void>()
    const timers: (() => void)[] = []
    const engine = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      checkForUpdates: vi.fn(async () => {
        throw new Error('unsigned')
      }),
      downloadUpdate: vi.fn(async () => undefined),
      quitAndInstall: vi.fn(),
      on: (ev: string, fn: (a: never) => void) => void listeners.set(ev, fn as (a: unknown) => void)
    } satisfies UpdateEngine
    const u = createUpdater({
      engine,
      currentVersion: '0.12.0',
      readSettings: () => ({ autoCheck, skippedVersion: null }),
      writeSettings: () => ({ autoCheck, skippedVersion: null }),
      fetchLatest,
      verifyRelease: async (v) => manifestFor(v),
      installerFor: () => null,
      engineAssetNames: () => [],
      downloadInstaller: async () => {
        throw new Error('not here')
      },
      hashFile: async () => GOOD_HASH,
      openFile: () => {},
      showFile: () => {},
      removeFile: () => {},
      publish: () => {},
      log: () => {},
      setTimer: (fn) => void timers.push(fn)
    })
    return { u, engine, fetchImpl, timers, emit: (ev: string, a: unknown) => listeners.get(ev)?.(a) }
  }

  it('off: launch, the launch timer and an engine error make no request on any path', async () => {
    const t = wired(false)
    t.u.init()
    for (const fn of t.timers) fn()
    await t.emit('error', new Error('x'))
    await new Promise((r) => setTimeout(r, 0))
    expect(t.engine.checkForUpdates).not.toHaveBeenCalled()
    expect(t.fetchImpl).not.toHaveBeenCalled()
  })

  it('off: Check now asks the site (and only what the user asked for)', async () => {
    const t = wired(false)
    t.u.init()
    expect((await t.u.checkNow()).status).toBe('available')
    expect(t.fetchImpl.mock.calls.map((c) => c[0])).toEqual(['https://site.test/api/latest'])
    expect(t.engine.checkForUpdates).not.toHaveBeenCalled()
  })

  it('on: the launch check goes to the feed, and its failure falls back to the site', async () => {
    const t = wired(true)
    t.u.init()
    t.timers[0]!()
    await vi.waitFor(() => expect(t.fetchImpl).toHaveBeenCalledWith('https://site.test/api/latest'))
    expect(t.engine.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('the site down: falls back to api.github.com', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('site.test')) throw new Error('offline')
      return { ok: true, json: async () => ({ tag_name: 'v0.13.0', html_url: 'https://gh/rel' }) }
    })
    const latest = await makeFetchLatest(fetchImpl, { siteLatestUrl: 'https://site.test/api/latest', githubRepo: 'o/r', releasesUrl: 'x', log: () => {} })()
    expect(latest).toEqual({ version: 'v0.13.0' })
    expect(fetchImpl.mock.calls[1]![0]).toBe('https://api.github.com/repos/o/r/releases/latest')
  })
})
