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

export type OrangeWebPayConfig = {
  clientId: string
  clientSecret: string
  merchantKey: string
  /** dev: sandbox, test currency OUV; cm: Cameroon production, XAF */
  environment: 'dev' | 'cm'
  baseUrl?: string
}

const CURRENCY = { dev: 'OUV', cm: 'XAF' }

/** The status call needs all three, so the opaque ref carries them. */
type Ref = { payToken: string; orderId: string; amount: number }

const encodeRef = (ref: Ref) => Buffer.from(JSON.stringify(ref)).toString('base64url')

function decodeRef(ref: string): Ref {
  let value: Record<string, unknown>
  try {
    value = record(JSON.parse(Buffer.from(ref, 'base64url').toString('utf8')))
  } catch {
    value = {}
  }
  const payToken = str(value.payToken)
  const orderId = str(value.orderId)
  const amount = Number(value.amount)
  if (!payToken || !orderId || !validAmount(amount)) throw new MobileMoneyError('unavailable', 'BAD_REF')
  return { payToken, orderId, amount }
}

function outcome(body: Record<string, unknown>, ref: Ref, currency: string): Outcome {
  switch (str(body.status).toUpperCase()) {
    case 'SUCCESS':
    case 'SUCCESSFULL':
    case 'SUCCESSFUL':
      // ponytail: status may omit amount/currency; fall back to what was requested for this pay_token
      return completed(body.amount ?? ref.amount, str(body.currency) || currency, currency)
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

/** Orange Money Web Payment (api.orange.com): the payer completes the payment on Orange's page. */
export function orangeWebPay(config: OrangeWebPayConfig): MobileMoneyProvider {
  const base = config.baseUrl ?? 'https://api.orange.com'
  const api = `${base}/orange-money-webpay/${config.environment}/v1`
  const currency = CURRENCY[config.environment]
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
  const tokens = tokenCache(() =>
    send(`${base}/oauth/v3/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    }),
  )
  const post = (path: string, body: unknown) =>
    authorized(tokens, (token) =>
      send(`${api}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      }),
    )

  return {
    operators: ['orange'],

    async collect(request) {
      if (request.operator !== 'orange' || !validAmount(request.amount) || !request.returnUrl) {
        throw new MobileMoneyError('rejected', 'invalid_input')
      }
      let result: HttpResult
      try {
        result = await post('/webpayment', {
          merchant_key: config.merchantKey,
          currency,
          order_id: request.id,
          amount: request.amount,
          return_url: request.returnUrl,
          cancel_url: request.returnUrl,
          notif_url: request.callbackUrl,
          lang: 'fr',
          reference: request.description,
        })
      } catch (error) {
        // without a payment_url the payer cannot pay, so a lost reply moves no money
        throw error instanceof MobileMoneyError ? error : new MobileMoneyError('rejected', 'NETWORK')
      }
      const body = record(result.body)
      const payToken = str(body.pay_token)
      const redirectUrl = str(body.payment_url)
      if (!ok(result) || !payToken || !redirectUrl) throw new MobileMoneyError('rejected', providerCode(result))
      return { ref: encodeRef({ payToken, orderId: request.id, amount: request.amount }), redirectUrl }
    },

    async status(ref) {
      try {
        const { payToken, orderId, amount } = decodeRef(ref)
        const result = await post('/transactionstatus', { order_id: orderId, amount, pay_token: payToken })
        if (!ok(result)) throw new MobileMoneyError('unavailable', `HTTP_${result.status}`)
        return outcome(record(result.body), { payToken, orderId, amount }, currency)
      } catch (error) {
        throw unavailable(error)
      }
    },
  }
}
