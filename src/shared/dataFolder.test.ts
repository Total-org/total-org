import { describe, expect, it } from 'vitest'
import { shownFolder } from './dataFolder'

describe('A9 (audit UX-22): shownFolder — the data folder in plain words', () => {
  it('a Mac / Linux folder under home is shown from ~', () => {
    expect(shownFolder('/Users/asha/Documents/total', '/Users/asha', 'darwin')).toBe('~/Documents/total')
    expect(shownFolder('/Users/asha/Documents/total/', '/Users/asha/', 'darwin')).toBe('~/Documents/total')
    expect(shownFolder('/home/asha/books', '/home/asha', 'linux')).toBe('~/books')
  })
  it('a folder outside home (a moved folder, an external disk, TOTAL_DATA_DIR) is the full path', () => {
    expect(shownFolder('/Volumes/Backup/total', '/Users/asha', 'darwin')).toBe('/Volumes/Backup/total')
    expect(shownFolder('/tmp/scratch-data', '/Users/asha', 'darwin')).toBe('/tmp/scratch-data')
  })
  it('a name that only starts like home is not under it', () => {
    expect(shownFolder('/Users/ashaX/total', '/Users/asha', 'darwin')).toBe('/Users/ashaX/total')
  })
  it('Windows: under the profile it is shown from there (any case, either slash); elsewhere the full path', () => {
    expect(shownFolder('C:\\Users\\Asha\\Documents\\total', 'C:\\Users\\Asha', 'win32')).toBe('Documents\\total')
    expect(shownFolder('c:\\users\\asha\\OneDrive\\Documents\\total', 'C:\\Users\\Asha', 'win32')).toBe('OneDrive\\Documents\\total')
    expect(shownFolder('D:\\Books\\total', 'C:\\Users\\Asha', 'win32')).toBe('D:\\Books\\total')
  })
  it('home itself, or no home known', () => {
    expect(shownFolder('/Users/asha', '/Users/asha', 'darwin')).toBe('~')
    expect(shownFolder('/Users/asha/total', '', 'darwin')).toBe('/Users/asha/total')
  })
})
