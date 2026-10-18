// Live pawaPay test. PAWAPAY_ENVIRONMENT=sandbox (default); production moves real money.
// Usage: npm run build && node --env-file=.env.live scripts/live-pawapay.mjs <mode>
//   collect <phone> <amount>   prints the payment page URL, polls status every 5 s for 2 min
//   payout <phone> <amount>    sends a payout, polls payoutStatus every 5 s for 2 min
//   listen <port>              logs raw callback bodies and what parsePawaPayCallback makes of them
// .env.live: PAWAPAY_TOKEN, PAWAPAY_ENVIRONMENT
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { parsePawaPayCallback, pawaPay } from '../dist/index.js'

const env = process.env
const [mode, arg1, arg2 = '100'] = process.argv.slice(2)
const redact = (text) => (env.PAWAPAY_TOKEN ? text.replaceAll(env.PAWAPAY_TOKEN, '***') : text)

if (mode === 'listen') {
  createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      console.log(new Date().toISOString(), req.method, req.url, body, '→', JSON.stringify(parsePawaPayCallback(body)))
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
  const provider = pawaPay({ token: env.PAWAPAY_TOKEN ?? '', environment: env.PAWAPAY_ENVIRONMENT ?? 'sandbox' })
  const phone = arg1 ?? ''
  const operator = /^(\+?237)?6(5[5-9]|9)/.test(phone.replace(/\s/g, '')) ? 'orange' : 'mtn'
  const id = randomUUID()
  let check
  try {
    if (mode === 'collect') {
      const started = await provider.collect({
        id,
        operator,
        amount: Number(arg2),
        phone,
        description: 'mobile-money live test',
        callbackUrl: 'https://example.com/cb',
        returnUrl: 'https://example.com/return',
      })
      console.log('\nOpen and pay:', started.redirectUrl, '\n')
      check = () => provider.status(started.ref)
    } else if (mode === 'payout') {
      const { ref } = await provider.payout({ id, operator, amount: Number(arg2), phone, message: 'Ecolage test' })
      check = () => provider.payoutStatus(ref)
    } else {
      console.error('mode: collect | payout | listen')
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
