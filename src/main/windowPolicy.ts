// WP 7.2 / D7 Electron hardening — every rule for what a window may do, in one place:
//   - the main window's webPreferences (sandboxed renderer, context isolation, no Node, web security);
//   - window.open / target=_blank: no window is ever opened; only the allow-listed links (help
//     pages, mailto:, a WhatsApp chat — shared/externalLinks.ts) go to the OS, the rest is logged;
//   - navigation: a window never leaves the app (a dropped file, a stray link) — only the dev
//     server's own pages in dev;
//   - webviews are never attached;
//   - (audit 2026-11 A2) developer tools only in an unpackaged run: `devTools: false` in packaged
//     builds and an application menu without Toggle Developer Tools / Reload; every permission
//     request is denied except writing to the clipboard (Copy / Copy for SMS / WhatsApp);
//     a renderer may load only the app's own files (file: under the renderer folder, data:, blob:,
//     the dev server in dev) —
//     the network belongs to main (src/main/ai, gstGateway / nic, the updater), never a page.
// No runtime Electron import (types only), so the policy is unit-tested (windowPolicy.test.ts)
// against a fake web contents. main/index.ts applies it to every web contents created.
import type { MenuItemConstructorOptions, Session, WebContents, WebPreferences } from 'electron'
import { allowedExternalUrl } from '@shared/externalLinks'

export interface WindowPolicyDeps {
  openExternal: (url: string) => void
  log: (level: 'warn', event: string, data: Record<string, unknown>) => void
  /** The dev server URL (electron-vite's ELECTRON_RENDERER_URL) in dev, else undefined. */
  devUrl?: string
}

/** The main window's webPreferences. `sandbox: true` — the preload uses only `electron`
 *  (contextBridge / ipcRenderer) and the sandbox's own `process.platform` / `process.argv`. */
export function mainWindowWebPreferences(opts: { preload: string; e2eToday?: string | null; devTools?: boolean }): WebPreferences {
  return {
    preload: opts.preload,
    // Audit A2: developer tools only when unpackaged (index.ts passes !app.isPackaged); default off.
    devTools: opts.devTools === true,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    // Scripted runs only (TOTAL_E2E_TODAY, e2eClock.ts): the preload hands the day to the renderer.
    ...(opts.e2eToday ? { additionalArguments: [`--total-e2e-today=${opts.e2eToday}`] } : {})
  }
}

const schemeOf = (url: string): string => String(url ?? '').split(':')[0]?.slice(0, 16) ?? ''

/** window.open: the safe URL to hand to the OS, or null (refused). The window itself is always denied. */
export function windowOpenTarget(url: string): string | null {
  return allowedExternalUrl(url)
}

/** True when the window may navigate to `url` (only within the dev server, in dev). */
export function navigationAllowed(url: string, devUrl?: string): boolean {
  if (!devUrl || typeof url !== 'string') return false
  try {
    const u = new URL(url)
    const d = new URL(devUrl)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === d.origin
  } catch {
    return false
  }
}

type PolicyContents = Pick<WebContents, 'setWindowOpenHandler' | 'on'>

/** Wire the policy onto one web contents (the main window, the hidden PDF window, any other). */
export function applyWindowPolicy(contents: PolicyContents, deps: WindowPolicyDeps): void {
  contents.setWindowOpenHandler((details) => {
    const safe = windowOpenTarget(details.url)
    if (safe) deps.openExternal(safe)
    else deps.log('warn', 'window-open-refused', { scheme: schemeOf(details.url) })
    return { action: 'deny' }
  })
  const refuseNavigation = (event: { preventDefault: () => void }, url: string): void => {
    if (navigationAllowed(url, deps.devUrl)) return
    event.preventDefault()
    deps.log('warn', 'navigation-refused', { scheme: schemeOf(url) })
  }
  contents.on('will-navigate', refuseNavigation as never)
  contents.on('will-redirect', refuseNavigation as never)
  contents.on('will-attach-webview', ((event: { preventDefault: () => void }) => {
    event.preventDefault()
    deps.log('warn', 'webview-refused', {})
  }) as never)
}

/** The hidden PDF window (services/pdf.ts): the print HTML needs no script — JavaScript, Node,
 *  developer tools and anything but its own data: page are off (audit 2026-11 SEC-14). */
export function pdfWindowWebPreferences(): WebPreferences {
  return {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    javascript: false,
    devTools: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false
  }
}

/** The application menu: the OS's own menus (app / File / Edit / Window — Services, ⌘W, copy and
 *  paste included) with a View menu of our own. Packaged builds' View has no Toggle Developer
 *  Tools, Reload or Force Reload (Electron's default menu has all three, even when packaged —
 *  audit 2026-11 SEC-1). */
export function appMenuTemplate(opts: { isMac: boolean; packaged: boolean }): MenuItemConstructorOptions[] {
  const view: MenuItemConstructorOptions[] = [
    ...(opts.packaged ? [] : ([{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as MenuItemConstructorOptions[])),
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  ]
  return [
    ...(opts.isMac ? ([{ role: 'appMenu' }] as MenuItemConstructorOptions[]) : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: view },
    { role: 'windowMenu' }
  ]
}

/** Every role in a menu template, submenus included (tests: no developer tools when packaged). */
export function menuRoles(template: MenuItemConstructorOptions[]): string[] {
  const out: string[] = []
  const walk = (items: MenuItemConstructorOptions[]): void => {
    for (const it of items) {
      if (it.role) out.push(String(it.role))
      if (Array.isArray(it.submenu)) walk(it.submenu as MenuItemConstructorOptions[])
    }
  }
  walk(template)
  return out
}

/** The only permission a page may have: writing text to the clipboard (navigator.clipboard.writeText —
 *  SaveCard, ReminderPanel, Outstandings, e-invoice details, support / error copy, the AI panel).
 *  Camera, microphone, location, notifications, reading the clipboard … are all refused. */
export const ALLOWED_PERMISSIONS: readonly string[] = ['clipboard-sanitized-write']

export function permissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.includes(permission)
}

/** A request a page (a renderer) may make: the app's own files (file: under `appRoot`, the renderer
 *  folder — never another file on the disk, such as another company's books) and inline data; in dev
 *  also the dev server (its pages, assets and HMR socket). Everything else — any http(s) / ws host,
 *  any other file — is cancelled. Requests main makes itself (Node fetch, electron-updater's own
 *  session) carry no web contents and are not filtered here. */
export function rendererRequestAllowed(url: string, opts: { appRoot: string; devUrl?: string }): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'devtools:') return true
  if (u.protocol === 'file:') return fileUnder(u, opts.appRoot)
  const devUrl = opts.devUrl
  if (!devUrl) return false
  try {
    const d = new URL(devUrl)
    const wsProtocol = d.protocol === 'https:' ? 'wss:' : 'ws:'
    return u.host === d.host && (u.protocol === d.protocol || u.protocol === wsProtocol)
  } catch {
    return false
  }
}

/** True when a file: URL lies inside the folder `root` (a file: URL of a folder). The URL parser has
 *  already resolved `..` and `%2e` segments; drive letters / Windows paths compare without case. */
function fileUnder(u: URL, root: string): boolean {
  let r: URL
  try {
    r = new URL(root)
  } catch {
    return false
  }
  if (r.protocol !== 'file:' || u.host !== r.host) return false
  const norm = (p: string): string => {
    let d = p
    try {
      d = decodeURIComponent(p)
    } catch {
      return '\u0000'
    }
    d = d.replace(/\\/g, '/')
    return /^\/[A-Za-z]:\//.test(d) ? d.toLowerCase() : d
  }
  const base = norm(r.pathname).replace(/\/+$/, '') + '/'
  const path = norm(u.pathname)
  return path.startsWith(base) && !path.split('/').includes('..')
}

type HardenedSession = {
  setPermissionRequestHandler: Session['setPermissionRequestHandler']
  setPermissionCheckHandler: Session['setPermissionCheckHandler']
  webRequest: Pick<Session['webRequest'], 'onBeforeRequest'>
}

/** Deny-by-default permissions and the renderer request allowlist, on one session (the default one —
 *  every window of the app uses it). */
export function hardenSession(session: HardenedSession, deps: Pick<WindowPolicyDeps, 'log' | 'devUrl'> & { appRoot: string }): void {
  session.setPermissionRequestHandler((_contents, permission, callback) => {
    const ok = permissionAllowed(permission)
    if (!ok) deps.log('warn', 'permission-refused', { permission: String(permission).slice(0, 40) })
    callback(ok)
  })
  session.setPermissionCheckHandler((_contents, permission) => permissionAllowed(permission))
  session.webRequest.onBeforeRequest((details, callback) => {
    // Main's own requests (no web contents) are not a page's; only pages are held to the allowlist.
    if (details.webContentsId == null || rendererRequestAllowed(details.url, { appRoot: deps.appRoot, ...(deps.devUrl ? { devUrl: deps.devUrl } : {}) })) return callback({})
    deps.log('warn', 'renderer-request-refused', { scheme: schemeOf(details.url) })
    callback({ cancel: true })
  })
}
