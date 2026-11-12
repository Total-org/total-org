// Audit A4 (SEC-10): what the updater may hand to the OS.
import { describe, expect, it } from 'vitest'
import { allowedUpdateUrl } from './externalLinks'

describe('allowedUpdateUrl', () => {
  it('opens this repo\'s GitHub releases and the site', () => {
    for (const url of [
      'https://github.com/Total-org/total-org/releases/latest',
      'https://github.com/Total-org/total-org/releases/download/v0.13.0/Total-Setup-0.13.0.exe',
      'https://github.com/total-org/total-org/releases/tag/v0.13.0',
      'https://irminflow.com/api/download?platform=mac',
      'https://www.irminflow.com/download',
      'https://devjindal.tech/api/download'
    ])
      expect(allowedUpdateUrl(url), url).toBe(new URL(url).href)
  })

  it('refuses every other scheme, host, repo or a disguised address', () => {
    for (const url of [
      'search-ms:query=setup&crumb=location:\\\\evil\\share',
      'ms-msdt:/id PCWDiagnostic',
      'smb://evil/share/Total.dmg',
      'file:///Applications/Calculator.app',
      'http://irminflow.com/api/download',
      'https://evil.example/Total.dmg',
      'https://irminflow.com.evil.example/x',
      'https://github.com/evil/total-org/releases/download/v1/x.exe',
      'https://github.com/Total-org/total-org-evil/releases',
      'https://github.com/Total-org/total-org/raw/main/x.exe',
      'https://github.com/Total-org/total-org/releases/../../../evil/repo/releases',
      'https://user:pw@irminflow.com/api/download',
      'https://irminflow.com:8443/api/download',
      'javascript:alert(1)',
      '',
      'not a url'
    ])
      expect(allowedUpdateUrl(url), url).toBeNull()
  })
})
