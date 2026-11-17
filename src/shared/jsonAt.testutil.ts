// Tests read JSON documents the app builds as Record<string, unknown> (the GSTR-1 / GSTR-3B
// offline-tool files) or parses from disk. jsonAt walks one path through such a document without
// claiming a type for it: each step must be an object (an array is one, indexed by position).

/** A JSON object or array: its members are unknown until read. */
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null

/** The member at `path` (keys and array positions); undefined as soon as a step is missing, so
 *  the expectation on it fails. */
export function jsonAt(json: unknown, ...path: (string | number)[]): unknown {
  let node = json
  for (const key of path) {
    if (!isRecord(node)) return undefined
    node = node[String(key)]
  }
  return node
}
