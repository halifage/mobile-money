// Live Orange Web Payment test. ORANGE_WEBPAY_ENVIRONMENT=dev (default) is the sandbox; cm moves real money.
// Usage: npm run build && node --env-file=.env.live scripts/live-orange-webpay.mjs [amount=10]
// .env.live: ORANGE_WEBPAY_CLIENT_ID, ORANGE_WEBPAY_CLIENT_SECRET, ORANGE_WEBPAY_MERCHANT_KEY, ORANGE_WEBPAY_ENVIRONMENT
import { randomUUID } from 'node:crypto'
import { orangeWebPay } from '../dist/index.js'

const env = process.env
const [amount = '10'] = process.argv.slice(2)
const secrets = [env.ORANGE_WEBPAY_CLIENT_SECRET, env.ORANGE_WEBPAY_MERCHANT_KEY].filter(Boolean)
const redact = (text) =>
  secrets
    .reduce((out, secret) => out.replaceAll(secret, '***'), text)
    .replace(/"(access_token|notif_token)"\s*:\s*"[^"]+"/g, '"$1":"***"')

// log every raw provider response, redacted, to record real status spellings
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  const response = await realFetch(url, init)
  const body = await response.clone().text()
  console.log(`${init?.method ?? 'GET'} ${new URL(url).pathname} → ${response.status} ${redact(body)}`)
  return response
}

const provider = orangeWebPay({
  clientId: env.ORANGE_WEBPAY_CLIENT_ID,
  clientSecret: env.ORANGE_WEBPAY_CLIENT_SECRET,
  merchantKey: env.ORANGE_WEBPAY_MERCHANT_KEY,
  environment: env.ORANGE_WEBPAY_ENVIRONMENT ?? 'dev',
})

let started
try {
  started = await provider.collect({
    id: randomUUID().replaceAll('-', '').slice(0, 20),
    operator: 'orange',
    amount: Number(amount),
    phone: '',
    description: 'mobile-money live test',
    callbackUrl: 'https://example.com/cb',
    returnUrl: 'https://example.com/return',
  })
} catch (error) {
  console.error('collect failed', error.kind, error.code)
  process.exit(1)
}

console.log('\nOpen and pay:', started.redirectUrl, '\n')
const deadline = Date.now() + 300_000
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 5000))
  const outcome = await provider.status(started.ref).catch((error) => ({ error: `${error.kind}:${error.code}` }))
  console.log(new Date().toISOString(), JSON.stringify(outcome))
  if (outcome.status === 'completed' || outcome.status === 'failed') break
}
