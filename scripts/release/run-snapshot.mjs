// Scheduled release — run upgrade/snapshot.ts against a SOURCE TREE (the last release's checkout or
// HEAD's). The bundle resolves `@main` / `@shared` and every package from that tree, is written
// inside it (so `require('better-sqlite3-multiple-ciphers')` loads that tree's driver) and runs
// under that tree's Electron binary as Node — the same pattern as scripts/total-cli.mjs.
//
//   node scripts/release/run-snapshot.mjs <tree> <seed|dump|check> <dataDir> [out.json]
import { createRequire } from 'module'
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const [treeArg, ...rest] = process.argv.slice(2)
if (!treeArg || rest.length < 2) {
  console.error('usage: run-snapshot.mjs <tree> <seed|dump|check> <dataDir> [out.json]')
  process.exit(2)
}
const tree = resolve(treeArg)
const treeRequire = createRequire(join(tree, 'package.json'))
const esbuild = treeRequire('esbuild')
const electron = treeRequire('electron')

// Modules snapshot.ts can do without: a release older than the module gets an empty stand-in, and
// snapshot.ts falls back (0.10 / 0.11 have no e2e clock, no Perf Traders seeder and no restore
// check). Every other import must exist in the tree, so a renamed service still fails the bundle.
const OPTIONAL = ['@shared/e2eClock', '@main/perf/cli', '@main/perf/seedLarge', '@main/services/backupVerify']
const srcPath = (spec) => join(tree, 'src', spec.startsWith('@shared') ? 'shared' : 'main', spec.replace(/^@(shared|main)\/?/, ''))
const inTree = (spec) => ['.ts', '.tsx', '/index.ts'].some((ext) => existsSync(srcPath(spec) + ext))
// `@main` / `@shared` resolve to THIS tree's src/ (a plugin, not `alias`, so an absent optional
// module can be told apart first).
const treeModules = {
  name: 'tree-modules',
  setup(build) {
    build.onResolve({ filter: /^@(shared|main)(\/|$)/ }, async (args) => {
      if (OPTIONAL.includes(args.path) && !inTree(args.path)) return { path: args.path, namespace: 'absent' }
      const r = await build.resolve(srcPath(args.path), { kind: args.kind, resolveDir: args.resolveDir })
      return r.errors.length ? { errors: r.errors } : { path: r.path, namespace: r.namespace, sideEffects: r.sideEffects }
    })
    build.onLoad({ filter: /.*/, namespace: 'absent' }, () => ({ contents: 'export {}', loader: 'js' }))
  }
}

const outfile = join(tree, 'out', 'release', 'snapshot.cjs')
mkdirSync(dirname(outfile), { recursive: true })
await esbuild.build({
  entryPoints: [join(here, 'upgrade', 'snapshot.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile,
  // 0.10 / 0.11 use plain better-sqlite3 (rebuilt for their Electron by their postinstall).
  external: ['electron', 'better-sqlite3-multiple-ciphers', 'better-sqlite3'],
  plugins: [treeModules],
  nodePaths: [join(tree, 'node_modules')],
  loader: { '.md': 'text' },
  logLevel: 'warning'
})

const [, dataDir, out] = rest
const args = [outfile, rest[0], resolve(dataDir), ...(out ? [resolve(out)] : [])]
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', TOTAL_SUPPRESS_SYNC_WARNING: '1', TOTAL_INSECURE_TEST_SECRETS: '1' }
const result = spawnSync(electron, args, { stdio: 'inherit', env, cwd: tree })
process.exit(result.status ?? 1)
