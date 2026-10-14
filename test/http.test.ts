import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorized, completed, type HttpResult, send, tokenCache } from '../src/http.js'
import { MobileMoneyError } from '../src/types.js'
import { mockFetch } from './fetch.js'

const token = (expires_in: number | string = 3600): HttpResult => ({
  status: 200,
  body: { access_token: 'tok', expires_in },
})

describe('send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses JSON, refuses redirects and sets a timeout signal', async () => {
    const { calls } = mockFetch({ 'x.test': { status: 200, body: { a: 1 } } })
    await expect(send('https://x.test/a')).resolves.toEqual({ status: 200, body: { a: 1 } })
    expect(calls[0]?.init.redirect).toBe('error')
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('turns a non-JSON body into null', async () => {
    mockFetch({ 'x.test': { status: 502, raw: '<html>Bad gateway</html>' } })
    await expect(send('https://x.test/a')).resolves.toEqual({ status: 502, body: null })
  })
})

describe('tokenCache', () => {
  it('shares one fetch across concurrent callers and caches the token', async () => {
    const fetchToken = vi.fn(async () => token())
    const tokens = tokenCache(fetchToken)
    await expect(Promise.all([tokens.get(), tokens.get()])).resolves.toEqual(['tok', 'tok'])
    await tokens.get()
    expect(fetchToken).toHaveBeenCalledTimes(1)
  })

  it('accepts expires_in as a string', async () => {
    const fetchToken = vi.fn(async () => token('3600'))
    const tokens = tokenCache(fetchToken)
    await tokens.get()
    await tokens.get()
    expect(fetchToken).toHaveBeenCalledTimes(1)
  })

  it('refetches every time when expires_in is under 60 s', async () => {
    const fetchToken = vi.fn(async () => token(30))
    const tokens = tokenCache(fetchToken)
    await tokens.get()
    await tokens.get()
    expect(fetchToken).toHaveBeenCalledTimes(2)
  })

  it('refetches after clear()', async () => {
    const fetchToken = vi.fn(async () => token())
    const tokens = tokenCache(fetchToken)
    await tokens.get()
    tokens.clear()
    await tokens.get()
    expect(fetchToken).toHaveBeenCalledTimes(2)
  })

  it('throws rejected TOKEN_FAILED on a bad response or network error', async () => {
    const failures: Array<() => Promise<HttpResult>> = [
      async () => ({ status: 401, body: null }),
      async () => ({ status: 200, body: { expires_in: 3600 } }),
      async () => {
        throw new TypeError('fetch failed')
      },
    ]
    for (const fetchToken of failures) {
      await expect(tokenCache(fetchToken).get()).rejects.toMatchObject({ kind: 'rejected', code: 'TOKEN_FAILED' })
    }
  })

  it('recovers after a failed fetch', async () => {
    const fetchToken = vi
      .fn<() => Promise<HttpResult>>()
      .mockResolvedValueOnce({ status: 500, body: null })
      .mockResolvedValue(token())
    const tokens = tokenCache(fetchToken)
    await expect(tokens.get()).rejects.toBeInstanceOf(MobileMoneyError)
    await expect(tokens.get()).resolves.toBe('tok')
  })
})

describe('authorized', () => {
  it('clears the token and retries once on 401', async () => {
    let n = 0
    const tokens = tokenCache(async () => ({ status: 200, body: { access_token: `tok${++n}`, expires_in: 3600 } }))
    const call = vi.fn(async (t: string) => ({ status: t === 'tok1' ? 401 : 200, body: null }))
    await expect(authorized(tokens, call)).resolves.toEqual({ status: 200, body: null })
    expect(call.mock.calls.map((c) => c[0])).toEqual(['tok1', 'tok2'])
  })

  it('returns a second 401 instead of looping', async () => {
    const tokens = tokenCache(async () => token())
    const call = vi.fn(async () => ({ status: 401, body: null }))
    await expect(authorized(tokens, call)).resolves.toEqual({ status: 401, body: null })
    expect(call).toHaveBeenCalledTimes(2)
  })
})

describe('completed', () => {
  it('accepts a positive integer amount in the expected currency', () => {
    expect(completed('10', 'XAF', 'XAF')).toEqual({ status: 'completed', amount: 10, currency: 'XAF' })
    expect(completed(10, 'XAF', 'XAF')).toEqual({ status: 'completed', amount: 10, currency: 'XAF' })
  })

  it.each([
    ['10.5', 'XAF'],
    ['0', 'XAF'],
    ['', 'XAF'],
    [undefined, 'XAF'],
    ['10', 'EUR'],
  ])('rejects amount %s in %s', (amount, currency) => {
    expect(() => completed(amount, currency, 'XAF')).toThrow(MobileMoneyError)
  })
})
