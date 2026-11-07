'use client'

import { useActionState, useEffect, useRef } from 'react'
import { joinWaitlist, type WaitlistState } from '@/app/waitlistAction'
import styles from './WaitlistForm.module.css'

const MESSAGES: Record<Exclude<WaitlistState['status'], 'idle' | 'joined'>, string> = {
  invalid: 'That doesn’t look like an e-mail address. Check it and try again.',
  limited: 'Too many tries just now. Wait ten minutes and try again.',
  closed: 'The waitlist isn’t open yet. Follow the releases on GitHub in the meantime.',
  failed: 'Something went wrong on our side and your address wasn’t saved. Try again in a minute.'
}

interface Props {
  /** Unique per form on the page (labels and messages hang off it). */
  id: string
  /** False until the owner connects the store: the form is replaced by a short note. */
  enabled: boolean
  releasesUrl: string
  tone?: 'light' | 'inverse'
}

export default function WaitlistForm({ id, enabled, releasesUrl, tone = 'light' }: Props): React.JSX.Element {
  // A request that never reaches the server (dropped connection) would otherwise throw into the
  // page; it becomes the same "try again" message as a store failure.
  const [state, action, pending] = useActionState<WaitlistState, FormData>(async (prev, form) => {
    try {
      return await joinWaitlist(prev, form)
    } catch {
      return { status: 'failed', email: String(form.get('email') ?? '') }
    }
  }, { status: 'idle' })
  const done = useRef<HTMLParagraphElement>(null)
  const toneClass = tone === 'inverse' ? styles.inverse : ''
  // One request at a time: a second click before React re-renders the disabled button would
  // otherwise queue another submission (stored once by the server, but it spends a rate-limit try).
  const inFlight = useRef(false)
  useEffect(() => {
    if (!pending) inFlight.current = false
    // The form is replaced by the confirmation: keep focus (and the screen reader) on it.
    if (state.status === 'joined') done.current?.focus()
  }, [pending, state])

  if (!enabled) {
    return (
      <p className={`${styles.closed} ${toneClass}`}>
        The 1.0 waitlist opens soon. Until then, <a href={releasesUrl}>follow the releases on GitHub</a>.
      </p>
    )
  }

  if (state.status === 'joined') {
    return (
      <p ref={done} tabIndex={-1} className={`${styles.done} ${toneClass}`} role="status">
        You’re on the list. We’ll write once, when 1.0 is out.
      </p>
    )
  }

  const error = state.status === 'idle' ? null : MESSAGES[state.status]
  const msgId = `${id}-msg`
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (inFlight.current) e.preventDefault()
        else inFlight.current = true
      }}
      className={`${styles.form} ${toneClass}`} aria-busy={pending} noValidate>
      <label htmlFor={`${id}-email`} className={styles.label}>
        Your e-mail
      </label>
      <div className={styles.row}>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={254}
          placeholder="you@yourshop.in"
          defaultValue={state.email ?? ''}
          aria-invalid={state.status === 'invalid' || undefined}
          aria-describedby={error ? `${msgId}-error ${msgId}` : msgId}
          className={styles.input}
        />
        <button type="submit" className={styles.button} disabled={pending}>
          {pending ? 'Joining…' : 'Join the waitlist'}
        </button>
      </div>
      {/* Honeypot: hidden from people and screen readers; bots fill every box. */}
      <div className={styles.trap} aria-hidden="true">
        <label htmlFor={`${id}-hp`}>Leave this empty</label>
        <input id={`${id}-hp`} name="hp_leave_empty" type="text" tabIndex={-1} autoComplete="off" data-1p-ignore data-lpignore="true" />
      </div>
      <p id={`${msgId}-error`} className={styles.error} role="alert">
        {error}
      </p>
      <p id={msgId} className={styles.note}>
        We only use this to tell you when 1.0 is out.
      </p>
    </form>
  )
}
