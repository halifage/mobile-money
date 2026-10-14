import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { orangeDirect } from '../src/orange.js'
import type { CollectRequest } from '../src/types.js'
import { caught, describeProviderContract, TOKEN } from './contract.js'
import { bodyOf, headersOf, mockFetch, type Reply } from './fetch.js'

const config = {
  username: 'user',
  password: 'pass',
  authToken: 'xauth',
  merchantMsisdn: '699000000',
  pin: '4242',
  baseUrl: 'https://orange.test',
}
const request: CollectRequest = {
  id: 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  operator: 'orange',
  amount: 10,
  phone: '+237690000000',
  description: 'Order 42',
  callbackUrl: 'https://app.test/cb?id=x&sig=y',
}
const INIT: Reply = {
  status: 200,
  body: { message: 'Payment request successfully initiated', data: { payToken: 'MP123' } },
}
const PAY: Reply = {
  status: 200,
  body: { message: 'Merchant payment successfully initiated', data: { status: 'PENDING' } },
}
const statusReply = (status: string, amount: unknown = '10'): Reply => ({
  status: 200,
  body: { data: { status, amount } },
})
const accepted = { '/mp/init': INIT, '/mp/pay': PAY }

describeProviderContract('orangeDirect', {
  make: () => orangeDirect(config),
  request,
  currency: 'XAF',
  paths: { send: '/mp/pay', status: '/mp/paymentstatus' },
  accepted,
  expectedRef: 'MP123',
  status: {
    completed: statusReply('SUCCESSFULL'),
    failed: statusReply('CANCELLED'),
    failedReason: 'declined',
    pending: statusReply('PENDING'),
    unknown: statusReply('WAITING_FOR_SOMETHING'),
  },
})

describe('orangeDirect', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('authenticates with Basic for the token, then Bearer + X-AUTH-TOKEN', async () => {
    const { calls } = mockFetch({ '/token': TOKEN, ...accepted })
    await orangeDirect(config).collect(request)
    expect(calls[0]?.url).toBe('https://orange.test/token')
    expect(headersOf(calls[0]).authorization).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`)
    expect(calls[0]?.init.body).toBe('grant_type=client_credentials')
    for (const call of calls.slice(1)) {
      expect(headersOf(call)).toMatchObject({ authorization: 'Bearer tok', 'x-auth-token': 'xauth' })
    }
    expect(calls.map((c) => c.url)).toEqual([
      'https://orange.test/token',
      'https://orange.test/omcoreapis/1.0.2/mp/init',
      'https://orange.test/omcoreapis/1.0.2/mp/pay',
    ])
  })

  it('sends the pay body', async () => {
    const { calls } = mockFetch({ '/token': TOKEN, ...accepted })
    await orangeDirect(config).collect(request)
    expect(bodyOf(calls[2])).toEqual({
      notifUrl: 'https://app.test/cb?id=x&sig=y',
      channelUserMsisdn: '699000000',
      amount: '10',
      subscriberMsisdn: '690000000',
      pin: '4242',
      orderId: 'b3f1c2d45e6f4a7b8c9d',
      description: 'Order 42',
      payToken: 'MP123',
    })
  })

  it('keeps orderId within the Orange 20-character limit', async () => {
    const { calls } = mockFetch({ '/token': TOKEN, ...accepted })
    await orangeDirect(config).collect({ ...request, id: 'order-with-a-very-long-identifier-42' })
    expect(bodyOf(calls[2]).orderId).toBe('orderwithaverylongid')
  })

  it.each(['+237690000000', '237690000000', '690 00 00 00', '690-000-000'])('normalises phone %s', async (phone) => {
    const { calls } = mockFetch({ '/token': TOKEN, ...accepted })
    await orangeDirect(config).collect({ ...request, phone })
    expect(bodyOf(calls[2]).subscriberMsisdn).toBe('690000000')
  })

  it.each(['+33612345678', '2376900', '790000000'])('rejects phone %s before any network call', async (phone) => {
    const { calls } = mockFetch({})
    expect(await caught(orangeDirect(config).collect({ ...request, phone }))).toMatchObject({
      kind: 'rejected',
      code: 'invalid_input',
    })
    expect(calls).toHaveLength(0)
  })

  it.each<Reply>([{ status: 500 }, new TypeError('fetch failed'), { status: 200, body: { data: {} } }])(
    'init failure → rejected and pay never sent',
    async (init) => {
      const { calls } = mockFetch({ '/token': TOKEN, '/mp/init': init, '/mp/pay': PAY })
      expect((await caught(orangeDirect(config).collect(request))).kind).toBe('rejected')
      expect(calls.some((c) => c.url.endsWith('/mp/pay'))).toBe(false)
    },
  )

  it.each(['SUCCESSFULL', 'SUCCESSFUL', 'SUCCESS', 'successful'])('treats %s as completed', async (status) => {
    mockFetch({ '/token': TOKEN, '/mp/paymentstatus': statusReply(status, 10) })
    await expect(orangeDirect(config).status('MP123')).resolves.toEqual({
      status: 'completed',
      amount: 10,
      currency: 'XAF',
    })
  })

  it('maps FAILED and EXPIRED', async () => {
    mockFetch({ '/token': TOKEN, '/mp/paymentstatus': [statusReply('FAILED'), statusReply('EXPIRED')] })
    const provider = orangeDirect(config)
    await expect(provider.status('MP123')).resolves.toEqual({ status: 'failed', reason: 'unknown', code: 'FAILED' })
    await expect(provider.status('MP123')).resolves.toEqual({ status: 'failed', reason: 'expired', code: 'EXPIRED' })
  })

  it('success with a bad amount or a missing status → unavailable', async () => {
    for (const reply of [statusReply('SUCCESSFULL', '10.5'), statusReply('SUCCESSFULL', null), statusReply('')]) {
      mockFetch({ '/token': TOKEN, '/mp/paymentstatus': reply })
      expect((await caught(orangeDirect(config).status('MP123'))).kind).toBe('unavailable')
    }
  })

  it('never puts the PIN or credentials in errors', async () => {
    for (const pay of [{ status: 500 }, { status: 400, body: { message: 'Invalid subscriber' } }]) {
      mockFetch({ '/token': TOKEN, '/mp/init': INIT, '/mp/pay': pay })
      const error = await caught(orangeDirect(config).collect(request))
      const text = `${error.message} ${JSON.stringify(error)}`
      for (const secret of ['4242', 'pass', 'xauth', 'tok']) expect(text).not.toContain(secret)
    }
  })
})
