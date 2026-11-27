// Live CamPay test. CAMPAY_ENVIRONMENT=demo (default, test numbers only); production moves real money.
// Usage: npm run build && node --env-file=.env.live scripts/live-campay.mjs <mode>
//   collect <phone> <amount>   USSD push, re-sends the same id once (idempotency), polls status every 5 s for 2 min
//   page <phone> <amount>      prints the hosted payment link, polls status every 5 s for 2 min
//   payout <phone> <amount>    sends a withdrawal, polls payoutStatus every 5 s for 2 min
//   listen <port>              logs raw callbacks (GET query or POST body) and what parseCamPayCallback makes of them
// Demo numbers: 237677777777 MTN ok, 237677777770 MTN fail, 237699999999 Orange ok, 237699999990 Orange fail.
// .env.live: CAMPAY_TOKEN, CAMPAY_WEBHOOK_KEY, CAMPAY_ENVIRONMENT
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { camPay, parseCamPayCallback } from '../dist/index.js'

const env = process.env
const [mode, arg1, arg2 = '100'] = process.argv.slice(2)
const redact = (text) => (env.CAMPAY_TOKEN ? text.replaceAll(env.CAMPAY_TOKEN, '***') : text)

if (mode === 'listen') {
  createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      let fields = Object.fromEntries(new URL(req.url, 'http://x').searchParams)
      try {
        if (body) fields = JSON.parse(body)
      } catch {}
      const parsed = parseCamPayCallback(fields, env.CAMPAY_WEBHOOK_KEY ?? '')
      console.log(new Date().toISOString(), req.method, req.url, body, '→', JSON.stringify(parsed))
      res.end('ok')
    })
  }).listen(Number(arg1 ?? 8787), () => console.log(`listening on ${arg1 ?? 8787}`))
} else {
  // log every raw provider response, redacted, to record real field names and status spellings
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const response = await realFetch(url, init)
    const body = await response.clone().text()
    console.log(`${init?.method ?? 'GET'} ${new URL(url).pathname} ${redact(String(init?.body ?? ''))}`)
    console.log(`  → ${response.status} ${redact(body)}`)
    return response
  }
  const provider = camPay({ token: env.CAMPAY_TOKEN ?? '', environment: env.CAMPAY_ENVIRONMENT ?? 'demo' })
  const phone = arg1 ?? ''
  const operator = /^(\+?237)?6(5[5-9]|9)/.test(phone.replace(/\s/g, '')) ? 'orange' : 'mtn'
  const request = {
    id: randomUUID(),
    operator,
    amount: Number(arg2),
    phone,
    description: 'mobile-money live test',
    callbackUrl: 'https://example.com/cb',
  }
  let check
  try {
    if (mode === 'collect') {
      const { ref } = await provider.collect(request)
      console.log('\nsame id again:')
      await provider.collect(request).then(
        (again) => console.log('  →', JSON.stringify(again)),
        (error) => console.log('  →', error.kind, error.code),
      )
      check = () => provider.status(ref)
    } else if (mode === 'page') {
      const started = await provider.collect({ ...request, returnUrl: 'https://example.com/return' })
      console.log('\nOpen and pay:', started.redirectUrl, '\n')
      check = () => provider.status(started.ref)
    } else if (mode === 'payout') {
      const { ref } = await provider.payout({ ...request, message: 'Ecolage test' })
      check = () => provider.payoutStatus(ref)
    } else {
      console.error('mode: collect | page | payout | listen')
      process.exit(1)
    }
  } catch (error) {
    console.error(`${mode} failed`, error.kind, error.code, error.ref ?? '')
    process.exit(1)
  }
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000))
    const outcome = await check().catch((error) => ({ error: `${error.kind}:${error.code}` }))
    console.log(new Date().toISOString(), JSON.stringify(outcome))
    if (outcome.status === 'completed' || outcome.status === 'failed') break
  }
}
