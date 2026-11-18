// Tests read the e-invoice and e-way bill documents the app builds and writes through these.
//
// E-invoice: tests read the documents the app builds (buildEInvoiceJson) or writes (the export
// file) as the IRN schema 1.1 type. The builder returns Record<string, unknown> — its compact()
// drops empty members, so the static shape is loose — and the schema is what says the shape, so
// each document is checked against it here and handed back as the SAME object (a parse would
// strip unknown members and hide them from the test).
import { einvoiceIssues, einvoiceSchema, type EInvoiceDoc } from './einvoiceSchema'
import type { EwbBill, EwbBulkJson } from './edocs'

function isEInvoiceDoc(doc: unknown): doc is EInvoiceDoc {
  return einvoiceSchema.safeParse(doc).success
}

/** The document, typed; throws (failing the test) when it does not pass the schema. */
export function einvoiceDoc(doc: unknown): EInvoiceDoc {
  if (!isEInvoiceDoc(doc)) throw new Error(`not an IRN schema 1.1 document: ${einvoiceIssues(doc).join('; ')}`)
  return doc
}

/** Every document of a builder result or an export file (an array of documents). */
export function einvoiceDocs(json: unknown): EInvoiceDoc[] {
  if (!Array.isArray(json)) throw new Error(`an e-invoice file holds an array of documents, not ${typeof json}`)
  return json.map(einvoiceDoc)
}

/** The one document of a builder result or an export file; throws unless there is exactly one. */
export function singleEinvoiceDoc(json: unknown): EInvoiceDoc {
  const docs = einvoiceDocs(json)
  const [doc] = docs
  if (docs.length !== 1 || !doc) throw new Error(`expected one e-invoice document, got ${docs.length}`)
  return doc
}

/** The one bill of an EWB bulk-tool file; throws unless there is exactly one. */
export function singleEwbBill(json: EwbBulkJson): EwbBill {
  const [bill] = json.billLists
  if (json.billLists.length !== 1 || !bill) throw new Error(`expected one e-way bill, got ${json.billLists.length}`)
  return bill
}
