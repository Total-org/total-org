// Scenario 78 — A10 (audit 2026-11 PROD-7 / PROD-8): share a bill and the UPI pay QR.
//   1. A simple-mode shop: Settings → Bills & printing → "Get paid by UPI": a wrong ID is refused
//      under the field, sharma@ybl is saved.
//   2. A ₹1,180 bill to Ramesh with ₹500 received: its print carries "Pay by UPI" with the QR for
//      the ₹680 still due (upi://pay … am=680.00); a bill paid in full prints no QR.
//   3. The bill's simple view → Share → WhatsApp: the PDF is written and shown in Finder, and the
//      OS browser is asked for wa.me/91<number> with the plain message (due + UPI ID); E-mail asks
//      for a mailto: draft. The app itself sends nothing (shell.openExternal is stubbed).
//   4. PROD-11: Settings → Bills & printing → "Receipt printer, 2-inch (58 mm)": the bill prints
//      on the 58 mm receipt (the UPI QR above its words) and its PDF page is 58 mm wide.
//   5. Accountant view: the same bill in the full sales editor has Share too.
import * as fs from 'node:fs'
import { scenario, assert, assertEq, localToday } from '../lib/harness.mjs'

const attached = (h, sel, timeout = 15000) => h.page.waitForSelector(sel, { state: 'attached', timeout })

await scenario('78-share-upi', async (h) => {
  const { page } = h
  const today = localToday()
  await h.createCompanyUI('Sharma Stores', { mode: 'simple' })
  await h.stubDialogs()
  await h.app.evaluate(({ shell }) => {
    globalThis.__external = []
    globalThis.__shown = []
    shell.openExternal = async (u) => void globalThis.__external.push(u)
    shell.showItemInFolder = (p) => void globalThis.__shown.push(p)
    shell.openPath = async () => ''
  })
  const external = () => h.app.evaluate(() => globalThis.__external ?? [])
  const shown = () => h.app.evaluate(() => globalThis.__shown ?? [])

  const groups = await h.invoke('master:groups:list')
  const gid = (n) => groups.find((g) => g.name === n).id
  const ledger = (name, group, extra = {}) =>
    h.invoke('master:ledgers:create', {
      name, groupId: gid(group), openingBalance: 0, gstin: null, stateCode: null, address: null, taxType: null, gstRate: null, hsn: null,
      tdsSectionId: null, pan: null, creditDays: null, exportType: null, ...extra
    })
  const ramesh = await ledger('Ramesh', 'Sundry Debtors', { phone: '98765 43210', email: 'ramesh@example.in' })
  const sales = await ledger('Shop sales', 'Sales Accounts')
  const ledgers = await h.invoke('master:ledgers:list')
  const cash = ledgers.find((l) => l.name === 'Cash').id
  const types = await h.invoke('master:voucherTypes:list')
  const vt = (k) => types.find((t) => t.kind === k).id
  const save = async (kind, partyId, lines) =>
    (await h.invoke('voucher:save', {
      data: { voucherTypeId: vt(kind), date: today, partyLedgerId: partyId, reference: null, narration: null, lines: lines.map((l) => ({ ...l, costAllocations: [] })), inventory: [], billRefs: [], tds: null }
    })).id
  const bill = await save('sales', ramesh.id, [{ ledgerId: ramesh.id, drCr: 'dr', amount: 118000 }, { ledgerId: sales.id, drCr: 'cr', amount: 118000 }])
  await save('receipt', null, [{ ledgerId: cash, drCr: 'dr', amount: 50000 }, { ledgerId: ramesh.id, drCr: 'cr', amount: 50000 }])

  // ---- 1. the UPI ID setting
  await h.click('simple-nav-settings')
  await h.click('simple-entry-bills-printing')
  await attached(h, '[data-testid="upi-setting"]')
  await page.waitForSelector('[data-testid="upi-id-input"]:not([disabled])')
  await page.fill('[data-testid="upi-id-input"]', 'sharma')
  await h.click('btn-upi-save')
  await attached(h, '[data-testid="field-error-upiId"]')
  assert((await page.textContent('[data-testid="field-error-upiId"]')).includes('name@bank'), 'a wrong UPI ID is explained under the field')
  await page.fill('[data-testid="upi-id-input"]', 'Sharma@YBL')
  await h.click('btn-upi-save')
  await attached(h, '[data-testid="upi-setting-note"]')
  assertEq((await h.invoke('upi:get')).upiId, 'sharma@ybl', 'the UPI ID is saved, cleaned')

  // ---- 2. the print
  const { html } = await h.invoke('invoice:previewHtml', { voucherId: bill })
  assert(html.includes('data-upi-qr') && html.includes('Pay by UPI'), 'the bill prints a UPI pay QR')
  assert(html.includes('to pay ₹680.00 to sharma@ybl'), 'the QR asks for the ₹680 still due')
  const paid = await save('sales', ramesh.id, [{ ledgerId: ramesh.id, drCr: 'dr', amount: 20000 }, { ledgerId: sales.id, drCr: 'cr', amount: 20000 }])
  await save('receipt', null, [{ ledgerId: cash, drCr: 'dr', amount: 88000 }, { ledgerId: ramesh.id, drCr: 'cr', amount: 88000 }])
  assert(!(await h.invoke('invoice:previewHtml', { voucherId: paid })).html.includes('data-upi-qr'), 'a bill paid in full prints no QR')
  const facts = await h.invoke('invoice:shareFacts', { voucherId: bill })
  assertEq(facts.duePaise, 0, 'the first bill is paid now too (oldest first)')
  // A fresh unpaid ₹990 bill for the share step.
  const open = await save('sales', ramesh.id, [{ ledgerId: ramesh.id, drCr: 'dr', amount: 99000 }, { ledgerId: sales.id, drCr: 'cr', amount: 99000 }])

  // ---- 3. Share from the bill's simple view
  await h.click('btn-back-to-simple')
  await h.click('simple-nav-sell')
  await h.click('simple-entry-sales-list')
  await h.waitScreen('simple-sales')
  await attached(h, `[data-testid="rows-simple-sales"] tr[data-row-id="${open}"]`)
  await page.click(`[data-testid="rows-simple-sales"] tr[data-row-id="${open}"]`)
  await attached(h, '[data-testid="simple-sale"][data-bill]')
  await h.click('btn-bill-share')
  await attached(h, '[data-testid="btn-bill-share-ways"]')
  await h.click('btn-bill-share-whatsapp')
  await attached(h, '[data-testid="btn-bill-share-note"]')
  const wa = (await external()).at(-1) ?? ''
  assert(wa.startsWith('https://wa.me/919876543210?text='), `WhatsApp opens a chat with Ramesh (${wa.slice(0, 40)})`)
  const message = decodeURIComponent(wa.split('text=')[1] ?? '')
  assert(message.includes('₹990.00') && message.includes('sharma@ybl'), `the message says the amount and the UPI ID (${message})`)
  const pdf = (await shown()).at(-1)
  assert(pdf && pdf.endsWith('.pdf') && fs.existsSync(pdf), 'the bill PDF is written and shown to attach')
  await h.click('btn-bill-share-email')
  await page.waitForFunction(() => (document.querySelector('[data-testid="btn-bill-share-note"]')?.textContent ?? '').includes('mail'))
  const mail = (await external()).at(-1) ?? ''
  assert(mail.startsWith('mailto:ramesh@example.in?subject='), `E-mail opens a draft to Ramesh (${mail.slice(0, 40)})`)
  await h.shot('78-share-simple')

  // ---- 4. PROD-11: a 58 mm (2-inch) receipt printer
  await h.click('simple-nav-settings')
  await h.click('simple-entry-bills-printing')
  await page.waitForSelector('[data-testid="receipt-paper-a4"][aria-checked="true"]:not([disabled])')
  await h.click('receipt-paper-58')
  await attached(h, '[data-testid="receipt-paper-note"]')
  assertEq((await h.invoke('template:list')).defaults.sales, 'receipt-58mm', 'sales bills print on the 58 mm receipt')
  assertEq((await h.invoke('counter:config')).config.templateId, 'receipt-58mm', 'the counter receipt follows')
  const receipt = (await h.invoke('counter:printHtml', { voucherId: open, templateId: 'receipt-58mm' })).html
  assert(receipt.includes('<div class="rc-upi" data-upi-qr>') && receipt.includes('width:28mm'), 'the 58 mm receipt puts a 28 mm UPI QR above its words')
  const { path: receiptPdf } = await h.invoke('invoice:pdf', { voucherId: open })
  const box = fs.readFileSync(receiptPdf, 'latin1').match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/)
  // 58 mm = 58 / 25.4 × 72 = 164.41 pt.
  assert(box && Math.abs(Number(box[1]) - 164.41) < 1, `the PDF page is 58 mm wide (${box?.[1]} pt)`)
  await h.shot('78-receipt-58mm')
  await h.click('btn-back-to-simple')

  // ---- 5. the full sales editor of the same bill
  await h.setMode('accountant')
  await h.gotoAllEntries()
  await attached(h, `[data-testid="rows-registers-entries"] [data-row-id="${open}"]`)
  await page.click(`[data-testid="rows-registers-entries"] [data-row-id="${open}"]`)
  await attached(h, '[data-testid="btn-voucher-share"]')
  await h.click('btn-voucher-share')
  await attached(h, '[data-testid="btn-voucher-share-whatsapp"]')
  assertEq(await page.textContent('[data-testid="btn-voucher-share"]'), 'Share', 'the full app says Share in English')
})
