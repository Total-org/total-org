// Scenario 07 — payroll preview-parity: payroll:preview for a month must agree line-for-line
// with what payroll:commit then writes (same employees, same net pay), and the committed run
// posts a balanced voucher. Since audit A13b a run deducts no PF / ESI / PT, whatever the
// employee's (old) flags say: both employees below are sent with them on.
//
// RECONCILE: lane S4 moves the renderer preview to the server (payroll:preview) — once merged,
// assert the Payroll screen's preview table shows these same figures.
import { scenario, assert, assertEq, localToday } from '../lib/harness.mjs'

await scenario('07-payroll', async (h) => {
  await h.createDemoCompany()

  await h.invoke('payroll:employees:save', {
    data: {
      name: 'Asha Kulkarni', code: 'E001', designation: 'Accountant', joined: null,
      pan: 'ABCPK1234F', uan: '100200300400', esicNo: null,
      basic: 3000000, hra: 1200000, special: 600000,
      pfEnabled: true, esiEnabled: true, ptEnabled: true, active: true
    }
  })
  await h.invoke('payroll:employees:save', {
    data: {
      name: 'Ravi Iyer', code: 'E002', designation: 'Sales', joined: null,
      pan: null, uan: null, esicNo: null,
      basic: 1200000, hra: 400000, special: 200000,
      pfEnabled: true, esiEnabled: true, ptEnabled: true, active: true
    }
  })

  const month = localToday().slice(0, 7)
  const preview = await h.invoke('payroll:preview', { month, days: [] })
  assertEq(preview.length, 2, 'preview covers both employees')
  for (const line of preview) {
    assert(Number.isInteger(line.net) && line.net > 0, `${line.employeeName ?? line.name}: net pay is positive integer paise`)
    assertEq(line.pfEmp + line.pfEr + line.esiEmp + line.esiEr + line.pt, 0, `${line.employeeName}: no PF / ESI / PT`)
  }
  // Hand-worked: Asha 30,000 + 12,000 + 6,000 = ₹48,000 a month, Ravi 12,000 + 4,000 + 2,000 =
  // ₹18,000. Even a full year (₹5.76 lakh / ₹2.16 lakh) is under the new regime's rebate, so no
  // TDS in any month: net = gross.
  const byName = Object.fromEntries(preview.map((l) => [l.employeeName, l]))
  const figures = (l) => JSON.stringify([l.gross, l.tds, l.net])
  assertEq(figures(byName['Asha Kulkarni']), '[4800000,0,4800000]', 'Asha: gross = net ₹48,000')
  assertEq(figures(byName['Ravi Iyer']), '[1800000,0,1800000]', 'Ravi: gross = net ₹18,000')
  const previewNet = preview.reduce((s, l) => s + l.net, 0)
  const previewGross = preview.reduce((s, l) => s + l.gross, 0)

  const run = await h.invoke('payroll:commit', { month, days: [] })
  assert(typeof run.voucherId === 'number', 'commit posted a voucher')
  assertEq(run.lines.length, preview.length, 'commit wrote one line per previewed employee')
  const commitNet = run.lines.reduce((s, l) => s + l.net, 0)
  const commitGross = run.lines.reduce((s, l) => s + l.gross, 0)
  assertEq(commitNet, previewNet, 'preview/commit net parity')
  assertEq(commitGross, previewGross, 'preview/commit gross parity')
  assertEq(run.pfAdminTopUp, 0, 'no PF admin top-up')
  // The salary journal: Salaries Dr ₹66,000 = Salaries Payable Cr ₹66,000 — no PF / ESI / PT line.
  const v = await h.invoke('voucher:get', { id: run.voucherId })
  const ledgerNames = new Map((await h.invoke('master:ledgers:list')).map((l) => [l.id, l.name]))
  const lines = v.lines.map((l) => `${ledgerNames.get(l.ledgerId)} ${l.drCr} ${l.amount}`).sort()
  assertEq(JSON.stringify(lines), JSON.stringify(['Salaries Payable cr 6600000', 'Salaries dr 6600000']), 'salary journal lines')

  // The books still tie with the salary voucher in.
  const today = localToday()
  const tb = await h.invoke('report:trialBalance', { asOn: today })
  assertEq(tb.totalDebit, tb.totalCredit, 'TB ties after payroll commit')

  const runs = await h.invoke('payroll:runs')
  assert(runs.some((r) => r.month === month), 'run listed for the month')

  await h.goto('payroll')
  await h.shot('01-payroll')
})
