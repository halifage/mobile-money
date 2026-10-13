# Mobile money SDK (`@halifage/mobile-money`)

Status: design approved in chat 2026-10-13. Awaiting written-spec review.

## Why

Koupon and CamTour both collect mobile money in Cameroon. Each app should not re-implement Orange and MTN. This
package is a pure abstraction over mobile-money providers: it starts collections, reports normalised outcomes and
helps authenticate callbacks. It never stores payments and never settles orders; persistence, idempotency policy,
settlement and reconciliation stay in each app.

Supersedes camtour draft PR #215 (`packages/mobile-money`), which coupled the SDK to storage (`PaymentStorage`) and
settlement (`createWebhookHandler(operator, onPayment)`).

## Scope

- Collections only, Cameroon, XAF (MTN sandbox uses EUR).
- v1 adapters: **Orange direct** (live-tested with prod creds) and **MTN direct** (mocked tests only until creds exist).
- Aggregators (Paynote, pawaPay) are not built; the interface must admit them without public API changes.
- Out of scope: refunds, payouts, migrating Koupon or CamTour (separate specs).

## Public API

```ts
export type Operator = 'mtn' | 'orange'

export interface CollectRequest {
  id: string          // app's attempt id, idempotency key, UUID
  operator: Operator
  amount: number      // whole units, positive integer
  phone: string       // E.164 or local; adapter normalises
  description: string
  callbackUrl: string // passed through as is; sign it with signCallbackUrl
}

export type Outcome =
  | { status: 'completed'; amount: number; currency: string }
  | { status: 'failed'; reason: 'insufficient_funds' | 'declined' | 'expired' | 'unknown'; code?: string }
  | { status: 'pending' }

export interface MobileMoneyProvider {
  readonly operators: readonly Operator[]
  collect(request: CollectRequest): Promise<{ ref: string }>
  status(ref: string): Promise<Outcome>
}

export class MobileMoneyError extends Error {
  readonly kind: 'rejected' | 'uncertain' | 'unavailable'
  readonly code: string
  readonly ref?: string
}

export function orangeDirect(config: OrangeDirectConfig): MobileMoneyProvider
export function mtnDirect(config: MtnDirectConfig): MobileMoneyProvider
export function signCallbackUrl(url: string, id: string, secret: string): string
export function verifyCallback(request: Request, secret: string): string | null
```

### Semantics

- `ref` is opaque. The app persists it and passes it back to `status()`.
- Error kinds:
  - `rejected`: the provider refused or nothing was sent. No money moves. The app may retry with a new `id`.
  - `uncertain`: the request may have reached the provider. `ref` is set whenever the adapter knows it, so the app
    persists it and polls `status()`; without `ref` the app reconciles by hand.
  - `unavailable`: a `status()` lookup failed (5xx, timeout, unparsable body). Retry later.
- Unknown provider status strings map to `pending`, never to `failed` or `completed`.
- `completed` requires a positive safe-integer amount and the adapter's expected currency, else `unavailable`.
- A 401 clears the cached token and the request is retried once.
- Token cache per adapter instance, valid until `expires_in − 60 s`, with one shared in-flight token fetch.
- HTTP: native `fetch`, 20 s timeout (`AbortSignal.timeout`), `redirect: 'error'`.
- Secrets (passwords, PIN, API keys, tokens) never appear in error messages.
- Each app routes operators to providers itself (Koupon already does via `PAYMENT_ROUTE_<NETWORK>`). No router in
  the SDK.

### Callbacks

Neither Orange nor MTN signs callbacks, and their payloads are undocumented or untrusted. So:

- `signCallbackUrl(url, id, secret)` returns `url` with `id=<id>&sig=<hex HMAC-SHA256(id, secret)>` appended.
- `verifyCallback(request, secret)` reads only the query string and returns `id` when `sig` matches
  (`timingSafeEqual`), else `null`. It never reads the body.
- The app then loads its attempt by `id` and calls `status(ref)` before acting. A leaked callback URL can at most
  trigger a status lookup.

## Orange direct adapter

Source: https://www.y-note.cm/integration-de-lapi-local-orange-money/ (Orange Cameroon local API).

Config: `orangeDirect({ username, password, authToken, merchantMsisdn, pin, baseUrl = 'https://api-s1.orange.cm' })`,
`operators: ['orange']`, currency `XAF`.

- Token: `POST /token`, `Authorization: Basic base64(username:password)`, form body `grant_type=client_credentials`
  → `{ access_token, expires_in }`.
- All API calls send `Authorization: Bearer <token>` and `X-AUTH-TOKEN: <authToken>`.

### collect

1. Validate before any network call: phone stripped of `+237`/`237` must match `^6\d{8}$`; amount a positive safe
   integer. Else `rejected/invalid_input`.
2. `POST /omcoreapis/1.0.2/mp/init` → `data.payToken`. Any failure → `rejected` (nothing charged yet).
3. `POST /omcoreapis/1.0.2/mp/pay` with JSON
   `{ notifUrl: callbackUrl, channelUserMsisdn: merchantMsisdn, amount: String(amount), subscriberMsisdn, pin,
   orderId: id, description, payToken }`.
   - 2xx → `{ ref: payToken }`.
   - 4xx → `rejected`, code from response `message` (truncated to 64 chars).
   - 5xx, timeout, network error → `uncertain` with `ref: payToken`.

### status

`GET /omcoreapis/1.0.2/mp/paymentstatus/{ref}`, read `data.status` upper-cased:

| Orange | Outcome |
|---|---|
| `SUCCESSFULL`, `SUCCESSFUL`, `SUCCESS` | `completed`, amount from `data.amount`, currency `XAF` |
| `FAILED` | `failed/unknown`, `code: 'FAILED'` |
| `CANCELLED` | `failed/declined` |
| `EXPIRED` | `failed/expired` |
| anything else | `pending` |

Non-2xx or unparsable body → `unavailable`.

### TLS

Orange's examples use `curl -k`. The adapter keeps certificate verification on. If the live test fails on the
certificate, stop and report; never disable verification.

## MTN direct adapter

Built from MTN MoMo Collections docs and camtour PR #215, fixing its review findings (no token clear on 401,
unknown status thrown instead of pending, FAILED reason dropped).

Config: `mtnDirect({ subscriptionKey, apiUser, apiKey, environment, baseUrl? })`, `operators: ['mtn']`.
`environment` is `'sandbox'` (base `https://sandbox.momodeveloper.mtn.com`, currency `EUR`) or `'mtncameroon'`
(base `https://proxy.momoapi.mtn.com`, currency `XAF`).

- Token: `POST /collection/token/`, Basic `apiUser:apiKey`, header `Ocp-Apim-Subscription-Key`.
- All API calls send `Authorization: Bearer`, `Ocp-Apim-Subscription-Key`, `X-Target-Environment: <environment>`.

### collect

- Phone normalised to `2376XXXXXXXX`; sandbox test MSISDNs accepted only when `environment === 'sandbox'`. `id` must
  be a UUID. Invalid → `rejected/invalid_input`.
- `POST /collection/v1_0/requesttopay`, headers `X-Reference-Id: id`, `X-Callback-Url: callbackUrl`, body
  `{ amount: String(amount), currency, externalId: id, payer: { partyIdType: 'MSISDN', partyId }, payerMessage:
  description, payeeNote: description }`.
  - 202 → `{ ref: id }`.
  - 409 (reference already used) → `{ ref: id }` (idempotent retry).
  - Other 4xx → `rejected`.
  - 5xx, timeout, network error → `uncertain` with `ref: id`.

### status

`GET /collection/v1_0/requesttopay/{ref}`:

| MTN | Outcome |
|---|---|
| `SUCCESSFUL` | `completed` (amount and currency checked) |
| `FAILED`, reason `NOT_ENOUGH_FUNDS` | `failed/insufficient_funds` |
| `FAILED`, reason `APPROVAL_REJECTED` | `failed/declined` |
| `FAILED`, reason `EXPIRED` | `failed/expired` |
| `FAILED`, other reason | `failed/unknown`, `code: <reason>` |
| other status | `pending` |
| HTTP 404 | `failed/unknown`, `code: 'NOT_FOUND'` |

5xx or unparsable body → `unavailable`. README warns apps to wait a few minutes after an `uncertain` collect before
treating `NOT_FOUND` as final.

## Files

```
src/index.ts        public exports
src/types.ts        Operator, CollectRequest, Outcome, MobileMoneyProvider, MobileMoneyError
src/http.ts         fetch with timeout, token cache with 401 retry
src/callback.ts     signCallbackUrl, verifyCallback
src/orange.ts       orangeDirect
src/mtn.ts          mtnDirect
test/contract.ts    shared provider contract
test/*.test.ts      orange, mtn, callback
test/package-smoke.mjs
scripts/live-orange.mjs
```

## Testing

- Shared contract (`describeProviderContract(makeProvider, fixtures)`), run against every adapter with mocked
  `fetch`: collect → ref; status mapping for completed, failed and pending; `rejected` vs `uncertain` with ref;
  unknown status → pending; 401 → token refresh then retry; concurrent calls share one token fetch. Future aggregator
  adapters run the same contract.
- Orange cases: init failure → `rejected`; pay timeout → `uncertain` carrying payToken; phone normalisation; PIN
  absent from error messages.
- MTN cases: 409 idempotent; FAILED reasons mapped; 404 → `NOT_FOUND`; sandbox MSISDN refused in production.
- Callback: valid signature verifies; tampered `id` or `sig` returns `null`.
- Package smoke: `npm pack`, install the tarball in a temp dir, import and check exports.
- Live Orange (`scripts/live-orange.mjs`), run by the user in their own terminal with creds in shell env: collect
  10 XAF from a given phone with `callbackUrl` `https://example.com/cb`, poll `status()` every 5 s for up to 3 min,
  print raw status responses with PIN and tokens redacted. Record observed status spellings and minimum amount in the
  README.

## Repo and release

- `halifage/mobile-money`, public. Branches `main` and `dev`; PRs target `dev`.
- TypeScript → `dist/` via `tsc`, ESM, `engines.node >= 22`, zero runtime dependencies.
- Dev dependencies: `typescript`, `vitest`, `@types/node`, `@biomejs/biome`.
- Scripts: `test`, `type-check`, `lint`, `build`. GitHub Actions runs all four on PRs.
- Publish `@halifage/mobile-money@0.1.0` to public npm; the user runs `npm publish --access public` under their own
  npm login.

## Risks

- Orange status spellings beyond `PENDING`/`SUCCESSFULL` are undocumented. Unknowns stay `pending`; the live test
  records the real ones.
- Orange callback payload is undocumented. Irrelevant by design: callbacks only carry our signed `id`.
- MTN adapter is untested against a real environment until creds exist.
- The live Orange test moves real money (10 XAF).
