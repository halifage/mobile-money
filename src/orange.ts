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
import { MobileMoneyError, type MobileMoneyProvider, type Outcome } from './types.js'

export type OrangeDirectConfig = {
  username: string
  password: string
  /** X-AUTH-TOKEN issued with the merchant account */
  authToken: string
  /** channelUserMsisdn: the merchant's number */
  merchantMsisdn: string
  pin: string
  baseUrl?: string
}

const API = '/omcoreapis/1.0.2/mp'

/** 9-digit local number (Orange refuses the country code), or null. */
function localPhone(phone: string): string | null {
  const digits = phone.replace(/[\s-]/g, '').replace(/^\+?237/, '')
  return /^6\d{8}$/.test(digits) ? digits : null
}

function outcome(data: Record<string, unknown>): Outcome {
  switch (str(data.status).toUpperCase()) {
    case 'SUCCESSFULL':
    case 'SUCCESSFUL':
    case 'SUCCESS':
      return completed(data.amount, 'XAF', 'XAF')
    case 'FAILED':
      return { status: 'failed', reason: 'unknown', code: 'FAILED' }
    case 'CANCELLED':
      return { status: 'failed', reason: 'declined', code: 'CANCELLED' }
    case 'EXPIRED':
      return { status: 'failed', reason: 'expired', code: 'EXPIRED' }
    case '':
      throw new MobileMoneyError('unavailable', 'BAD_RESPONSE')
    default:
      return { status: 'pending' }
  }
}

/** Orange Money Cameroon local API (api-s1.orange.cm). */
export function orangeDirect(config: OrangeDirectConfig): MobileMoneyProvider {
  const base = config.baseUrl ?? 'https://api-s1.orange.cm'
  const basic = Buffer.from(`${config.username}:${config.password}`).toString('base64')
  const tokens = tokenCache(() =>
    send(`${base}/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    }),
  )
  const call = (path: string, init: RequestInit = {}) =>
    authorized(tokens, (token) =>
      send(`${base}${API}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          'x-auth-token': config.authToken,
          'content-type': 'application/json',
        },
      }),
    )

  return {
    operators: ['orange'],

    async collect(request) {
      const subscriberMsisdn = localPhone(request.phone)
      if (request.operator !== 'orange' || !subscriberMsisdn || !validAmount(request.amount)) {
        throw new MobileMoneyError('rejected', 'invalid_input')
      }

      // init only reserves a payToken, so any failure here means nothing was charged
      const init = await call('/init', { method: 'POST' }).catch((error: unknown) => {
        throw error instanceof MobileMoneyError ? error : new MobileMoneyError('rejected', 'NETWORK')
      })
      const payToken = str(record(record(init.body).data).payToken)
      if (!ok(init) || !payToken) throw new MobileMoneyError('rejected', providerCode(init))

      let pay: HttpResult
      try {
        pay = await call('/pay', {
          method: 'POST',
          body: JSON.stringify({
            notifUrl: request.callbackUrl,
            channelUserMsisdn: config.merchantMsisdn,
            amount: String(request.amount),
            subscriberMsisdn,
            pin: config.pin,
            // Orange caps orderId at 20 chars; payToken is the ref, so a shortened id is only a label
            orderId: request.id.replace(/-/g, '').slice(0, 20),
            description: request.description,
            payToken,
          }),
        })
      } catch (error) {
        // a MobileMoneyError here is a token failure: pay was never sent
        if (error instanceof MobileMoneyError) throw error
        throw new MobileMoneyError('uncertain', 'NETWORK', payToken)
      }
      if (ok(pay)) return { ref: payToken }
      if (pay.status < 500) throw new MobileMoneyError('rejected', providerCode(pay))
      throw new MobileMoneyError('uncertain', `HTTP_${pay.status}`, payToken)
    },

    async status(ref) {
      try {
        const result = await call(`/paymentstatus/${encodeURIComponent(ref)}`)
        if (!ok(result)) throw new MobileMoneyError('unavailable', `HTTP_${result.status}`)
        return outcome(record(record(result.body).data))
      } catch (error) {
        throw unavailable(error)
      }
    },
  }
}
