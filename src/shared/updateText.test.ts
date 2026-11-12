// WP 7.3 — the updater's words and links on macOS vs Windows.
import { describe, expect, it } from 'vitest'
import { dataFolderLabel, updateCheckDisabled } from './updateText'

describe('updateText', () => {
  it('names the data folder the way each platform writes it', () => {
    expect(dataFolderLabel('darwin')).toBe('~/Documents/total')
    expect(dataFolderLabel('win32')).toBe('Documents\\total')
  })
  it('scripted runs turn the startup check off', () => {
    expect(updateCheckDisabled({ TOTAL_NO_UPDATE_CHECK: '1' })).toBe(true)
    expect(updateCheckDisabled({})).toBe(false)
  })
})
