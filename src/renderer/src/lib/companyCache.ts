import type { QueryClient } from '@tanstack/react-query'
import { useSession } from '../state/stores'
import { endSessionView } from './sessionEnd'

/**
 * Query keys are not namespaced by company (['ledgers'] means "the open company's ledgers"), so
 * the cache must be emptied whenever the open company changes — otherwise the next company's
 * screens paint the previous company's data until their refetch lands.
 *
 * Every open/switch/close goes through the session store's `slug` (setCompany / clearCompany),
 * so this subscribes there. Zustand runs subscribers synchronously inside `set()`, i.e. before
 * React renders the new company's tree, so no component ever reads a stale entry. A same-slug
 * setCompany (Company Info save) is not a switch and keeps the cache (a lock or another user's
 * sign-in empties it too — `bindQueryCacheToSession`).
 *
 * Returns the unsubscribe function.
 */
export function bindQueryCacheToCompany(queryClient: QueryClient): () => void {
  return useSession.subscribe((state, prev) => {
    if (state.slug !== prev.slug) queryClient.clear()
  })
}

/**
 * Audit A3 (SEC-2): a session ends when the open company LOCKS (⌘L, the idle lock, Lock / sign-out,
 * a restore that locks — `locked` turns true on the same company) or when someone OTHER than the
 * last signed-in user signs in (a sign-in after a lock is caught by the lock already; this covers
 * any path that swaps the user without one). Then the query cache is emptied — the cached P&L /
 * statements would otherwise paint for the next person, and React Query keeps `data` when the
 * refetch is refused — and every store registered with `onSessionEnd` forgets what it holds
 * (screens back to Home, kept forms, AI / Ask Total conversations, toasts, open dialogs and drawers).
 * Runs synchronously inside set(), before React renders the lock screen.
 *
 * Returns the unsubscribe function.
 */
export function bindQueryCacheToSession(queryClient: QueryClient): () => void {
  let lastUserId: number | null = useSession.getState().user?.id ?? null
  return useSession.subscribe((state, prev) => {
    if (state.slug !== prev.slug) {
      // Another company: bindQueryCacheToCompany clears; its first sign-in is not "another user".
      lastUserId = state.user?.id ?? null
      return
    }
    const locked = state.slug !== null && state.locked && !prev.locked
    const userId = state.user?.id ?? null
    const otherUser = userId !== null && lastUserId !== null && userId !== lastUserId
    if (userId !== null) lastUserId = userId
    if (locked || otherUser) {
      queryClient.clear()
      endSessionView()
    }
  })
}
