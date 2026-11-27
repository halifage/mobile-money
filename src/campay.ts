import { Buffer } from 'node:buffer'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { completed, type HttpResult, ok, providerCode, record, send, str, unavailable, validAmount } from './http.js'
import { MobileMoneyError, type MobileMoneyPayouts, type MobileMoneyProvider, type Outcome } from './types.js'

export type CamPayConfig = {
  /** Permanent access token of the CamPay app (dashboard → app → API keys); demo and production differ. */
  token: string
  environment: 'demo' | 'production'
  baseUrl?: string
}

const BASE = { demo: 'https://demo.campay.net/api', production: 'https://www.campay.net/api' }
const OPERATORS = ['mtn', 'orange'] as const
const CURRENCY = 'XAF'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const invalid = () => new MobileMoneyError('rejected', 'invalid_input')
const errorCode = (result: HttpResult) => str(record(result.body).error_code) || providerCode(result)

/** Validates the request; returns the payer number as `237` + 9 digits starting with 6. */
function checked(request: { id: string; operator: string; amount: number; phone: string }): string {
  const match = /^(?:\+?237)?(6\d{8})$/.exec(request.phone.replace(/[\s-]/g, ''))
  const known = (OPERATORS as readonly string[]).includes(request.operator)
  if (!known || !validAmount(request.amount) || !UUID.test(request.id) || !match) throw invalid()
  return `237${match[1]}`
}

/** CamPay (campay.net): USSD push or hosted payment link for collections, withdrawals for payouts. */
export function camPay(config: CamPayConfig): MobileMoneyProvider & MobileMoneyPayouts {
  const base = config.baseUrl ?? BASE[config.environment]
  const headers = { authorization: `Token ${config.token}`, 'content-type': 'application/json' }
  const post = (path: string, body: object) =>
    send(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })

  /** Sends a request whose reference CamPay assigns: a lost reply is uncertain without ref. */
  async function start(path: string, body: object): Promise<{ ref: string }> {
    let result: HttpResult
    try {
      result = await post(path, body)
    } catch {
      throw new MobileMoneyError('uncertain', 'NETWORK')
    }
    if (result.status >= 500) throw new MobileMoneyError('uncertain', `HTTP_${result.status}`)
    const code = errorCode(result)
    // the same id is still in flight: once it settles, re-sending returns its reference
    if (code === 'DUPLICATE_ATTEMPT') throw new MobileMoneyError('uncertain', code)
    if (!ok(result)) throw new MobileMoneyError('rejected', code)
    const ref = str(record(result.body).reference)
    if (!ref) throw new MobileMoneyError('uncertain', 'BAD_RESPONSE')
    return { ref }
  }

  /** Collections and withdrawals share one lookup by CamPay reference. */
  async function lookup(ref: string): Promise<Outcome> {
    let result: HttpResult
    try {
      result = await send(`${base}/transaction/${encodeURIComponent(ref)}/`, { headers })
    } catch (error) {
      throw unavailable(error)
    }
    // a payment link reference has no transaction until the payer acts on the page
    if (result.status === 404) return { status: 'pending', code: 'NOT_FOUND' }
    if (!ok(result)) throw new MobileMoneyError('unavailable', `HTTP_${result.status}`)
    const body = record(result.body)
    switch (str(body.status)) {
      case '':
        throw new MobileMoneyError('unavailable', 'BAD_RESPONSE')
      case 'SUCCESSFUL':
        return completed(body.amount, str(body.currency), CURRENCY)
      case 'FAILED':
        return { status: 'failed', reason: 'unknown', code: str(body.reason) }
      default:
        return { status: 'pending' }
    }
  }

  return {
    operators: OPERATORS,

    async collect(request) {
      const payment = {
        amount: String(request.amount),
        currency: CURRENCY,
        from: checked(request),
        description: request.description,
        external_reference: request.id,
      }
      // re-sending the same id returns the first reference once it settles (DUPLICATE_ATTEMPT before that)
      if (!request.returnUrl) return start('/collect/', payment)
      let result: HttpResult
      try {
        result = await post('/get_payment_link/', {
          ...payment,
          redirect_url: request.returnUrl,
          failure_redirect_url: request.returnUrl,
          payment_options: 'MOMO',
        })
      } catch {
        // without the page the payer cannot pay, so a lost reply moves no money
        throw new MobileMoneyError('rejected', 'NETWORK')
      }
      const body = record(result.body)
      const ref = str(body.reference)
      const redirectUrl = str(body.link)
      if (!ok(result) || !ref || !redirectUrl) throw new MobileMoneyError('rejected', errorCode(result))
      return { ref, redirectUrl }
    },

    status: lookup,

    async payout(request) {
      return start('/withdraw/', {
        amount: String(request.amount),
        to: checked(request),
        description: request.message ?? '',
        external_reference: request.id,
      })
    },

    payoutStatus: lookup,
  }
}

/** HS256 JWT check with the app's webhook key. */
function signedWith(token: string, key: string): boolean {
  const [header, payload, signature, ...rest] = token.split('.')
  if (!key || !header || !payload || !signature || rest.length) return false
  try {
    if (JSON.parse(Buffer.from(header, 'base64url').toString()).alg !== 'HS256') return false
  } catch {
    return false
  }
  const expected = createHmac('sha256', key).update(`${header}.${payload}`).digest()
  const actual = Buffer.from(signature, 'base64url')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

const CALLBACK_KINDS: Record<string, 'collect' | 'payout'> = { collect: 'collect', withdraw: 'payout' }

/**
 * Which collection or payout a CamPay callback is about, once its signature checks out; null otherwise.
 * fields: the GET query (`Object.fromEntries(url.searchParams)`) or the POST JSON body.
 * Never trust its status: re-check with status / payoutStatus.
 */
export function parseCamPayCallback(
  fields: Record<string, unknown>,
  webhookKey: string,
): { kind: 'collect' | 'payout'; ref: string } | null {
  const kind = CALLBACK_KINDS[str(fields.endpoint)]
  const ref = str(fields.reference)
  if (!kind || !ref || !signedWith(str(fields.signature), webhookKey)) return null
  return { kind, ref }
}
