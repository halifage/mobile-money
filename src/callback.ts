import { Buffer } from 'node:buffer'
import { createHmac, timingSafeEqual } from 'node:crypto'

function sign(id: string, secret: string): string {
  if (!secret) throw new TypeError('callback secret is empty')
  return createHmac('sha256', secret).update(id).digest('hex')
}

/** Appends id and an HMAC of it, so callbacks can be authenticated without trusting their body. */
export function signCallbackUrl(url: string, id: string, secret: string): string {
  const signed = new URL(url)
  signed.searchParams.set('id', id)
  signed.searchParams.set('sig', sign(id, secret))
  return signed.toString()
}

/** Returns the signed id, or null. Reads only the query string, never the body. */
export function verifyCallback(request: Request, secret: string): string | null {
  const params = new URL(request.url).searchParams
  const id = params.get('id')
  const expected = Buffer.from(sign(id ?? '', secret), 'hex')
  const actual = Buffer.from(params.get('sig') ?? '', 'hex')
  return id && actual.length === expected.length && timingSafeEqual(actual, expected) ? id : null
}
