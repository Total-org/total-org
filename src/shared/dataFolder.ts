/** Settings → "Where Total keeps your books" — what main tells the renderer (ipcDataRoot.ts). */

export type DataFolderSource = 'env' | 'pointer' | 'default'

export type DataFolderProblem = 'same' | 'inside_current' | 'contains_current' | 'not_empty' | 'not_a_folder' | 'not_writable' | 'no_space' | 'old_copy'

export interface DataFolderView {
  /** The folder in use this session. */
  path: string
  /** A9 (audit UX-22): `path` as the company list and Settings → About show it — `shownFolder`. */
  shown: string
  source: DataFolderSource
  defaultPath: string
  /** In a OneDrive folder (shared/windowsPaths.ts `isOneDrivePath`). */
  oneDrive: boolean
  /** Another cloud-sync folder (Dropbox, Google Drive, iCloud …) — shared/syncpath.ts. */
  synced: boolean
  /** A moved folder could not be found at launch (the default one is open instead). */
  missingPointer: string | null
  /** The folder in use holds MOVED-TO.txt: it is the old copy a move left behind (the pointer to
   *  the moved books is gone — a reinstall, a new user profile), so its books may be stale. */
  oldCopy: boolean
}

export interface DataFolderPick {
  path: string
  ok: boolean
  /** empty / new = the books are copied there; total = the folder already holds Total books. */
  kind?: 'empty' | 'new' | 'total'
  problem?: DataFolderProblem
  bytes?: number
  /** The picked folder is itself in OneDrive / a synced folder (a warning, not a refusal). */
  oneDrive: boolean
  synced: boolean
}

export interface DataFolderMoved {
  path: string
  copied: boolean
  files: number
  /** The app restarts on its own a moment after this answer. */
  relaunching: boolean
}

/**
 * A9 (audit UX-22): the data folder in plain words — under the user's home it is shown from there
 * ("~/Documents/total" on a Mac, "Documents\\total" on Windows, as before when it is the default),
 * anywhere else as the full path. Pure.
 */
export function shownFolder(path: string, home: string, platform: string): string {
  const win = platform === 'win32'
  const sep = win ? '\\' : '/'
  const trim = (p: string): string => (p.length > 1 && (p.endsWith('/') || p.endsWith('\\')) ? p.slice(0, -1) : p)
  const h = trim(home)
  const p = trim(path)
  if (!h) return p
  const same = (a: string, b: string): boolean => (win ? a.toLowerCase() === b.toLowerCase() : a === b)
  const under = p.length > h.length && same(p.slice(0, h.length), h) && (p[h.length] === sep || (win && p[h.length] === '/'))
  if (!under) return same(p, h) ? (win ? p : '~') : p
  const rest = p.slice(h.length + 1)
  return win ? rest : `~/${rest}`
}
