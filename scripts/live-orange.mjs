// Live Orange Money test. Moves real money.
// Usage: npm run build && node --env-file=.env.live scripts/live-orange.mjs 6XXXXXXXX [amount=10]
// .env.live: ORANGE_USERNAME, ORANGE_PASSWORD, ORANGE_AUTH_TOKEN, ORANGE_MERCHANT_MSISDN, ORANGE_PIN
import { randomUUID } from 'node:crypto'
import { orangeDirect } from '../dist/index.js'

const env = process.env
const [phone, amount = '10'] = process.argv.slice(2)
if (!phone) {
  console.error('usage: node --env-file=.env.live scripts/live-orange.mjs 6XXXXXXXX [amount]')
  process.exit(1)
}

const secrets = [env.ORANGE_PIN, env.ORANGE_PASSWORD, env.ORANGE_AUTH_TOKEN].filter(Boolean)
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

const provider = orangeDirect({
  username: env.ORANGE_USERNAME,
  password: env.ORANGE_PASSWORD,
  authToken: env.ORANGE_AUTH_TOKEN,
  merchantMsisdn: env.ORANGE_MERCHANT_MSISDN,
  pin: env.ORANGE_PIN,
})

let ref
try {
  ;({ ref } = await provider.collect({
    id: randomUUID(),
    operator: 'orange',
    amount: Number(amount),
    phone,
    description: 'mobile-money live test',
    callbackUrl: 'https://example.com/cb',
  }))
} catch (error) {
  console.error('collect failed', error.kind, error.code, error.ref ?? '')
  if (!error.ref) process.exit(1)
  ref = error.ref
}

console.log('ref', ref, '— approve the payment on the phone')
const deadline = Date.now() + 180_000
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 5000))
  const outcome = await provider.status(ref).catch((error) => ({ error: `${error.kind}:${error.code}` }))
  console.log(new Date().toISOString(), JSON.stringify(outcome))
  if (outcome.status === 'completed' || outcome.status === 'failed') break
}
