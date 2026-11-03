// Creates an MTN MoMo sandbox API user and key (production users come from the MTN partner portal).
// Usage: node --env-file=.env.live scripts/mtn-sandbox-user.mjs >> .env.live
// .env.live: MTN_SUBSCRIPTION_KEY (Collections primary key). Prints MTN_API_USER and MTN_API_KEY lines on stdout.
import { randomUUID } from 'node:crypto'

const key = process.env.MTN_SUBSCRIPTION_KEY
if (!key) {
  console.error('MTN_SUBSCRIPTION_KEY missing')
  process.exit(1)
}

const base = 'https://sandbox.momodeveloper.mtn.com/v1_0/apiuser'
const user = randomUUID()
const headers = { 'ocp-apim-subscription-key': key, 'content-type': 'application/json' }

const created = await fetch(base, {
  method: 'POST',
  headers: { ...headers, 'x-reference-id': user },
  body: JSON.stringify({ providerCallbackHost: 'example.com' }),
})
if (created.status !== 201) {
  console.error('create user failed', created.status, await created.text())
  process.exit(1)
}

const keyed = await fetch(`${base}/${user}/apikey`, { method: 'POST', headers })
if (keyed.status !== 201) {
  console.error('create key failed', keyed.status, await keyed.text())
  process.exit(1)
}
const { apiKey } = await keyed.json()

console.log(`MTN_API_USER=${user}\nMTN_API_KEY=${apiKey}`)
console.error('sandbox api user created')
