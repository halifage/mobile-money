import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CollectRequest } from '../src/types.js'
import { type OrangeWebPayConfig, orangeWebPay } from '../src/webpay.js'
import { caught, describeProviderContract, TOKEN } from './contract.js'
import { bodyOf, headersOf, mockFetch, type Reply } from './fetch.js'

const config: OrangeWebPayConfig = {
  clientId: 'client',
  clientSecret: 'secret',
  merchantKey: 'mkey',
  environment: 'cm',
  baseUrl: 'https://orange.test',
}
const request: CollectRequest = {
  id: 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  operator: 'orange',
  amount: 10,
  phone: '+237690000000',
  description: 'Order 42',
  callbackUrl: 'https://app.test/cb?id=x&sig=y',
  returnUrl: 'https://app.test/checkout/pending',
}
const PAYMENT_URL = 'https://webpayment.orange.test/pay/abc'
const ACCEPTED: Reply = {
  status: 201,
  body: { status: 201, message: 'OK', pay_token: 'PT1', payment_url: PAYMENT_URL, notif_token: 'nt' },
}
const ref = Buffer.from(JSON.stringify({ payToken: 'PT1', orderId: request.id, amount: 10 })).toString('base64url')
const statusOf = (status: string, extra: Record<string, unknown> = {}): Reply => ({
  status: 201,
  body: { status, order_id: request.id, txnid: 'MP1', ...extra },
})

describeProviderContract('orangeWebPay', {
  make: () => orangeWebPay(config),
  request,
  currency: 'XAF',
  paths: { send: '/webpayment', status: '/transactionstatus' },
  accepted: { '/webpayment': ACCEPTED },
  expectedRef: ref,
  redirectUrl: PAYMENT_URL,
  sendFailure: 'rejected',
  status: {
    completed: statusOf('SUCCESS', { amount: 10, currency: 'XAF' }),
    failed: statusOf('CANCELLED'),
    failedReason: 'declined',
    pending: statusOf('INITIATED'),
    unknown: statusOf('SOMETHING_NEW'),
  },
})

describe('orangeWebPay', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('gets an OAuth token with Basic client credentials', async () => {
    const { calls } = mockFetch({ '/token': TOKEN, '/webpayment': ACCEPTED })
    await orangeWebPay(config).collect(request)
    expect(calls[0]?.url).toBe('https://orange.test/oauth/v3/token')
    expect(headersOf(calls[0]).authorization).toBe(`Basic ${Buffer.from('client:secret').toString('base64')}`)
    expect(calls[0]?.init.body).toBe('grant_type=client_credentials')
    expect(headersOf(calls[1]).authorization).toBe('Bearer tok')
  })

  it('sends the web payment body on the cm path in XAF', async () => {
    const { calls } = mockFetch({ '/token': TOKEN, '/webpayment': ACCEPTED })
    await orangeWebPay(config).collect(request)
    expect(calls[1]?.url).toBe('https://orange.test/orange-money-webpay/cm/v1/webpayment')
    expect(bodyOf(calls[1])).toEqual({
      merchant_key: 'mkey',
      currency: 'XAF',
      order_id: request.id,
      amount: 10,
      return_url: 'https://app.test/checkout/pending',
      cancel_url: 'https://app.test/checkout/pending',
      notif_url: 'https://app.test/cb?id=x&sig=y',
      lang: 'fr',
      reference: 'Order 42',
    })
  })

  it('uses the dev path and the OUV test currency in the sandbox, with api.orange.com by default', async () => {
    const { calls } = mockFetch({
      '/token': TOKEN,
      '/webpayment': ACCEPTED,
      '/transactionstatus': statusOf('SUCCESS', { amount: 10, currency: 'OUV' }),
    })
    const provider = orangeWebPay({ ...config, environment: 'dev', baseUrl: undefined })
    const { ref: devRef } = await provider.collect(request)
    expect(calls[1]?.url).toBe('https://api.orange.com/orange-money-webpay/dev/v1/webpayment')
    expect(bodyOf(calls[1]).currency).toBe('OUV')
    await expect(provider.status(devRef)).resolves.toEqual({ status: 'completed', amount: 10, currency: 'OUV' })
  })

  it('requires a returnUrl before any network call', async () => {
    const { calls } = mockFetch({})
    expect(await caught(orangeWebPay(config).collect({ ...request, returnUrl: undefined }))).toMatchObject({
      kind: 'rejected',
      code: 'invalid_input',
    })
    expect(calls).toHaveLength(0)
  })

  it('rejects a 2xx without pay_token or payment_url', async () => {
    for (const body of [{ pay_token: 'PT1' }, { payment_url: PAYMENT_URL }]) {
      mockFetch({ '/token': TOKEN, '/webpayment': { status: 201, body } })
      expect((await caught(orangeWebPay(config).collect(request))).kind).toBe('rejected')
    }
  })

  it('queries status with order_id, amount and pay_token from the ref', async () => {
    const { calls } = mockFetch({ '/token': TOKEN, '/transactionstatus': statusOf('PENDING') })
    await orangeWebPay(config).status(ref)
    expect(calls[1]?.url).toBe('https://orange.test/orange-money-webpay/cm/v1/transactionstatus')
    expect(bodyOf(calls[1])).toEqual({ order_id: request.id, amount: 10, pay_token: 'PT1' })
  })

  it('falls back to the ref amount and environment currency when the status omits them', async () => {
    mockFetch({ '/token': TOKEN, '/transactionstatus': statusOf('SUCCESSFULL') })
    await expect(orangeWebPay(config).status(ref)).resolves.toEqual({
      status: 'completed',
      amount: 10,
      currency: 'XAF',
    })
  })

  it('maps FAILED and EXPIRED', async () => {
    mockFetch({ '/token': TOKEN, '/transactionstatus': [statusOf('FAILED'), statusOf('EXPIRED')] })
    const provider = orangeWebPay(config)
    await expect(provider.status(ref)).resolves.toEqual({ status: 'failed', reason: 'unknown', code: 'FAILED' })
    await expect(provider.status(ref)).resolves.toEqual({ status: 'failed', reason: 'expired', code: 'EXPIRED' })
  })

  it('reports a tampered or foreign ref as unavailable without calling Orange', async () => {
    const { calls } = mockFetch({ '/token': TOKEN, '/transactionstatus': statusOf('SUCCESS') })
    const foreign = Buffer.from(JSON.stringify({ payToken: 'PT1' })).toString('base64url')
    for (const bad of ['not-a-ref', 'MP123', foreign]) {
      expect(await caught(orangeWebPay(config).status(bad))).toMatchObject({ kind: 'unavailable', code: 'BAD_REF' })
    }
    expect(calls).toHaveLength(0)
  })

  it('never puts credentials in errors', async () => {
    mockFetch({ '/token': TOKEN, '/webpayment': { status: 400, body: { message: 'bad request' } } })
    const error = await caught(orangeWebPay(config).collect(request))
    const text = `${error.message} ${JSON.stringify(error)}`
    for (const secret of ['secret', 'mkey', 'tok']) expect(text).not.toContain(secret)
  })
})
