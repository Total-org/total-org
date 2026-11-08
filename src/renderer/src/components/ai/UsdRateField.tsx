import { useEffect, useState } from 'react'
import type { Translate } from '@shared/i18n'
import { formatPaise, parseAmountText } from '@shared/money'
import { Button } from '../kit/Button'
import { Field, TextInput } from '../kit/Field'

/** Rupees per US dollar × 10⁶ ↔ the "86.25" the user types (paise precision). */
export function usdRateFromText(text: string): number | null | 'invalid' {
  if (text.trim() === '') return null
  const paise = parseAmountText(text)
  if (paise == null || paise < 100 || paise > 1_000_000) return 'invalid'
  return paise * 10_000
}

function textOf(rateMicro: number | null | undefined): string {
  return rateMicro ? formatPaise(Math.round(rateMicro / 10_000)).replace(/,/g, '') : ''
}

/**
 * A10 / plan 3c — "US dollar rate for AI costs" (AiSettings.usdRateMicro), both AI settings
 * screens. Display only: AI spend in rupees; nothing in the books reads it. `t` is the screen's
 * (the simple helper's language, or English in the full app).
 */
export function UsdRateField({
  t,
  rateMicro,
  canEdit,
  onSave
}: {
  t: Translate
  rateMicro: number | null | undefined
  canEdit: boolean
  onSave: (rateMicro: number | null) => Promise<void>
}): React.JSX.Element {
  const [value, setValue] = useState(textOf(rateMicro))
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setValue(textOf(rateMicro)), [rateMicro])
  const changed = value.trim() !== textOf(rateMicro)
  const save = async (): Promise<void> => {
    const r = usdRateFromText(value)
    if (r === 'invalid') return setError(t('simple.ai.usdRate.invalid'))
    setBusy(true)
    setError(null)
    try {
      await onSave(r)
      setNote(r == null ? t('simple.ai.usdRate.cleared') : t('simple.ai.usdRate.saved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-testid="ai-usd-rate">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('simple.ai.usdRate.label')} name="usdRate" error={error} hint={t('simple.ai.usdRate.hint')} className="min-w-56 flex-1">
          <TextInput
            data-testid="ai-usd-rate-input"
            inputMode="decimal"
            value={value}
            disabled={!canEdit || busy}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
              setNote(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && changed) void save()
            }}
          />
        </Field>
        {canEdit && (
          <Button size="sm" data-testid="btn-ai-usd-rate-save" disabled={busy || !changed} onClick={() => void save()}>
            {t('simple.ai.usdRate.save')}
          </Button>
        )}
      </div>
      {note && (
        <p role="status" className="mt-1 text-hint text-muted" data-testid="ai-usd-rate-note">
          {note}
        </p>
      )}
    </div>
  )
}
