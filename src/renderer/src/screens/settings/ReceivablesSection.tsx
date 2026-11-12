// Settings → Receivables (WP 4.2): the statement email (subject / body), the payment-request line,
// the three reminder letters (gentle / firm / final) with their merge fields and thresholds and the
// reminder cadence. (The interest posting options went with interest on overdue bills, audit A13b;
// the stored `interest` block still parses and is saved back unchanged.)
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MERGE_FIELDS, REMINDER_BUCKETS, REMINDER_BUCKET_LABELS, type ReceivablesConfig } from '@shared/receivables/config'
import { receivablesApi } from '../../lib/receivablesClient'
import { useToasts } from '../../state/stores'
import { Button, Field, Panel, SectionTitle, Skeleton, TextInput, Textarea } from '../../components/ui'

export function ReceivablesSection(): React.JSX.Element {
  const toast = useToasts()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['receivablesConfig'], queryFn: receivablesApi.config })
  const [draft, setDraft] = useState<ReceivablesConfig | null>(null)
  useEffect(() => {
    if (data && !draft) setDraft(data.config)
  }, [data, draft])
  const dirty = !!draft && !!data && JSON.stringify(draft) !== JSON.stringify(data.config)

  const save = async (): Promise<void> => {
    if (!draft) return
    try {
      const saved = await receivablesApi.setConfig(draft)
      setDraft(saved)
      await qc.invalidateQueries({ queryKey: ['receivablesConfig'] })
      toast.push('success', 'Receivables settings saved')
    } catch (err) {
      toast.push('error', (err as Error).message)
    }
  }
  const num = (v: string, d: number): number => (v.trim() === '' || !Number.isFinite(Number(v)) ? d : Math.trunc(Number(v)))

  if (!draft) {
    return (
      <div>
        <SectionTitle>Receivables</SectionTitle>
        <Panel className="p-5"><Skeleton className="h-4 w-2/3" /></Panel>
      </div>
    )
  }
  const set = (f: (c: ReceivablesConfig) => ReceivablesConfig): void => setDraft((c) => (c ? f(c) : c))
  return (
    <div data-testid="settings-receivables">
      <SectionTitle>Receivables</SectionTitle>
      <Panel className="flex flex-col gap-5 p-5">
        <section className="flex flex-col gap-3">
          <h3 className="text-detail font-semibold">Statement of account — email</h3>
          <Field label="Subject">
            <TextInput data-testid="input-rx-statement-subject" value={draft.statementEmail.subject} onChange={(e) => set((c) => ({ ...c, statementEmail: { ...c.statementEmail, subject: e.target.value } }))} />
          </Field>
          <Field label="Body">
            <Textarea rows={5} value={draft.statementEmail.body} onChange={(e) => set((c) => ({ ...c, statementEmail: { ...c.statementEmail, body: e.target.value } }))} />
          </Field>
          <Field label="Payment request (printed on the statement)" hint="Bank details print from the statement's print template (Settings → Invoice templates → Footer).">
            <TextInput value={draft.paymentRequest} onChange={(e) => set((c) => ({ ...c, paymentRequest: e.target.value }))} />
          </Field>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-detail font-semibold">Reminder letters</h3>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Firm letter from (days overdue)">
              <TextInput className="num text-right" data-testid="input-rx-firm-days" value={String(draft.firmFromDays)} onChange={(e) => set((c) => ({ ...c, firmFromDays: num(e.target.value, c.firmFromDays) }))} />
            </Field>
            <Field label="Final letter from (days overdue)">
              <TextInput className="num text-right" data-testid="input-rx-final-days" value={String(draft.finalFromDays)} onChange={(e) => set((c) => ({ ...c, finalFromDays: num(e.target.value, c.finalFromDays) }))} />
            </Field>
            <Field label="Don't remind again within (days)">
              <TextInput className="num text-right" data-testid="input-rx-gap-days" value={String(draft.minDaysBetweenReminders)} onChange={(e) => set((c) => ({ ...c, minDaysBetweenReminders: num(e.target.value, c.minDaysBetweenReminders) }))} />
            </Field>
          </div>
          {REMINDER_BUCKETS.map((b) => (
            <div key={b} className="flex flex-col gap-2 rounded-lg border border-line p-3" data-testid={`rx-letter-${b}`}>
              <p className="text-detail font-medium">{REMINDER_BUCKET_LABELS[b]} letter</p>
              <Field label="Subject">
                <TextInput value={draft.reminders[b].subject} onChange={(e) => set((c) => ({ ...c, reminders: { ...c.reminders, [b]: { ...c.reminders[b], subject: e.target.value } } }))} />
              </Field>
              <Field label="Body" hint="A line with just {bills} prints as the overdue-bills table on the PDF.">
                <Textarea rows={6} value={draft.reminders[b].body} onChange={(e) => set((c) => ({ ...c, reminders: { ...c.reminders, [b]: { ...c.reminders[b], body: e.target.value } } }))} />
              </Field>
            </div>
          ))}
          <div className="text-hint text-muted">
            Merge fields:{' '}
            {MERGE_FIELDS.map(([k, label]) => (
              <span key={k} className="mr-2 inline-block" title={label}>
                <code className="num rounded bg-panel2 px-1">{`{${k}}`}</code> {label}
              </span>
            ))}
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(data?.config ?? null)}>Discard</Button>
          <Button variant="primary" data-testid="btn-rx-save" data-save-shortcut="" disabled={!dirty} onClick={() => void save()}>Save</Button>
        </div>
      </Panel>
    </div>
  )
}
