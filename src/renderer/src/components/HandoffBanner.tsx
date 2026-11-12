import { useState } from 'react'
import { formatPaise } from '@shared/money'
import { followUpIntent, INTENT_SCREEN, moneyPartOf, type SimpleHandoff } from '@shared/simple/handoff'
import { api } from '../lib/client'
import { openHandoff } from '../lib/handoff'
import { useT } from '../lib/i18n'
import { useNav, useSession, useToasts, type Screen } from '../state/stores'
import { Banner, Button } from './ui'

/**
 * WP 9.10: above the full editor opened from a simple form's "Accountant view" — the answers are
 * filled in and nothing is saved until Save; the parts of the same answers this editor does not
 * hold (a payment made now, a refund), accounts that do not exist yet and are made on save (the
 * walk-in customer, GST / round-off ledgers), and accounts to pick or create. Plain words (t()), since
 * whoever reads it came from a simple screen.
 */
export function HandoffBanner({ handoff }: { handoff: SimpleHandoff }): React.JSX.Element {
  const t = useT()
  return (
    <Banner
      tone="info"
      className="mb-section"
      testId="handoff-banner"
      title={handoff.afterBill != null ? t('simple.handoff.afterBillTitle', { bill: handoff.afterBill }) : t('simple.handoff.title')}
    >
      <p>{t('simple.handoff.body')}</p>
      {handoff.others.map((o, i) => (
        <p key={i} className="mt-1" data-testid="handoff-other">
          {t(o.kind === 'receipt' ? 'simple.handoff.otherReceived' : 'simple.handoff.otherPaid', { amount: formatPaise(o.amount, { symbol: true }) })}
        </p>
      ))}
      {(handoff.addedOnSave?.length ?? 0) > 0 && (
        <p className="mt-1" data-testid="handoff-added-on-save">
          {t('simple.handoff.addedOnSave', { names: handoff.addedOnSave!.join(', '), count: handoff.addedOnSave!.length })}
        </p>
      )}
      {handoff.missing.length > 0 && (
        <p className="mt-1" data-testid="handoff-missing">
          {t('simple.handoff.missing', { names: handoff.missing.join(', '), count: handoff.missing.length })}
        </p>
      )}
    </Banner>
  )
}

/** The party the answers named (when the saved entry carries none). */
function intentParty(h: SimpleHandoff): number | null {
  const i = (h.intent ?? {}) as { customerId?: number; supplierId?: number }
  return i.customerId ?? i.supplierId ?? null
}

/**
 * Phase 5: the hand-off's SECOND step. Once the editor saved the bill / return note, the money
 * paid / received / refunded now (which that editor does not hold) opens as its own receipt /
 * payment editor, pre-filled and set against the entry just saved (shared/simple/handoff.ts
 * `followUpIntent` → simple:intentForm — nothing is saved until the user saves it there).
 */
export function HandoffNextStep({ handoff, savedId }: { handoff: SimpleHandoff; savedId: number }): React.JSX.Element | null {
  const t = useT()
  const nav = useNav()
  const toast = useToasts()
  const today = useSession((s) => s.workingDate)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const part = moneyPartOf(handoff)
  if (!part || done) return null
  const amount = formatPaise(part.amount, { symbol: true })
  const received = part.kind === 'receipt'
  const next = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const v = await api.vouchers.get(savedId)
      if (!v) {
        setDone(true)
        return void toast.push('info', t('simple.handoff.nothingLeft'))
      }
      const partyId = v.partyLedgerId ?? intentParty(handoff)
      const openBills = partyId != null ? await api.simpleMoney.bills(partyId, v.date) : []
      const intent = followUpIntent(handoff, { voucherId: savedId, date: v.date, partyId, openBills })
      if (!intent) {
        setDone(true)
        return void toast.push('info', t('simple.handoff.nothingLeft'))
      }
      const bill = openBills.find((b) => b.voucherId === savedId)?.name ?? v.number
      const blank: Screen = { name: 'voucher-entry', kindHint: part.kind }
      await openHandoff({
        from: INTENT_SCREEN[intent.kind] as Screen['name'],
        intent,
        today,
        blank,
        force: true,
        afterBill: bill,
        // In place of this (now blank) editor: Back from the second step goes where the first came from.
        go: (screen) => nav.replace(screen),
        onNotCarried: () => toast.push('info', t('simple.handoff.notCarried'))
      })
    } catch (err) {
      toast.push('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Banner tone="info" className="mb-section" testId="handoff-next" title={t('simple.handoff.nextTitle')}>
      <p>{t(received ? 'simple.handoff.nextReceived' : 'simple.handoff.nextPaid', { amount })}</p>
      <div className="mt-2">
        <Button variant="primary" onClick={() => void next()} disabled={busy} data-testid="btn-handoff-next">
          {t(received ? 'simple.handoff.nextReceivedButton' : 'simple.handoff.nextPaidButton', { amount })}
        </Button>
      </div>
    </Banner>
  )
}
