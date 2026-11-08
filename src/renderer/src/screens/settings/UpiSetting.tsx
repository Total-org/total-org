import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { translator, type Translate } from '@shared/i18n'
import { mapError, type CaughtError } from '@shared/errors'
import { api } from '../../lib/client'
import { useT } from '../../lib/i18n'
import { useMode } from '../../lib/mode'
import { isOwnerOrNoUsers } from '../../lib/roles'
import { useSession } from '../../state/stores'
import { Button } from '../../components/kit/Button'
import { Field, TextInput } from '../../components/kit/Field'

const ENGLISH = translator('en')
const UPI_KEY = ['upi'] // i18n-technical

/**
 * A10 — Settings → Bills & printing: the business's UPI ID (meta `upi`, owner-only, audited as a
 * company update). With one set, a sales bill with money due prints a "Pay by UPI" QR (made
 * locally — shared/upi.ts). Plain words in a simple-mode company, English in the full app.
 */
export function UpiSetting(): React.JSX.Element {
  const simple = useMode() === 'simple'
  const userT = useT()
  const t: Translate = simple ? userT : ENGLISH
  const { user } = useSession()
  const owner = isOwnerOrNoUsers(user)
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: UPI_KEY, queryFn: api.upi.get })
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setValue(data?.upiId ?? ''), [data])

  const save = async (): Promise<void> => {
    setBusy(true)
    setNote(null)
    setError(null)
    try {
      const r = await api.upi.set(value.trim() === '' ? null : value)
      queryClient.setQueryData(UPI_KEY, r)
      setValue(r.upiId ?? '')
      setNote(r.upiId ? t('simple.upi.saved') : t('simple.upi.cleared'))
    } catch (err) {
      const m = mapError(err as CaughtError, { simple, t, fields: ['upiId'] })
      setError(m.fields.upiId ?? m.general ?? t('errors.generic'))
    } finally {
      setBusy(false)
    }
  }

  const changed = value.trim() !== (data?.upiId ?? '')
  return (
    <section className="mb-6 rounded-xl border border-line bg-panel px-4 py-3" aria-labelledby="upi-setting-title" data-testid="upi-setting">
      <h2 id="upi-setting-title" className="text-body font-semibold text-ink">{t('simple.upi.title')}</h2>
      <p className="mt-1 text-detail text-muted">{t('simple.upi.intro')}</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Field label={t('simple.upi.label')} name="upiId" error={error} hint={owner ? t('simple.upi.hint') : t('simple.upi.ownerOnly')} className="min-w-64 flex-1">
          <TextInput
            data-testid="upi-id-input"
            value={value}
            disabled={!owner || busy || data === undefined}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
              setNote(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && owner && changed) void save()
            }}
          />
        </Field>
        {owner && (
          <Button variant="primary" data-testid="btn-upi-save" disabled={busy || !changed} onClick={() => void save()}>
            {t('simple.upi.save')}
          </Button>
        )}
      </div>
      <p className="mt-2 text-small text-muted">{t('simple.upi.notOnNotes')}</p>
      {note && (
        <p role="status" className="mt-1 text-detail text-success" data-testid="upi-setting-note">
          {note}
        </p>
      )}
    </section>
  )
}
