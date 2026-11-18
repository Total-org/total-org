// Readiness review SEC3-3: the shipped app.asar must not carry the type-check output
// (`out/types-*/`, `*.tsbuildinfo`: the build machine's paths and the name of every source file).
// package.json `build.files` leaves it out with "!out/types-*/**"; this checks the packaged result
// (CI build-win, release-mac, release-win).
//
//   node scripts/release/asar-check.mjs <app.asar>
import { listPackage } from '@electron/asar'
import { pathToFileURL } from 'url'

/** The entries of an asar listing that must not ship (paths in either separator). */
export function forbiddenEntries(entries) {
  return entries.map((e) => e.replace(/\\/g, '/')).filter((e) => /(^|\/)out\/types-[^/]*(\/|$)/.test(e) || e.endsWith('.tsbuildinfo'))
}

/** A listing that holds the app's main entry — so a wrong path or an empty archive never passes. */
export const isAppArchive = (entries) => entries.some((e) => e.replace(/\\/g, '/') === '/out/main/index.js')

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const archive = process.argv[2]
  if (!archive) {
    console.error('usage: node scripts/release/asar-check.mjs <app.asar>')
    process.exit(2)
  }
  const entries = listPackage(archive, { isPack: false })
  if (!isAppArchive(entries)) {
    console.error(`${archive} is not Total's app archive (no /out/main/index.js)`)
    process.exit(1)
  }
  const bad = forbiddenEntries(entries)
  if (bad.length) {
    console.error(`${archive} ships ${bad.length} file(s) it must not:\n${bad.slice(0, 20).join('\n')}`)
    process.exit(1)
  }
  console.log(`${archive}: ${entries.length} entries, no type-check output`)
}
