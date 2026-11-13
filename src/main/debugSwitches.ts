/**
 * Audit 2 SEC2-3: a PACKAGED Total refuses to start with a Chromium remote-debugging switch.
 *
 * `--remote-debugging-port=9222` (or `-pipe`) opens a DevTools endpoint on the page, from which any
 * program running as the same user can drive `window.total.invoke(...)` — what `devTools: false`,
 * the menu without "Toggle Developer Tools" and the --inspect / NODE_OPTIONS fuses (audit A2) closed.
 * Electron has no fuse for these switches, so main checks its own command line before anything else
 * (`debugGuard.ts`, imported first by index.ts). The one exception is a build whose Node inspector
 * is RUNNING: only a copy with the --inspect fuse turned back on can start it (`scripts/fuses.mjs
 * test-copy`, the packaged smoke — Playwright launches with `--inspect=0 --remote-debugging-port=0`);
 * the shipped build has that fuse off, so there the inspector never runs.
 *
 * Pure (no Electron) so it is plain-vitest testable.
 */

/** Switches that open a debugging endpoint on the app (or configure one). */
export const DEBUG_SWITCHES: readonly string[] = [
  'remote-debugging-port',
  'remote-debugging-pipe',
  'remote-debugging-io-pipes',
  'remote-debugging-address',
  'remote-debugging-socket-name',
  'remote-allow-origins'
]

/**
 * The debugging switches present in `argv` (argv[0], the executable, is skipped). Chromium reads a
 * switch with a `--` or `-` prefix (and `/` on Windows, where names are also case-insensitive);
 * every argument is read that way here — refusing too much costs nothing.
 */
export function debugSwitchesIn(argv: readonly string[]): string[] {
  const found = new Set<string>()
  for (const arg of argv.slice(1)) {
    const m = /^(?:--?|\/)([^=\s]+)/.exec(arg)
    if (!m) continue
    const name = m[1]!.toLowerCase()
    if (DEBUG_SWITCHES.includes(name)) found.add(name)
  }
  return [...found]
}

/** Whether a packaged build must refuse to start: a debugging switch, and no Node inspector running. */
export function mustRefuseDebugging(o: { packaged: boolean; argv: readonly string[]; hasSwitch: (name: string) => boolean; inspectorRunning: boolean }): string[] {
  if (!o.packaged || o.inspectorRunning) return []
  const found = new Set(debugSwitchesIn(o.argv))
  for (const name of DEBUG_SWITCHES) if (o.hasSwitch(name)) found.add(name)
  return [...found]
}
