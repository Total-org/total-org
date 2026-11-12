// Shared by the SQL lints (movesStockLint, notDeletedLint): pulls every string / template literal
// out of a TS source so a test can check the SQL in it. Plain Node, no service imported.

/** Every string / template literal in a TS source (comments skipped; a template's nested
 *  templates are part of it). */
export function sqlStrings(src: string): string[] {
  const out: string[] = []
  let i = 0
  const readTemplate = (): string => {
    const start = i
    i++ // opening backtick
    while (i < src.length) {
      const c = src[i]!
      if (c === '\\') i += 2
      else if (c === '`') {
        i++
        return src.slice(start, i)
      } else if (c === '$' && src[i + 1] === '{') {
        i += 2
        let depth = 1
        while (i < src.length && depth > 0) {
          const d = src[i]!
          if (d === '`') readTemplate()
          else if (d === "'" || d === '"') readQuoted()
          else {
            if (d === '{') depth++
            else if (d === '}') depth--
            i++
          }
        }
      } else i++
    }
    return src.slice(start)
  }
  const readQuoted = (): string => {
    const q = src[i]!
    const start = i
    i++
    while (i < src.length && src[i] !== q && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1
    i++
    return src.slice(start, i)
  }
  while (i < src.length) {
    const c = src[i]!
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end === -1 ? src.length : end + 2
    } else if (c === '`') out.push(readTemplate())
    else if (c === "'" || c === '"') out.push(readQuoted())
    else i++
  }
  return out
}
