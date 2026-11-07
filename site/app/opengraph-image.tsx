import { ImageResponse } from 'next/og'

export const alt = 'Total: accounting for Indian shops and their CAs, on your own computer'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/** The share card for every page (built once at build time). */
export default function OpengraphImage(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: '#fcfcfa',
          color: '#15171c'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 34, fontWeight: 600 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: '#f2b53a' }} />
          Total
        </div>
        <div style={{ display: 'flex', fontSize: 92, fontWeight: 600, letterSpacing: -4, lineHeight: 1, maxWidth: 980 }}>
          Your accounts, on your own computer.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 30, color: '#565c69' }}>
          <div style={{ width: 64, height: 6, borderRadius: 3, background: '#f2b53a' }} />
          Bills, GST returns, stock and bank. Offline. For Indian shops and their CAs.
        </div>
      </div>
    ),
    size
  )
}
