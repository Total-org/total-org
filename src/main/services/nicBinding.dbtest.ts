// Audit 2026-11 A5 (SEC-4): the NIC password and client secret go only to the portal address and
// public key they were saved for; addresses are https (http only on this computer); no redirect is
// followed. The GST gateway's password stays with the provider it was typed for.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import http from 'http'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { seededDb } from '../db/testdb'
import type { DB } from '../db/connection'
import { createSecretStore, insecureTestCipher, companyScope, SecretsUnavailableError, type SecretStore } from './secrets'
import {
  authenticate, readNicCredentials, readNicState, resetNicSession, saveNicCredentials, testNicConnection, writeNicCredentials,
  NIC_SECRET_MASK, type NicFetch
} from './nic'
import { nicCredentialsSchema, type NicCredentials } from '@shared/schemas'
import { NIC_SECRETS_HELD_BACK } from '@shared/nicEndpoint'
import { gatewayStatus, openGateway, resetGatewaySessions, setGatewaySettings } from '../gstGateway'
import { TEST_GSP_PASSWORD } from '../gstGateway/testGsp'
import type { CompanyInfo } from '@shared/domain'

const PEM = '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----'
const CREDS = nicCredentialsSchema.parse({
  baseUrlEinvoice: 'https://einv-apisandbox.nic.in',
  username: 'demo_user',
  password: 'secret123',
  clientId: 'CID',
  clientSecret: 'CSEC',
  publicKeyPem: PEM
})
const MASKED: NicCredentials = { ...CREDS, password: NIC_SECRET_MASK, clientSecret: NIC_SECRET_MASK }
const SLUG = 'acme'
const REAL_PEM = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString()
const COMPANY = { gstin: '27AAPFU0939F1ZV' } as CompanyInfo

let dir: string
let prevDataDir: string | undefined
let store: SecretStore
let db: DB

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'total-nicbind-'))
  prevDataDir = process.env.TOTAL_DATA_DIR
  process.env.TOTAL_DATA_DIR = dir
})
afterAll(() => {
  if (prevDataDir === undefined) delete process.env.TOTAL_DATA_DIR
  else process.env.TOTAL_DATA_DIR = prevDataDir
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  const file = join(dir, `secrets-${Math.random().toString(36).slice(2)}.json`)
  store = createSecretStore({ filePath: () => file, cipher: insecureTestCipher() })
  db = seededDb()
  resetNicSession()
  resetGatewaySessions()
})

const secrets = (): [string, string] => {
  const c = readNicCredentials(db, SLUG, store)
  return [c.password, c.clientSecret]
}
const editMetaOutsideTotal = (patch: Record<string, unknown>): void => {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'nic'").get() as { value: string }
  db.prepare("UPDATE meta SET value = ? WHERE key = 'nic'").run(JSON.stringify({ ...JSON.parse(row.value), ...patch }))
}
const recordingFetch = (): { fetchFn: NicFetch; calls: string[] } => {
  const calls: string[] = []
  return { calls, fetchFn: async (url) => { calls.push(url); return { status: 200, json: async () => ({ Status: '0', ErrorDetails: [{ ErrorCode: '1019', ErrorMessage: 'x' }] }) } } }
}

describe('NIC secrets follow the address they were saved for', () => {
  it('a masked re-save on the same origin keeps them (another path on that host too)', () => {
    saveNicCredentials(db, SLUG, CREDS, store)
    expect(saveNicCredentials(db, SLUG, MASKED, store)).toEqual({ configured: true, secretsDropped: false })
    expect(secrets()).toEqual(['secret123', 'CSEC'])
    expect(saveNicCredentials(db, SLUG, { ...MASKED, baseUrlEinvoice: 'https://einv-apisandbox.nic.in/' }, store).secretsDropped).toBe(false)
    expect(secrets()).toEqual(['secret123', 'CSEC'])
  })

  it('another e-invoice origin with the mask: both secrets dropped, the company no longer configured', () => {
    saveNicCredentials(db, SLUG, CREDS, store)
    const r = saveNicCredentials(db, SLUG, { ...MASKED, baseUrlEinvoice: 'https://attacker.example' }, store)
    expect(r).toEqual({ configured: false, secretsDropped: true })
    expect(secrets()).toEqual(['', ''])
    expect(store.get(companyScope(SLUG), 'nic.password')).toBeNull()
    expect(store.get(companyScope(SLUG), 'nic.clientSecret')).toBeNull()
  })

  it('another e-way bill origin or another public key with the mask: dropped too', () => {
    saveNicCredentials(db, SLUG, CREDS, store)
    expect(saveNicCredentials(db, SLUG, { ...MASKED, baseUrlEwb: 'https://ewb.example' }, store).secretsDropped).toBe(true)
    saveNicCredentials(db, SLUG, CREDS, store)
    expect(saveNicCredentials(db, SLUG, { ...MASKED, publicKeyPem: '-----BEGIN PUBLIC KEY-----\nATTACKER\n-----END PUBLIC KEY-----' }, store).secretsDropped).toBe(true)
    expect(secrets()).toEqual(['', ''])
  })

  it('the same key with other line breaks is the same key', () => {
    saveNicCredentials(db, SLUG, CREDS, store)
    expect(saveNicCredentials(db, SLUG, { ...MASKED, publicKeyPem: PEM.replace(/\n/g, '\r\n') + '\n' }, store).secretsDropped).toBe(false)
    expect(secrets()).toEqual(['secret123', 'CSEC'])
  })

  it('a new address with the secrets typed again keeps the new ones, bound to the new address', () => {
    saveNicCredentials(db, SLUG, CREDS, store)
    const next = { ...CREDS, baseUrlEinvoice: 'https://einvoice1.gst.gov.in', password: 'new-pw', clientSecret: 'new-cs' }
    expect(saveNicCredentials(db, SLUG, next, store)).toEqual({ configured: true, secretsDropped: false })
    expect(secrets()).toEqual(['new-pw', 'new-cs'])
    // Moving back to the sandbox without retyping drops them (they now belong to einvoice1).
    expect(saveNicCredentials(db, SLUG, { ...next, baseUrlEinvoice: CREDS.baseUrlEinvoice, password: NIC_SECRET_MASK, clientSecret: NIC_SECRET_MASK }, store).secretsDropped).toBe(true)
  })

  it('only one secret masked: the typed one is kept, the masked one dropped', () => {
    saveNicCredentials(db, SLUG, CREDS, store)
    const r = saveNicCredentials(db, SLUG, { ...CREDS, baseUrlEinvoice: 'https://other.example', clientSecret: NIC_SECRET_MASK, password: 'typed' }, store)
    expect(r.secretsDropped).toBe(true)
    expect(secrets()).toEqual(['typed', ''])
  })
})

describe('secure storage unavailable (review of #225)', () => {
  it('a masked save is refused before anything is written; the secrets survive', () => {
    let up = true
    const base = insecureTestCipher()
    const file = join(dir, `secrets-off-${Math.random().toString(36).slice(2)}.json`)
    const flaky = createSecretStore({ filePath: () => file, cipher: { ...base, isAvailable: () => up && base.isAvailable() } })
    saveNicCredentials(db, SLUG, CREDS, flaky)
    up = false
    expect(() => saveNicCredentials(db, SLUG, { ...MASKED, username: 'u2' }, flaky)).toThrow(SecretsUnavailableError)
    up = true
    const after = readNicCredentials(db, SLUG, flaky)
    expect([after.username, after.password, after.clientSecret]).toEqual(['demo_user', 'secret123', 'CSEC'])
  })
})

describe('NIC addresses must be https', () => {
  it('plain http to another computer is refused with the field, nothing written', () => {
    saveNicCredentials(db, SLUG, CREDS, store)
    let err: unknown
    try {
      saveNicCredentials(db, SLUG, { ...CREDS, baseUrlEinvoice: 'http://einv-apisandbox.nic.in' }, store)
    } catch (e) {
      err = e
    }
    expect(err).toMatchObject({ code: 'nic_url_not_https', field: 'baseUrlEinvoice' })
    expect(readNicCredentials(db, SLUG, store).baseUrlEinvoice).toBe(CREDS.baseUrlEinvoice)
    expect(() => saveNicCredentials(db, SLUG, { ...CREDS, baseUrlEwb: 'http://ewb.example' }, store)).toThrow(/must start with https/)
    expect(() => saveNicCredentials(db, SLUG, { ...CREDS, baseUrlEinvoice: 'https://u:p@x.example' }, store)).toThrow(/user name and password out/)
  })

  it('http on this computer (the fake sandbox) is allowed', () => {
    expect(saveNicCredentials(db, SLUG, { ...CREDS, baseUrlEinvoice: 'http://127.0.0.1:4555' }, store).configured).toBe(true)
  })

  it('a stored http address (edited outside Total) is never contacted', async () => {
    const { fetchFn, calls } = recordingFetch()
    await expect(authenticate({ ...CREDS, publicKeyPem: REAL_PEM, baseUrlEinvoice: 'http://einv-apisandbox.nic.in' }, COMPANY.gstin!, fetchFn, { sleep: async () => {} })).rejects.toThrow(/must start with https/)
    expect(calls).toEqual([])
  })
})

describe('an address changed outside Total holds the secrets back', () => {
  it('meta edited in the company file: the secrets are not read, not sent, and the status says so', async () => {
    saveNicCredentials(db, SLUG, CREDS, store)
    editMetaOutsideTotal({ baseUrlEinvoice: 'https://attacker.example' })
    const state = readNicState(db, SLUG, store)
    expect(state.heldBack).toBe(true)
    expect([state.creds.password, state.creds.clientSecret]).toEqual(['', ''])
    const { fetchFn, calls } = recordingFetch()
    await expect(testNicConnection(db, SLUG, COMPANY, { store, fetchFn, sleep: async () => {} })).rejects.toThrow(NIC_SECRETS_HELD_BACK)
    expect(calls).toEqual([])
    // Still in the store (the owner may set the address back) — just never handed out.
    expect(store.get(companyScope(SLUG), 'nic.password')).toBe('secret123')
    editMetaOutsideTotal({ baseUrlEinvoice: CREDS.baseUrlEinvoice })
    expect(readNicState(db, SLUG, store)).toMatchObject({ heldBack: false, creds: { password: 'secret123' } })
  })

  it('a public key swapped in the file holds them back too', () => {
    saveNicCredentials(db, SLUG, CREDS, store)
    editMetaOutsideTotal({ publicKeyPem: '-----BEGIN PUBLIC KEY-----\nATTACKER\n-----END PUBLIC KEY-----' })
    expect(readNicState(db, SLUG, store).heldBack).toBe(true)
  })

  it('secrets saved before the binding existed are bound to where they point on first read', () => {
    // As the old writeNicCredentials left them: secrets in the store, no binding row.
    writeNicCredentials(db, SLUG, CREDS, store)
    store.delete(companyScope(SLUG), 'nic.boundTo')
    expect(readNicState(db, SLUG, store)).toMatchObject({ heldBack: false, creds: { password: 'secret123', clientSecret: 'CSEC' } })
    expect(JSON.parse(store.get(companyScope(SLUG), 'nic.boundTo')!)).toMatchObject({ einvoice: 'https://einv-apisandbox.nic.in', ewb: '' })
    editMetaOutsideTotal({ baseUrlEinvoice: 'https://attacker.example' })
    expect(readNicState(db, SLUG, store).heldBack).toBe(true)
  })

  it('clearing both secrets removes the binding', () => {
    saveNicCredentials(db, SLUG, CREDS, store)
    saveNicCredentials(db, SLUG, { ...CREDS, password: '', clientSecret: '' }, store)
    expect(store.get(companyScope(SLUG), 'nic.boundTo')).toBeNull()
  })
})

describe('NIC requests never follow a redirect', () => {
  it('a 307 to another server is an error; the other server never sees the secret header', async () => {
    const seenByOther: string[] = []
    const other = http.createServer((req, res) => {
      seenByOther.push(String(req.headers.client_secret ?? ''))
      res.end('{}')
    })
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r))
    const otherUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}`
    let redirects = 0
    const first = http.createServer((req, res) => {
      redirects++
      res.writeHead(307, { Location: `${otherUrl}${req.url}` })
      res.end()
    })
    await new Promise<void>((r) => first.listen(0, '127.0.0.1', r))
    const firstUrl = `http://127.0.0.1:${(first.address() as AddressInfo).port}`
    try {
      const creds = { ...CREDS, baseUrlEinvoice: firstUrl, publicKeyPem: REAL_PEM }
      await expect(authenticate(creds, COMPANY.gstin!, undefined, { sleep: async () => {} })).rejects.toThrow(/Could not reach the NIC portal/)
      expect(redirects).toBeGreaterThan(0)
      expect(seenByOther).toEqual([])
    } finally {
      first.close()
      other.close()
    }
  })
})

describe('the GST gateway password stays with its provider', () => {
  it('a password is bound to the provider it was typed for; another provider never gets it', () => {
    setGatewaySettings(db, SLUG, { provider: 'test-gsp', live: false, username: 'testgsp', password: TEST_GSP_PASSWORD }, store)
    expect(store.get(companyScope(SLUG), 'gstGateway.boundTo')).toBe('test-gsp')
    expect(gatewayStatus(db, SLUG, store).passwordStored).toBe(true)
    // The binding names another provider (as a future build's adapter would): not handed out.
    store.set(companyScope(SLUG), 'gstGateway.boundTo', 'nic-direct')
    expect(gatewayStatus(db, SLUG, store).passwordStored).toBe(false)
  })
  it('a password saved before the binding existed was the Test GSP\'s — and only the Test GSP\'s', () => {
    store.set(companyScope(SLUG), 'gstGateway.password', TEST_GSP_PASSWORD)
    expect(gatewayStatus(db, SLUG, store).passwordStored).toBe(true)
    // A future adapter named in the company file never receives it.
    expect(openGateway(db, SLUG, COMPANY, { store, adapter: { id: 'nic-direct', test: false } as never }).who.password).toBe('')
    expect(openGateway(db, SLUG, COMPANY, { store }).who.password).toBe(TEST_GSP_PASSWORD)
  })
  it('forgetting the password removes the binding', () => {
    setGatewaySettings(db, SLUG, { provider: 'test-gsp', live: false, username: 'testgsp', password: TEST_GSP_PASSWORD }, store)
    setGatewaySettings(db, SLUG, { provider: 'test-gsp', live: false, username: 'testgsp', password: '' }, store)
    expect(store.get(companyScope(SLUG), 'gstGateway.boundTo')).toBeNull()
  })
})
