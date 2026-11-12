import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GST_STATES } from '@shared/gst/states'
import { issuesOf, mapError, type CaughtError } from '@shared/errors/map'
import {
  MAX_LOGO_BYTES, businessDraft, businessErrors, businessInfoPayload, infoChanged, isRegistered, templateWithBill,
  type BusinessDraft, type BusinessField
} from '@shared/simple/business'
import { api } from '../lib/client'
import { useT } from '../lib/i18n'
import { useUnsavedGuard } from '../lib/useUnsavedGuard'
import { useNav, useSession, useToasts } from '../state/stores'
import { Button, Field, Page, Textarea, TextInput } from '../components/ui'
import { ViewerNote } from './ViewerNote'

const TEMPLATES_KEY = ['printTemplates'] as const // i18n-technical: query key (shared with the designer)
const FULL_FORM = { name: 'company-info' } as const // i18n-technical
const BILLS_PRINTING = { name: 'settings', tab: 'invoice' } as const // i18n-technical

const LOGO_TYPES = 'image/png,image/jpeg,image/webp,image/svg+xml' // i18n-technical: file input filter

/** The fields a refusal can be placed on (company:updateInfo's payload paths). */
const FIELDS = ['name', 'address', 'phone', 'email', 'gstin', 'pan'] as const // i18n-technical: field paths

const cardCls = 'rounded-xl border border-line bg-panel p-panel shadow-elev-1'

/**
 * Audit A7 / UX-1 — Settings → Business details in plain words (the setup checklist's first step
 * and Home's "Add your business details" open it). Name, address, phone / e-mail, the GSTIN and
 * PAN, and what every bill carries: the logo and the bank details. It saves through the existing
 * channels (company:updateInfo, owner only; template:save on the template sales bills use). How the
 * business is registered for GST, the state, e-invoicing and the rest stay in the full form, one
 * click away.
 */
export function SimpleBusiness(): React.JSX.Element {
  const t = useT()
  const nav = useNav()
  const toast = useToasts()
  const queryClient = useQueryClient()
  const { info, slug, setCompany, user } = useSession()
  // company:updateInfo is owner-only (everyone in a company without sign-ins).
  const isOwner = !user || user.role === 'owner'
  const viewer = user?.role === 'viewer'
  const { data: templates } = useQuery({ queryKey: TEMPLATES_KEY, queryFn: api.templates.list })
  const billTemplateId = templates?.defaults.sales ?? null
  const { data: template } = useQuery({
    queryKey: ['printTemplate', billTemplateId], // i18n-technical
    queryFn: () => api.templates.get(billTemplateId!),
    enabled: billTemplateId != null
  })
  // The form shows once the business AND the bill template are read, so nothing typed is replaced
  // by a late answer; after that it follows the saved details only while the user changed nothing.
  const loaded = !!info && templates !== undefined && (billTemplateId == null || template !== undefined)
  const saved = useMemo(() => (loaded && info ? businessDraft(info, template ?? null) : null), [loaded, info, template])
  const [draft, setDraft] = useState<BusinessDraft | null>(saved)
  const shown = useRef<BusinessDraft | null>(saved)
  useEffect(() => {
    setDraft((d) => (d == null || JSON.stringify(d) === JSON.stringify(shown.current) ? saved : d))
    shown.current = saved
  }, [saved])
  const [errors, setErrors] = useState<Partial<Record<BusinessField, string>>>({})
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved)
  useUnsavedGuard(dirty)

  if (!info || !draft) return <Page width="narrow" data-testid="simple-business" data-loading="true">{null}</Page>

  const set = (patch: Partial<BusinessDraft>): void => {
    setDraft({ ...draft, ...patch })
    // A message stays until its field's value changes.
    const cleared = { ...errors }
    for (const k of Object.keys(patch) as BusinessField[]) delete cleared[k]
    if (patch.bankIfsc !== undefined || patch.bankName !== undefined || patch.bankAccount !== undefined || patch.bankBranch !== undefined) {
      delete cleared.bankName
      delete cleared.bankAccount
      delete cleared.bankIfsc
    }
    setErrors(cleared)
  }
  const readOnly = !isOwner

  const onLogo = (file: File | null): void => {
    if (!file) return
    if (fileRef.current) fileRef.current.value = ''
    if (file.size > MAX_LOGO_BYTES) {
      setErrors({ ...errors, logoDataUrl: t('errors.business.logoTooBig', { size: Math.ceil(file.size / 1024) }) })
      return
    }
    const reader = new FileReader()
    reader.onload = () => set({ logoDataUrl: typeof reader.result === 'string' ? reader.result : null })
    reader.readAsDataURL(file)
  }

  const save = async (): Promise<void> => {
    const found = businessErrors(draft, info)
    if (Object.keys(found).length > 0) {
      const shown: Partial<Record<BusinessField, string>> = {}
      for (const [k, key] of Object.entries(found)) shown[k as BusinessField] = t(key!) // i18n-technical: keys from businessErrors
      setErrors(shown)
      return
    }
    setBusy(true)
    // Review: a refusal goes under its field in plain words (WP 8.5 mapError); what has no field
    // is said, with which part was already saved.
    let businessSaved = false
    const refused = (e: unknown): void => {
      const err = e as CaughtError
      const m = mapError(err, { simple: true, t, fields: FIELDS })
      const placed = Object.keys(m.fields).length > 0
      if (placed) setErrors(m.fields as Partial<Record<BusinessField, string>>)
      if (businessSaved) toast.push('error', t('simple.business.billPartFailed'))
      else if (m.general && issuesOf(err).length > 0) toast.push('error', t('simple.business.saveFailed', { reason: m.general }))
      else if (!placed) toast.push('error', t('simple.business.saveFailedPlain'))
    }
    try {
      if (infoChanged(info, draft)) {
        const updated = await api.company.updateInfo(businessInfoPayload(info, draft))
        if (slug) setCompany(slug, updated)
        businessSaved = true
      }
      const next = template ? templateWithBill(template, draft) : null
      if (next) {
        await api.templates.save(next)
        await queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY })
        await queryClient.invalidateQueries({ queryKey: ['printTemplate'] }) // i18n-technical
      }
      await queryClient.invalidateQueries({ queryKey: ['simple', 'home'] }) // i18n-technical
      toast.push('success', t('simple.business.saved'))
    } catch (e) {
      refused(e)
    } finally {
      setBusy(false)
    }
  }

  const registration = info.gstRegistrationType
  const gstSentence =
    registration === 'regular' ? t('simple.business.gstRegular') : registration === 'composition' ? t('simple.business.gstComposition') : t('simple.business.gstNone')

  return (
    <Page width="narrow" data-testid="simple-business" data-loading="false">
      <h1 className="mb-2 font-serif text-heading font-semibold tracking-tight text-ink">{t('simple.settings.business')}</h1>
      <p className="mb-5 text-detail text-muted">{t('simple.business.intro')}</p>
      {viewer ? (
        <ViewerNote top />
      ) : readOnly ? (
        <p role="note" className="mb-4 rounded-md border border-line bg-panel2 px-3 py-2 text-detail text-ink" data-testid="simple-business-owner-only">
          {t('simple.business.ownerOnly')}
        </p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!readOnly && !busy) void save()
        }}
        className="flex flex-col gap-5"
      >
        <section className={cardCls} aria-labelledby="business-you">
          <h2 id="business-you" className="mb-3 text-lead font-semibold text-ink">{t('simple.business.you')}</h2>
          <div className="flex flex-col gap-4">
            <Field label={t('simple.business.name')} name="name" error={(errors.name ?? null)} required>
              <TextInput data-testid="input-business-name" value={draft.name} readOnly={readOnly} maxLength={120} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label={t('simple.business.address')} name="address" error={(errors.address ?? null)} hint={t('simple.business.addressHint')}>
              <Textarea data-testid="input-business-address" rows={3} value={draft.address} readOnly={readOnly} maxLength={500} onChange={(e) => set({ address: e.target.value })} />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('simple.business.phone')} name="phone" error={(errors.phone ?? null)}>
                <TextInput data-testid="input-business-phone" inputMode="tel" value={draft.phone} readOnly={readOnly} maxLength={20} onChange={(e) => set({ phone: e.target.value })} />
              </Field>
              <Field label={t('simple.business.email')} name="email" error={(errors.email ?? null)}>
                <TextInput data-testid="input-business-email" type="email" value={draft.email} readOnly={readOnly} maxLength={120} onChange={(e) => set({ email: e.target.value })} />
              </Field>
            </div>
          </div>
        </section>

        <section className={cardCls} aria-labelledby="business-tax">
          <h2 id="business-tax" className="mb-1 text-lead font-semibold text-ink">{t('simple.business.taxNumbers')}</h2>
          <p className="mb-3 text-detail text-muted" data-testid="simple-business-gst">
            {gstSentence} {t('simple.business.state', { state: GST_STATES[info.stateCode] ?? info.stateCode })}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {isRegistered(info) && (
              <Field label={t('simple.business.gstin')} name="gstin" error={(errors.gstin ?? null)} required>
                <TextInput data-testid="input-business-gstin" className="uppercase" value={draft.gstin} readOnly={readOnly} maxLength={15} onChange={(e) => set({ gstin: e.target.value })} />
              </Field>
            )}
            <Field label={t('simple.business.pan')} name="pan" error={(errors.pan ?? null)} hint={t('simple.business.panHint')}>
              <TextInput data-testid="input-business-pan" className="uppercase" value={draft.pan} readOnly={readOnly} maxLength={10} onChange={(e) => set({ pan: e.target.value })} />
            </Field>
          </div>
          <p className="mt-3 text-detail text-muted">
            {t('simple.business.moreInFull')}{' '}
            <button type="button" className="t-link" data-testid="btn-business-full-form" onClick={() => nav.go(FULL_FORM)}>
              {t('simple.business.openFull')}
            </button>
          </p>
        </section>

        <section className={cardCls} aria-labelledby="business-bill">
          <h2 id="business-bill" className="mb-1 text-lead font-semibold text-ink">{t('simple.business.onBills')}</h2>
          <p className="mb-3 text-detail text-muted">{t('simple.business.onBillsHint')}</p>
          <div className="mb-4">
            <p className="mb-1.5 text-small font-medium text-muted" id="business-logo-label">{t('simple.business.logo')}</p>
            <div className="flex flex-wrap items-center gap-3">
              {draft.logoDataUrl ? (
                <img src={draft.logoDataUrl} alt={t('simple.business.logoAlt')} className="h-12 max-w-40 rounded border border-line bg-white object-contain p-1" data-testid="simple-business-logo" />
              ) : (
                <span className="text-detail text-muted" data-testid="simple-business-no-logo">{t('simple.business.noLogo')}</span>
              )}
              {!readOnly && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={LOGO_TYPES}
                    className="sr-only"
                    tabIndex={-1}
                    aria-labelledby="business-logo-label"
                    data-testid="input-business-logo"
                    onChange={(e) => onLogo(e.target.files?.[0] ?? null)}
                  />
                  <Button size="sm" variant="secondary" data-testid="btn-business-logo" onClick={() => fileRef.current?.click()}>
                    {draft.logoDataUrl ? t('simple.business.changeLogo') : t('simple.business.addLogo')}
                  </Button>
                  {draft.logoDataUrl && (
                    <Button size="sm" variant="ghost" data-testid="btn-business-logo-remove" onClick={() => set({ logoDataUrl: null })}>
                      {t('simple.business.removeLogo')}
                    </Button>
                  )}
                </>
              )}
            </div>
            {(errors.logoDataUrl ?? null) && (
              <span className="mt-1 block text-hint text-danger" role="alert" data-testid="field-error-logoDataUrl">
                {(errors.logoDataUrl ?? null)}
              </span>
            )}
          </div>
          <p className="mb-2 text-small font-medium text-muted">{t('simple.business.bank')}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('simple.business.bankName')} name="bankName" error={(errors.bankName ?? null)}>
              <TextInput data-testid="input-business-bank-name" value={draft.bankName} readOnly={readOnly} maxLength={120} onChange={(e) => set({ bankName: e.target.value })} />
            </Field>
            <Field label={t('simple.business.bankAccount')} name="bankAccount" error={(errors.bankAccount ?? null)}>
              <TextInput data-testid="input-business-bank-account" inputMode="numeric" value={draft.bankAccount} readOnly={readOnly} maxLength={40} onChange={(e) => set({ bankAccount: e.target.value })} />
            </Field>
            <Field label={t('simple.business.bankIfsc')} name="bankIfsc" error={(errors.bankIfsc ?? null)} hint={t('simple.business.bankIfscHint')}>
              <TextInput data-testid="input-business-bank-ifsc" className="uppercase" value={draft.bankIfsc} readOnly={readOnly} maxLength={11} onChange={(e) => set({ bankIfsc: e.target.value })} />
            </Field>
            <Field label={t('simple.business.bankBranch')} name="bankBranch" error={(errors.bankBranch ?? null)}>
              <TextInput data-testid="input-business-bank-branch" value={draft.bankBranch} readOnly={readOnly} maxLength={120} onChange={(e) => set({ bankBranch: e.target.value })} />
            </Field>
          </div>
          <p className="mt-3 text-detail text-muted">
            {t('simple.business.moreOnBills')}{' '}
            <button type="button" className="t-link" data-testid="btn-business-bills-printing" onClick={() => nav.go(BILLS_PRINTING)}>
              {t('simple.settings.billsPrinting')}
            </button>
          </p>
        </section>

        {!readOnly && (
          <div className="flex justify-end">
            <Button type="submit" variant="primary" data-testid="btn-business-save" data-save-shortcut="" disabled={busy || !dirty}>
              {busy ? t('simple.business.saving') : t('common.save')}
            </Button>
          </div>
        )}
      </form>
    </Page>
  )
}
