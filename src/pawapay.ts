import { completed, type HttpResult, ok, providerCode, record, send, str, unavailable, validAmount } from './http.js'
import { type FailureReason, MobileMoneyError, type MobileMoneyProvider, type Operator, type Outcome } from './types.js'

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

/** `237` + 9 digits starting with 6, no `+`; anything else is invalid input. */
function msisdn(phone: string): string {
  const match = /^(?:\+?237)?(6\d{8})$/.exec(phone.replace(/[\s-]/g, ''))
  if (!match) throw invalid()
  return `237${match[1]}`
}

function deposit(body: Record<string, unknown>): Outcome {
  if (body.status === 'NOT_FOUND') return { status: 'pending', code: 'NOT_FOUND' }
  if (body.status !== 'FOUND') throw new MobileMoneyError('unavailable', 'BAD_RESPONSE')
  const data = record(body.data)
  switch (data.status) {
    case 'COMPLETED':
      return completed(data.amount, str(data.currency), CURRENCY)
    case 'FAILED': {
      const code = str(record(data.failureReason).failureCode)
      return { status: 'failed', reason: DEPOSIT_FAILURE[code] ?? 'unknown', code }
    }
    default:
      return { status: 'pending' }
  }
}

/** pawaPay Merchant API v2, Cameroon: collections through the hosted Payment Page. */
export function pawaPay(config: PawaPayConfig): MobileMoneyProvider {
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
      if (!(request.operator in PROVIDER) || !validAmount(request.amount) || !UUID.test(request.id)) throw invalid()
      if (!request.returnUrl) throw invalid()
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
      return deposit(await get(`/v2/deposits/${encodeURIComponent(ref)}`))
    },
  }
}
