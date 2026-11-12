// Audit A12 (HEALTH-4): proves the split of src/main/ipc.ts moved handlers without changing them.
// For every `handle('<channel>', …)` call in src/main (tests excluded) it takes the call's source
// text (indentation and blank lines normalised) at a git ref and in the working tree, and prints
// the channels that appear / disappear / differ. Usage: node scripts/ipc-handlers-diff.mjs [ref]
// (default origin/main). Exit 1 when anything differs (pass --allow <channel> to accept a
// channel whose text changed on purpose, e.g. a module-state read now made through a getter).
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
const ts = createRequire(import.meta.url)('typescript')

const args = process.argv.slice(2)
const allow = new Set()
let ref = 'origin/main'
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--allow') allow.add(args[++i])
  else ref = args[i]
}
const isSource = (p) => p.startsWith('src/main/') && p.endsWith('.ts') && !/\.(test|dbtest|testutil)\.ts$/.test(p) && !p.endsWith('.d.ts')
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 })

function calls(files) {
  const out = new Map()
  for (const [path, text] of files) {
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^handle$|Handle$/.test(node.expression.text)) {
        const first = node.arguments[0]
        if (first && ts.isStringLiteral(first)) {
          const body = node.getText(sf).split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
          if (out.has(first.text)) throw new Error(`channel ${first.text} registered twice (${out.get(first.text).path}, ${path})`)
          out.set(first.text, { path, body })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return out
}

const before = calls(git('ls-tree', '-r', '--name-only', ref, 'src/main').split('\n').filter(isSource).map((p) => [p, git('show', `${ref}:${p}`)]))
const after = calls(git('ls-files', '--cached', '--others', '--exclude-standard', 'src/main').split('\n').filter(isSource).map((p) => [p, readFileSync(p, 'utf8')]))

let bad = 0
const moved = {}
for (const [ch, b] of before) {
  const a = after.get(ch)
  if (!a) { console.log(`MISSING  ${ch} (was in ${b.path})`); bad++; continue }
  if (a.path !== b.path) moved[`${b.path} → ${a.path}`] = (moved[`${b.path} → ${a.path}`] ?? 0) + 1
  if (a.body !== b.body) {
    console.log(`${allow.has(ch) ? 'CHANGED (allowed)' : 'CHANGED'}  ${ch} (${a.path})`)
    if (!allow.has(ch)) bad++
  }
}
for (const ch of after.keys()) if (!before.has(ch)) { console.log(`NEW      ${ch} (${after.get(ch).path})`); bad++ }
for (const [k, n] of Object.entries(moved)) console.log(`moved ${String(n).padStart(3)}  ${k}`)
console.log(`${before.size} channels at ${ref}, ${after.size} now; ${bad ? `${bad} difference(s)` : 'every handler identical'}`)
process.exit(bad ? 1 : 0)
