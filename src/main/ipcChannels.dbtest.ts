// Audit A12 (HEALTH-4): ipc.ts was split into per-area files (ipcSimple.ts, ipcVouchers.ts …).
// This pins every registered channel with its gate — minimum role, ungated or not, and the
// capability flag that governs it — to __fixtures__/ipcChannels.json, which was generated from
// origin/main BEFORE the split (TOTAL_IPC_CHANNELS_WRITE=1 on known-good code only; never
// regenerate it from the code under test to make this pass). A new channel, or a deliberate gate
// change, adds / edits its row by hand in the same PR so the change shows in review.
// scripts/ipc-handlers-diff.mjs compares the handlers' own source text with a git ref.
import { TRUSTED_EVENT } from './ipcSender.testutil'
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

void TRUSTED_EVENT
const registered = new Set<string>()

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test', getPath: () => tmpdir(), isPackaged: false, on: () => {} },
  ipcMain: { handle: (ch: string) => registered.add(ch.replace(/^total:/, '')) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => '', showItemInFolder: () => {} },
  Notification: class {},
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('./updater', () => ({ checkForUpdatesInteractive: async () => null }))

process.env.TOTAL_DATA_DIR = mkdtempSync(join(tmpdir(), 'total-ipc-channels-'))
process.env.TOTAL_SUPPRESS_SYNC_WARNING = '1'

// Imported at collection (WP 7.3: the import is most of the time; hooks time out on Windows).
const ipc = await import('./ipc')
ipc.registerIpc()

const FIXTURE = join(__dirname, '__fixtures__', 'ipcChannels.json')

interface Row { channel: string; role: string; ungated: boolean; capability: string | null }

describe('IPC channels and their gates (A12)', () => {
  it('every channel keeps its role, ungated flag and capability', () => {
    const caps = ipc.channelCapabilityMap()
    const rows: Row[] = [...ipc.CHANNEL_ROLES]
      .map(([channel, role]) => ({ channel, role, ungated: ipc.UNGATED_CHANNEL_NAMES.has(channel), capability: caps.get(channel) ?? null }))
      .sort((a, b) => (a.channel < b.channel ? -1 : a.channel > b.channel ? 1 : 0))
    // Every role entry is a real ipcMain registration and the other way round.
    expect([...registered].sort()).toEqual(rows.map((r) => r.channel))
    if (process.env.TOTAL_IPC_CHANNELS_WRITE === '1') writeFileSync(FIXTURE, JSON.stringify(rows, null, 1).replace(/\n {2,}/g, ' ').replace(/\n \}/g, ' }') + '\n')
    const expected = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Row[]
    expect(rows).toEqual(expected)
  })
})
