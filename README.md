# @halifage/mobile-money

Mobile money collections for Cameroon. Talks to Orange Money and MTN MoMo directly and returns normalised
outcomes. It stores nothing and settles nothing: your app persists the `ref`, confirms every payment with
`status()`, and settles.

Node 22+, ESM, no runtime dependencies.

```bash
npm install @halifage/mobile-money
```

## Usage

```ts
import { MobileMoneyError, orangeDirect, signCallbackUrl, verifyCallback } from '@halifage/mobile-money'

// one instance per process: it caches the provider token
const orange = orangeDirect({
  username: process.env.ORANGE_USERNAME!,
  password: process.env.ORANGE_PASSWORD!,
  authToken: process.env.ORANGE_AUTH_TOKEN!,
  merchantMsisdn: process.env.ORANGE_MERCHANT_MSISDN!,
  pin: process.env.ORANGE_PIN!,
})

// start a payment
try {
  const { ref } = await orange.collect({
    id: attempt.id, // your UUID, the idempotency key
    operator: 'orange',
    amount: 500,
    phone: '+237690000000',
    description: 'Order 42',
    callbackUrl: signCallbackUrl('https://app.example/api/momo/callback', attempt.id, process.env.CALLBACK_SECRET!),
  })
  // save ref on the attempt
} catch (error) {
  if (error instanceof MobileMoneyError && error.kind === 'uncertain') {
    // may have reached the provider: save error.ref when set and keep polling status()
  }
  // rejected: nothing moved, offer a retry with a new id
}

// callback route: the body is never trusted
export async function POST(request: Request) {
  const id = verifyCallback(request, process.env.CALLBACK_SECRET!)
  if (!id) return new Response(null, { status: 401 })
  const outcome = await orange.status(refForAttempt(id))
  // settle when outcome.status === 'completed'
  return new Response(null, { status: 204 })
}
```

## Outcomes

| `status()` result | Meaning |
|---|---|
| `{ status: 'completed', amount, currency }` | Paid. Check `amount` against what you asked for. |
| `{ status: 'failed', reason, code? }` | Final. `reason`: `insufficient_funds`, `declined`, `expired`, `unknown`. |
| `{ status: 'pending' }` | Not final yet, including any status string the SDK does not know. Poll again. |

## Errors

`MobileMoneyError` has `kind`, `code` and, when known, `ref`.

| `kind` | When | What to do |
|---|---|---|
| `rejected` | `collect` refused or nothing was sent (`invalid_input`, `TOKEN_FAILED`, provider 4xx) | No money moved. Retry with a new `id`. |
| `uncertain` | `collect` may have reached the provider (timeout, network error, 5xx) | Save `ref` if set and poll `status()`. Without `ref`, reconcile by hand. |
| `unavailable` | `status()` lookup failed | Retry later. |

## Providers

| Factory | Operators | Config |
|---|---|---|
| `orangeDirect` | `orange` | `username`, `password`, `authToken` (X-AUTH-TOKEN), `merchantMsisdn`, `pin`, `baseUrl?` (default `https://api-s1.orange.cm`) |
| `orangeWebPay` | `orange` | `clientId`, `clientSecret`, `merchantKey`, `environment` (`dev` sandbox in test currency `OUV`, or `cm`), `baseUrl?` (default `https://api.orange.com`) |
| `mtnDirect` | `mtn` | `subscriptionKey`, `apiUser`, `apiKey`, `environment` (`sandbox` or `mtncameroon`), `baseUrl?` |

- Orange wants a 9-digit local payer number; the SDK strips `+237`.
- `orangeWebPay` is redirect-based: pass `returnUrl`, then send the payer to the `redirectUrl` that `collect` returns,
  where they confirm with an Orange Money OTP. Its `ref` is opaque base64url (it carries the pay token, order id and
  amount the status call needs). No merchant PIN is involved. A lost `collect` reply is `rejected`: without the
  payment page the payer cannot pay.
- MTN requires `id` to be a UUID and uses it as the `ref`. Sandbox works in EUR and accepts MTN's test numbers.
- MTN `status()` returns `failed` with code `NOT_FOUND` for a payment MTN never received. After an `uncertain`
  collect, wait a few minutes before treating `NOT_FOUND` as final.

Your app picks the provider per operator. To add an aggregator (Paynote, pawaPay), implement
`MobileMoneyProvider` and run `describeProviderContract` from `test/contract.ts` against it.

## Observed provider behaviour

- Orange (live, 2026-10-14): token, `mp/init` and TLS verification work as documented. `mp/pay` rejects an
  `orderId` over 20 characters with HTTP 422, so the SDK sends `id` without dashes, cut to 20. Status spellings:
  documented `PENDING` and `SUCCESSFULL`, plus `FAILED` seen in `data.status`. A wrong merchant PIN returns HTTP 417
  with `inittxnstatus` `00036` and **blocks the merchant account** (unblock with `#150*1#` from the merchant SIM), so
  check the PIN before going live. A completed (approved) payment has not been observed yet.

- Orange Web Payment: sandbox path `dev/v1` with currency `OUV`, production `cm/v1` with `XAF` (per open-source
  integrations; official reference is gated). Token path (`/oauth/v3/token`), `order_id` limits and status spellings
  are unconfirmed until a sandbox run.

## Development

```bash
npm test          # vitest
npm run type-check
npm run lint      # biome
npm run build     # dist/
npm run smoke     # pack, install, import
```

Live Orange test (moves real money): copy `.env.example` to `.env.live` (all `.env*` files except the example are
gitignored), fill in the Orange credentials, then:

```bash
cp .env.example .env.live
npm run build && node --env-file=.env.live scripts/live-orange.mjs 6XXXXXXXX 10
```

It prints every raw provider response with secrets redacted and polls `status()` for up to 3 minutes.

Orange Web Payment sandbox (no real money with `ORANGE_WEBPAY_ENVIRONMENT=dev`): fill the `ORANGE_WEBPAY_*` values in
`.env.live`, then open the printed payment URL and pay:

```bash
npm run build && node --env-file=.env.live scripts/live-orange-webpay.mjs 10
```
