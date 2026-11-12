// Phase 5 speed: with TOTAL_IPC_TRACE=1 (scratch data dir only — the same switch as the IPC trace in
// ipc.ts) main records where its start-up time goes: each step with the ms since the process
// started, kept on `globalThis.__totalBootMarks` (they happen before a driver can listen to stdout);
// scripts/perf-launch.mjs --trace reads them from the main process and lists them. Step names only.
const TRACE = process.env.TOTAL_IPC_TRACE === '1' && !!process.env.TOTAL_DATA_DIR

type BootMarks = Array<{ step: string; ms: number }>
const marks: BootMarks = []
if (TRACE) (globalThis as { __totalBootMarks?: BootMarks }).__totalBootMarks = marks

export function bootMark(step: string): void {
  if (TRACE) marks.push({ step, ms: Math.round(performance.now()) })
}

bootMark('main bundle started')
