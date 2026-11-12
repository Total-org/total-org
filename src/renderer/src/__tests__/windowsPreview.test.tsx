// Phase 6: Windows is labelled a preview — the simple Backups note shows on Windows only, in the
// reader's language.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { t } from '@shared/i18n'
import { WindowsPreviewNote } from '../simple/WindowsPreviewNote'

afterEach(cleanup)

describe('the Windows preview note', () => {
  it('says Windows is a preview on Windows', () => {
    render(<WindowsPreviewNote windows />)
    expect(screen.getByTestId('simple-windows-preview').textContent).toBe(t('simple.backups.windowsPreview', undefined, 'en'))
    expect(screen.getByTestId('simple-windows-preview').textContent).toMatch(/preview/)
  })
  it('shows nothing on a Mac', () => {
    render(<WindowsPreviewNote windows={false} />)
    expect(screen.queryByTestId('simple-windows-preview')).toBeNull()
  })
})
