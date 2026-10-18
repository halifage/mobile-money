import { afterEach, describe, expect, it, vi } from 'vitest'
import { type PawaPayConfig, pawaPay } from '../src/pawapay.js'
import type { CollectRequest } from '../src/types.js'
import { caught, describeProviderContract } from './contract.js'
import { bodyOf, headersOf, mockFetch, type Reply } from './fetch.js'

const config: PawaPayConfig = { token: 'tok_test', environment: 'sandbox', baseUrl: 'https://pawapay.test' }
const request: CollectRequest = {
  id: 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  operator: 'mtn',
  amount: 10,
  phone: '+237653456789',
  description: 'Order 42',
  callbackUrl: 'https://app.test/cb',
  returnUrl: 'https://app.test/checkout/pending',
}
const PAGE = 'https://sandbox.paywith.pawapay.io/?token=abc'
const ACCEPTED: Reply = { status: 200, body: { redirectUrl: PAGE } }
const dep = (status: string, extra: Record<string, unknown> = {}): Reply => ({
  status: 200,
  body: { status: 'FOUND', data: { depositId: request.id, status, ...extra } },
})

describeProviderContract('pawaPay', {
  make: () => pawaPay(config),
  request,
  currency: 'XAF',
  token: false,
  sendFailure: 'rejected',
  paths: { send: '/v2/paymentpage', status: `/v2/deposits/${request.id}` },
  accepted: { '/v2/paymentpage': ACCEPTED },
  expectedRef: request.id,
  redirectUrl: PAGE,
  status: {
    completed: dep('COMPLETED', { amount: '10', currency: 'XAF' }),
    failed: dep('FAILED', { failureReason: { failureCode: 'PAYMENT_NOT_APPROVED' } }),
    failedReason: 'declined',
    pending: dep('PROCESSING'),
    unknown: dep('SOMETHING_NEW'),
  },
})

describe('pawaPay collections', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts the payment page request', async () => {
    const { calls } = mockFetch({ '/v2/paymentpage': ACCEPTED })
    await pawaPay(config).collect(request)
    expect(calls[0]?.url).toBe('https://pawapay.test/v2/paymentpage')
    expect(headersOf(calls[0]).authorization).toBe('Bearer tok_test')
    expect(bodyOf(calls[0])).toEqual({
      depositId: request.id,
      returnUrl: request.returnUrl,
      phoneNumber: '237653456789',
      amountDetails: { amount: '10', currency: 'XAF' },
      country: 'CMR',
      language: 'FR',
      reason: 'Order 42',
    })
  })

  it('cuts reason to 50 chars', async () => {
    const { calls } = mockFetch({ '/v2/paymentpage': ACCEPTED })
    await pawaPay(config).collect({ ...request, description: 'x'.repeat(80) })
    expect(bodyOf(calls[0]).reason).toBe('x'.repeat(50))
  })

  it('normalises phone numbers', async () => {
    for (const phone of ['+237 6 53 45 67 89', '653456789', '237653456789']) {
      const { calls } = mockFetch({ '/v2/paymentpage': ACCEPTED })
      await pawaPay(config).collect({ ...request, phone })
      expect(bodyOf(calls[0]).phoneNumber).toBe('237653456789')
    }
    const { calls } = mockFetch({})
    for (const phone of ['+233201234567', '553456789', '65345678']) {
      const error = await caught(pawaPay(config).collect({ ...request, phone }))
      expect(error).toMatchObject({ kind: 'rejected', code: 'invalid_input' })
    }
    expect(calls).toHaveLength(0)
  })

  it('rejects a non-UUID id and a missing returnUrl', async () => {
    const { calls } = mockFetch({})
    for (const bad of [{ id: 'order-42' }, { returnUrl: undefined }]) {
      const error = await caught(pawaPay(config).collect({ ...request, ...bad }))
      expect(error).toMatchObject({ kind: 'rejected', code: 'invalid_input' })
    }
    expect(calls).toHaveLength(0)
  })

  it('maps deposit NOT_FOUND to pending with code', async () => {
    mockFetch({ '/v2/deposits/': { status: 200, body: { status: 'NOT_FOUND' } } })
    await expect(pawaPay(config).status(request.id)).resolves.toEqual({ status: 'pending', code: 'NOT_FOUND' })
  })

  it('maps INSUFFICIENT_BALANCE to insufficient_funds', async () => {
    mockFetch({ '/v2/deposits/': dep('FAILED', { failureReason: { failureCode: 'INSUFFICIENT_BALANCE' } }) })
    await expect(pawaPay(config).status(request.id)).resolves.toEqual({
      status: 'failed',
      reason: 'insufficient_funds',
      code: 'INSUFFICIENT_BALANCE',
    })
  })

  it('reports a status body without FOUND or NOT_FOUND as unavailable', async () => {
    for (const body of [{}, { status: 'WEIRD' }]) {
      mockFetch({ '/v2/deposits/': { status: 200, body } })
      expect(await caught(pawaPay(config).status(request.id))).toMatchObject({
        kind: 'unavailable',
        code: 'BAD_RESPONSE',
      })
    }
  })

  it('defaults environment URLs', async () => {
    const { calls } = mockFetch({ '/v2/paymentpage': ACCEPTED })
    await pawaPay({ token: 't', environment: 'sandbox' }).collect(request)
    await pawaPay({ token: 't', environment: 'production' }).collect(request)
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.sandbox.pawapay.io/v2/paymentpage',
      'https://api.pawapay.io/v2/paymentpage',
    ])
  })
})
