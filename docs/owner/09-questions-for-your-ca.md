# Questions for your CA

Written 17 October 2026. One list you can hand to a chartered accountant. Each question has three
parts:

- **Today**: what Total does now.
- **Confirm**: the exact point the CA must say yes or no to.
- **In the code**: where it is written (file and the UNVERIFIED id), so Claude can change it as soon as you have the answer.

Why this list exists: Total's rule is that no tax rule is written from memory. Where the official
text could not be read, Total says so on screen and in the code. These are those points. If the CA
says "that is right", nothing changes except that we remove the UNVERIFIED label. If the answer is
different, tell Claude the answer and the source, and Claude fixes it. A fix that moves a figure
comes back to you first.

How to use it: read the **Ask first** section with your CA. The rest can be a second sitting, or
skipped for topics you do not sell into (for example TCS or payroll).

Note on four items (Q17 to Q20): the e-invoice applicability (Q17), the e-invoice and e-way bill cancel rules (Q18) and the TCS
slabs (Q19 and Q20) are in pull requests #165, #164 and #163. Those are open,
not merged, when this was written. Their files and ids exist only after they merge. Their lines say
"open PR".

---

## Ask first (these change figures or dates on a return)

1. **GST on sale of an asset: which rule governs?** (GST on sale of assets)
   - Today: Total works out the tax on a sale of a capital good two ways, rule 40(2) (5 points per quarter) and rule 44(6) (remaining months of a 60-month life). It uses the higher.
   - Confirm: is "the higher of the two" safe? Or does one rule govern?
   - In the code: `src/shared/fixedAssetSources.ts`, `cg-two-rules`.
2. **GST on sale of an asset: where does the extra tax go on GSTR-1?** (GST on sale of assets)
   - Today: the extra output tax is reported on the sale invoice line in GSTR-1, so the tax amount is above rate x taxable value. It is also in GSTR-3B 3.1(a). The seller bears it; the buyer is charged tax on the value only. The rule does not name a GSTR-1 table.
   - Confirm: will the portal accept a B2B invoice like that? Or should the buyer be charged the full amount on the invoice instead?
   - In the code: `src/shared/fixedAssetSources.ts`, `cg-where`.
3. **GSTR-1 and GSTR-3B due dates** (GST returns and dates)
   - Today: GSTR-1 on the 11th (monthly) or 13th after the quarter. Quarterly GSTR-3B on the 22nd or 24th by state. Later amendments and one-off extensions are not read.
   - Confirm: are these the dates in force now? Any amendment to Notification 83/2020-CT that changes them?
   - In the code: `src/shared/gst/filing.ts` `GST_FILING_UNVERIFIED`; `src/shared/compliance.ts` `COMPLIANCE_UNVERIFIED`; `src/shared/assistantSources.ts` ids `gstr1-11th`, `gstr3b-qrmp`.
4. **The current GST rate slabs** (GST returns and dates)
   - Today: the 2025 and 2026 slabs (0, 5, 18, 40, and the older 12 and 28 up to 21 Sep 2025) come from secondary copies of Notification 9/2025 and 19/2025 (Central Tax, Rate). Services after 22 Sep 2025 are not reflected.
   - Confirm: are the slabs and dates right? Do any services still carry 12 or 28 percent?
   - In the code: `src/shared/gst/rateTable.ts` `GST_RATE_UNVERIFIED`.
5. **ITC and time bar** (GST returns and dates)
   - Today: the s.16(4) time bar uses 30 November after the financial year only. GSTR-3B rows 4(B) and 4(D) follow Circular 170. Interest on ITC reversal (s.50) is taken as 18 percent, assuming the credit was used.
   - Confirm: is 30 November enough, or is the annual-return limb needed too? Is 18 percent right for this case?
   - In the code: `src/shared/assistantSources.ts` id `s16-4-annual-return`; `src/shared/gst/sources.ts` ids `s50-rate`, `3b-labels`.
6. **TDS: rounding and the 194Q base** (TDS)
   - Today: TDS is rounded to the nearest rupee. Section 194Q is charged on the amount above Rs 50 lakh, and the GST in the base is treated as per the seeded rule.
   - Confirm: round to the nearest rupee, or to Rs 10 as s.288B and s.516 suggest? Does the 194Q base include GST? Is the Rs 10 crore turnover condition read correctly?
   - In the code: `src/main/db/migrations.ts` (the TDS section and rate seed near the `194Q` rows); to-do.md section 5 "TDS (WP 3.1 / 3.2)".
7. **Payroll: the PF wage ceiling and salary TDS rounding** (Payroll)
   - Today: EPF ceiling of Rs 25,000 from 17 September 2026, with the September split-month proration. Salary TDS is rounded to the nearest rupee.
   - Confirm: is the ceiling and its start date right, and how is September prorated? Rupee or Rs 10 rounding for salary TDS?
   - In the code: `src/shared/payrollStatutory.ts` `UNVERIFIED_WP37` (lines on EPF and salary TDS).
8. **Is a composition dealer's treatment right?** (GST returns and dates)
   - Today: only a regular registration charges GST. A composition dealer prints a Bill of Supply. Reverse-charge purchases by a composition dealer are not handled, and only one registration change is remembered.
   - Confirm: is that enough for your customers? Is the reverse-charge gap acceptable?
   - In the code: `src/shared/gst/registration.ts` `GST_REGISTRATION_UNVERIFIED`.

---

## GST on sale of assets

(Q1 and Q2 above, plus these.)

9. **Counting quarters** 
   - Today: "quarter or part" is counted in three-month blocks from the invoice date, not calendar quarters. A sale on the invoice date is in the first quarter.
   - Confirm: is that the usual reading?
   - In the code: `src/shared/fixedAssetSources.ts`, `cg-quarters`.
10. **Comparing the two amounts**
    - Today: "whichever is higher" is compared on the total of CGST, SGST and IGST. Cess is separate. The extra tax is paid under the sale's own heads.
    - Confirm: is a total comparison right, or head by head?
    - In the code: `src/shared/fixedAssetSources.ts`, `cg-compare`.
11. **How much credit was taken**
    - Today: the credit is taken from the tax lines of the asset's purchase bill, in the asset's share. Credit on later additions is not counted. You can type it in by hand.
    - Confirm: is that a safe starting point?
    - In the code: `src/shared/fixedAssetSources.ts`, `cg-itc`.
12. **HSN on the sale invoice**
    - Today: the sale posts to one "Sale of Fixed Assets" account with no HSN. GSTR-1's HSN summary flags it until you set one.
    - Confirm: which HSN or SAC would you put on a used machine, vehicle or furniture sale?
    - In the code: `src/shared/fixedAssetSources.ts`, `cg-hsn`.

## E-invoicing and e-way bill

13. **Invoice number format** 
    - Today: Total warns if the invoice number is not 1 to 16 characters of letters, digits, "/" and "-", not starting with 0, "/" or "-" (NIC schema, Validations item 8). It warns only when e-invoicing is on.
    - Confirm: does your experience match the IRP? Any other number rules?
    - In the code: `src/shared/gst/sources.ts` source `einvoiceDocNo`; `src/shared/gst/einvoiceSchema.ts` (header note UNVERIFIED).
14. **The IRP's checks**
    - Today: the e-invoice file follows the NIC page's patterns and tolerances ("rupee part minus 1 to next rupee plus 1"). Nobody has tested them against the real IRP.
    - Confirm: any case where the IRP rejects a file that follows these?
    - In the code: `src/shared/gst/einvoiceSchema.ts` header "UNVERIFIED (no sandbox credentials)".
15. **TCS on an e-invoice**
    - Today: income-tax TCS goes into the e-invoice's "other charges" field, not into the taxable value or GST.
    - Confirm: is OthChrg the right place? Is TCS outside the GST value (Circular 76/50/2018)?
    - In the code: `src/shared/gst/edocs.ts` (comment on `OthChrg`); `src/main/services/tcs.ts` (header, circular 76/50/2018 note).
16. **Delivery challans on e-way bills**
    - Today: a challan for a sale goes out as supply type Others, sub-supply "Supply on challan" (code 8). Job work, approval and inter-State job-work cases follow our reading.
    - Confirm: is that what officers expect? Is an "approval" a supply here?
    - In the code: `src/shared/gst/edocs.ts` (`challanSubSupply`, UNVERIFIED comment); `src/shared/voucherEdit/stockNote.ts`.
17. **Who needs e-invoicing, and when** (open PR #165)
    - Today (in the PR): thresholds Rs 500 cr, 100, 50, 20, 10 and 5 cr, each from its dated notification. The year's turnover counts from the next 1 April. A 30-day reporting window applies from 1 April 2025 at Rs 10 cr and above.
    - Confirm: any amendment to 13/2020-CT after 10/2023-CT? Which year's turnover counts for the 30 days? Do OIDAR and rule-14 classes matter to you?
    - In the code: after merge, `src/shared/gst/einvoiceApplicability.ts` `EINVOICE_APPLICABILITY_UNVERIFIED`.
18. **Cancelling an IRN and e-way bill** (open PR #164)
    - Today (in the PR): cancel is refused after 24 hours from the acknowledgement time, or while an e-way bill is live. Extending an e-way bill is allowed only from 8 hours before to 8 hours after expiry. The portal's times are read as IST.
    - Confirm: do the 24 hours count from the acknowledgement or from the Part B entry? Is the remark required on cancel?
    - In the code: after merge, `src/shared/gst/nicRecord.ts` `NIC_UNVERIFIED`.

## TCS

19. **Tour packages (s.206C(1G))** (open PR #163)
    - Today (in the PR): 5 percent up to Rs 10 lakh for the year per buyer, 20 percent above. A collection that crosses the limit is split in two parts. FY 2026-27 is a flat 2 percent.
    - Confirm: is the slab right for FY 2025-26? Is the flat 2 percent for FY 2026-27 right (Finance Act 2026 s.85(f))? The 1961 text could not be opened.
    - In the code: after merge, `src/shared/tcsSources.ts` and `src/main/services/tcs.ts`.
20. **Parking, toll and mining (s.206C(1C))** (open PR #163)
    - Today (in the PR): 2 percent each, no-PAN 5 percent. The 1C rate came from a search index, not the Act text.
    - Confirm: rate and no-PAN rate. Return codes F, G, H (27EQ) and 1090 to 1092 (Form 143).
    - In the code: after merge, `src/shared/tcsSources.ts`.
21. **TCS base and codes**
    - Today: for sales outside 206C(1H), GST in the base follows the seeded rule. Collectee codes 01, 05, 06 and due at receipt versus invoice (1F) are our reading.
    - Confirm: does the base include GST? Are the codes and timing right?
    - In the code: `src/main/db/migrations.ts` (TCS rate seed, comment "UNVERIFIED list in the WP 3.3 report"); to-do.md section 5 "TCS (WP 3.3)".

## TDS

22. **Interest for late deduction (s.201(1A))**
    - Today: "month or part of a month" counts calendar months, first and last both counted (the TRACES reading). A bill that became liable when a later bill crossed the threshold is treated as deductible on that later date. Bills from an earlier year are not followed.
    - Confirm: calendar months or periods from the date? Is the threshold treatment right?
    - In the code: `src/shared/tdsInterest.ts` `TDS_INTEREST_UNVERIFIED`.
23. **TDS deposit date under the new rules**
    - Today: 7th of the next month, 30 April for March, from rule 30(2) of the 1962 Rules. The Income-tax Rules 2026 (rule 218) were read only in secondary sources.
    - Confirm: same dates under rule 218?
    - In the code: `src/shared/compliance.ts` `COMPLIANCE_UNVERIFIED`.
24. **Senior citizens, 194N and old years**
    - Today: the senior-citizen age under the 2025 Act, section 194N and rates before FY 2026 are partly not seeded or only as read.
    - Confirm: what should be seeded for your clients?
    - In the code: to-do.md section 5 "TDS (WP 3.1 / 3.2)"; `src/main/db/migrations.ts` (TDS seed).
25. **Return and certificate layouts**
    - Today: 26Q reason codes, the Form 16A layout and TRACES month counting follow practice, not the current notification.
    - Confirm: anything the TRACES utility rejects?
    - In the code: `src/main/services/tdsWorkbench.ts` (comments "UNVERIFIED against the current utility" and Form 16A).

## GST returns and dates

(Q3 to Q5 and Q8 above, plus these.)

26. **Quarterly GSTR-3B, special states**
    - Today: a state in neither list of rule 61(1)(ii), such as code 97 or a missing state, is dated the 22nd and flagged.
    - Confirm: which date for those?
    - In the code: `src/shared/gst/filing.ts` `GST_FILING_UNVERIFIED`.
27. **Quarterly filers and the offline tools**
    - Today: Total prepares GSTR-1 and 3B files month by month for a quarterly filer. IFF (invoice furnishing facility) and the monthly PMT-06 amount are not modelled.
    - Confirm: does the portal want one file per quarter named by its last month? Do you need IFF or PMT-06 amounts?
    - In the code: `src/shared/gst/filing.ts` `GST_FILING_UNVERIFIED` (lines on QRMP files, IFF, PMT-06).
28. **ARN format and portal wording**
    - Today: an ARN is accepted as 10 to 20 letters or digits. Menu wording on gst.gov.in is as read.
    - Confirm: the real ARN format.
    - In the code: `src/shared/simple/taxes.ts` (comment on the ARN check).
29. **GSTR-2B file fields**
    - Today: field names (reverse charge, ITC available, amended notes) follow real downloads, not the official schema.
    - Confirm: are there other flags that should block or reverse ITC?
    - In the code: `src/shared/assistantSources.ts` ids `gstr2b-schema`, `gstr2b-flags`.
30. **GSTR-9, ITC-04 and IMS**
    - Today: GSTR-9 labels come from a secondary copy, and the Rs 2 crore exemption (Notification 15/2025). The JSON files for GSTR-9, ITC-04 and IMS are Total's own layout, for review, not upload.
    - Confirm: labels and the exemption. How is an IMS record identified?
    - In the code: `src/shared/gst/sources.ts` ids `gstr9-layout`, `gstr9-json`, `gstr9-exempt`, `itc04-json`, `ims-json`, `ims-key`.
31. **Interest charged on overdue bills** (the feature was removed in November 2026, audit A13b — this only matters for interest notes already in old books)
    - Today: the interest debit note carries GST. GST on interest is due when the interest is received, but Total puts it on the note by default (paid early, never late). It reports through the interest ledger with no HSN. The SAC is left blank.
    - Confirm: charge GST when claimed or when received? Which SAC (9971)? Which HSN in Table 12?
    - In the code: `src/shared/receivables/sources.ts` ids `cgst-12-6`, `hsn-of-interest`, `sac-of-interest`.
32. **Amount-only bills and the rate**
    - Today: when a sales bill has no item and its account has no rate, the rate is worked back from the tax posted. Some old months show more GST payable after this change.
    - Confirm: is that the right way to report it? Anything to tell clients with old months?
    - In the code: `src/shared/gst/postedRate.ts`. Also see 04 section 3.1, items 2 and 3.
33. **The old B2C Large limit (Rs 2.5 lakh) around 1 August 2024**
    - Today: an inter-state sale to an unregistered buyer goes in GSTR-1 table 5 (B2C Large) when its value is above Rs 1 lakh, the limit Notification 12/2024-Central Tax set from 1 August 2024. Above Rs 2.5 lakh was the limit before that. Total picks the limit by the INVOICE DATE: a July 2024 invoice of Rs 2,12,400 goes in B2C Small, an August 2024 one in B2C Large. A credit or debit note follows its original invoice's date when Total can tell which invoice it is (so a note issued in August 2024 against a July 2024 invoice of Rs 2,12,400 goes in B2C Small, not CDNUR); when it can't, the note is judged by its own value and date. Quarterly (QRMP) filers have a July to September 2024 quarter that straddles the change.
    - Confirm: does the portal apply the limit by invoice date, or by the tax period the return is for (for example the whole July to September 2024 quarter at one limit)? And for notes: by the original invoice's date, the note's own date, or the period? (GSTN's CDNUR help page still quotes Rs 2.5 lakh.)
    - In the code: `src/shared/gst/returns.ts` `B2CL_LIMIT_CHANGED_ON` and `b2clLimitOn` (the UNVERIFIED note above them); the CDNUR rule in the same file (`isB2clNote`). to-do.md section 5, "GSTR-1 B2CL / CDNUR (#187)".

## MSME

34. **Bank rate history**
    - Today: the RBI bank-rate rows before October 2025 are not read from the official text. Total uses 3 times the bank rate for the s.16 interest.
    - Confirm: the rate and its dates (6 Jun 2025, 7 Feb 2025, 9 Apr 2025, 8 Feb 2023).
    - In the code: `src/shared/payables/msmeSources.ts` (note on the bank-rate rows).
35. **Traders and s.43B(h)**
    - Today: a trader supplier is excluded from s.43B(h), as a reading of an office memorandum. Finance Act 2026 changes to s.37 are not read.
    - Confirm: are traders out? Anything new in FA 2026?
    - In the code: `src/shared/payables/msmeSources.ts` (notes on s.37 and s.43B(h)).
36. **Form 1 and Udyam number**
    - Today: the MSME Form 1 has the S.O. number from a secondary source. The Udyam number is read as state code then district code, no official text.
    - Confirm: the S.O. number and the layout.
    - In the code: `src/shared/payables/msmeSources.ts` (Form 1 and Udyam notes).
37. **MSME bills in the cash forecast** (merged PR #156)
    - Today: if you tick the option, bills of registered micro and small suppliers move to their s.15 date in the forecast. The interest is listed separately and never posted.
    - Confirm: is the s.15 deadline (45 days with a written agreement, 15 without) used correctly, and is the interest worked as 3 times the bank rate, compounded monthly, as s.16 says?
    - In the code: `src/main/services/cashForecast.ts` (`withMsmeFacts`); `src/shared/payables/msme.ts`.

## Payroll

(Q7 above, plus these. Ideally also ask an HR or payroll adviser.)

38. **EPF admin charge and EDLI**
    - Today: admin charge 0.5 percent with a Rs 500 minimum. EDLI 0.5 percent on the Rs 25,000 ceiling. The notification numbers are not confirmed.
    - Confirm: both rates and notifications.
    - In the code: `src/shared/payrollStatutory.ts` `UNVERIFIED_WP37` (first EPF lines); `src/main/db/migrations.ts` (the EDLI and admin rows).
39. **ECR file**
    - Today: the ECR text file uses "#~#" between fields.
    - Confirm: is that the separator the EPFO portal takes?
    - In the code: `src/shared/payrollStatutory.ts` `UNVERIFIED_WP37` (line on the ECR separator).
40. **ESI ceilings under the Code**
    - Today: Rs 21,000 (Rs 25,000 for persons with disability), the Rs 176 exemption and staying covered to the end of the contribution period, as ESIC applies them. The upload template columns are not confirmed.
    - Confirm: legal basis under the Code on Social Security, and the template.
    - In the code: `src/shared/payrollStatutory.ts` `UNVERIFIED_WP37` (ESI lines); `src/main/db/migrations.ts` (ESI rows).
41. **Professional tax**
    - Today: slabs for West Bengal, Tamil Nadu (Chennai), Andhra Pradesh and Madhya Pradesh, and every state's due date except Telangana, are from secondary sources.
    - Confirm: the slabs and due dates for the states you serve.
    - In the code: `src/shared/payrollStatutory.ts` `UNVERIFIED_WP37` (PT line); `src/main/db/migrations.ts` (PT rows, comments `[PT-WB]`, `[PT-AP]`, `[PT-MP]`).
42. **Gratuity, bonus and Form 16**
    - Today: gratuity ceiling Rs 20 lakh and bonus Rs 21,000 / Rs 7,000 as under the new Codes. The Form 16 Part B row list follows the 1962 Rules.
    - Confirm: the figures and the row list.
    - In the code: `src/shared/payrollStatutory.ts` `UNVERIFIED_WP37` (last two lines); `src/shared/print/form16.ts`.
43. **Income-tax sections cited for salary**
    - Today: the 1961 texts for ss.16, 80C, 80CCD, 80D, 10(13A), 24(b), 87A, 192, 288A and 288B were not re-read. The 2025-Act equivalents carry the same figures.
    - Confirm: same figures in the year you file?
    - In the code: `src/shared/payrollStatutory.ts` `UNVERIFIED_WP37` (Income tax line).

## Fixed assets

44. **Hotel and school furniture life**
    - Today: 8 years, from the Schedule II appendix. The MCA e-book copy says 10.
    - Confirm: 8 or 10.
    - In the code: `src/main/db/migrations.ts` (row `V(ii)` and the comment "Hotel / school furniture life").
45. **Income-tax rates and Finance Act 2026**
    - Today: only FY 2025-26 income-tax block rates were read. Earlier years are seeded from FY 2017-18 with unconfirmed start dates. Finance Act 2026 is assumed to change nothing in s.33, s.41, s.74 or Appendix I.
    - Confirm: both points.
    - In the code: `src/main/db/migrations.ts` (comment "UNVERIFIED (kept editable"; rows `BLD5` onwards); `src/shared/depreciation.ts`.
46. **Sale proceeds and half-rate additions**
    - Today: sale proceeds reduce the full-rate block before the half-rate additions (ICAI Illustration 4). The Act's text does not say so.
    - Confirm: is that the order?
    - In the code: `src/main/db/migrations.ts` (same UNVERIFIED comment); `src/shared/fixedAssetSources.ts` id `s50-text` (s.50 and s.43(6)(c) not re-read).
47. **Partial disposal**
    - Today: a part sold takes a pro-rata share of cost, additions and depreciation. A part of a different value (one machine of a set) needs its cost typed in.
    - Confirm: is pro-rata fine for identical units?
    - In the code: `src/shared/fixedAssetSources.ts` ids `part-split`, `part-undo`.
48. **Concessional regime, 40 percent cap**
    - Today: rule 25(2) cap of 40 percent of WDV, and no additional depreciation, applies to 2025-Act years only (FY 2026-27 on). The 1961 equivalent was not re-read.
    - Confirm: is the 1961 rule the same for FY 2025-26 and earlier? Is additional depreciation nil in this regime?
    - In the code: `src/shared/fixedAssetSources.ts` ids `r25-1961`, `r25-regime`.
49. **Extra-shift depreciation and components**
    - Today: double shift +50 percent and triple +100 percent, pro rata by days, averaged over the period. Only the seeded classes are checked for "no extra shift". A component with its own life is split off only before the first depreciation run.
    - Confirm: the formula, and whether components can change later.
    - In the code: `src/shared/fixedAssetSources.ts` ids `shift-formula`, `shift-user-class`, `component-when`.

## Other

50. **Forecast dates**
    - Today: the statutory due dates in the cash forecast were written from memory.
    - Confirm: the dates.
    - In the code: `src/main/services/cashForecast.ts` (UNVERIFIED comments).
51. **Foreign exchange** — no longer applied
    - Today: Total no longer revalues foreign balances or settles them at an actual rate (forex was cut in 1.0, PR #195). Books that already hold revaluation or settlement entries keep them as they are, and an un-reversed revaluation can still be reversed.
    - Confirm: nothing, unless your clients need foreign-currency books again. The old AS 11 / Ind AS 21 citations (as recalled) are still in the code for those entries.
    - In the code: `src/shared/forex.ts` (header comment).
52. **Audit trail**
    - Today: the edit log follows s.128(5), Income-tax rule 6F and the 2025 Act (s.62, rule 46(9)) retention. The exact wording was not re-read.
    - Confirm: retention period and what the log must show.
    - In the code: `src/main/services/audit.ts` (header comments).
53. **State codes**
    - Today: the GST state-code list was not re-read against the latest list.
    - Confirm: any state or code added or changed.
    - In the code: `src/shared/gst/states.ts`.
54. **Applicability and advance GST** 
    - Today: the GPT review left these for a CA: when e-invoicing applies, GST on advances, and the MSME acceptance date.
    - MSME (WP 2d): a bill can now record its day of acceptance (delivery, or an objection removed) and the s.15 period runs from it; whether the supplier was covered is judged on the supply day (the recorded delivery day, else the bill date), never on the day an objection was removed.
    - Confirm: your view on each (the first is also Q17); for MSME, that coverage reading.
    - In the code: to-do.md section 5, last line ("GST calendar items from the GPT review").
55. **Exports and SEZ "with payment of IGST"**
    - Today: a bill to a party flagged "SEZ / export with payment" is charged IGST (an SEZ unit in your own state too, IGST Act s.7(5)(b)); one flagged "without payment" (LUT / bond) is charged no GST (s.16(3)). A credit note to such a party follows the same class — except a return of a bill made before 8 Nov 2026 that charged GST (IGST, or CGST + SGST for an SEZ unit in your state): that return takes the GST the bill charged back (owner, 13 Nov; CGST Act s.34), so the bill and its return net to nil.
    - Confirm: since 1 October 2023 s.16(4) allows payment of IGST on zero-rated supplies only for notified classes — which classes are notified, whether the credit-note rule is right, and whether returning an old bill's GST through the credit note is the right way to correct it.
    - In the code: `src/shared/gst/zeroRated.ts`, `src/shared/gst/sources.ts` id `zero-rated-with-payment`.
56. **TDS: do purchase returns lower the yearly threshold?** (TDS)
    - Today: the yearly limit of a section (s.194C, 194J, 194H … of the 1961 Act; the Income-tax Act 2025 s.393 Table from 1 April 2026) is tested on "the aggregate of the amounts credited or paid" — every bill and advance counts, and a debit note to the supplier does NOT lower it. A contractor billed ₹1,10,000 in the year who was given a ₹20,000 debit note for short work is still over the s.194C ₹1,00,000 yearly limit. (For goods, s.194Q's ₹50 lakh works the same way.)
    - Confirm: does a debit note reduce "the amount credited" for the threshold — under the 1961 Act and under the 2025 Act? Changing it would change which bills Total says needed TDS in years already done — tell Claude, and the owner decides on the old years.
    - In the code: `src/shared/tdsEligibility.ts` (header, THRESHOLDS / BASE).
57. **GST you can't claim back (s.17(5))** (GST)
    - Today: a bill marked "can't claim" (Record a purchase / Money out ask it; the full purchase editor has the box) keeps its Input CGST / SGST / IGST lines. GSTR-3B shows the credit in 4(A)(5) and reverses it in 4(B)(1) (Circular 170), as for a supplier marked "blocked". Since 13 Nov (owner's decision) an EXPENSE or just-an-amount bill marked in Record a purchase / Money out also posts a journal moving that GST from the Input GST accounts into the cost (Dr the bill's account, Cr Input CGST / SGST / IGST), and a return of it moves the returned part back. A bill of PRODUCTS, and a bill marked in the full editor, only carry the mark: their GST stays an asset until the accountant posts that journal. The s.17(5) exceptions (a car dealer, passenger transport, a restaurant buying food to sell …) are left to the user's answer.
    - Confirm: is that journal (Input GST to the expense) the right treatment, and is the 4(A)(5) + 4(B)(1) reporting right? For products: should the GST be part of the stock's cost (AS-2 ¶7, non-recoverable taxes) — i.e. carried in the item's value until sold — rather than expensed at once?
    - In the code: `src/main/services/gst.ts` `bookedItcByVoucher`; `src/shared/gst/returns.ts` `circular170Inputs`.

---

When the CA has answered, send Claude the question number, the answer, and the source (notification,
section or screenshot). Claude will update the code, remove the UNVERIFIED label, and tell you
if any figure moved.

---

<!-- ca-check:start (generated from src/shared/caCheck.ts — do not edit by hand) -->

## In the app: "check with your CA" badges

Each point below shows as a small "Check with your CA" badge beside the figure or date it touches.
When the CA confirms one, Claude removes it from `src/shared/caCheck.ts` (and its UNVERIFIED
note); this list is rewritten from that file, so it never drifts from what the app shows.

| Point | What the badge says | Questions | Where |
| --- | --- | --- | --- |
| `gst-due-dates` | These due dates are the ones in the GST rules. Later changes and one-off extensions (after a portal outage or a flood, say) are not known to Total. *(Notification 83/2020-CT; rules 61 and 62 CGST Rules)* | Q3 | Home → GST tile (its due date); Taxes → GSTR-1 due date; Taxes → GSTR-3B due date; Taxes → composition dates (CMP-08, GSTR-4); Home → GST tile of a composition business; Gateway → Compliance card, GST returns row; GSTR-1 screen header; GSTR-3B screen header |
| `gstr3b-quarterly` | For a quarterly filer GSTR-3B is due on the 22nd or the 24th, by the state of your main place of business. A state in neither list is shown the 22nd. *(Rule 61(1)(ii) CGST Rules)* | Q3, Q26 | Home → GST tile (its due date); Taxes → GSTR-3B due date; Gateway → Compliance card, GST returns row (quarterly filers) |
| `qrmp-files` | For a quarterly filer Total does not offer the monthly invoice upload (IFF), and it prepares the quarter’s files month by month. Ask your CA how to upload them. *(Proviso to s.39(1) CGST Act; rule 59(2) CGST Rules (IFF))* | Q27 | Taxes → how often you file (quarterly filers); Taxes → step 3, prepare the files; Gateway → Compliance card, GST returns row (quarterly filers) |
| `pmt06-amount` | A quarterly filer pays for each of the first two months by the 25th (PMT-06). Total shows the date but does not work out how much to pay. *(Rule 61(3) CGST Rules (PMT-06))* | Q27 | Taxes → PMT-06 dates (quarterly filers); Home → GST tile (its due date) (quarterly filers) |
| `composition-listed-elsewhere` | A pointer to where the composition dates are shown (simple Taxes), not a tax point; those dates carry the "gst-due-dates" badge. | — | closed — not a tax point |
| `gst-slabs-new` | The GST rates from 22 September 2025 (and the changes from 1 February 2026) were read in copies of the notifications, not the official text. *(Notifications 9/2025 and 19/2025-Central Tax (Rate); 02/2025-Compensation Cess (Rate))* | Q4 | Every simple GST rate picker (new product, bill, purchase, money out, return, bank line) (from 2025-09-22) |
| `gst-services-rates` | Rates for services after 22 September 2025 were not checked — a service may still carry 12% or 28%. *(The services rate notification replacing No. 11/2017-Central Tax (Rate))* | Q4 | Every simple GST rate picker (new product, bill, purchase, money out, return, bank line) (from 2025-09-22) |
| `gst-slab-choice` | Total does not know which rate your product or service falls under — you pick it. Check the rate with your CA. *(HSN / SAC classification (Customs Tariff; Scheme of Classification of Services))* | Q4 | Every simple GST rate picker (new product, bill, purchase, money out, return, bank line) |
| `composition-rules` | For a composition business Total charges no GST on bills and claims none on purchases. Purchases where you must pay the GST yourself (reverse charge) are not handled. *(s.10(4) CGST Act; s.9(3) / 9(4) (reverse charge))* | Q8 | Taxes → composition dates (CMP-08, GSTR-4); Home → GST tile of a composition business; Company details → GST registration |
| `notes-follow-invoice` | A return takes the GST of the bill it is against. The law’s exact words on this (s.34) were not re-read. *(s.34 CGST Act)* | Q8 | Returns → the return's total |
| `registration-history` | Only one change of GST registration is kept: the type before and the day the current one started. *(Registration (s.25 CGST Act) and its changes)* | Q8 | Company details → GST registration |
| `gst-state-codes` | The list of GST state codes was not re-read against the latest official list. *(GST state-code list (GSTN))* | Q53 | Company details → state |
| `posted-tax-rupee` | When a bill of just an amount had its GST typed rounded to the rupee, the return shows the GST worked out on the value, not the rounded GST on the bill. Which one the return should carry is not confirmed. *(GSTR-1 / GSTR-3B: tax charged vs rate on value)* | Q32 | Taxes → GST you collected; GSTR-1 screen header; GSTR-3B → 3.1(a) row |
| `zero-rated-with-payment` | A bill to a customer marked “SEZ or export with payment” is charged IGST; one marked “without payment” (LUT or bond) is charged no GST. Since 1 October 2023 GST may be paid on such supplies only by notified classes, and Total does not check which. A return of such a bill follows its bill. *(IGST Act s.16(3) and (4) (zero-rated supply on payment of IGST, from 1 October 2023))* | Q55 | Masters → ledger → Export / SEZ type; Credit note / Returns → a return of an SEZ / export bill saved before 8 Nov that charged GST; Returns → a return of an SEZ / export bill saved before 8 Nov that charged GST |
| `gstr3b-advances` | GST on advances you received is left out of the GST to pay here. The portal may add it (advances less the ones adjusted). Ask your CA. *(GSTR-3B 3.1(a) and GSTR-1 Tables 11A / 11B (advances))* | Q54 | Taxes → cash to pay; GSTR-3B → 3.1(a) row |
| `gstr3b-negative` | In a month with only returns (credit notes), the GST figures can come out below zero. Whether the portal accepts that or carries it forward is not confirmed. *(GSTR-3B save schema; portal handling of negative figures)* | — | Taxes → cash to pay; GSTR-3B → 3.1(a) row |
| `gstr3b-schema-draft` | The GSTR-3B file is checked against the portal’s file layout, which GSTN still marks as a draft. *(GSTR-3B save schema v7.1 (GSTN API portal, marked Draft))* | — | Taxes → step 3, prepare the files; GSTR-3B screen header |
| `hsn-table12` | In the HSN summary (GSTR-1 Table 12) a line without an HSN / SAC code is left out, and services go in with the unit "OTH". The portal may want a code on every line. *(GSTR-1 Table 12 (HSN summary) advisories)* | — | Taxes → step 3, prepare the files; GSTR-1 screen header |
| `hsn-master` | Codes are checked against the GST portal’s HSN / SAC list (April 2026). How complete that list is, and the digits your turnover needs (4, 6 or 8), are not confirmed — Total does not know your turnover. *(GST portal HSN / SAC list (April 2026); Notifications 78/2020-CT and 90/2020-CT (HSN digits))* | — | New product → HSN / SAC code; Masters → stock item → HSN / SAC code |
| `b2cl-limit` | A sale to an unregistered buyer in another state counts as "large" above ₹1 lakh from 1 August 2024 (₹2.5 lakh before), by the bill’s date. Whether the portal goes by the bill’s date or the return period is not confirmed. *(Notification 12/2024-CT (B2C Large limit from 1 August 2024))* | Q33 | GSTR-1 screen header |
| `gstr3b-4b-4d` | The wording of the rows for GST credit reversed and reclaimed (4(B), 4(D)) was read in copies, not the official text. *(Notification 14/2022-CT; Circular 170/02/2022-GST)* | Q5 | GSTR-3B → 4(B) / 4(D) rows; ITC reversal screen |
| `gst-interest-18` | Interest on GST credit reversed is worked out at 18% a year, taking it that the credit was used. The rate was confirmed only in copies. *(s.50 CGST Act (interest rate))* | Q5 | ITC reversal screen |
| `gstr9-files` | The annual return (GSTR-9) labels and the ₹2 crore exemption were read in copies. Its file is Total’s own layout, for review, not upload. *(Rule 80 CGST Rules; Notifications 13/2025 and 15/2025-CT)* | Q30 | GSTR-9 screen |
| `itc04-files` | The job-work return file is Total’s own layout — no official file layout is published — and it has no HSN column. *(Rule 45(3) CGST Rules (FORM ITC-04))* | Q30 | ITC-04 screen |
| `ims-files` | The IMS file is Total’s own layout, and a record is matched by supplier GSTIN, type and number — read from the portal’s screens, not an official spec. *(Invoice Management System (GSTN))* | Q30 | GSTR-2B → IMS tab |
| `gstr2b-fields` | Total reads GSTR-2B files by the field names seen in real downloads; the official layout was not read, so a file that names them differently shows no flag. The suggested actions are bookkeeping suggestions, not tax advice. *(GSTR-2B JSON (GSTN API portal); s.16(2)(aa) CGST Act)* | Q29 | Taxes → GST on purchases; Checks → GST 2B mismatches tab |
| `itc-time-bar` | The last day to claim GST on a purchase is taken as 30 November after the year ends; the other limit (filing the annual return) is not checked. *(s.16(4) CGST Act)* | Q5 | Taxes → GST on purchases; Checks → GST 2B mismatches tab |
| `arn-format` | An acknowledgement number (ARN) is accepted as 10 to 20 letters or digits; the portal’s exact format was not checked. *(GST portal acknowledgement number (ARN))* | Q28 | Taxes → step 5, "I've filed" (acknowledgement number) |
| `einvoice-applicability` | Who must make e-invoices, and from when, comes from the notifications read up to 2023 and your turnover as you typed it. Later changes and the details of the 30-day reporting rule are not confirmed. *(Notification 13/2020-CT and amendments; GSTN advisory of 5 Nov 2024 (30-day window))* | Q17, Q54 | Taxes → "e-invoicing applies to you"; Company details → e-invoicing; e-Invoice / e-way bill list |
| `einvoice-file-rules` | The e-invoice file follows the NIC pages: invoice numbers of 1 to 16 letters, digits, "/" and "-", the rounding allowance, and TCS under other charges. No real IRP has checked it yet. *(e-invoice schema 1.1 (NIC); Circular 76/50/2018-GST (TCS))* | Q13, Q14, Q15 | e-Invoice / e-way bill list |
| `eway-challan-codes` | An e-way bill for a delivery challan uses the "supply on challan" codes as Total reads them (job work, on approval). Not confirmed. *(Rule 55 CGST Rules; e-way bill sub-supply codes (NIC master codes))* | Q16 | e-Invoice / e-way bill list |
| `nic-live` | Total’s live e-invoice link has never run against the real NIC portal. The 24-hour cancel windows and the 8-hour extension window are counted as Total reads the pages. *(NIC e-invoice / e-way bill API (cancel and extend windows))* | Q18 | e-Invoice details (cancel and extend) |
| `tds-deposit-date` | TDS is due by the 7th of the next month (30 April for March). This is the 1962 rule; the 2026 rules were read only in copies. *(Rule 30(2) Income-tax Rules 1962; rule 218 Income-tax Rules 2026)* | Q23 | Taxes → TDS card; Gateway → Compliance card, TDS row; TDS screen header (rates, due dates, returns) |
| `tds-rates-rounding` | TDS is rounded to the nearest rupee (the Act may want ₹10). The base of section 194Q and some sections (194N, senior citizens, years before 2026) are as seeded, not confirmed. *(s.288B / s.516 (rounding); s.194Q; s.194N (Income-tax Act))* | Q6, Q24 | Taxes → TDS card; TDS screen header (rates, due dates, returns) |
| `gst-blocked-credit` | GST you say you can’t claim is moved into the cost by a small entry beside the bill — for expense bills and bills typed as an amount; a bill of products keeps it in your GST accounts for your accountant to move. The return shows it taken and reversed. The exceptions (a car dealer, a restaurant buying food to sell …) are your call. Not confirmed. *(CGST Act s.17(5); Circular 170/02/2022-GST (GSTR-3B 4(A)(5) / 4(B)(1)))* | Q57 | Record a purchase / Money out → "Can you claim this GST back?" (s.17(5)) |
| `tds-threshold-returns` | A purchase return (debit note) does not lower a supplier’s yearly TDS limit here — every bill counts. Not confirmed. *(ss.194C(5), 194J, 194H, 194Q … Income-tax Act 1961; Income-tax Act 2025 s.393 Table — "the aggregate of the amounts credited or paid")* | Q56 | TDS screen header (rates, due dates, returns) |
| `tds-return-layouts` | The 26Q reason codes and the Form 16A layout follow practice, not the current notification. *(Form 26Q, Form 16A (TRACES utility))* | Q25 | TDS screen header (rates, due dates, returns) |
| `tds-late-interest` | Interest on late TDS counts each calendar month or part of one, the first and the last both. Bills of an earlier year are not followed. Not confirmed in the official text. *(s.201(1A) Income-tax Act 1961 (2025 Act s.398(3)(a)))* | Q22 | TDS → late-deduction interest |
| `tcs-rules` | Some TCS rates (tour packages, parking, toll, mining) and whether GST is in the TCS base were read in copies, not the Act. *(s.206C(1C), (1G), (1H) Income-tax Act; Form 27EQ / Form 143)* | Q19, Q20, Q21 | Taxes → TCS card; TCS screen header |
| `payroll-salary-tds` | Salary TDS is rounded to the nearest rupee, and the Form 16 Part B rows follow the 1962 rules. Not confirmed. *(s.192 Income-tax Act; Form 16 Part B (1962 Rules))* | Q7, Q42, Q43 | Payroll screen header (salary TDS, Form 16) |
| `msme-43bh` | Bills of a trader supplier are left out of the s.43B(h) list — a reading of an office memo. Changes by the Finance Act 2026 were not read. *(s.43B(h) and s.37 Income-tax Act; MSMED Act s.15)* | Q35 | Payables → MSME tab |
| `msme-acceptance-coverage` | Whether an MSME bill is covered is judged on the day of supply (the delivery day you record, else the bill date), not on the day an objection was removed — a reading, not checked in the law or a judgment. *(MSMED Act s.2(b) Explanation, s.2(n), s.15 — day of acceptance; registration before the supply)* | Q54 | Payables → MSME tab |
| `msme-form1-udyam` | The MSME Form 1 layout and how a Udyam number is read (state, then district) come from copies, not the official text. *(MSME Form 1 (MSMED Act s.9); Udyam registration number)* | Q36 | Payables → MSME tab |
| `forecast-dates` | The tax due dates in the forecast (GST, TDS) were written from summaries, and a small supplier’s bills move to their s.15 date as Total reads the rule. Check them. *(Statutory due dates in the cash forecast (GST, TDS))* | Q50, Q37, Q54 | Cash forecast screen header |
| `audit-retention` | How long the edit log must be kept, and what it must show, was not re-read in the law’s exact words. *(s.128(5) Companies Act; Income-tax rule 6F; IT Act 2025 s.62 / Rules 2026 r.46(9))* | Q52 | Edit log screen header |
| `fixed-assets` | The fixed-asset register was removed (audit A13b); depreciation / disposal journals in older books stay as ordinary entries, and the s.18(6) extra tax an old GST disposal posted is still read into GSTR-1 / 3B (the cg-* entries record how). | Q1, Q2, Q9, Q10, Q11, Q12, Q44, Q45, Q46, Q47, Q48, Q49 | closed — feature removed |
| `payroll-statutory` | Payroll PF / ESI / PT was removed (audit A13b): pay runs no longer deduct them; runs, dues and payments in older books stay as saved. The compute-only gratuity / bonus helper (Payroll → Salary TDS) posts nothing. | Q7, Q38, Q39, Q40, Q41, Q42 | closed — feature removed |
| `receivables-interest` | Interest on overdue bills was removed (audit A13b); old interest debit notes stay as ordinary entries. | Q31 | closed — feature removed |
| `msme-interest` | MSME interest is indicative and never posted; it closes with the feature (Phase 1 triage §5). | Q34 | closed — feature hidden |
| `forex` | Forex revaluation and settlement were removed in the 1.0 cleanup (PR #195). | Q51 | closed — feature removed |
| `gateway-api` | The GST gateway is sandbox-only in 1.0 (live switch off); its API shapes are proved by a GSP sandbox, not a CA. | — | closed — sandbox only |
| `busy-zoho-headers` | Import header spellings — the owner accepted them (Phase 1 triage §5); the import screen still names them. | — | closed — accepted by the owner |

<!-- ca-check:end -->
