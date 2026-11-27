import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CamPayConfig, camPay, parseCamPayCallback } from '../src/campay.js'
import type { CollectRequest, Operator, PayoutRequest } from '../src/types.js'
import { caught, describeProviderContract } from './contract.js'
import { bodyOf, headersOf, mockFetch, type Reply } from './fetch.js'

const config: CamPayConfig = { token: 'tok_test', environment: 'demo', baseUrl: 'https://campay.test/api' }
const REF = 'bcedde9b-62a7-4421-96ac-2e6179552a1a'
const LINK = 'https://demo.campay.net/pay/abc'
const push: CollectRequest = {
  id: 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  operator: 'mtn',
  amount: 10,
  phone: '+237677777777',
  description: 'Order 42',
  callbackUrl: 'https://app.test/cb',
}
const page: CollectRequest = { ...push, returnUrl: 'https://app.test/checkout/pending' }
// shapes as documented in the CamPay Postman collection
const COLLECTED: Reply = { status: 200, body: { reference: REF, ussd_code: '*126#', operator: 'MTN' } }
const LINKED: Reply = { status: 200, body: { link: LINK, reference: REF } }
const tx = (status: string, extra: Record<string, unknown> = {}): Reply => ({
  status: 200,
  body: { reference: REF, status, currency: 'XAF', operator: 'MTN', ...extra },
})
const statuses = {
  completed: tx('SUCCESSFUL', { amount: 10, endpoint: 'collect' }),
  failed: tx('FAILED', { reason: 'TESTING' }),
  failedReason: 'unknown' as const,
  pending: tx('PENDING'),
  unknown: tx('SOMETHING_NEW'),
}

describeProviderContract('camPay USSD push', {
  make: () => camPay(config),
  request: push,
  currency: 'XAF',
  token: false,
  sendFailure: 'uncertain-without-ref',
  paths: { send: '/collect/', status: `/transaction/${REF}/` },
  accepted: { '/collect/': COLLECTED },
  expectedRef: REF,
  status: statuses,
})

describeProviderContract('camPay payment link', {
  make: () => camPay(config),
  request: page,
  currency: 'XAF',
  token: false,
  sendFailure: 'rejected',
  paths: { send: '/get_payment_link/', status: `/transaction/${REF}/` },
  accepted: { '/get_payment_link/': LINKED },
  expectedRef: REF,
  redirectUrl: LINK,
  status: statuses,
})

describe('camPay collections', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts a USSD push when there is no returnUrl', async () => {
    const { calls } = mockFetch({ '/collect/': COLLECTED })
    await expect(camPay(config).collect(push)).resolves.toEqual({ ref: REF })
    expect(calls[0]?.url).toBe('https://campay.test/api/collect/')
    expect(headersOf(calls[0]).authorization).toBe('Token tok_test')
    expect(bodyOf(calls[0])).toEqual({
      amount: '10',
      currency: 'XAF',
      from: '237677777777',
      description: 'Order 42',
      external_reference: push.id,
    })
  })

  it('posts a MOMO-only payment link when returnUrl is set', async () => {
    const { calls } = mockFetch({ '/get_payment_link/': LINKED })
    await camPay(config).collect(page)
    expect(calls[0]?.url).toBe('https://campay.test/api/get_payment_link/')
    expect(bodyOf(calls[0])).toEqual({
      amount: '10',
      currency: 'XAF',
      from: '237677777777',
      description: 'Order 42',
      external_reference: page.id,
      redirect_url: page.returnUrl,
      failure_redirect_url: page.returnUrl,
      payment_options: 'MOMO',
    })
  })

  it('2xx without reference: push → uncertain without ref, link → rejected', async () => {
    mockFetch({
      '/collect/': { status: 200, body: {} },
      '/get_payment_link/': { status: 200, body: { reference: REF } },
    })
    expect(await caught(camPay(config).collect(push))).toMatchObject({ kind: 'uncertain', ref: undefined })
    expect((await caught(camPay(config).collect(page))).kind).toBe('rejected')
  })

  it('normalises phone numbers, rejects bad input before any fetch', async () => {
    for (const phone of ['+237 6 77 77 77 77', '677777777', '237677777777']) {
      const { calls } = mockFetch({ '/collect/': COLLECTED })
      await camPay(config).collect({ ...push, phone })
      expect(bodyOf(calls[0]).from).toBe('237677777777')
    }
    const { calls } = mockFetch({})
    for (const bad of [{ phone: '+233201234567' }, { phone: '65345678' }, { id: 'order-42' }]) {
      expect(await caught(camPay(config).collect({ ...push, ...bad }))).toMatchObject({
        kind: 'rejected',
        code: 'invalid_input',
      })
    }
    expect(calls).toHaveLength(0)
  })

  // body shapes observed in the CamPay demo, 2026-11-27
  it('4xx → rejected with error_code', async () => {
    mockFetch({ '/collect/': { status: 400, body: { message: 'Invalid phone number', error_code: 'ER101' } } })
    expect(await caught(camPay(config).collect(push))).toMatchObject({ kind: 'rejected', code: 'ER101' })
  })

  it('same id while the first is processing (429 DUPLICATE_ATTEMPT) → uncertain without ref', async () => {
    const duplicate: Reply = {
      status: 429,
      body: {
        message: 'A request with this external reference is already being processed',
        error_code: 'DUPLICATE_ATTEMPT',
      },
    }
    mockFetch({ '/collect/': duplicate })
    expect(await caught(camPay(config).collect(push))).toMatchObject({
      kind: 'uncertain',
      code: 'DUPLICATE_ATTEMPT',
      ref: undefined,
    })
  })

  it('maps a reference CamPay has no result for to pending NOT_FOUND', async () => {
    mockFetch({ '/transaction/': { status: 404, body: { message: 'Not found.' } } })
    await expect(camPay(config).status(REF)).resolves.toEqual({ status: 'pending', code: 'NOT_FOUND' })
  })

  it('keeps the CamPay reason as the failure code', async () => {
    mockFetch({ '/transaction/': statuses.failed })
    await expect(camPay(config).status(REF)).resolves.toEqual({
      status: 'failed',
      reason: 'unknown',
      code: 'TESTING',
    })
  })

  it('defaults environment URLs', async () => {
    const { calls } = mockFetch({ '/collect/': COLLECTED })
    await camPay({ token: 't', environment: 'demo' }).collect(push)
    await camPay({ token: 't', environment: 'production' }).collect(push)
    expect(calls.map((c) => c.url)).toEqual([
      'https://demo.campay.net/api/collect/',
      'https://www.campay.net/api/collect/',
    ])
  })
})

describe('camPay payouts', () => {
  afterEach(() => vi.unstubAllGlobals())
  const payout: PayoutRequest = {
    id: 'c4e2d3f5-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
    operator: 'orange',
    amount: 20000,
    phone: '699999999',
    message: 'Ecolage versement',
  }
  const WITHDRAWN: Reply = { status: 200, body: { reference: REF, status: 'PENDING' } }

  it('posts the withdrawal and returns the CamPay reference', async () => {
    const { calls } = mockFetch({ '/withdraw/': WITHDRAWN })
    await expect(camPay(config).payout(payout)).resolves.toEqual({ ref: REF })
    expect(calls[0]?.url).toBe('https://campay.test/api/withdraw/')
    expect(headersOf(calls[0]).authorization).toBe('Token tok_test')
    expect(bodyOf(calls[0])).toEqual({
      amount: '20000',
      to: '237699999999',
      description: 'Ecolage versement',
      external_reference: payout.id,
    })
  })

  it('ER301 / 4xx → rejected with the provider code', async () => {
    mockFetch({ '/withdraw/': { status: 400, body: { message: 'Insufficient balance', error_code: 'ER301' } } })
    expect(await caught(camPay(config).payout(payout))).toMatchObject({ kind: 'rejected', code: 'ER301' })
  })

  it('network error, 5xx, 2xx without reference → uncertain without ref', async () => {
    for (const r of [new TypeError('fetch failed'), { status: 503 }, { status: 200, body: {} }] as Reply[]) {
      mockFetch({ '/withdraw/': r })
      expect(await caught(camPay(config).payout(payout))).toMatchObject({ kind: 'uncertain', ref: undefined })
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
      expect(await caught(camPay(config).payout({ ...payout, ...b }))).toMatchObject({
        kind: 'rejected',
        code: 'invalid_input',
      })
    }
    expect(calls).toHaveLength(0)
  })

  it('maps payout statuses through the same transaction lookup', async () => {
    mockFetch({
      '/transaction/': [
        tx('SUCCESSFUL', { amount: '20000', endpoint: 'withdraw' }),
        tx('FAILED', { reason: 'Invalid number' }),
        tx('PENDING'),
      ],
    })
    const provider = camPay(config)
    await expect(provider.payoutStatus(REF)).resolves.toEqual({ status: 'completed', amount: 20000, currency: 'XAF' })
    await expect(provider.payoutStatus(REF)).resolves.toEqual({
      status: 'failed',
      reason: 'unknown',
      code: 'Invalid number',
    })
    await expect(provider.payoutStatus(REF)).resolves.toEqual({ status: 'pending' })
  })
})

describe('parseCamPayCallback', () => {
  const KEY = 'webhook_key'
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const jwt = (key: string, header: object = { alg: 'HS256', typ: 'JWT' }) => {
    const signed = `${b64(header)}.${b64({})}`
    return `${signed}.${createHmac('sha256', key).update(signed).digest('base64url')}`
  }
  const fields = { status: 'SUCCESSFUL', reference: REF, endpoint: 'collect', signature: jwt(KEY) }

  it('returns kind and ref for a valid signature', () => {
    expect(parseCamPayCallback(fields, KEY)).toEqual({ kind: 'collect', ref: REF })
    expect(parseCamPayCallback({ ...fields, endpoint: 'withdraw' }, KEY)).toEqual({ kind: 'payout', ref: REF })
  })

  it('returns null for a bad signature or odd fields, never throws', () => {
    const bad = [
      { ...fields, signature: jwt('other') },
      { ...fields, signature: jwt(KEY, { alg: 'none' }) },
      { ...fields, signature: 'not.a.jwt' },
      { ...fields, signature: undefined },
      { ...fields, endpoint: 'refund' },
      { ...fields, reference: '' },
      {},
    ]
    for (const f of bad) expect(parseCamPayCallback(f, KEY)).toBeNull()
    expect(parseCamPayCallback(fields, '')).toBeNull()
  })
})
