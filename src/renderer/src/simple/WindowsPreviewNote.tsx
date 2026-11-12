import { isWindows } from '../lib/platform'
import { useT } from '../lib/i18n'

/** Phase 6: Windows is a preview — said where a simple-mode Windows user looks after their books
 *  (Settings → Backups). Nothing on a Mac. */
export function WindowsPreviewNote({ windows = isWindows }: { windows?: boolean }): React.JSX.Element | null {
  const t = useT()
  if (!windows) return null
  return (
    <p className="mt-1 text-small text-muted" data-testid="simple-windows-preview">
      {t('simple.backups.windowsPreview')}
    </p>
  )
}
