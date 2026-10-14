import { describe, expect, it } from 'vitest'
import { signCallbackUrl, verifyCallback } from '../src/callback.js'

const secret = 'test-secret'
const verify = (url: string, key = secret) => verifyCallback(new Request(url, { method: 'POST' }), key)

describe('callbacks', () => {
  it('verifies a signed URL and keeps existing query params', () => {
    const url = signCallbackUrl('https://app.test/cb?tenant=a', 'attempt-1', secret)
    expect(new URL(url).searchParams.get('tenant')).toBe('a')
    expect(verify(url)).toBe('attempt-1')
  })

  it('rejects a tampered id', () => {
    const url = new URL(signCallbackUrl('https://app.test/cb', 'attempt-1', secret))
    url.searchParams.set('id', 'attempt-2')
    expect(verify(url.toString())).toBeNull()
  })

  it('rejects a tampered, non-hex or missing signature', () => {
    const url = new URL(signCallbackUrl('https://app.test/cb', 'attempt-1', secret))
    for (const sig of ['00'.repeat(32), 'zz', '']) {
      url.searchParams.set('sig', sig)
      expect(verify(url.toString())).toBeNull()
    }
    expect(verify('https://app.test/cb?id=attempt-1')).toBeNull()
    expect(verify('https://app.test/cb')).toBeNull()
  })

  it('rejects a signature made with another secret', () => {
    expect(verify(signCallbackUrl('https://app.test/cb', 'attempt-1', 'other'))).toBeNull()
  })

  it('refuses an empty secret', () => {
    expect(() => signCallbackUrl('https://app.test/cb', 'attempt-1', '')).toThrow(TypeError)
    expect(() => verify('https://app.test/cb?id=a&sig=00', '')).toThrow(TypeError)
  })
})
