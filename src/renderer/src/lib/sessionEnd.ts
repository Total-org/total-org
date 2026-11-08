// Audit A3 (SEC-2): when a session ends — the lock (⌘L, the idle lock, Lock / sign-out, a restore
// that locks) or a sign-in as ANOTHER user — nothing of the previous session may stay on screen or
// in memory for the next person: every store that holds figures, names, answers or a half-typed
// form registers its reset here, at module load (a store whose module never loaded holds nothing).
// companyCache.ts `bindQueryCacheToSession` calls `endSessionView` together with the query cache
// clear, synchronously inside the session store's set() — before React renders the lock screen.
//
// Kept free of imports so any module (stores.ts included) can register without a cycle.

const resets = new Set<() => void>()

/** Register what to forget when a session ends. Returns the unregister function. */
export function onSessionEnd(reset: () => void): () => void {
  resets.add(reset)
  return () => {
    resets.delete(reset)
  }
}

/** Forget everything the registered stores hold (one failing reset never stops the others). */
export function endSessionView(): void {
  for (const reset of [...resets]) {
    try {
      reset()
    } catch {
      /* a store that can't reset must not keep the others' data on screen */
    }
  }
}
