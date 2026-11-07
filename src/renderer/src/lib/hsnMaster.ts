// Phase 2c: the GST portal's HSN / SAC list (≈1.5 MB of JSON) is loaded ONLY through this dynamic
// import, so it is its own chunk and never part of the startup bundle (hsnLazy.test.ts). Loaded
// once per session, the first time an HSN field shows.
import { useEffect, useState } from 'react'
import { createHsnIndex, type HsnIndex } from '@shared/gst/hsn'
import type { HsnMasterData } from '@shared/gst/hsnMaster/normalise'

let loading: Promise<HsnIndex> | null = null
let loaded: HsnIndex | null = null

export function loadHsnIndex(): Promise<HsnIndex> {
  loading ??= import('@shared/gst/hsnMaster/hsnSac.json')
    .then((m) => {
      loaded = createHsnIndex(m.default as unknown as HsnMasterData)
      return loaded
    })
    .catch((err: unknown) => {
      loading = null // a failed load may be retried by the next field
      throw err
    })
  return loading
}

/** The list once loaded (null meanwhile, or when it could not be read — the field still works as plain text). */
export function useHsnIndex(): HsnIndex | null {
  const [index, setIndex] = useState<HsnIndex | null>(loaded)
  useEffect(() => {
    if (loaded) return
    let live = true
    loadHsnIndex().then(
      (i) => live && setIndex(i),
      () => undefined
    )
    return () => {
      live = false
    }
  }, [])
  return index
}
