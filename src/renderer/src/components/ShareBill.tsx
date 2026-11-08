import { useState } from 'react'
import { translator, type Translate } from '@shared/i18n'
import { shareMailto, shareMessage, shareSubject, shareWhatsappLink, type BillShareFacts, type ShareVia } from '@shared/billShare'
import { api } from '../lib/client'
import { useT } from '../lib/i18n'
import { Button } from './kit/Button'
import { printFailureText } from '../simple/printFailure'

const ENGLISH = translator('en')

/**
 * A10 — "Share" for one saved bill (sales invoice or credit note), in both modes: the save card,
 * the simple bill view, the accountant invoice editor and All entries. Clicking it shows the ways
 * inline (no popover — Tab reaches each one): WhatsApp (wa.me with the message, the PDF shown in
 * Finder to attach), E-mail (a mailto: draft, PDF shown in Finder), More ways… (the macOS share
 * sheet with the PDF + message — macOS only) and Copy the message. The app itself sends nothing.
 * `plain` = the simple shell's language; otherwise English, like the rest of the full app.
 */
export function ShareBill({
  voucherId,
  plain,
  testId = 'btn-share',
  size
}: {
  voucherId: number
  plain: boolean
  testId?: string
  size?: 'sm' | 'md'
}): React.JSX.Element {
  const userT = useT()
  const t: Translate = plain ? userT : ENGLISH
  const [open, setOpen] = useState(false)
  const [facts, setFacts] = useState<BillShareFacts | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const toggle = async (): Promise<void> => {
    if (open) return setOpen(false)
    setProblem(null)
    setNote(null)
    try {
      setFacts(facts ?? (await api.invoice.shareFacts(voucherId)))
      setOpen(true)
    } catch (err) {
      setProblem(plain ? printFailureText(err, t, t('simple.share.failed')) : err instanceof Error ? err.message : String(err))
    }
  }

  const run = async (via: ShareVia | 'copy'): Promise<void> => {
    if (!facts) return
    setBusy(true)
    setProblem(null)
    setNote(null)
    const text = shareMessage(facts, t)
    try {
      if (via === 'copy') {
        await api.invoice.share(voucherId, 'folder')
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          /* no clipboard (tests, denied) — the PDF is still shown */
        }
        setNote(t('simple.share.copied'))
      } else if (via === 'whatsapp') {
        await api.invoice.share(voucherId, 'whatsapp')
        window.open(shareWhatsappLink(facts, text), '_blank', 'noopener')
        setNote([t('simple.share.openedWhatsapp'), facts.whatsapp ? '' : t('simple.share.noPhone', { name: facts.partyName ?? '' })].filter(Boolean).join(' '))
      } else if (via === 'email') {
        await api.invoice.share(voucherId, 'email')
        window.open(shareMailto(facts, shareSubject(facts, t), text), '_blank', 'noopener')
        setNote(t('simple.share.openedEmail'))
      } else {
        const r = await api.invoice.share(voucherId, 'sheet', text)
        setNote(r.sheet ? t('simple.share.openedSheet') : t('simple.share.copied'))
      }
    } catch (err) {
      setProblem(plain ? printFailureText(err, t, t('simple.share.failed')) : err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="contents">
      <Button size={size} data-testid={testId} aria-expanded={open} disabled={busy} onClick={() => void toggle()}>
        {t('simple.share.button')}
      </Button>
      {open && facts?.shareable && (
        <div role="group" aria-label={t('simple.share.menuLabel')} className="flex flex-wrap items-center gap-2" data-testid={`${testId}-ways`}>
          <Button size={size} data-testid={`${testId}-whatsapp`} disabled={busy} onClick={() => void run('whatsapp')}>
            {t('simple.share.whatsapp')}
          </Button>
          <Button size={size} data-testid={`${testId}-email`} disabled={busy} onClick={() => void run('email')}>
            {t('simple.share.email')}
          </Button>
          {facts.shareSheet && (
            <Button size={size} data-testid={`${testId}-sheet`} disabled={busy} onClick={() => void run('sheet')}>
              {t('simple.share.sheet')}
            </Button>
          )}
          <Button size={size} data-testid={`${testId}-copy`} disabled={busy} onClick={() => void run('copy')}>
            {t('simple.share.copy')}
          </Button>
        </div>
      )}
      {(note || problem) && (
        <p
          role={problem ? 'alert' : 'status'}
          className={`w-full text-detail ${problem ? 'text-danger' : 'text-muted'}`}
          data-testid={`${testId}-${problem ? 'error' : 'note'}`}
        >
          {problem ?? note}
        </p>
      )}
    </div>
  )
}
