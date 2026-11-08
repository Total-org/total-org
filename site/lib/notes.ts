/**
 * Release notes (the CHANGELOG section GitHub releases carry) → React elements, never HTML.
 *
 * The notes are text from merged PRs in a public repo, so nothing in them may become markup:
 * `parseNotes` reads the few Markdown shapes the CHANGELOG uses (## / ### / #### headings,
 * paragraphs, `-` / `*` lists with continuation lines and one level of nesting, **bold**, _italic_,
 * `code`, [text](url) and bare URLs) into plain data, and `renderNotes` builds React elements from
 * it — React escapes every text and attribute. A link is made only for an absolute http(s) URL
 * (`safeHref`, checked with `new URL`); anything else (javascript:, data:, relative, broken) stays
 * text. Audit 2026-11 SEC-7 (the old string-built HTML let a `"` break out of an href).
 * Tested by lib/notes.test.ts (node --test), including hostile entries.
 */
import { createElement, Fragment, type ReactElement, type ReactNode } from 'react'

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }

export interface ListItem {
  c: Inline[]
  items: ListItem[]
}

export type Block =
  | { t: 'h'; level: 2 | 3 | 4; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: ListItem[] }

/** The URL as the browser will see it, or null unless it is an absolute http: / https: URL. */
export function safeHref(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!url.hostname) return null
  return url.href
}

const BARE_URL = /https?:\/\/[^\s<>"'`()[\]{}]+/y
/** Punctuation that ends a sentence rather than the URL ("see https://x.y/a." → no dot). */
const TRAILING = /[.,;:!?*_]+$/

function pushText(out: Inline[], v: string): void {
  if (!v) return
  const last = out[out.length - 1]
  if (last && last.t === 'text') last.v += v
  else out.push({ t: 'text', v })
}

/** Inline Markdown → nodes. Unclosed markers stay literal text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i + 1) {
        out.push({ t: 'code', v: src.slice(i + 1, end) })
        i = end + 1
        continue
      }
    } else if (ch === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2)
      if (end > i + 2) {
        out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    } else if (ch === '_' && (i === 0 || /[\s(]/.test(src[i - 1])) && src[i + 1] && src[i + 1] !== ' ') {
      // _italic_ only at a word start, so snake_case names stay as they are.
      const end = src.indexOf('_', i + 1)
      if (end > i + 1 && (end + 1 === src.length || /[\s).,;:!?]/.test(src[end + 1]))) {
        out.push({ t: 'em', c: parseInline(src.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    } else if (ch === '[') {
      const close = src.indexOf('](', i + 1)
      const end = close < 0 ? -1 : src.indexOf(')', close + 2)
      if (close > i + 1 && end > close + 2) {
        const label = src.slice(i + 1, close)
        const href = safeHref(src.slice(close + 2, end).trim())
        if (href && !label.includes('[')) {
          out.push({ t: 'link', href, c: parseInline(label) })
        } else {
          // Not a link we will make: keep the words, drop the address.
          for (const node of parseInline(label)) node.t === 'text' ? pushText(out, node.v) : out.push(node)
        }
        i = end + 1
        continue
      }
    } else if (ch === 'h') {
      BARE_URL.lastIndex = i
      const m = BARE_URL.exec(src)
      if (m && (i === 0 || !/[A-Za-z0-9]/.test(src[i - 1]))) {
        const raw = m[0].replace(TRAILING, '')
        const href = safeHref(raw)
        if (href) {
          out.push({ t: 'link', href, c: [{ t: 'text', v: raw }] })
          i += raw.length
          continue
        }
      }
    }
    pushText(out, ch)
    i += 1
  }
  return out
}

const HEADING = /^(#{2,4})\s+(.*)$/
const BULLET = /^(\s*)[-*]\s+(.*)$/

/** Block-level Markdown → nodes (plain data; nothing here is HTML). */
export function parseNotes(src: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: ListItem[] | null = null
  // The item a continuation line belongs to, and the raw text gathered for it.
  let current: { item: ListItem; text: string[] } | null = null

  const flushItem = (): void => {
    if (current) {
      current.item.c = parseInline(current.text.join(' '))
      current = null
    }
  }
  const flushPara = (): void => {
    if (para.length) {
      blocks.push({ t: 'p', c: parseInline(para.join(' ')) })
      para = []
    }
  }
  const closeList = (): void => {
    flushItem()
    if (list) {
      blocks.push({ t: 'ul', items: list })
      list = null
    }
  }

  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const heading = HEADING.exec(line)
    const bullet = BULLET.exec(line)
    if (line === '') {
      flushPara()
      closeList()
    } else if (heading) {
      flushPara()
      closeList()
      blocks.push({ t: 'h', level: heading[1].length as 2 | 3 | 4, c: parseInline(heading[2]) })
    } else if (bullet) {
      flushPara()
      flushItem()
      const item: ListItem = { c: [], items: [] }
      const nested = bullet[1].length >= 2 && list && list.length > 0
      if (!list) list = []
      if (nested) list![list!.length - 1].items.push(item)
      else list!.push(item)
      current = { item, text: [bullet[2]] }
    } else if (current && /^\s/.test(raw)) {
      current.text.push(line.trim())
    } else {
      closeList()
      para.push(line.trim())
    }
  }
  flushPara()
  closeList()
  return blocks
}

function inlineNodes(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, k) => {
    switch (n.t) {
      case 'text':
        return n.v
      case 'code':
        return createElement('code', { key: k }, n.v)
      case 'strong':
        return createElement('strong', { key: k }, ...inlineNodes(n.c))
      case 'em':
        return createElement('em', { key: k }, ...inlineNodes(n.c))
      case 'link':
        return createElement('a', { key: k, href: n.href, target: '_blank', rel: 'noopener noreferrer' }, ...inlineNodes(n.c))
    }
  })
}

function listElement(items: ListItem[], key: number): ReactElement {
  return createElement(
    'ul',
    { key },
    ...items.map((item, k) =>
      createElement('li', { key: k }, ...inlineNodes(item.c), ...(item.items.length ? [listElement(item.items, -1)] : []))
    )
  )
}

const HEADING_TAG = { 2: 'h3', 3: 'h4', 4: 'h5' } as const

/** The notes as React elements (the page's h1 / h2 sit above them, so ## becomes h3). */
export function renderNotes(src: string): ReactElement {
  return createElement(
    Fragment,
    null,
    ...parseNotes(src).map((b, k) => {
      if (b.t === 'h') return createElement(HEADING_TAG[b.level], { key: k }, ...inlineNodes(b.c))
      if (b.t === 'p') return createElement('p', { key: k }, ...inlineNodes(b.c))
      return listElement(b.items, k)
    })
  )
}
