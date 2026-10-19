import { Buffer } from 'node:buffer'
import {
  authorized,
  completed,
  type HttpResult,
  ok,
  providerCode,
  record,
  send,
  str,
  tokenCache,
  unavailable,
  validAmount,
} from './http.js'
import { type FailureReason, MobileMoneyError, type MobileMoneyProvider } from './types.js'

export type MtnDirectConfig = {
  subscriptionKey: string
  apiUser: string
  apiKey: string
  environment: 'sandbox' | 'mtncameroon'
  baseUrl?: string
}

const BASE = { sandbox: 'https://sandbox.momodeveloper.mtn.com', mtncameroon: 'https://proxy.momoapi.mtn.com' }
const CURRENCY = { sandbox: 'EUR', mtncameroon: 'XAF' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REASONS: Record<string, FailureReason> = {
  NOT_ENOUGH_FUNDS: 'insufficient_funds',
  APPROVAL_REJECTED: 'declined',
  EXPIRED: 'expired',
  PAYER_NOT_FOUND: 'wrong_number',
  SERVICE_UNAVAILABLE: 'unavailable',
}

/** 2376XXXXXXXX, or a sandbox test number in sandbox, or null. */
function partyId(phone: string, sandbox: boolean): string | null {
  const digits = phone.replace(/[\s-]/g, '').replace(/^\+/, '')
  const msisdn = /^6\d{8}$/.test(digits) ? `237${digits}` : digits
  if (/^2376\d{8}$/.test(msisdn)) return msisdn
  // ponytail: sandbox test numbers (e.g. 46733123450) have no fixed shape, so any 8–15 digits pass there
  return sandbox && /^\d{8,15}$/.test(digits) ? digits : null
}

/** MTN MoMo Collections API. */
export function mtnDirect(config: MtnDirectConfig): MobileMoneyProvider {
  const base = config.baseUrl ?? BASE[config.environment]
  const currency = CURRENCY[config.environment]
  const sandbox = config.environment === 'sandbox'
  const basic = Buffer.from(`${config.apiUser}:${config.apiKey}`).toString('base64')
  const tokens = tokenCache(() =>
    send(`${base}/collection/token/`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'ocp-apim-subscription-key': config.subscriptionKey },
    }),
  )
  const call = (path: string, init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {}) =>
    authorized(tokens, (token) =>
      send(`${base}/collection/v1_0${path}`, {
        ...init,
        headers: {
          ...init.headers,
          authorization: `Bearer ${token}`,
          'ocp-apim-subscription-key': config.subscriptionKey,
          'x-target-environment': config.environment,
        },
      }),
    )

  return {
    operators: ['mtn'],

    async collect(request) {
      const payer = partyId(request.phone, sandbox)
      if (request.operator !== 'mtn' || !UUID.test(request.id) || !payer || !validAmount(request.amount)) {
        throw new MobileMoneyError('rejected', 'invalid_input')
      }

      let result: HttpResult
      try {
        result = await call('/requesttopay', {
          method: 'POST',
          headers: {
            'x-reference-id': request.id,
            'x-callback-url': request.callbackUrl,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            amount: String(request.amount),
            currency,
            externalId: request.id,
            payer: { partyIdType: 'MSISDN', partyId: payer },
            payerMessage: request.description,
            payeeNote: request.description,
          }),
        })
      } catch (error) {
        // a MobileMoneyError here is a token failure: the request was never sent
        if (error instanceof MobileMoneyError) throw error
        throw new MobileMoneyError('uncertain', 'NETWORK', request.id)
      }
      // 409: this reference was already accepted, so a retry is idempotent
      if (ok(result) || result.status === 409) return { ref: request.id }
      if (result.status < 500) throw new MobileMoneyError('rejected', providerCode(result))
      throw new MobileMoneyError('uncertain', `HTTP_${result.status}`, request.id)
    },

    async status(ref) {
      try {
        const result = await call(`/requesttopay/${encodeURIComponent(ref)}`)
        if (result.status === 404) return { status: 'failed', reason: 'unknown', code: 'NOT_FOUND' }
        if (!ok(result)) throw new MobileMoneyError('unavailable', `HTTP_${result.status}`)
        const body = record(result.body)
        const status = str(body.status).toUpperCase()
        if (status === 'SUCCESSFUL') return completed(body.amount, str(body.currency), currency)
        if (status === 'FAILED') {
          const code = (str(body.reason) || str(record(body.reason).code)).toUpperCase()
          return { status: 'failed', reason: REASONS[code] ?? 'unknown', code: code || 'FAILED' }
        }
        if (!status) throw new MobileMoneyError('unavailable', 'BAD_RESPONSE')
        return { status: 'pending' }
      } catch (error) {
        throw unavailable(error)
      }
    },
  }
}
