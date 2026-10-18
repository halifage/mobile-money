import { completed, type HttpResult, ok, providerCode, record, send, str, unavailable, validAmount } from './http.js'
import {
  type FailureReason,
  MobileMoneyError,
  type MobileMoneyPayouts,
  type MobileMoneyProvider,
  type Operator,
  type Outcome,
} from './types.js'

export type PawaPayConfig = {
  /** Bearer token from the pawaPay dashboard; sandbox and production differ. */
  token: string
  environment: 'sandbox' | 'production'
  baseUrl?: string
}

const BASE = { sandbox: 'https://api.sandbox.pawapay.io', production: 'https://api.pawapay.io' }
const PROVIDER: Record<Operator, string> = { mtn: 'MTN_MOMO_CMR', orange: 'ORANGE_CMR' }
const CURRENCY = 'XAF'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEPOSIT_FAILURE: Record<string, FailureReason> = {
  INSUFFICIENT_BALANCE: 'insufficient_funds',
  PAYMENT_NOT_APPROVED: 'declined',
}

const invalid = () => new MobileMoneyError('rejected', 'invalid_input')

function checkIds(request: { id: string; operator: Operator; amount: number }) {
  if (!Object.hasOwn(PROVIDER, request.operator) || !validAmount(request.amount) || !UUID.test(request.id)) {
    throw invalid()
  }
}

/** `237` + 9 digits starting with 6, no `+`; anything else is invalid input. */
function msisdn(phone: string): string {
  const match = /^(?:\+?237)?(6\d{8})$/.exec(phone.replace(/[\s-]/g, ''))
  if (!match) throw invalid()
  return `237${match[1]}`
}

const failureCode = (value: Record<string, unknown>) => str(record(value.failureReason).failureCode)

/** Shared by deposits and payouts: only NOT_FOUND differs. */
function lookup(body: Record<string, unknown>, notFound: Outcome, reason: (code: string) => FailureReason): Outcome {
  if (body.status === 'NOT_FOUND') return notFound
  if (body.status !== 'FOUND') throw new MobileMoneyError('unavailable', 'BAD_RESPONSE')
  const data = record(body.data)
  switch (data.status) {
    case 'COMPLETED':
      return completed(data.amount, str(data.currency), CURRENCY)
    case 'FAILED': {
      const code = failureCode(data)
      return { status: 'failed', reason: reason(code), code }
    }
    default:
      return { status: 'pending' }
  }
}

/** pawaPay Merchant API v2, Cameroon: collections through the hosted Payment Page, and payouts. */
export function pawaPay(config: PawaPayConfig): MobileMoneyProvider & MobileMoneyPayouts {
  const base = config.baseUrl ?? BASE[config.environment]
  const headers = { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' }
  const get = async (path: string) => {
    try {
      const result = await send(`${base}${path}`, { headers })
      if (!ok(result)) throw new MobileMoneyError('unavailable', `HTTP_${result.status}`)
      return record(result.body)
    } catch (error) {
      throw unavailable(error)
    }
  }

  return {
    operators: ['mtn', 'orange'],

    async collect(request) {
      if (!request.returnUrl) throw invalid()
      checkIds(request)
      const phoneNumber = msisdn(request.phone)
      let result: HttpResult
      try {
        result = await send(`${base}/v2/paymentpage`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            depositId: request.id,
            returnUrl: request.returnUrl,
            phoneNumber,
            amountDetails: { amount: String(request.amount), currency: CURRENCY },
            country: 'CMR',
            language: 'FR',
            reason: request.description.slice(0, 50),
          }),
        })
      } catch {
        // without the page the payer cannot pay, so a lost reply moves no money
        throw new MobileMoneyError('rejected', 'NETWORK')
      }
      const redirectUrl = str(record(result.body).redirectUrl)
      if (!ok(result) || !redirectUrl) throw new MobileMoneyError('rejected', providerCode(result))
      return { ref: request.id, redirectUrl }
    },

    async status(ref) {
      const body = await get(`/v2/deposits/${encodeURIComponent(ref)}`)
      return lookup(body, { status: 'pending', code: 'NOT_FOUND' }, (code) => DEPOSIT_FAILURE[code] ?? 'unknown')
    },

    async payout(request) {
      checkIds(request)
      const phoneNumber = msisdn(request.phone)
      const message = request.message ?? ''
      let result: HttpResult
      try {
        result = await send(`${base}/v2/payouts`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            payoutId: request.id,
            amount: String(request.amount),
            currency: CURRENCY,
            recipient: { type: 'MMO', accountDetails: { phoneNumber, provider: PROVIDER[request.operator] } },
            ...(message.length >= 4 && message.length <= 22 && { customerMessage: message }),
          }),
        })
      } catch {
        throw new MobileMoneyError('uncertain', 'NETWORK', request.id)
      }
      const body = record(result.body)
      if (result.status >= 500) throw new MobileMoneyError('uncertain', `HTTP_${result.status}`, request.id)
      if (!ok(result)) throw new MobileMoneyError('rejected', providerCode(result))
      if (body.status === 'ACCEPTED' || body.status === 'DUPLICATE_IGNORED') return { ref: request.id }
      const code = failureCode(body)
      if (body.status === 'REJECTED' && code !== 'UNKNOWN_ERROR')
        throw new MobileMoneyError('rejected', code || 'REJECTED')
      // UNKNOWN_ERROR or an unexpected 2xx body: pawaPay may still process it
      throw new MobileMoneyError('uncertain', code || 'BAD_RESPONSE', request.id)
    },

    async payoutStatus(ref) {
      const body = await get(`/v2/payouts/${encodeURIComponent(ref)}`)
      // NOT_FOUND: the payout never reached pawaPay
      return lookup(body, { status: 'failed', reason: 'unknown', code: 'NOT_FOUND' }, () => 'unknown')
    },
  }
}

const CALLBACK_KINDS = [
  ['depositId', 'deposit'],
  ['payoutId', 'payout'],
  ['refundId', 'refund'],
] as const

/** Which deposit, payout or refund a callback is about. Never trust its status: re-check with status / payoutStatus. */
export function parsePawaPayCallback(rawBody: string): { kind: 'deposit' | 'payout' | 'refund'; ref: string } | null {
  let body: Record<string, unknown>
  try {
    body = record(JSON.parse(rawBody))
  } catch {
    return null
  }
  for (const [field, kind] of CALLBACK_KINDS) {
    const ref = body[field]
    if (typeof ref === 'string' && ref) return { kind, ref }
  }
  return null
}
