/**
 * WP 7.3 — the updater's platform facts (pure, unit-tested): where the data folder is shown. A hand
 * download opens the installer the signed release manifest names (audit A4, releaseManifest.ts).
 * (The update notices themselves are in-app since the consent updater, PR #108; the SmartScreen / Gatekeeper steps are in the help article "Total on
 * Windows" and the README.)
 */

export type DesktopPlatform = 'darwin' | 'win32' | 'linux' | string

/** How the data folder is written for the user on this platform. */
export function dataFolderLabel(platform: DesktopPlatform): string {
  return platform === 'win32' ? 'Documents\\total' : '~/Documents/total'
}

/** Scripted runs (smoke / e2e / CI) turn the startup update check off: a packaged build would
 *  otherwise ask GitHub and could open a dialog in the middle of a run. */
export function updateCheckDisabled(env: Record<string, string | undefined>): boolean {
  return env.TOTAL_NO_UPDATE_CHECK === '1'
}
