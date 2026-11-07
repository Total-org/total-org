// Phase 2c: the HSN / SAC field — a text box that searches the GST portal's own list (code prefix
// or description words, shared/gst/hsn.ts). `useHsnStatus` + `HsnStatusLines` say what the typed
// code is; the caller puts them in its Field's hint, so they describe the box (aria-describedby)
// without becoming part of its name. It never fills in or suggests a GST rate (the list has none)
// and only ever writes the code the user typed or picked. Used by the item master and simple
// mode's new-product dialog. The words it prints come in through `labels` (English by default —
// accountant screens; simple callers pass t() words, simple/hsnLabels.ts).
import { useEffect, useId, useMemo, useState } from 'react'
import { checkHsn, hsnDescription, searchHsn, type HsnCheck, type HsnEntry } from '@shared/gst/hsn'
import { useFieldAria } from './kit/Field'
import { registerEscapeLayer } from './kit/layers'
import { inputCls } from './ui'
import { useHsnIndex } from '../lib/hsnMaster'

export interface HsnLabels {
  loading: string
  list: string
  noMatch: (query: string) => string
  rateNote: string
  notInList: (code: string) => string
  fourDigits: string
  eightDigits: string
}

export const ENGLISH_HSN_LABELS: HsnLabels = {
  loading: 'Loading the GST HSN / SAC list…',
  list: 'HSN / SAC codes',
  noMatch: (q) => `No code in the GST HSN / SAC list matches “${q}”.`,
  rateNote: 'Total does not suggest GST rates for a code — check the rate with your CA.',
  notInList: (code) => `${code} is not in the GST portal's HSN / SAC list (April 2026) — check the code.`,
  fourDigits: 'Above ₹5 crore turnover in the preceding year, 6 digits are needed (Notification 78/2020-CT).',
  eightDigits: 'The chemicals of Notification 90/2020-CT under this code need all 8 digits.'
}

const MAX_OPTIONS = 8

/** What to say about the value as typed (none for a malformed value — that is the field's error). */
export function hsnStatusLines(check: HsnCheck, labels: HsnLabels): string[] {
  if (!check.code || check.problem) return []
  const out: string[] = []
  if (check.entry) out.push(`${check.entry.code} · ${hsnDescription(check.entry)}`)
  if (check.notes.includes('not_in_list')) out.push(labels.notInList(check.code))
  if (check.notes.includes('four_digits')) out.push(labels.fourDigits)
  if (check.notes.includes('eight_digits')) out.push(labels.eightDigits)
  if (check.entry) out.push(labels.rateNote)
  return out
}

/** The lines to show under an HSN field for its current value (the list is loaded on demand). */
export function useHsnStatus(value: string, labels: HsnLabels = ENGLISH_HSN_LABELS): string[] {
  const index = useHsnIndex()
  return useMemo(() => (value.trim() ? hsnStatusLines(checkHsn(value, index), labels) : []), [value, index, labels])
}

/** The status lines, for a Field's `hint`. */
export function HsnStatusLines({ lines, testId }: { lines: string[]; testId?: string }): React.JSX.Element | null {
  if (lines.length === 0) return null
  return (
    <span className="block" data-testid={testId}>
      {lines.map((line, i) => (
        <span key={i} className="block">
          {line}
        </span>
      ))}
    </span>
  )
}

export function HsnInput({
  value,
  onChange,
  testId,
  placeholder,
  labels = ENGLISH_HSN_LABELS,
  ariaLabel
}: {
  value: string
  onChange: (value: string) => void
  testId?: string
  placeholder?: string
  labels?: HsnLabels
  ariaLabel?: string
}): React.JSX.Element {
  const index = useHsnIndex()
  const listId = useId()
  const fieldAria = useFieldAria()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  const query = value.trim()
  const options: HsnEntry[] = useMemo(() => (index && query ? searchHsn(index, query, MAX_OPTIONS) : []), [index, query])
  const exact = options.length === 1 && options[0]!.code === query.replace(/[\s.]/g, '')
  const showList = open && !!query && !exact
  // While the list shows it is an Esc layer: a dialog's capture-phase Esc handler lets that Esc
  // through to close the list instead of the whole dialog (and the answers in it).
  useEffect(() => (showList ? registerEscapeLayer() : undefined), [showList])

  const pick = (e: HsnEntry | undefined): void => {
    if (!e) return
    onChange(e.code)
    setOpen(false)
    setActive(-1)
  }

  return (
    <div className="relative">
      <input
        className={`${inputCls} num`}
        data-testid={testId}
        value={value}
        placeholder={placeholder}
        role="combobox"
        aria-label={ariaLabel}
        aria-describedby={fieldAria['aria-describedby']}
        aria-invalid={fieldAria['aria-invalid']}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 && options[active] ? `${listId}-${options[active]!.code}` : undefined}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onKeyDown={(e) => {
          // ⌘↵ is the form's save; plain Enter picks only a row the arrows reached (never what
          // happens to be first — the typed text stays as typed).
          if (e.metaKey || e.ctrlKey) return
          if (!showList) {
            if (e.key === 'ArrowDown' && query) setOpen(true)
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            setOpen(false)
            setActive(-1)
          } else if (e.key === 'ArrowDown' && options.length) {
            e.preventDefault()
            setActive((a) => Math.min(options.length - 1, a + 1))
          } else if (e.key === 'ArrowUp' && options.length) {
            e.preventDefault()
            setActive((a) => Math.max(-1, a - 1))
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault()
            pick(options[active])
          }
        }}
      />
      {showList && (
        <div id={listId} role="listbox" aria-label={labels.list} className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-auto rounded-md border border-line bg-raised shadow-elev-2">
          {!index ? (
            <div className="px-3 py-1.5 text-caption text-muted">{labels.loading}</div>
          ) : options.length === 0 ? (
            <div className="px-3 py-1.5 text-caption text-muted" data-testid={testId ? `${testId}-nomatch` : undefined}>
              {labels.noMatch(query)}
            </div>
          ) : (
            options.map((o, i) => (
              <div
                key={o.code}
                id={`${listId}-${o.code}`}
                role="option"
                aria-selected={i === active}
                data-active={i === active}
                data-code={o.code}
                className="kbar-row cursor-pointer px-3 py-1.5"
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(o)
                }}
              >
                <span className="num text-detail">{o.code}</span>
                <span className="ml-2 text-caption text-muted">{hsnDescription(o)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
