// Live MTN MoMo sandbox test (EUR, no real money).
// Usage: npm run build && node --env-file=.env.live scripts/live-mtn.mjs [phone=237670000000] [amount=10]
// Sandbox numbers (observed 2026-11-03): 237670000000 successful, 46733123451 rejected, 46733123454 pending;
// 46733123450/461 INTERNAL_PROCESSING_ERROR, 46733123455 PAYER_NOT_FOUND, 46733123460 INVALID_CURRENCY.
// .env.live: MTN_SUBSCRIPTION_KEY, MTN_API_USER, MTN_API_KEY (create the last two with mtn-sandbox-user.mjs)
import { randomUUID } from 'node:crypto'
import { mtnDirect } from '../dist/index.js'

const env = process.env
const [phone = '237670000000', amount = '10'] = process.argv.slice(2)
const secrets = [env.MTN_SUBSCRIPTION_KEY, env.MTN_API_KEY].filter(Boolean)
const redact = (text) =>
  secrets
    .reduce((out, secret) => out.replaceAll(secret, '***'), text)
    .replace(/"access_token"\s*:\s*"[^"]+"/g, '"access_token":"***"')

// log every raw provider response, redacted, to record real status spellings
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  const response = await realFetch(url, init)
  const body = await response.clone().text()
  console.log(`${init?.method ?? 'GET'} ${new URL(url).pathname} → ${response.status} ${redact(body)}`)
  return response
}

const provider = mtnDirect({
  subscriptionKey: env.MTN_SUBSCRIPTION_KEY,
  apiUser: env.MTN_API_USER,
  apiKey: env.MTN_API_KEY,
  environment: 'sandbox',
})

let ref
try {
  ;({ ref } = await provider.collect({
    id: randomUUID(),
    operator: 'mtn',
    amount: Number(amount),
    phone,
    description: 'mobile-money sandbox test',
    callbackUrl: 'https://example.com/cb',
  }))
} catch (error) {
  console.error('collect failed', error.kind, error.code, error.ref ?? '')
  if (!error.ref) process.exit(1)
  ref = error.ref
}

console.log('ref', ref)
const deadline = Date.now() + 60_000
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const outcome = await provider.status(ref).catch((error) => ({ error: `${error.kind}:${error.code}` }))
  console.log(new Date().toISOString(), JSON.stringify(outcome))
  if (outcome.status === 'completed' || outcome.status === 'failed') break
}
