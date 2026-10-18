# pawaPay provider: collections and payouts

Date: 2026-10-18. Status: design, for approval.
Companion: Écolage `docs/superpowers/specs/2026-10-18-pawapay-payouts-design.md` (the first consumer).
Source: pawaPay Merchant API v2 docs (docs.pawapay.io, read 2026-10-18) and its OpenAPI spec.

## 1. Why

Notch Pay's split payments (Sync) are not enabled on our account and their docs contradict themselves, so Écolage
moves to pawaPay. pawaPay has no split either. Écolage instead collects each parent payment into its own pawaPay
wallet and immediately pays the school out of that wallet. The library therefore needs a pawaPay provider that can
**collect** (hosted payment page) and **pay out** to a mobile money number. `@halifage/mobile-money` stays the single
payment library across projects.

## 2. Goals

1. `pawaPay(config)` implementing `MobileMoneyProvider` (`collect` via the pawaPay Payment Page, `status`).
2. A payouts capability on the same object: `payout(request)` and `payoutStatus(ref)`.
3. A callback parser that returns only which deposit or payout to look up, never a status.
4. Verified against the pawaPay sandbox with its Cameroon test numbers, findings recorded under "Observed provider
   behaviour" in the README, unit tests using the observed payloads.

## 3. Non-goals

- Refunds, remittances, bulk payouts, checkouts (USSD push without a page), statements.
- RFC 9421 request signing and callback signature checking (optional at pawaPay; callbacks are never trusted anyway).
- Countries other than Cameroon, currencies other than XAF.
- Persisting anything; the library still stores nothing and settles nothing.

## 4. Anti-goals

- Trusting a callback body's status. Callbacks only say "look at id X".
- The API token in a URL, log line or error message.
- Treating a payout as failed when pawaPay may still process it (`UNKNOWN_ERROR`, network errors, 5xx).

## 5. Decided

### 5.1 Config and transport

```ts
pawaPay({
  token: string,                          // Bearer token from the pawaPay dashboard (sandbox and production differ)
  environment: 'sandbox' | 'production',  // https://api.sandbox.pawapay.io | https://api.pawapay.io
  baseUrl?: string,                       // tests only
})
```

- `Authorization: Bearer <token>`, JSON bodies, reuse `src/http.ts` (`send`, `ok`, `record`, `str`, `validAmount`,
  `providerCode`, `completed`, `unavailable`).
- `operators: ['mtn', 'orange']`; provider codes `MTN_MOMO_CMR` / `ORANGE_CMR`; country `CMR`; currency `XAF`;
  amounts sent as integer strings (CMR does not support decimals).
- Phone numbers go to pawaPay as `237` + 9 digits, no `+`. Anything else is `rejected` / `invalid_input`.
- `collect` and `payout` require `id` to be a UUID (pawaPay's `depositId` / `payoutId`); the `ref` returned is that id.

### 5.2 Collect (Payment Page)

`POST /v2/paymentpage` with `depositId: id`, `returnUrl` (required, else `invalid_input`), `phoneNumber` (fixed, so
the payer cannot switch wallets), `amountDetails: { amount, currency: 'XAF' }`, `country: 'CMR'`, `language: 'FR'`,
`reason: description` cut to 50 chars. Returns `{ ref: id, redirectUrl }`.

- `callbackUrl` is ignored: pawaPay posts callbacks to URLs set in its dashboard (document it).
- `payee` is rejected with `split_unsupported` (pawaPay cannot split), like the other providers.
- 4xx → `rejected`; network error or 5xx → `rejected` too (as `orangeWebPay`/`notchPay`: without the page the payer
  cannot pay).

### 5.3 Status of a deposit

`GET /v2/deposits/{id}`:

| pawaPay | `Outcome` |
|---|---|
| `FOUND` + `COMPLETED` | `completed(amount, currency)` (positive integer, XAF) |
| `FOUND` + `FAILED` | `failed`; `INSUFFICIENT_BALANCE` → `insufficient_funds`, `PAYMENT_NOT_APPROVED` → `declined`, others → `unknown`; `code` = `failureCode` |
| `FOUND` + `ACCEPTED` / `PROCESSING` / `IN_RECONCILIATION` / unknown | `pending` |
| `NOT_FOUND` | `pending` with `code: 'NOT_FOUND'` |

`NOT_FOUND` means the payer has not pressed Pay yet, or abandoned the page. The page expires after 15 minutes and
sends no callback, so the **caller** decides when a long-`NOT_FOUND` deposit is dead. To let it, `Outcome`'s pending
case gains an optional `code` (additive, library-wide). Lookup failures → `unavailable`.

### 5.4 Payouts

```ts
interface PayoutRequest { id: string /* UUID */; operator: Operator; amount: number; phone: string; message?: string }
interface MobileMoneyPayouts {
  payout(request: PayoutRequest): Promise<{ ref: string }>
  payoutStatus(ref: string): Promise<Outcome>
}
```

`pawaPay()` returns `MobileMoneyProvider & MobileMoneyPayouts`. The new interface is exported for other providers.

- `payout` → `POST /v2/payouts` with `payoutId: id`, `amount`, `currency: 'XAF'`,
  `recipient: { type: 'MMO', accountDetails: { phoneNumber, provider } }`, `customerMessage` (`message`, 4–22 chars,
  else omitted).
- Response `ACCEPTED` or `DUPLICATE_IGNORED` → `{ ref: id }` (a duplicate means it was already sent: idempotent).
- `REJECTED` → `MobileMoneyError('rejected', failureCode)`, except `UNKNOWN_ERROR` → `uncertain` with `ref`.
- Network error or 5xx → `MobileMoneyError('uncertain', 'NETWORK', id)`: poll `payoutStatus`.
- `payoutStatus` → `GET /v2/payouts/{id}`: `COMPLETED` → `completed`; `FAILED` → `failed` with `reason: 'unknown'`
  and `code` = `failureCode` (`RECIPIENT_NOT_FOUND`, `WALLET_LIMIT_REACHED`, `PAWAPAY_WALLET_OUT_OF_FUNDS`,
  `MANUALLY_CANCELLED`, `UNSPECIFIED_FAILURE`, `UNKNOWN_ERROR`); `ACCEPTED` / `ENQUEUED` / `PROCESSING` /
  `IN_RECONCILIATION` → `pending`; `NOT_FOUND` (never reached pawaPay) → `failed` with `code: 'NOT_FOUND'`.
- Fees are taken from the merchant wallet on success; the recipient gets exactly `amount`.

### 5.5 Callbacks

```ts
parsePawaPayCallback(rawBody: string): { kind: 'deposit' | 'payout' | 'refund'; ref: string } | null
```

Reads `depositId` / `payoutId` / `refundId` only. Callers then call `status` / `payoutStatus`. Callback URLs are
set per type in the pawaPay dashboard (System configuration → Callback URLs).

### 5.6 Verification against the sandbox

- `scripts/live-pawapay.mjs`, like `live-notchpay.mjs`: `PAWAPAY_TOKEN` from `.env.live`, raw responses printed with
  the token redacted; modes `collect <phone> <amount>`, `payout <phone> <amount>`, `listen <port>`.
- Sandbox numbers (docs/test_numbers): deposits MTN `237653456789` completed, `237653456039` not approved;
  Orange `237693456789` completed, `237693456049` insufficient balance. Payouts MTN `237653456789` completed,
  `237653456089` `RECIPIENT_NOT_FOUND`; Orange `237693456789` completed, `237693456099` `WALLET_LIMIT_REACHED`.
- Capture one deposit and one payout callback through a `cloudflared` tunnel.
- Every mismatch: failing unit test with the observed payload first, then the fix, then a README line.
- The user creates the sandbox account (dashboard.sandbox.pawapay.io), generates the token and puts it in
  `.env.live` themselves. The sandbox wallet may need a top-up before payouts succeed; confirm.

## 6. Open

1. Whether the Payment Page accepts `phoneNumber` + `amountDetails` together for CMR (the guide's examples use the
   older `msisdn` / `amount` names; the OpenAPI v2 schema uses `phoneNumber` / `amountDetails`). The sandbox decides.
2. Whether deposits land in the wallet net of the collection fee (affects only Écolage's margin, not the school).

## 7. Calls made by Claude

- Branch `feat/pawapay` cut from `feat/notchpay`: it reuses that branch's contract-test flags (`token`, `split`) and
  `rejectSplit`.
- No request or callback signatures; callbacks only name the id to re-check.
- Deposit `NOT_FOUND` is `pending` with a code, payout `NOT_FOUND` is `failed` (§5.3, §5.4).

## 8. Left to the builder

File layout (`src/pawapay.ts` plus test), helper names, exact deposit failure-code mapping beyond the table above,
README wording, version number (minor bump).
