// Scenario 83 — R3 of the 1.0 readiness review (FIG-G-3): the GST return screens follow the
// registration of the MONTH shown, never today's. A regular company opts into the composition scheme
// from 1 April of this financial year (an option taken from the start of a year — s.10(5) / rule 3(3))
// and withdraws to regular from 1 May (rule 62(5)) — both through Company details, effective-dated
// (WP 8.0; one change is kept, so April reads composition, May regular). April says "A composition
// dealer files CMP-08 and GSTR-4, not this return", offers no export, and GSTR-2B has no credit to
// reconcile (s.10(4)); May shows its GSTR-3B / GSTR-1 with the export; main refuses April's export
// too. Both months are in every working FY, so the scenario holds on any calendar day (a 1 May in the
// future is a valid effective date).
import { scenario, assert, assertEq, fyStartYearOf } from '../lib/harness.mjs'
import { waitForSettled } from '../lib/a11y.mjs'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const display = (iso) => `${iso.slice(8, 10)}-${MON[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}`
const typed = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`

await scenario('83-composition-returns', async (h) => {
  const page = h.page
  const fy = fyStartYearOf()
  const april = `${fy}-04`
  const may = `${fy}-05`
  await h.createCompanyUI('Shift Traders', { gstin: '27AAPFU0939F1ZV' })
  await h.stubDialogs()

  // ---------- Company details: composition from 1 April, back to regular from 1 May ----------
  const changeRegistration = async (type, since) => {
    await page.click('header button[title="Company details"]')
    await h.waitScreen('company-info')
    await page.locator('label', { has: page.locator('span', { hasText: /^Registration$/ }) }).locator('select').selectOption(type)
    await page.waitForSelector('[data-testid="input-company-reg-since"]', { timeout: 5000 })
    await h.fill('input-company-reg-since', typed(since))
    await page.press('[data-testid="input-company-reg-since"]', 'Enter')
    await page.waitForFunction((want) => document.querySelector('[data-testid="input-company-reg-since"]')?.value === want, display(since), { timeout: 5000 })
    await page.getByRole('button', { name: 'Save details' }).click()
    await page.waitForSelector('[data-testid="company-reg-history"]', { timeout: 10000 })
  }
  await changeRegistration('composition', `${april}-01`)
  await changeRegistration('regular', `${may}-01`)
  const { info } = await h.invoke('company:current')
  assertEq(info.gstRegistrationType, 'regular', 'regular again')
  assertEq(info.gstRegistrationSince, `${may}-01`, 'from 1 May')
  assertEq(info.gstPreviousRegistrationType, 'composition', 'composition before')

  // ---------- GSTR-3B: April says no return; May is the regular return ----------
  await h.goto('gstr3b')
  await page.selectOption('[data-testid="input-gstr3b-month"]', april)
  const banner3b = await page.waitForSelector('[data-testid="gstr3b-composition"]', { timeout: 10000 })
  assert((await banner3b.textContent()).includes('A composition dealer files CMP-08 and GSTR-4, not GSTR-3B'), 'April: the composition reason')
  assertEq(await page.$('[data-testid="btn-gstr3b-export"]'), null, 'April: no export')
  await waitForSettled(page)
  await h.shot('01-gstr3b-composition-month')
  await page.selectOption('[data-testid="input-gstr3b-month"]', may)
  await page.waitForSelector('[data-testid="rows-gstr3b"]', { timeout: 10000 })
  assertEq(await page.$('[data-testid="gstr3b-composition"]'), null, 'May: no composition banner')
  assert(await page.$('[data-testid="btn-gstr3b-export"]'), 'May: the export is offered')

  // ---------- GSTR-1: the same split ----------
  await h.goto('gstr1')
  await page.selectOption('[data-testid="input-gstr1-month"]', april)
  const banner1 = await page.waitForSelector('[data-testid="gstr1-composition"]', { timeout: 10000 })
  assert((await banner1.textContent()).includes('not GSTR-1'), 'April GSTR-1: the composition reason')
  assertEq(await page.$('[data-testid="btn-gstr1-export"]'), null, 'April GSTR-1: no export')
  await page.selectOption('[data-testid="input-gstr1-month"]', may)
  await page.waitForSelector('[data-testid="rows-gstr1"]', { state: 'attached', timeout: 10000 })
  assertEq(await page.$('[data-testid="gstr1-composition"]'), null, 'May GSTR-1: no composition banner')

  // ---------- GSTR-2B: no credit to reconcile in April ----------
  await h.goto('gstr2b')
  await page.selectOption('[data-testid="input-gstr2b-month"]', april)
  const banner2b = await page.waitForSelector('[data-testid="gstr2b-composition"]', { timeout: 10000 })
  assert((await banner2b.textContent()).includes('s.10(4) CGST Act'), 'April GSTR-2B: no credit (s.10(4))')
  assertEq(await page.$('[data-testid="btn-2b-pick"]'), null, 'April GSTR-2B: no import')
  await h.shot('02-gstr2b-composition-month')

  // ---------- main refuses April's export too (any caller) ----------
  let refused = ''
  try {
    await h.invoke('gst:exportGstr3b', { from: `${april}-01`, to: `${april}-30`, period: `04${fy}` })
  } catch (err) {
    refused = String(err.message)
  }
  assert(refused.includes('A composition dealer files CMP-08 and GSTR-4'), `April's GSTR-3B export is refused: ${refused}`)
})
