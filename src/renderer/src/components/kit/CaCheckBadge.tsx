import { useState } from 'react'
import { PopoverButton } from '../table/Popover'

/**
 * Phase 2b — "Check with your CA": a small amber badge beside a figure, a date or a file that
 * rests on a tax rule Total could not confirm in the official text. Click (or Enter) opens a
 * popover with one sentence per point and the rule it is about. The kit takes every word as a
 * prop; `components/CaCheck.tsx` fills them from the registry (shared/caCheck.ts) — t() on simple
 * screens, English on accountant ones. A badge never changes what it sits beside.
 */
export function CaCheckBadge({
  label,
  ariaLabel,
  intro,
  points,
  testId
}: {
  /** Badge text ("Check with your CA"). */
  label: string
  /** Accessible name of the trigger and the popover. */
  ariaLabel: string
  /** First line of the popover. */
  intro: string
  points: { id: string; sentence: string; rule: string }[]
  testId?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  // A click on the badge or in its popover (portalled, but still a React child) must not reach a
  // clickable parent. Keys are left alone: app shortcuts (⌘K, ⌘L, Esc-back) listen on window,
  // and drill rows already ignore keys from their children.
  return (
    <span className="contents" onClick={(e) => e.stopPropagation()}>
    <PopoverButton
      label={ariaLabel}
      popoverLabel={ariaLabel}
      open={open}
      setOpen={setOpen}
      align="left"
      width={340}
      testId={testId}
      className="ml-1.5 inline-flex normal-case tracking-normal !rounded-sm !border-warning/40 !bg-warning-soft !px-1.5 !py-px align-middle text-label font-medium whitespace-nowrap !text-warning hover:!border-warning"
      render={() => (
        <div className="flex flex-col gap-2" data-testid={testId && `${testId}-body`} data-points={points.map((p) => p.id).join(' ')}>
          <p className="text-detail text-ink">{intro}</p>
          <ul className="flex flex-col gap-2">
            {points.map((p) => (
              <li key={p.id} className="text-detail text-ink" data-testid={testId && `${testId}-point-${p.id}`}>
                {p.sentence}
                <span className="mt-0.5 block text-hint text-muted">{p.rule}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    >
      {label}
    </PopoverButton>
    </span>
  )
}
