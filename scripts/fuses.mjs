#!/usr/bin/env node
// Audit 2026-11 A2 (SEC-6): Electron fuses of a PACKAGED build (package.json build.electronFuses —
// no ELECTRON_RUN_AS_NODE, no NODE_OPTIONS, no --inspect, asar integrity, app only from app.asar).
//
//   node scripts/fuses.mjs check <exe>       exit 1 unless every fuse is as package.json sets it
//   node scripts/fuses.mjs test-copy <exe>   copy the build next to itself with ONLY the --inspect
//                                            fuse turned back on and print the copy's executable
//
// Why the copy: Playwright drives Electron through the Node inspector (`--inspect=0`), which the
// shipped build refuses. The packaged smoke checks the shipped build's fuses first, then runs on a
// copy that differs from it in that one fuse bit (the asar, its integrity hash and every other
// fuse are the shipped ones). <exe> is the app's executable (…/Total.app/Contents/MacOS/Total or
// …\win-unpacked\Total.exe).
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fuses from '@electron/fuses'

const { FuseV1Options, FuseVersion, flipFuses, getCurrentFuseWire } = fuses
// @electron/fuses' FuseState (not re-exported by its index): the ASCII '0' / '1' in the fuse wire.
const FuseState = { DISABLE: 48, ENABLE: 49 }

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NAMES = {
  runAsNode: FuseV1Options.RunAsNode,
  enableNodeOptionsEnvironmentVariable: FuseV1Options.EnableNodeOptionsEnvironmentVariable,
  enableNodeCliInspectArguments: FuseV1Options.EnableNodeCliInspectArguments,
  enableEmbeddedAsarIntegrityValidation: FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
  onlyLoadAppFromAsar: FuseV1Options.OnlyLoadAppFromAsar
}

function expected() {
  const cfg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).build?.electronFuses ?? {}
  const out = {}
  for (const [name, id] of Object.entries(NAMES)) {
    if (typeof cfg[name] !== 'boolean') throw new Error(`package.json build.electronFuses.${name} is not set`)
    out[name] = { id, on: cfg[name] }
  }
  return out
}

/** The folder that holds the whole build: the .app bundle on macOS, the exe's folder elsewhere. */
function buildRoot(exe) {
  const i = exe.indexOf('.app/')
  return i >= 0 ? exe.slice(0, i + 4) : dirname(exe)
}

async function check(exe) {
  const wire = await getCurrentFuseWire(exe)
  const bad = []
  for (const [name, { id, on }] of Object.entries(expected())) {
    const state = wire[id]
    const want = on ? FuseState.ENABLE : FuseState.DISABLE
    if (state !== want) bad.push(`${name}: want ${on ? 'on' : 'off'}, found ${state === FuseState.ENABLE ? 'on' : state === FuseState.DISABLE ? 'off' : String(state)}`)
  }
  if (bad.length) {
    console.error(`[fuses] ${exe}:\n  ${bad.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`[fuses] ${basename(exe)}: every fuse is as package.json sets it`)
}

async function testCopy(exe) {
  const from = buildRoot(exe)
  const to = from.endsWith('.app') ? join(dirname(from) + '-smoke', basename(from)) : `${from}-smoke`
  const copyRoot = from.endsWith('.app') ? dirname(to) : to
  if (existsSync(copyRoot)) rmSync(copyRoot, { recursive: true, force: true })
  cpSync(from, to, { recursive: true, verbatimSymlinks: true })
  const copyExe = join(to, relative(from, exe))
  await flipFuses(copyExe, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: process.platform === 'darwin',
    [FuseV1Options.EnableNodeCliInspectArguments]: true
  })
  console.log(copyExe)
}

const [cmd, exeArg] = process.argv.slice(2)
if (!exeArg || !['check', 'test-copy'].includes(cmd)) {
  console.error('usage: node scripts/fuses.mjs check|test-copy <app executable>')
  process.exit(2)
}
const exe = resolve(exeArg)
if (!existsSync(exe)) {
  console.error(`[fuses] not found: ${exe}`)
  process.exit(2)
}
if (cmd === 'check') await check(exe)
else await testCopy(exe)
