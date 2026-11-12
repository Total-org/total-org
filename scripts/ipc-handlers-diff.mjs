// Audit A12 (HEALTH-4): proves the split of src/main/ipc.ts moved handlers without changing them.
// For every `handle('<channel>', …)` call in src/main (tests excluded) it takes the call's source
// text (indentation and blank lines normalised) at a git ref and in the working tree, and prints
// the channels that appear / disappear / differ. Usage: node scripts/ipc-handlers-diff.mjs [ref]
// (default origin/main) [--lines]. Exit 1 when anything differs. `--getter <name>` accepts exactly one kind
// of change: a module-state variable of ipc.ts now read through a getter of the same name
// (`sessionUser?.role` → `sessionUser()?.role`); such channels are listed as "getter only".
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
const ts = createRequire(import.meta.url)('typescript')

const args = process.argv.slice(2)
const getters = []
let ref = 'origin/main'
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--getter') getters.push(args[++i])
  else if (args[i] !== '--lines') ref = args[i]
}
const ungetter = (text) => getters.reduce((t, g) => t.replace(new RegExp(`\\b${g}\\(\\)`, 'g'), g), text)
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
    const getterOnly = ungetter(a.body) === b.body
    console.log(`${getterOnly ? 'CHANGED (getter only)' : 'CHANGED'}  ${ch} (${a.path})`)
    if (!getterOnly) bad++
  }
}
for (const ch of after.keys()) if (!before.has(ch)) { console.log(`NEW      ${ch} (${after.get(ch).path})`); bad++ }
for (const [k, n] of Object.entries(moved)) console.log(`moved ${String(n).padStart(3)}  ${k}`)
console.log(`${before.size} channels at ${ref}, ${after.size} now; ${bad ? `${bad} difference(s)` : getters.length ? 'every handler identical but for the getters' : 'every handler identical'}`)

// --lines: every code line of ipc.ts at the ref against ipc.ts + the src/main/ipc*.ts files that are
// new since the ref (imports, comments and blank lines left out; indentation ignored) — so the
// helpers between the handlers are checked too. Prints the lines found on one side only.
if (args.includes('--lines')) {
  const code = (text) => {
    const out = []
    let inImport = false
    for (const raw of text.split('\n')) {
      const l = raw.trim()
      if (inImport) { if (/from '[^']+'$/.test(l)) inImport = false; continue }
      if (/^import /.test(l)) { if (!/from '[^']+'$/.test(l) && !/^import '/.test(l)) inImport = true; continue }
      if (!l || l.startsWith('//') || l.startsWith('/*') || l.startsWith('*')) continue
      out.push(ungetter(l))
    }
    return out
  }
  const known = new Set(git('ls-tree', '-r', '--name-only', ref, 'src/main').split('\n'))
  const newFiles = git('ls-files', '--cached', '--others', '--exclude-standard', 'src/main').split('\n').filter((p) => /^src\/main\/ipc[A-Za-z]*\.ts$/.test(p) && !known.has(p))
  const count = (lines) => lines.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map())
  const b = count(code(git('show', `${ref}:src/main/ipc.ts`)))
  const a = count(['src/main/ipc.ts', ...newFiles].flatMap((p) => code(readFileSync(p, 'utf8'))))
  console.log(`\n--lines: ipc.ts at ${ref} vs ipc.ts + ${newFiles.join(', ')}`)
  for (const [l, n] of b) if ((a.get(l) ?? 0) < n) console.log(`- ${l}${n - (a.get(l) ?? 0) > 1 ? `  (×${n - (a.get(l) ?? 0)})` : ''}`)
  for (const [l, n] of a) if ((b.get(l) ?? 0) < n) console.log(`+ ${l}${n - (b.get(l) ?? 0) > 1 ? `  (×${n - (b.get(l) ?? 0)})` : ''}`)
}
process.exit(bad ? 1 : 0)
