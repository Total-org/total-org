// Payables → MSME (WP 2d): a bill's day of acceptance. The MSMED Act s.15 period runs from the day
// goods were delivered / services rendered, or the day a written objection was removed (s.2(b)
// Explanation) — not necessarily the bill date. The cell shows the day the period runs from and lets
// an accountant record it; "Use the bill date" clears it (exactly as before).
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toDisplayDate, todayISO } from '@shared/dates'
import type { MsmeAcceptanceBasis, MsmeBillRow } from '@shared/payables/types'
import { Button, DateInput, Field, Modal, Select, TextInput } from '../../components/ui'
import { payablesApi } from '../../lib/payablesClient'
import { useToasts } from '../../state/stores'
import { useCanWrite } from '../../simple/ViewerNote'

const BASIS_LABEL: Record<MsmeAcceptanceBasis, string> = {
  delivered: 'Goods delivered / services rendered on',
  objection_removed: 'A written objection was removed on'
}

function AcceptanceDialog({ row, onClose }: { row: MsmeBillRow; onClose: () => void }): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToasts()
  const [basis, setBasis] = useState<MsmeAcceptanceBasis>(row.acceptance?.basis ?? 'delivered')
  const [date, setDate] = useState(row.acceptance?.acceptedOn ?? row.date)
  const [note, setNote] = useState(row.acceptance?.note ?? '')
  const [busy, setBusy] = useState(false)
  const save = async (acceptedOn: string | null): Promise<void> => {
    if (row.voucherId == null) return
    setBusy(true)
    try {
      await payablesApi.setMsmeAcceptance({ voucherId: row.voucherId, acceptedOn, basis, note })
      await qc.invalidateQueries({ queryKey: ['msmeReport'] })
      await qc.invalidateQueries({ queryKey: ['payablesPlan'] })
      toast.push('success', acceptedOn ? `Accepted on ${toDisplayDate(acceptedOn)} — the s.15 period runs from it` : 'The s.15 period runs from the bill date again')
      onClose()
    } catch (err) {
      toast.push('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const dirty = date !== (row.acceptance?.acceptedOn ?? row.date) || basis !== (row.acceptance?.basis ?? 'delivered') || note !== (row.acceptance?.note ?? '')
  return (
    <Modal title={`Day of acceptance — bill ${row.number}`} onClose={onClose} dirty={dirty}>
      <div className="grid gap-3" data-testid="msme-acceptance-dialog">
        <p className="text-hint text-muted">
          The s.15 period runs from the day the goods were delivered or the services rendered — or, when you objected in writing within
          15 days, from the day the supplier removed the objection (MSMED Act s.2(b) Explanation). Bill date: {toDisplayDate(row.date)}.
        </p>
        <Field label="What happened">
          <Select data-testid="input-msme-acceptance-basis" value={basis} onChange={(e) => setBasis(e.target.value as MsmeAcceptanceBasis)}>
            {(Object.keys(BASIS_LABEL) as MsmeAcceptanceBasis[]).map((b) => (
              <option key={b} value={b}>{BASIS_LABEL[b]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <DateInput value={date} context={row.date} onChange={setDate} testId="input-msme-acceptance-date" ariaLabel="Day of acceptance" />
        </Field>
        <Field label="Note (optional)">
          <TextInput value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} data-testid="input-msme-acceptance-note" placeholder="GRN 14, objection letter of 3 Jul …" />
        </Field>
        <div className="flex flex-row-reverse gap-2">
          <Button variant="primary" data-save-shortcut="" data-testid="btn-msme-acceptance-save" loading={busy} disabled={!date || date > todayISO()} onClick={() => void save(date)}>
            Save
          </Button>
          {row.acceptance && (
            <Button data-testid="btn-msme-acceptance-clear" disabled={busy} onClick={() => void save(null)}>
              Use the bill date
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** The "Accepted" cell of the MSME dues table. */
export function MsmeAcceptanceCell({ row }: { row: MsmeBillRow }): React.JSX.Element {
  const canWrite = useCanWrite()
  const [open, setOpen] = useState(false)
  const recorded = row.acceptance
  return (
    <span className="inline-flex items-center gap-1">
      <span className={recorded ? 'num' : 'num text-muted'} title={recorded ? `${BASIS_LABEL[recorded.basis]} ${toDisplayDate(recorded.acceptedOn)}${recorded.note ? ` — ${recorded.note}` : ''}` : 'The bill date'}>
        {toDisplayDate(row.acceptedOn)}
      </span>
      {canWrite && row.voucherId != null && (
        <Button size="sm" variant="ghost" data-testid={`btn-msme-acceptance-${row.voucherId}`} aria-label={`Change the day of acceptance of bill ${row.number}`} onClick={(e) => { e.stopPropagation(); setOpen(true) }}>
          Change
        </Button>
      )}
      {open && <AcceptanceDialog row={row} onClose={() => setOpen(false)} />}
    </span>
  )
}
