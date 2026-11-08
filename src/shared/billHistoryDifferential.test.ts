// Review of #233: the cash forecast's collection history (`billHistory`) must equal origin/main's
// on every event list except where the audit A1 rule applies — a positive event's 'against' ref
// to a name no settling entry's 'new' ref gave (a named credit). Those refs are turned into 'new'
// refs here (both versions then open a bill), so every other path — named credits held as bills,
// refunds against them, invoices drawing on advances, refless FIFO, unknown names — is compared
// case for case with the frozen copy (fixtures/billHistoryMain.ts). The A1 rule itself is checked
// by hand-worked cases in cashForecast.test.ts.
import { describe, it, expect } from 'vitest'
import * as A from './fixtures/billHistoryMain'
import { billHistory } from './cashForecast'
import { gen, rng } from './fixtures/billEventsGen'
import type { BillEvent } from './outstanding'

function withoutA1(evs: BillEvent[]): { events: BillEvent[]; turned: number } {
  const creditNames = new Set<string>()
  let turned = 0
  const events = evs.map((ev) => {
    const refs = ev.refs.map((r) => {
      if (r.kind === 'new') { if (ev.amount < 0) creditNames.add(r.name); return r }
      if (ev.amount > 0 && !creditNames.has(r.name)) { turned++; return { ...r, kind: 'new' as const } }
      return r
    })
    return { ...ev, refs }
  })
  return { events, turned }
}

describe('billHistory = origin/main\'s, case for case (A1 refs aside)', () => {
  it('identical on 50k random event lists', () => {
    let turned = 0, credits = 0
    for (let seed = 1; seed <= 50000; seed++) {
      const r = rng(seed)
      const { events, turned: t } = withoutA1(gen(r))
      turned += t
      if (events.some((e) => e.amount > 0 && e.refs.some((x) => x.kind === 'against'))) credits++
      const cd = r() < 0.3 ? null : Math.floor(r() * 60)
      const clone = () => JSON.parse(JSON.stringify(events)) as BillEvent[]
      expect(JSON.stringify(billHistory(clone(), cd)), `seed ${seed}`).toBe(JSON.stringify(A.billHistory(clone(), cd)))
    }
    expect(turned).toBeGreaterThan(10_000)
    // Lists that still carry a positive 'against' (to a named credit) — the path the review caught.
    expect(credits).toBeGreaterThan(5_000)
  }, 60_000)
})
