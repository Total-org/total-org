// Phase 2c: the GST portal's HSN / SAC list in main (capture's HSN check). Loaded through a dynamic
// import so the ~1.5 MB JSON is its own chunk, read the first time capture needs it — never at
// launch (shared/gst/hsnLazy.test.ts).
import { createHsnIndex, type HsnIndex } from '@shared/gst/hsn'
import type { HsnMasterData } from '@shared/gst/hsnMaster/normalise'

let loading: Promise<HsnIndex> | null = null
let loaded: HsnIndex | null = null

export function loadHsnIndex(): Promise<HsnIndex> {
  loading ??= import('@shared/gst/hsnMaster/hsnSac.json')
    .then((m) => (loaded = createHsnIndex((m.default ?? m) as unknown as HsnMasterData)))
    .catch((err: unknown) => {
      loading = null
      throw err
    })
  return loading
}

/** The list if it has been loaded this session, else null (and a load is started). */
export function loadedHsnIndex(): HsnIndex | null {
  if (!loaded) void loadHsnIndex().catch(() => undefined)
  return loaded
}
