import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkHsn, cleanHsn, createHsnIndex, EIGHT_DIGIT_HSN_N90_2020, hsnDescription, hsnParent, lookupHsn, searchHsn } from './hsn'
import type { HsnMasterData } from './hsnMaster/normalise'

const small = createHsnIndex({
  goods: [
    ['10', 'CEREALS'],
    ['1006', 'RICE'],
    ['100610', 'Rice in the husk (paddy or rough)'],
    ['10061010', 'Of seed quality'],
    ['100640', 'Broken rice'],
    ['8471', 'AUTOMATIC DATA PROCESSING MACHINES'],
    ['84713010', 'Personal computer'],
    ['1006', 'duplicate row of a code (first wins)']
  ],
  services: [
    ['99', 'All Services'],
    ['9983', 'Other professional, technical and business services'],
    ['998311', 'Management consulting and management services'],
    ['998312', 'Business consulting services']
  ]
})
const codes = (q: string, n?: number): string[] => searchHsn(small, q, n).map((e) => e.code)

describe('HSN search', () => {
  it('digits match codes by prefix, headings first', () => {
    expect(codes('1006')).toEqual(['1006', '100610', '100640', '10061010'])
    expect(codes('10 06 4')).toEqual(['100640'])
    expect(codes('998')).toEqual(['9983', '998311', '998312'])
  })
  it('chapters and odd lengths are never offered', () => {
    expect(codes('10')).not.toContain('10')
    expect(codes('99')).not.toContain('99')
  })
  it('words match the start of description words, any order, case-insensitive', () => {
    expect(codes('rice')).toEqual(['1006', '100610', '100640'])
    expect(codes('BROK RI')).toEqual(['100640'])
    expect(codes('consulting business')).toEqual(['998312'])
    expect(codes('computer')).toEqual(['84713010'])
    expect(codes('nothing like it')).toEqual([])
  })
  it('whole-word matches rank before prefix matches', () => {
    expect(codes('management')[0]).toBe('998311')
    const s = createHsnIndex({ goods: [['1111', 'Paddy rice'], ['2222', 'Rices of all kinds']], services: [] })
    expect(searchHsn(s, 'rice').map((e) => e.code)).toEqual(['1111', '2222'])
  })
  it('digits and words together narrow both ways', () => {
    expect(codes('1006 broken')).toEqual(['100640'])
    expect(codes('8471 rice')).toEqual([])
  })
  it('respects the limit; blank finds nothing', () => {
    expect(codes('1006', 2)).toEqual(['1006', '100610'])
    expect(codes('  ')).toEqual([])
  })
  it('a code listed twice keeps its first row', () => {
    expect(lookupHsn(small, '1006')?.description).toBe('RICE')
    expect(codes('duplicate')).toEqual([])
  })
})

describe('HSN lookup and checks', () => {
  it('cleans spaces and dots, refuses anything else', () => {
    expect(cleanHsn(' 1006 10 ')).toBe('100610')
    expect(cleanHsn('8471.30')).toBe('847130')
    expect(cleanHsn('rice')).toBeNull()
  })
  it('lookup and nearest parent', () => {
    expect(lookupHsn(small, '100610')?.kind).toBe('goods')
    expect(lookupHsn(small, '998311')?.kind).toBe('services')
    expect(lookupHsn(small, '10069999')).toBeNull()
    expect(hsnParent(small, '10069999')?.code).toBe('1006')
  })
  it('structure: digits only; 4, 6 or 8 of them (the old validateHsn rule)', () => {
    expect(checkHsn('rice').problem).toBe('digits')
    expect(checkHsn('10').problem).toBe('length')
    expect(checkHsn('10061').problem).toBe('length')
    expect(checkHsn('100610').problem).toBeNull()
  })
  it('notes never block: not in the list, 4 digits, Notification 90/2020 chemicals', () => {
    expect(checkHsn('100610', small)).toMatchObject({ problem: null, notes: [], entry: { code: '100610' } })
    expect(checkHsn('10069999', small).notes).toEqual(['not_in_list'])
    expect(checkHsn('1006', small).notes).toEqual(['four_digits'])
    // Without the list there is no list note.
    expect(checkHsn('10069999').notes).toEqual([])
    // 2931 starts several codes of the Notification 90/2020 Table (e.g. 29313200).
    expect(checkHsn('2931').notes).toEqual(['four_digits', 'eight_digits'])
    expect(checkHsn('293132').notes).toEqual(['eight_digits'])
    expect(checkHsn('29313200').notes).toEqual([])
  })
  it('Notification 90/2020 table: 49 rows, two "As applicable", 39 distinct 8-digit codes', () => {
    expect(EIGHT_DIGIT_HSN_N90_2020).toHaveLength(39)
    expect(new Set(EIGHT_DIGIT_HSN_N90_2020).size).toBe(39)
    for (const c of EIGHT_DIGIT_HSN_N90_2020) expect(c).toMatch(/^\d{8}$/)
  })
  it('descriptions show the heading join as an arrow', () => {
    expect(hsnDescription({ code: '230700', kind: 'goods', description: 'RESIDUES~Wine lees; argol' })).toBe('RESIDUES › Wine lees; argol')
  })
})

describe('on the portal list', () => {
  const data = JSON.parse(readFileSync(join(__dirname, 'hsnMaster', 'hsnSac.json'), 'utf8')) as HsnMasterData
  const index = createHsnIndex(data)
  it('finds rice, laptops and consultancy (hand-checked in the workbook)', () => {
    expect(searchHsn(index, '1006')[0]?.code).toBe('1006')
    expect(searchHsn(index, 'rice', 50).map((e) => e.code)).toContain('1006')
    expect(lookupHsn(index, '9954')?.description).toBe('Construction services')
    expect(lookupHsn(index, '0101')?.description).toBe('LIVE HORSES, ASSES, MULES AND HINNIES.')
  })
  it('a search over the whole list is quick', () => {
    const t0 = performance.now()
    for (const q of ['rice', 'cotton yarn', '84', 'services', 'steel tube']) searchHsn(index, q)
    expect(performance.now() - t0).toBeLessThan(500)
  })
})
