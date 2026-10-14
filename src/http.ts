import { MobileMoneyError, type Outcome } from './types.js'

const TIMEOUT_MS = 20_000

export type HttpResult = { status: number; body: unknown }

/** fetch with a timeout and no redirects; non-JSON bodies become null. Throws on network error or timeout. */
export async function send(url: string, init: RequestInit = {}): Promise<HttpResult> {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) })
  const text = await response.text()
  try {
    return { status: response.status, body: text ? JSON.parse(text) : null }
  } catch {
    return { status: response.status, body: null }
  }
}

export const ok = (result: HttpResult) => result.status >= 200 && result.status < 300

export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

export type Tokens = { get(): Promise<string>; clear(): void }

/** Bearer token cached until expires_in − 60 s; concurrent callers share one fetch. */
export function tokenCache(fetchToken: () => Promise<HttpResult>): Tokens {
  let cached: { token: string; expiresAt: number } | null = null
  let inflight: Promise<string> | null = null

  const load = async () => {
    const result = await fetchToken().catch(() => {
      throw new MobileMoneyError('rejected', 'TOKEN_FAILED')
    })
    const body = record(result.body)
    const token = str(body.access_token)
    const expiresIn = Number(body.expires_in)
    if (!ok(result) || !token || !Number.isFinite(expiresIn)) throw new MobileMoneyError('rejected', 'TOKEN_FAILED')
    cached = { token, expiresAt: Date.now() + Math.max(expiresIn - 60, 0) * 1000 }
    return token
  }

  return {
    get() {
      if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.token)
      inflight ??= load().finally(() => {
        inflight = null
      })
      return inflight
    },
    clear() {
      cached = null
    },
  }
}

/** Calls with a bearer token; on 401 clears the token and retries once. */
export async function authorized(tokens: Tokens, call: (token: string) => Promise<HttpResult>): Promise<HttpResult> {
  const first = await call(await tokens.get())
  if (first.status !== 401) return first
  tokens.clear()
  return call(await tokens.get())
}

export const validAmount = (amount: number) => Number.isSafeInteger(amount) && amount > 0

export function providerCode(result: HttpResult): string {
  const body = record(result.body)
  return (str(body.code) || str(body.message)).slice(0, 64) || `HTTP_${result.status}`
}

/** `completed` only for a positive integer amount in the expected currency. */
export function completed(amount: unknown, currency: string, expected: string): Outcome {
  const value = Number(str(amount))
  if (!Number.isSafeInteger(value) || value <= 0 || currency !== expected) {
    throw new MobileMoneyError('unavailable', 'BAD_AMOUNT')
  }
  return { status: 'completed', amount: value, currency }
}

export function unavailable(error: unknown): MobileMoneyError {
  return new MobileMoneyError('unavailable', error instanceof MobileMoneyError ? error.code : 'NETWORK')
}
