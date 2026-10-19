import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type MtnDirectConfig, mtnDirect } from '../src/mtn.js'
import type { CollectRequest } from '../src/types.js'
import { caught, describeProviderContract, TOKEN } from './contract.js'
import { bodyOf, headersOf, mockFetch, type Reply } from './fetch.js'

const config: MtnDirectConfig = {
  subscriptionKey: 'sub',
  apiUser: 'user',
  apiKey: 'key',
  environment: 'mtncameroon',
  baseUrl: 'https://mtn.test',
}
const request: CollectRequest = {
  id: 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  operator: 'mtn',
  amount: 10,
  phone: '677000000',
  description: 'Order 42',
  callbackUrl: 'https://app.test/cb?id=x&sig=y',
}
const body = (status: string, extra: Record<string, unknown> = {}): Reply => ({
  status: 200,
  body: { status, amount: '10', currency: 'XAF', ...extra },
})

describeProviderContract('mtnDirect', {
  make: () => mtnDirect(config),
  request,
  currency: 'XAF',
  paths: { send: 'requesttopay', status: 'requesttopay/' },
  accepted: { requesttopay: { status: 202 } },
  expectedRef: request.id,
  status: {
    completed: body('SUCCESSFUL'),
    failed: body('FAILED', { reason: 'NOT_ENOUGH_FUNDS' }),
    failedReason: 'insufficient_funds',
    pending: body('PENDING'),
    unknown: body('ONGOING'),
  },
})

describe('mtnDirect', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the documented headers and body', async () => {
    const { calls } = mockFetch({ '/token': TOKEN, requesttopay: { status: 202 } })
    await mtnDirect(config).collect(request)
    expect(calls[0]?.url).toBe('https://mtn.test/collection/token/')
    expect(headersOf(calls[0])).toMatchObject({
      authorization: `Basic ${Buffer.from('user:key').toString('base64')}`,
      'ocp-apim-subscription-key': 'sub',
    })
    expect(calls[1]?.url).toBe('https://mtn.test/collection/v1_0/requesttopay')
    expect(headersOf(calls[1])).toMatchObject({
      authorization: 'Bearer tok',
      'ocp-apim-subscription-key': 'sub',
      'x-target-environment': 'mtncameroon',
      'x-reference-id': request.id,
      'x-callback-url': request.callbackUrl,
    })
    expect(bodyOf(calls[1])).toEqual({
      amount: '10',
      currency: 'XAF',
      externalId: request.id,
      payer: { partyIdType: 'MSISDN', partyId: '237677000000' },
      payerMessage: 'Order 42',
      payeeNote: 'Order 42',
    })
  })

  it('treats 409 (reference already used) as accepted', async () => {
    mockFetch({ '/token': TOKEN, requesttopay: { status: 409, body: { code: 'RESOURCE_ALREADY_EXIST' } } })
    await expect(mtnDirect(config).collect(request)).resolves.toEqual({ ref: request.id })
  })

  it('rejects a non-UUID id before any network call', async () => {
    const { calls } = mockFetch({})
    expect(await caught(mtnDirect(config).collect({ ...request, id: 'order-42' }))).toMatchObject({
      kind: 'rejected',
      code: 'invalid_input',
    })
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['APPROVAL_REJECTED', 'declined'],
    ['EXPIRED', 'expired'],
    ['SERVICE_UNAVAILABLE', 'unavailable'],
    ['INTERNAL_PROCESSING_ERROR', 'unknown'],
  ])('maps FAILED reason %s to %s', async (reason, expected) => {
    mockFetch({ '/token': TOKEN, 'requesttopay/': body('FAILED', { reason }) })
    await expect(mtnDirect(config).status(request.id)).resolves.toEqual({
      status: 'failed',
      reason: expected,
      code: reason,
    })
  })

  it('reads a FAILED reason given as an object', async () => {
    mockFetch({ '/token': TOKEN, 'requesttopay/': body('FAILED', { reason: { code: 'NOT_ENOUGH_FUNDS' } }) })
    await expect(mtnDirect(config).status(request.id)).resolves.toMatchObject({ reason: 'insufficient_funds' })
  })

  it('maps PAYER_NOT_FOUND to wrong_number', async () => {
    mockFetch({ '/token': TOKEN, 'requesttopay/': body('FAILED', { reason: { code: 'PAYER_NOT_FOUND' } }) })
    await expect(mtnDirect(config).status(request.id)).resolves.toMatchObject({ reason: 'wrong_number' })
  })

  it('404 → failed NOT_FOUND', async () => {
    mockFetch({ '/token': TOKEN, 'requesttopay/': { status: 404 } })
    await expect(mtnDirect(config).status(request.id)).resolves.toEqual({
      status: 'failed',
      reason: 'unknown',
      code: 'NOT_FOUND',
    })
  })

  it('success in the wrong currency → unavailable', async () => {
    mockFetch({ '/token': TOKEN, 'requesttopay/': body('SUCCESSFUL', { currency: 'EUR' }) })
    expect(await caught(mtnDirect(config).status(request.id))).toMatchObject({
      kind: 'unavailable',
      code: 'BAD_AMOUNT',
    })
  })

  it('refuses sandbox MSISDNs in production', async () => {
    const { calls } = mockFetch({})
    expect((await caught(mtnDirect(config).collect({ ...request, phone: '46733123450' }))).code).toBe('invalid_input')
    expect(calls).toHaveLength(0)
  })

  it('sandbox: default base URL, EUR, test MSISDNs accepted', async () => {
    const { calls } = mockFetch({ '/token': TOKEN, requesttopay: { status: 202 } })
    await mtnDirect({ ...config, environment: 'sandbox', baseUrl: undefined }).collect({
      ...request,
      phone: '46733123450',
    })
    expect(calls[1]?.url).toBe('https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay')
    expect(headersOf(calls[1])['x-target-environment']).toBe('sandbox')
    expect(bodyOf(calls[1])).toMatchObject({ currency: 'EUR', payer: { partyId: '46733123450' } })
  })

  it('production default base URL', async () => {
    const { calls } = mockFetch({ '/token': TOKEN, requesttopay: { status: 202 } })
    await mtnDirect({ ...config, baseUrl: undefined }).collect(request)
    expect(calls[0]?.url).toBe('https://proxy.momoapi.mtn.com/collection/token/')
  })
})
