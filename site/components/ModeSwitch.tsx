'use client'

import { useId, useRef, useState } from 'react'
import styles from './ModeSwitch.module.css'

export interface ModePanel {
  key: string
  label: string
  /** Rendered on the server and handed in (text + next/image). */
  body: React.ReactNode
  shot: React.ReactNode
}

/** "Shop owner / Accountant": the app's two ways of looking at the same books, as tabs. */
export default function ModeSwitch({ panels }: { panels: ModePanel[] }): React.JSX.Element {
  const [active, setActive] = useState(0)
  const base = useId()
  const tabs = useRef<(HTMLButtonElement | null)[]>([])

  const onKey = (e: React.KeyboardEvent, i: number): void => {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? panels.length - 1 : null
    if (next == null) return
    e.preventDefault()
    const j = (next + panels.length) % panels.length
    setActive(j)
    tabs.current[j]?.focus()
  }

  return (
    <div className={styles.switch}>
      <div role="tablist" aria-label="Who is using Total" className={styles.tabs}>
        {panels.map((p, i) => (
          <button
            key={p.key}
            ref={(el) => {
              tabs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${p.key}`}
            aria-selected={i === active}
            aria-controls={`${base}-panel-${p.key}`}
            tabIndex={i === active ? 0 : -1}
            className={styles.tab}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {panels.map((p, i) => (
        <div
          key={p.key}
          role="tabpanel"
          id={`${base}-panel-${p.key}`}
          aria-labelledby={`${base}-tab-${p.key}`}
          hidden={i !== active}
          tabIndex={0}
          className={styles.panel}
        >
          <div className={styles.body}>{p.body}</div>
          <div className={styles.shot}>{p.shot}</div>
        </div>
      ))}
    </div>
  )
}
