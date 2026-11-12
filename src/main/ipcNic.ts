// IPC channels for live filing through the NIC APIs (e-invoice / e-way bill). Registered from ipc.ts with
// its `handle` (role gate + { ok, data | error } envelope); every payload is Zod-parsed here, every write
// channel is mapped in auditCoverage.ts. Split out of ipc.ts by audit A12 (HEALTH-4) — the handlers were
// moved, not rewritten (scripts/ipc-handlers-diff.mjs compares them with origin/main).
import { shell } from 'electron'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { fitFileName, portableFileName } from '@shared/fileNames'
import { EWB_CANCEL_REMARK_MAX, IRN_CANCEL_REMARK_MAX, NIC_CANCEL_REASONS } from '@shared/gst/nicRecord'
import { z } from 'zod'
import { companyExportsDir } from './paths'
import { isoDate } from '@shared/schemas'
import * as nic from './services/nic'
import { clearLoadedImports } from './ipcDataImport'
import { nicCredentialsSchema } from '@shared/schemas'
import { auditExport, type IpcContext, type IpcHandle } from './ipcCommon'

export function registerNicIpc(handle: IpcHandle, { requireCompany }: IpcContext): void {
  // ---------- live filing (NIC APIs) ----------
  handle('nic:get', () => {
    const c = requireCompany()
    // Secrets come from the encrypted secret store (services/secretStore.ts), not the company DB;
    // a first read also migrates any legacy plaintext copy out of `meta`.
    const creds = nic.readNicCredentials(c.db, c.slug)
    // Never send live secrets back to the UI in full — password AND clientSecret are the two
    // halves of the NIC auth credential pair (username/password + client_id/client_secret),
    // and nic:get is viewer-gated (v0.3 review F3).
    return nic.maskNicCredentials(creds)
  }, 'viewer')
  handle('nic:save', (p) => {
    const c = requireCompany()
    const incoming = nicCredentialsSchema.parse(p)
    // Re-saving the mask sentinel means "keep what's stored" — but only while the addresses and
    // the public key stay the ones the secrets were saved for (audit 2026-11 A5, nic.ts).
    const result = nic.saveNicCredentials(c.db, c.slug, incoming)
    nic.resetNicSession()
  // WP 6.3: a file loaded into the import wizard never carries over to another company.
  clearLoadedImports()
    return result
  }, 'owner')
  handle('nic:status', () => {
    const c = requireCompany()
    const { creds, heldBack } = nic.readNicState(c.db, c.slug)
    return { configured: nic.nicConfigured(c.db, c.slug), secretsHeldBack: heldBack && !creds.password && !creds.clientSecret }
  }, 'viewer')
  // Settings → NIC "Connection test" (WP 3.5): the auth handshake only — files nothing and
  // writes nothing to the books; the outcome (or the mapped NIC error) goes back to the UI.
  handle('nic:testConnection', async () => {
    const c = requireCompany()
    return nic.testNicConnection(c.db, c.slug, c.info)
  }, 'owner')
  handle('nic:generateIrn', async (p) => {
    const { voucherId } = z.object({ voucherId: z.number().int().positive() }).parse(p)
    const c = requireCompany()
    return nic.generateIrn(c.db, c.slug, c.info, voucherId)
  }, 'owner')
  handle('nic:generateEwb', async (p) => {
    const { voucherId } = z.object({ voucherId: z.number().int().positive() }).parse(p)
    const c = requireCompany()
    return nic.generateEwbByIrn(c.db, c.slug, c.info, voucherId)
  }, 'owner')
  // Cancel IRN ([CNL] /eicore/v1.03/Invoice/Cancel): within 24 h of the ack, reasons 1–4, remark ≤ 100.
  handle('nic:cancelIrn', async (p) => {
    const { voucherId, reason, remark } = z.object({
      voucherId: z.number().int().positive(),
      reason: z.enum(NIC_CANCEL_REASONS),
      remark: z.string().trim().min(1).max(IRN_CANCEL_REMARK_MAX)
    }).strict().parse(p)
    const c = requireCompany()
    return nic.cancelIrn(c.db, c.slug, c.info, voucherId, reason, remark)
  }, 'owner')
  // Cancel e-way bill ([CEWB] ewayapi action CANEWB): within 24 h, reasons per [MASTER], remark ≤ 50.
  handle('nic:cancelEwb', async (p) => {
    const { voucherId, reason, remark } = z.object({
      voucherId: z.number().int().positive(),
      reason: z.enum(NIC_CANCEL_REASONS),
      remark: z.string().trim().min(1).max(EWB_CANCEL_REMARK_MAX)
    }).strict().parse(p)
    const c = requireCompany()
    return nic.cancelEwb(c.db, c.slug, c.info, voucherId, reason, remark)
  }, 'owner')
  // Extend e-way bill validity ([EXT] ewayapi action EXTENDVALIDITY): 8 h before / after expiry.
  handle('nic:extendEwb', async (p) => {
    const { voucherId, ...input } = z.object({
      voucherId: z.number().int().positive(),
      // [MASTER] "Reasons for extension of validity" (= EWB_EXTEND_REASONS).
      reasonCode: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(5), z.literal(99)]),
      remarks: z.string().trim().min(1).max(50),
      fromPlace: z.string().trim().min(1).max(50),
      fromStateCode: z.number().int().min(1).max(99),
      fromPincode: z.number().int().min(100000).max(999999),
      remainingDistanceKm: z.number().int().min(1).max(4000),
      transMode: z.enum(['1', '2', '3', '4', '5']), // [MASTER] modes; 5 = in transit (= EWB_EXTEND_MODES)
      vehicleNo: z.string().trim().max(20).optional(),
      transDocNo: z.string().trim().max(15).optional(),
      transDocDate: isoDate.optional(),
      transitType: z.enum(['R', 'W', 'O']).optional(),
      addressLine1: z.string().trim().max(120).optional()
    }).strict().parse(p)
    const c = requireCompany()
    return nic.extendEwb(c.db, c.slug, c.info, voucherId, input)
  }, 'owner')
  // The stored IRP / EWB answers for one voucher (signed invoice + QR, ack, cancel state, e-way
  // history) — read-only, no network.
  handle('nic:record', (p) => {
    const { voucherId } = z.object({ voucherId: z.number().int().positive() }).parse(p)
    return nic.nicRecord(requireCompany().db, voucherId)
  }, 'viewer')
  // "Save JSON": the signed invoice + signed QR as the IRP returned them, to the exports folder.
  handle('nic:signedCopyExport', (p) => {
    const { voucherId } = z.object({ voucherId: z.number().int().positive() }).parse(p)
    const c = requireCompany()
    const rec = nic.nicRecord(c.db, voucherId)
    const json = nic.signedCopyJson(rec)
    const dir = join(companyExportsDir(c.slug), 'einvoice-signed')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, fitFileName(dir, `${portableFileName(rec.number.replace(/[\\/]/g, '-'), { fallback: `voucher-${voucherId}` })}-signed-einvoice.json`))
    writeFileSync(path, JSON.stringify(json, null, 2), 'utf8')
    auditExport(c.db, 'einvoice_signed', { voucherId, path })
    shell.showItemInFolder(path)
    return { path }
  })
}
