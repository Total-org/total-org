import { describe, expect, it } from 'vitest'
import { checkNicBaseUrl, nicOriginOf, parseNicBinding, sameNicBinding } from './nicEndpoint'

describe('checkNicBaseUrl (audit A5)', () => {
  it('https anywhere; empty is "not set"', () => {
    expect(checkNicBaseUrl('https://einv-apisandbox.nic.in')).toEqual({ ok: true, origin: 'https://einv-apisandbox.nic.in' })
    expect(checkNicBaseUrl('https://einvoice1.gst.gov.in/path/')).toEqual({ ok: true, origin: 'https://einvoice1.gst.gov.in' })
    expect(checkNicBaseUrl('')).toEqual({ ok: true, origin: '' })
    expect(checkNicBaseUrl('  ')).toEqual({ ok: true, origin: '' })
  })
  it('plain http only on this computer', () => {
    expect(checkNicBaseUrl('http://127.0.0.1:4321')).toEqual({ ok: true, origin: 'http://127.0.0.1:4321' })
    expect(checkNicBaseUrl('http://localhost:8080/x')).toEqual({ ok: true, origin: 'http://localhost:8080' })
    expect(checkNicBaseUrl('http://[::1]:9000')).toEqual({ ok: true, origin: 'http://[::1]:9000' })
    expect(checkNicBaseUrl('http://einv-apisandbox.nic.in')).toMatchObject({ ok: false, code: 'not_https' })
    expect(checkNicBaseUrl('http://127.0.0.1.evil.example')).toMatchObject({ ok: false, code: 'not_https' })
    expect(checkNicBaseUrl('http://192.168.1.4')).toMatchObject({ ok: false, code: 'not_https' })
  })
  it('refuses other schemes, junk and a login inside the address', () => {
    expect(checkNicBaseUrl('ftp://x.nic.in')).toMatchObject({ ok: false, code: 'not_url' })
    expect(checkNicBaseUrl('einv-apisandbox.nic.in')).toMatchObject({ ok: false, code: 'not_url' })
    expect(checkNicBaseUrl('https://user:pw@einv-apisandbox.nic.in')).toMatchObject({ ok: false, code: 'has_login' })
  })
  it('origins: the same host with another path is the same; another port or scheme is not', () => {
    expect(nicOriginOf('https://a.nic.in/x')).toBe(nicOriginOf('https://a.nic.in/y/'))
    expect(nicOriginOf('https://a.nic.in')).not.toBe(nicOriginOf('https://a.nic.in:8443'))
    expect(nicOriginOf('http://a.nic.in')).not.toBe(nicOriginOf('https://a.nic.in'))
    expect(nicOriginOf('http://a.nic.in')).toBe('invalid:http://a.nic.in')
  })
  it('bindings compare every part and parse defensively', () => {
    const b = { einvoice: 'https://a', ewb: '', pem: 'f' }
    expect(sameNicBinding(b, { ...b })).toBe(true)
    expect(sameNicBinding(b, { ...b, pem: 'g' })).toBe(false)
    expect(sameNicBinding(b, { ...b, ewb: 'https://b' })).toBe(false)
    expect(parseNicBinding(JSON.stringify(b))).toEqual(b)
    expect(parseNicBinding(null)).toBeNull()
    expect(parseNicBinding('{')).toBeNull()
    expect(parseNicBinding('{"einvoice":1}')).toBeNull()
  })
})
