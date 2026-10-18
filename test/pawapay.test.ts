import { afterEach, describe, expect, it, vi } from 'vitest'
import { type PawaPayConfig, parsePawaPayCallback, pawaPay } from '../src/pawapay.js'
import type { CollectRequest, Operator, PayoutRequest } from '../src/types.js'
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
// shapes as observed in the pawaPay sandbox, 2026-10-18
const ACCEPTED: Reply = { status: 201, body: { redirectUrl: PAGE } }
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
    completed: dep('COMPLETED', { amount: '10.00', currency: 'XAF' }),
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

describe('pawaPay payouts', () => {
  afterEach(() => vi.unstubAllGlobals())
  const payout: PayoutRequest = {
    id: 'c4e2d3f5-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
    operator: 'orange',
    amount: 20000,
    phone: '693456789',
    message: 'Ecolage versement',
  }
  const reply = (status: string, extra: Record<string, unknown> = {}): Reply => ({
    status: 200,
    body: { payoutId: payout.id, status, ...extra },
  })
  const found = (status: string, extra: Record<string, unknown> = {}): Reply => ({
    status: 200,
    body: { status: 'FOUND', data: { payoutId: payout.id, status, ...extra } },
  })

  it('posts the payout', async () => {
    const { calls } = mockFetch({ '/v2/payouts': reply('ACCEPTED') })
    await pawaPay(config).payout(payout)
    expect(calls[0]?.url).toBe('https://pawapay.test/v2/payouts')
    expect(headersOf(calls[0]).authorization).toBe('Bearer tok_test')
    expect(bodyOf(calls[0])).toEqual({
      payoutId: payout.id,
      amount: '20000',
      currency: 'XAF',
      recipient: { type: 'MMO', accountDetails: { phoneNumber: '237693456789', provider: 'ORANGE_CMR' } },
      customerMessage: 'Ecolage versement',
    })
    for (const message of ['abc', 'x'.repeat(23), undefined]) {
      const { calls } = mockFetch({ '/v2/payouts': reply('ACCEPTED') })
      await pawaPay(config).payout({ ...payout, message })
      expect(bodyOf(calls[0])).not.toHaveProperty('customerMessage')
    }
  })

  it('ACCEPTED and DUPLICATE_IGNORED resolve with the ref', async () => {
    mockFetch({ '/v2/payouts': [reply('ACCEPTED'), reply('DUPLICATE_IGNORED')] })
    const provider = pawaPay(config)
    await expect(provider.payout(payout)).resolves.toEqual({ ref: payout.id })
    await expect(provider.payout(payout)).resolves.toEqual({ ref: payout.id })
  })

  it('REJECTED → rejected with the failure code', async () => {
    mockFetch({ '/v2/payouts': reply('REJECTED', { failureReason: { failureCode: 'INVALID_PHONE_NUMBER' } }) })
    expect(await caught(pawaPay(config).payout(payout))).toMatchObject({
      kind: 'rejected',
      code: 'INVALID_PHONE_NUMBER',
    })
  })

  it('REJECTED UNKNOWN_ERROR, network error, 5xx → uncertain with ref', async () => {
    const replies: Reply[] = [
      reply('REJECTED', { failureReason: { failureCode: 'UNKNOWN_ERROR' } }),
      new TypeError('fetch failed'),
      { status: 503 },
    ]
    for (const r of replies) {
      mockFetch({ '/v2/payouts': r })
      expect(await caught(pawaPay(config).payout(payout))).toMatchObject({ kind: 'uncertain', ref: payout.id })
    }
  })

  it('invalid payout input → rejected before any fetch', async () => {
    const { calls } = mockFetch({})
    const bad: Partial<PayoutRequest>[] = [
      { id: 'p-1' },
      { amount: 0 },
      { amount: 1.5 },
      { phone: '+233201234567' },
      { operator: 'airtel' as Operator },
    ]
    for (const b of bad) {
      expect(await caught(pawaPay(config).payout({ ...payout, ...b }))).toMatchObject({
        kind: 'rejected',
        code: 'invalid_input',
      })
    }
    expect(calls).toHaveLength(0)
  })

  it('maps payout statuses', async () => {
    mockFetch({
      '/v2/payouts/': [
        found('COMPLETED', { amount: '20000.00', currency: 'XAF' }),
        found('FAILED', { failureReason: { failureCode: 'RECIPIENT_NOT_FOUND' } }),
        found('ENQUEUED'),
        { status: 200, body: { status: 'NOT_FOUND' } },
      ],
    })
    const provider = pawaPay(config)
    await expect(provider.payoutStatus(payout.id)).resolves.toEqual({
      status: 'completed',
      amount: 20000,
      currency: 'XAF',
    })
    await expect(provider.payoutStatus(payout.id)).resolves.toEqual({
      status: 'failed',
      reason: 'unknown',
      code: 'RECIPIENT_NOT_FOUND',
    })
    await expect(provider.payoutStatus(payout.id)).resolves.toEqual({ status: 'pending' })
    await expect(provider.payoutStatus(payout.id)).resolves.toEqual({
      status: 'failed',
      reason: 'unknown',
      code: 'NOT_FOUND',
    })
  })

  it('payout status 5xx or bad body → unavailable; hostile ref encoded', async () => {
    for (const r of [{ status: 500 }, { status: 200, body: {} }] as Reply[]) {
      mockFetch({ '/v2/payouts/': r })
      expect((await caught(pawaPay(config).payoutStatus(payout.id))).kind).toBe('unavailable')
    }
    const { calls } = mockFetch({ '/v2/payouts/': found('ENQUEUED') })
    await pawaPay(config).payoutStatus('../x?y')
    expect(calls[0]?.url).toBe('https://pawapay.test/v2/payouts/..%2Fx%3Fy')
  })
})

describe('parsePawaPayCallback', () => {
  it('returns the kind and id to re-check, nothing else', () => {
    expect(parsePawaPayCallback('{"depositId":"d1","status":"COMPLETED"}')).toEqual({ kind: 'deposit', ref: 'd1' })
    expect(parsePawaPayCallback('{"payoutId":"p1"}')).toEqual({ kind: 'payout', ref: 'p1' })
    expect(parsePawaPayCallback('{"refundId":"r1"}')).toEqual({ kind: 'refund', ref: 'r1' })
  })

  it('returns null for anything else, never throws', () => {
    for (const raw of ['{}', 'not json', '[]', '{"depositId":5}', '{"depositId":""}', 'null']) {
      expect(parsePawaPayCallback(raw)).toBeNull()
    }
  })
})
