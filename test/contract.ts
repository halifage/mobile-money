import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CollectRequest, type FailureReason, MobileMoneyError, type MobileMoneyProvider } from '../src/types.js'
import { type Call, mockFetch, type Reply } from './fetch.js'

export type ContractFixtures = {
  make: () => MobileMoneyProvider
  request: CollectRequest
  currency: string
  /** mockFetch route keys: the call that hands the payment to the provider, and the status lookup */
  paths: { send: string; status: string }
  /** routes, besides the token, that make collect succeed */
  accepted: Record<string, Reply>
  expectedRef: string
  status: { completed: Reply; failed: Reply; failedReason: FailureReason; pending: Reply; unknown: Reply }
}

export const TOKEN: Reply = { status: 200, body: { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 } }

export async function caught(promise: Promise<unknown>): Promise<MobileMoneyError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(MobileMoneyError)
  return error as MobileMoneyError
}

const tokenCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/token')).length

export function describeProviderContract(name: string, f: ContractFixtures) {
  describe(`${name} contract`, () => {
    afterEach(() => vi.unstubAllGlobals())
    const ref = f.expectedRef

    it('collect returns the ref', async () => {
      mockFetch({ '/token': TOKEN, ...f.accepted })
      await expect(f.make().collect(f.request)).resolves.toEqual({ ref })
    })

    it('4xx on send → rejected', async () => {
      mockFetch({ '/token': TOKEN, ...f.accepted, [f.paths.send]: { status: 400, body: { message: 'bad' } } })
      expect((await caught(f.make().collect(f.request))).kind).toBe('rejected')
    })

    it('network error on send → uncertain with ref', async () => {
      mockFetch({ '/token': TOKEN, ...f.accepted, [f.paths.send]: new TypeError('fetch failed') })
      expect(await caught(f.make().collect(f.request))).toMatchObject({ kind: 'uncertain', ref })
    })

    it('5xx on send → uncertain with ref', async () => {
      mockFetch({ '/token': TOKEN, ...f.accepted, [f.paths.send]: { status: 503 } })
      expect(await caught(f.make().collect(f.request))).toMatchObject({ kind: 'uncertain', ref })
    })

    it('token failure → rejected and nothing sent', async () => {
      const { calls } = mockFetch({ '/token': { status: 500 }, ...f.accepted })
      expect(await caught(f.make().collect(f.request))).toMatchObject({ kind: 'rejected', code: 'TOKEN_FAILED' })
      expect(calls.some((c) => c.url.includes(f.paths.send))).toBe(false)
    })

    it('invalid amount → rejected before any network call', async () => {
      const { calls } = mockFetch({})
      for (const amount of [0, -5, 10.5, Number.NaN]) {
        const error = await caught(f.make().collect({ ...f.request, amount }))
        expect(error).toMatchObject({ kind: 'rejected', code: 'invalid_input' })
      }
      expect(calls).toHaveLength(0)
    })

    it('unsupported operator → rejected before any network call', async () => {
      const { calls } = mockFetch({})
      const operator = f.request.operator === 'mtn' ? 'orange' : 'mtn'
      const error = await caught(f.make().collect({ ...f.request, operator }))
      expect(error).toMatchObject({ kind: 'rejected', code: 'invalid_input' })
      expect(calls).toHaveLength(0)
    })

    it('maps completed', async () => {
      mockFetch({ '/token': TOKEN, [f.paths.status]: f.status.completed })
      await expect(f.make().status(ref)).resolves.toEqual({
        status: 'completed',
        amount: f.request.amount,
        currency: f.currency,
      })
    })

    it('maps failed', async () => {
      mockFetch({ '/token': TOKEN, [f.paths.status]: f.status.failed })
      await expect(f.make().status(ref)).resolves.toMatchObject({ status: 'failed', reason: f.status.failedReason })
    })

    it('maps pending, and unknown statuses to pending', async () => {
      mockFetch({ '/token': TOKEN, [f.paths.status]: [f.status.pending, f.status.unknown] })
      const provider = f.make()
      await expect(provider.status(ref)).resolves.toEqual({ status: 'pending' })
      await expect(provider.status(ref)).resolves.toEqual({ status: 'pending' })
    })

    it('status 5xx, network error or non-JSON body → unavailable', async () => {
      const replies: Reply[] = [
        { status: 500 },
        new TypeError('fetch failed'),
        { status: 200, raw: '<html>oops</html>' },
      ]
      for (const reply of replies) {
        mockFetch({ '/token': TOKEN, [f.paths.status]: reply })
        expect((await caught(f.make().status(ref))).kind).toBe('unavailable')
      }
    })

    it('401 → refreshes the token and retries once', async () => {
      const { calls } = mockFetch({ '/token': TOKEN, [f.paths.status]: [{ status: 401 }, f.status.completed] })
      await expect(f.make().status(ref)).resolves.toMatchObject({ status: 'completed' })
      expect(tokenCalls(calls)).toBe(2)
    })

    it('shares one token across concurrent and sequential calls', async () => {
      const { calls } = mockFetch({ '/token': TOKEN, [f.paths.status]: f.status.pending })
      const provider = f.make()
      await Promise.all([provider.status(ref), provider.status(ref)])
      await provider.status(ref)
      expect(tokenCalls(calls)).toBe(1)
    })

    it('encodes the ref in the status URL', async () => {
      const { calls } = mockFetch({ '/token': TOKEN, [f.paths.status]: f.status.pending })
      await f.make().status('../x?y')
      expect(calls.find((c) => c.url.includes(f.paths.status))?.url).toContain('..%2Fx%3Fy')
    })
  })
}
