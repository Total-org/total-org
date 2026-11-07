import { describe, expect, it } from 'vitest'
import {
  appMenuTemplate, applyWindowPolicy, hardenSession, mainWindowWebPreferences, menuRoles, navigationAllowed, pdfWindowWebPreferences, permissionAllowed,
  rendererRequestAllowed, windowOpenTarget
} from './windowPolicy'

function fakeContents() {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  let openHandler: ((d: { url: string }) => { action: string }) | null = null
  return {
    contents: {
      setWindowOpenHandler: (h: (d: { url: string }) => { action: string }) => void (openHandler = h),
      on: (ev: string, fn: (...args: unknown[]) => void) => {
        listeners.set(ev, fn)
        return undefined as never
      }
    },
    open: (url: string) => openHandler!({ url }),
    fire: (ev: string, url?: string) => {
      let prevented = false
      listeners.get(ev)!({ preventDefault: () => void (prevented = true) }, url)
      return prevented
    },
    has: (ev: string) => listeners.has(ev)
  }
}

describe('mainWindowWebPreferences', () => {
  it('sandboxed, isolated, no Node, web security on', () => {
    const p = mainWindowWebPreferences({ preload: '/x/preload/index.js' })
    expect(p).toMatchObject({
      preload: '/x/preload/index.js', sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false
    })
    expect(p.additionalArguments).toBeUndefined()
  })
  it('passes the e2e day only when set', () => {
    expect(mainWindowWebPreferences({ preload: 'p', e2eToday: '2026-05-01' }).additionalArguments).toEqual(['--total-e2e-today=2026-05-01'])
  })
})

describe('window policy', () => {
  it('window.open: always denied; only allow-listed links reach the OS', () => {
    const f = fakeContents()
    const opened: string[] = []
    const logged: string[] = []
    applyWindowPolicy(f.contents as never, { openExternal: (u) => opened.push(u), log: (_l, ev) => logged.push(ev) })
    expect(f.open('https://www.gst.gov.in').action).toBe('deny')
    expect(f.open('mailto:a@b.c').action).toBe('deny')
    expect(f.open('https://evil.example/').action).toBe('deny')
    expect(f.open('file:///etc/passwd').action).toBe('deny')
    expect(opened).toEqual(['https://www.gst.gov.in/', 'mailto:a@b.c'])
    expect(logged).toEqual(['window-open-refused', 'window-open-refused'])
    expect(windowOpenTarget('javascript:alert(1)')).toBeNull()
  })

  it('navigation and redirects are refused (dev server origin allowed in dev only)', () => {
    const f = fakeContents()
    applyWindowPolicy(f.contents as never, { openExternal: () => {}, log: () => {} })
    expect(f.fire('will-navigate', 'https://evil.example/')).toBe(true)
    expect(f.fire('will-navigate', 'file:///tmp/dropped.html')).toBe(true)
    expect(f.fire('will-redirect', 'https://evil.example/')).toBe(true)
    const d = fakeContents()
    applyWindowPolicy(d.contents as never, { openExternal: () => {}, log: () => {}, devUrl: 'http://localhost:5173' })
    expect(d.fire('will-navigate', 'http://localhost:5173/x')).toBe(false)
    expect(d.fire('will-navigate', 'http://localhost:5173.evil.example/')).toBe(true)
    expect(d.fire('will-navigate', 'https://evil.example/')).toBe(true)
    expect(navigationAllowed('http://localhost:5173/', undefined)).toBe(false)
  })

  it('webviews are never attached', () => {
    const f = fakeContents()
    const logged: string[] = []
    applyWindowPolicy(f.contents as never, { openExternal: () => {}, log: (_l, ev) => logged.push(ev) })
    expect(f.fire('will-attach-webview')).toBe(true)
    expect(logged).toEqual(['webview-refused'])
  })
})

// Audit 2026-11 A2.
describe('developer tools and the menu (audit A2)', () => {
  it('devTools only when asked for (unpackaged); off by default', () => {
    expect(mainWindowWebPreferences({ preload: 'p' }).devTools).toBe(false)
    expect(mainWindowWebPreferences({ preload: 'p', devTools: false }).devTools).toBe(false)
    expect(mainWindowWebPreferences({ preload: 'p', devTools: true }).devTools).toBe(true)
  })
  it('the PDF window: no script, no devtools, sandboxed', () => {
    expect(pdfWindowWebPreferences()).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, devTools: false, webSecurity: true })
  })
  for (const isMac of [true, false]) {
    it(`packaged menu (${isMac ? 'macOS' : 'Windows'}) has no developer tools or reload, keeps copy / paste`, () => {
      const roles = menuRoles(appMenuTemplate({ isMac, packaged: true, appName: 'Total' }))
      for (const r of ['toggleDevTools', 'reload', 'forceReload']) expect(roles).not.toContain(r)
      for (const r of ['copy', 'paste', 'cut', 'selectAll', 'undo', 'quit']) expect(roles).toContain(r)
    })
    it(`unpackaged menu (${isMac ? 'macOS' : 'Windows'}) keeps them for development`, () => {
      const roles = menuRoles(appMenuTemplate({ isMac, packaged: false, appName: 'Total' }))
      expect(roles).toEqual(expect.arrayContaining(['toggleDevTools', 'reload', 'forceReload']))
    })
  }
})

describe('permissions and renderer requests (audit A2)', () => {
  it('only clipboard write is allowed', () => {
    expect(permissionAllowed('clipboard-sanitized-write')).toBe(true)
    for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'openExternal', 'fullscreen', 'display-capture', 'hid', 'serial', 'usb', 'unknown'])
      expect(permissionAllowed(p)).toBe(false)
  })
  it('a page loads only the app files and inline data', () => {
    for (const u of ['file:///Applications/Total.app/Contents/Resources/app.asar/out/renderer/index.html', 'data:image/png;base64,AA', 'blob:file:///abc', 'devtools://devtools/bundled/x.html'])
      expect(rendererRequestAllowed(u)).toBe(true)
    for (const u of ['https://api.openai.com/v1/x', 'http://127.0.0.1:5173/', 'ws://localhost:5173/', 'https://fonts.googleapis.com/css', 'ftp://x/y', 'not a url', ''])
      expect(rendererRequestAllowed(u)).toBe(false)
  })
  it('in dev, the dev server and its HMR socket too — no other host or port', () => {
    const dev = 'http://localhost:5173'
    expect(rendererRequestAllowed('http://localhost:5173/src/main.tsx', dev)).toBe(true)
    expect(rendererRequestAllowed('ws://localhost:5173/', dev)).toBe(true)
    expect(rendererRequestAllowed('http://localhost:5174/', dev)).toBe(false)
    expect(rendererRequestAllowed('https://evil.example/', dev)).toBe(false)
  })
  it('hardenSession wires the handlers: refuses, allows clipboard, lets main-process requests through', () => {
    let request: ((c: unknown, p: string, cb: (ok: boolean) => void) => void) | null = null
    let check: ((c: unknown, p: string) => boolean) | null = null
    let before: ((d: { url: string; webContentsId?: number }, cb: (r: { cancel?: boolean }) => void) => void) | null = null
    const logs: string[] = []
    hardenSession({
      setPermissionRequestHandler: ((h: never) => void (request = h)) as never,
      setPermissionCheckHandler: ((h: never) => void (check = h)) as never,
      webRequest: { onBeforeRequest: ((h: never) => void (before = h)) as never }
    }, { log: (_l, e) => void logs.push(e) })
    const asked = (p: string): boolean => {
      let r = true
      request!(null, p, (ok) => void (r = ok))
      return r
    }
    expect(asked('media')).toBe(false)
    expect(asked('clipboard-sanitized-write')).toBe(true)
    expect(check!(null, 'geolocation')).toBe(false)
    expect(check!(null, 'clipboard-sanitized-write')).toBe(true)
    const sent = (url: string, webContentsId?: number): boolean => {
      let cancelled = false
      before!({ url, ...(webContentsId !== undefined ? { webContentsId } : {}) }, (r) => void (cancelled = !!r.cancel))
      return !cancelled
    }
    expect(sent('https://example.com/x', 3)).toBe(false)
    expect(sent('file:///x/index.html', 3)).toBe(true)
    // electron-updater / net requests from main carry no web contents.
    expect(sent('https://github.com/Total-org/total-org/releases/latest')).toBe(true)
    expect(logs).toEqual(['permission-refused', 'renderer-request-refused'])
  })
})
