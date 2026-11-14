// A9 (audit UX-22): the data folder Total really uses (TOTAL_DATA_DIR, a moved folder, else the
// default), from main — never the fixed "~/Documents/total" label, which was wrong after a move.
// One query for every screen that shows it (Settings → "Where Total keeps your books" too).
import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import { dataFolder, pathSep } from './platform'

export const DATA_ROOT_KEY = ['appDataRoot'] // i18n-technical: query key

/** The folder in plain words (`DataFolderView.shown`); the default's label until main answers. */
export function useDataFolder(): string {
  const { data } = useQuery({ queryKey: DATA_ROOT_KEY, queryFn: api.app.dataRoot, staleTime: Infinity })
  return data?.shown ?? dataFolder
}

/** A path inside the data folder, shown with this computer's separator. */
export function inDataFolder(root: string, ...parts: string[]): string {
  return [root, ...parts].join(pathSep)
}
