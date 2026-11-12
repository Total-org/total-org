import { bootMark } from './bootTrace'
import { e2eToday } from './e2eClock'
import { app, BrowserWindow, dialog, Menu, session, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { registerIpc, closeCurrentCompany, getCurrentCompany } from './ipc'
import { ensureDataTree, dataRoot, dataRootChoice } from './paths'
import { initUpdater } from './updater'
import { initLogging, log } from './log'
import { startBackupScheduler, backupOnQuit } from './backup-scheduler'
import { cleanupOpenedCopies, sweepStaleOpenCopies } from './services/attachments'
import { syncFolderWarning } from '@shared/syncpath'
import { configureI18n } from '@shared/i18n'
// Main renders hi / hinglish synchronously (prints, errors): register both catalogues.
import '@shared/i18n/all'
import '@shared/zodMessages'
import { appMenuTemplate, applyWindowPolicy, hardenSession, mainWindowWebPreferences } from './windowPolicy'
import { configureTrustedRenderer } from './ipcSender'
import { dataFolderLabel } from '@shared/updateText'
import { MOVED_NOTE } from './services/dataRootMove'

bootMark('main modules loaded')

// Hermetic scripted runs (smoke/e2e/CI, TOTAL_DATA_DIR set): keep Electron's userData —
// localStorage (theme, sidebar sections, report columns), caches, the single-instance lock —
// inside the scratch dir too, so a run never writes to the user's real app profile. Relaunches
// against the same scratch dir (e2e 01/12) still see what the previous launch persisted. Must
// run before requestSingleInstanceLock(), which places its lock under userData: each scratch dir
// then gets its own lock, so a scripted run doesn't collide with the user's open app either.
if (process.env.TOTAL_DATA_DIR) {
  app.setPath('userData', join(process.env.TOTAL_DATA_DIR, '.electron-userdata'))
}

// Audit 2026-11 A2: every renderer is sandboxed (the main window and the hidden PDF window already
// ask for it; this makes it the rule for any web contents).
app.enableSandbox()

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
}

let syncWarningShown = false
let iCloudDesktopWarningShown = false

const appIconPath = app.isPackaged
  ? join(process.resourcesPath, 'total.png')
  : join(app.getAppPath(), 'resources/total.png')

// Automated drivers (CI smoke test, Playwright scripts) set this to skip the native
// dialog.showMessageBox() calls below — on macOS an unattended modal alert can wedge the
// main-thread run loop that also pumps CDP messages, hanging Playwright's electron.launch().
const SUPPRESS_SYNC_WARNINGS = process.env.TOTAL_SUPPRESS_SYNC_WARNING === '1'

function warnIfSyncedFolder(): void {
  if (SUPPRESS_SYNC_WARNINGS) return
  const marker = syncFolderWarning(dataRoot())
  if (marker && !syncWarningShown) {
    syncWarningShown = true
    log('warn', 'sync-folder-detected', { marker })
    void dialog.showMessageBox({
      type: 'warning',
      title: 'Cloud sync folder detected',
      message: 'Total’s data folder appears to be inside a cloud-sync folder.',
      detail:
        `Total stores your books as a live SQLite database. Cloud-sync tools (Dropbox, OneDrive, Google Drive, iCloud, etc.) can corrupt the database if it is edited on two machines at once, or synced mid-write. Moving ${dataFolderLabel(process.platform)} out of the synced folder is strongly recommended.`,
      buttons: ['OK']
    })
  }

  if (process.platform === 'darwin' && !iCloudDesktopWarningShown) {
    const iCloudDesktopDocs = join(homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Documents')
    if (existsSync(iCloudDesktopDocs)) {
      iCloudDesktopWarningShown = true
      log('warn', 'icloud-desktop-documents-sync-detected', {})
      void dialog.showMessageBox({
        type: 'info',
        title: 'iCloud Desktop & Documents sync is on',
        message: 'macOS is syncing your Documents folder to iCloud.',
        detail:
          'If Total’s data folder ends up inside your Documents folder, iCloud may sync it in the background while it is open elsewhere. This is usually fine, but if you notice odd behavior, consider excluding the total folder from iCloud sync.',
        buttons: ['OK']
      })
    }
  }
}

/** A moved data folder (Settings → "Where Total keeps your books") that is not there at launch —
 *  an unplugged drive, a renamed folder: say so, once. The default folder is open instead and the
 *  pointer is kept, so the next launch with the folder back opens the moved books again. */
function warnIfMovedFolderMissing(): void {
  const choice = dataRootChoice()
  // The folder in use is the old copy a move left behind (MOVED-TO.txt) and no pointer leads to
  // the moved books (a reinstall that cleared the app's settings, a new user profile): say so,
  // or the owner keeps working in stale books without noticing.
  if (!choice.problem && choice.source !== 'env' && existsSync(join(choice.path, MOVED_NOTE))) {
    log('warn', 'data-root-is-old-copy', {})
    if (SUPPRESS_SYNC_WARNINGS) return
    void dialog.showMessageBox({
      type: 'warning',
      title: 'These may be old books',
      message: `Total is opening ${choice.path}, which is the old copy left behind when your books were moved to another folder.`,
      detail: `Its books may be older than yours. ${MOVED_NOTE} in that folder says where they went. To open the moved books again, use Settings → "Where Total keeps your books" → Move to another folder and pick that folder.`,
      buttons: ['OK']
    })
    return
  }
  const problem = choice.problem
  if (!problem) return
  log('warn', 'data-root-pointer-not-followed', { kind: problem.kind })
  if (SUPPRESS_SYNC_WARNINGS) return
  void dialog.showMessageBox({
    type: 'warning',
    title: 'Your books folder was not found',
    message: problem.pointerPath ? `Total could not find the folder it keeps your books in: ${problem.pointerPath}` : 'Total could not read where it keeps your books.',
    detail:
      `Total opened ${dataRootChoice().defaultPath} instead. If the folder is on a drive that is not connected, connect it and start Total again. ` +
      'Settings → About → "Where Total keeps your books" shows the folder in use.',
    buttons: ['OK']
  })
}

let dockIconSet = false

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: 'Total',
    icon: appIconPath,
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 16 } } : {}),
    backgroundColor: '#f4f4ef',
    webPreferences: mainWindowWebPreferences({ preload: join(__dirname, '../preload/index.js'), e2eToday, devTools: !app.isPackaged })
  })

  win.webContents.once('dom-ready', () => bootMark('renderer DOM ready'))
  win.on('ready-to-show', () => {
    bootMark('window ready to show')
    win.show()
    // Phase 5 speed: decoding the 1024 px PNG held main for ~80–110 ms before the window existed.
    // A packaged Mac app shows its bundle icon (resources/total.icns) without it; an unpackaged
    // run (dev, e2e) still gets the Total icon, once the window is up.
    if (process.platform === 'darwin' && !app.isPackaged && !dockIconSet) {
      dockIconSet = true
      setTimeout(() => app.dock?.setIcon(appIconPath), 0)
    }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    bootMark('app ready')
    initLogging()
    configureI18n({ dev: !app.isPackaged })
    log('info', 'app-start', { version: app.getVersion(), platform: process.platform, dataRoot: dataRootChoice().source })
    electronApp.setAppUserModelId('com.irminlabs.total')
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
    // WP 7.2 / D7: one policy for every web contents (the main window, the hidden PDF window):
    // no new windows, no navigation away from the app, no webviews (windowPolicy.ts).
    const devUrl = is.dev ? process.env.ELECTRON_RENDERER_URL : undefined
    // Audit 2026-11 A2: no Toggle Developer Tools / Reload in a packaged build's menu; every
    // permission refused but clipboard write; pages load only the app's own files.
    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate({ isMac: process.platform === 'darwin', packaged: app.isPackaged })))
    hardenSession(session.defaultSession, { log, devUrl, appRoot: pathToFileURL(join(__dirname, '../renderer')).href })
    app.on('web-contents-created', (_, contents) =>
      applyWindowPolicy(contents, { openExternal: (url) => void shell.openExternal(url), log, devUrl })
    )
    // D7: IPC answers only the app's own renderer page (ipcSender.ts) — set before any window loads.
    configureTrustedRenderer({
      fileUrl: pathToFileURL(join(__dirname, '../renderer/index.html')).href,
      ...(devUrl ? { devOrigin: devUrl } : {})
    })
    // Phase 5 speed: the window (its renderer process starts and loads in parallel) is created
    // BEFORE the IPC handlers are registered. Safe: this whole callback is synchronous, so no IPC
    // message can be handled before registerIpc below has run.
    bootMark('creating the window')
    createWindow()
    ensureDataTree()
    registerIpc()
    bootMark('ipc registered')
    startBackupScheduler(getCurrentCompany)
    // WP 6.4: opened attachment copies left by a crash (> 1 day old) — this session's go on quit.
    try {
      const swept = sweepStaleOpenCopies()
      if (swept > 0) log('info', 'attachment-copies-swept', { swept })
    } catch {
      // housekeeping only
    }
    warnIfSyncedFolder()
    warnIfMovedFolderMissing()
    initUpdater()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    closeCurrentCompany()
    app.quit()
  })

  app.on('before-quit', () => {
    backupOnQuit(getCurrentCompany)
    closeCurrentCompany()
    cleanupOpenedCopies()
  })
}
