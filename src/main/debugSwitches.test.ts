// Audit 2 SEC2-3: a packaged build refuses remote-debugging switches unless its Node inspector runs
// (only the fuse-flipped smoke copy can start it). Plain vitest.
import { describe, expect, it } from 'vitest'
import { debugSwitchesIn, mustRefuseDebugging } from './debugSwitches'

const EXE = '/Applications/Total.app/Contents/MacOS/Total'
const none = (): boolean => false

describe('debugSwitchesIn', () => {
  it('finds the switches however Chromium would read them', () => {
    expect(debugSwitchesIn([EXE, '--remote-debugging-port=9222'])).toEqual(['remote-debugging-port'])
    expect(debugSwitchesIn([EXE, '--remote-debugging-port', '9222'])).toEqual(['remote-debugging-port'])
    expect(debugSwitchesIn([EXE, '--remote-debugging-pipe'])).toEqual(['remote-debugging-pipe'])
    expect(debugSwitchesIn([EXE, '-remote-debugging-port=1'])).toEqual(['remote-debugging-port'])
    expect(debugSwitchesIn(['C:\\Total.exe', '/Remote-Debugging-Port=1'])).toEqual(['remote-debugging-port'])
    expect(debugSwitchesIn([EXE, '--remote-debugging-address=0.0.0.0', '--remote-allow-origins=*'])).toEqual(['remote-debugging-address', 'remote-allow-origins'])
  })

  it('leaves ordinary arguments alone (macOS -psn_, a file path, the executable itself)', () => {
    expect(debugSwitchesIn([EXE, '-psn_0_12345', '/Users/me/remote-debugging-port.txt', '--lang=hi'])).toEqual([])
    expect(debugSwitchesIn(['--remote-debugging-port=1'])).toEqual([]) // argv[0] is the executable
  })
})

describe('mustRefuseDebugging', () => {
  it('packaged + a debugging switch (argv or the command line Electron parsed) = refuse', () => {
    expect(mustRefuseDebugging({ packaged: true, argv: [EXE, '--remote-debugging-port=9222'], hasSwitch: none, inspectorRunning: false })).toEqual(['remote-debugging-port'])
    expect(
      mustRefuseDebugging({ packaged: true, argv: [EXE], hasSwitch: (n) => n === 'remote-debugging-pipe', inspectorRunning: false })
    ).toEqual(['remote-debugging-pipe'])
  })

  it('a plain packaged launch, a source run and the smoke copy (inspector running) start as before', () => {
    expect(mustRefuseDebugging({ packaged: true, argv: [EXE], hasSwitch: none, inspectorRunning: false })).toEqual([])
    expect(mustRefuseDebugging({ packaged: false, argv: [EXE, '--remote-debugging-port=0'], hasSwitch: () => true, inspectorRunning: false })).toEqual([])
    expect(mustRefuseDebugging({ packaged: true, argv: [EXE, '--remote-debugging-port=0'], hasSwitch: () => true, inspectorRunning: true })).toEqual([])
  })
})
