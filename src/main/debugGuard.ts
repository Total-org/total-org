// Audit 2 SEC2-3: imported FIRST by index.ts, so a packaged build started with a remote-debugging
// switch exits before any module, window or company is set up (rules in debugSwitches.ts).
import { app } from 'electron'
import { url as inspectorUrl } from 'inspector'
import { mustRefuseDebugging } from './debugSwitches'

const refused = mustRefuseDebugging({
  packaged: app.isPackaged,
  argv: process.argv,
  hasSwitch: (name) => app.commandLine.hasSwitch(name),
  inspectorRunning: typeof inspectorUrl() === 'string'
})
if (refused.length > 0) {
  console.error(`Total does not start with ${refused.map((s) => `--${s}`).join(', ')}.`)
  app.exit(1)
  process.exit(1)
}
