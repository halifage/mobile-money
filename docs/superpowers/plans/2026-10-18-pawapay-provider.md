# pawaPay Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pawaPay provider (hosted Payment Page collections, payouts, callback parser) to
`@halifage/mobile-money`, verified against the pawaPay sandbox.

**Architecture:** `pawaPay()` returns `MobileMoneyProvider & MobileMoneyPayouts`. Collections reuse the existing
`collect`/`status` contract; payouts are a new exported interface. Callbacks are parsed for an id only; callers
re-check status. One file, `src/pawapay.ts`, on the existing `src/http.ts` helpers.

**Tech Stack:** TypeScript 6, Node 22 ESM, vitest 4, biome. No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-18-pawapay-provider-design.md`

## Global Constraints

- Worktree `~/dev/mobile-money-pawapay`, branch `feat/pawapay` (cut from `origin/dev`). PR against `dev`.
- `origin/main` has merge commit `288206b` that `origin/dev` lacks: `git merge origin/main` before opening the PR.
- No runtime dependencies. Reuse `src/http.ts` (`send`, `ok`, `record`, `str`, `validAmount`, `providerCode`,
  `completed`, `unavailable`).
- Base URLs: sandbox `https://api.sandbox.pawapay.io`, production `https://api.pawapay.io`. `Authorization: Bearer <token>`.
- Cameroon only: country `CMR`, currency `XAF`, providers `MTN_MOMO_CMR` / `ORANGE_CMR`, integer amounts sent as strings.
- Phone to pawaPay: `237` + 9 digits starting with `6`, no `+`.
- `id` for `collect` and `payout` must be a UUID; the returned `ref` is that id.
- Never put the token in a URL, log or error. Live token only in `.env.live` (gitignored), placed by the user.
- Version `0.3.0`. **Stop and ask** before `npm publish`, and before pushing / opening the PR.
- After each task: `npm test`, `npm run type-check`, `npm run lint`, `npm run build`, then commit (terse
  conventional commit, caveman style, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## Review Focus

- Deposit status body missing the top-level `status` (neither `FOUND` nor `NOT_FOUND`, e.g. HTML or `{}`) →
  `unavailable` / `BAD_RESPONSE`, never `pending` (Task 1 test).
- Payout initiation `REJECTED` with `UNKNOWN_ERROR` → `uncertain` with ref, never `rejected` (Task 2 test).
- Payout `DUPLICATE_IGNORED` → resolves with the ref (idempotent retry), no error (Task 2 test).
- Phone `+237 6 53 45 67 89`, `653456789`, `237653456789` all normalise to `237653456789`; `+2332...`, `5...`,
  8 digits → `invalid_input` before any fetch (Task 1 test).
- Callback body with both `depositId` and garbage, or non-JSON → `null` / deposit ref only, never throws (Task 3 test).

---

### Task 1: Contract flags and pawaPay collections

**Files:**
- Modify: `src/types.ts` (pending `code`), `test/contract.ts` (token flag, unsupported-operator case)
- Create: `src/pawapay.ts`, `test/pawapay.test.ts`
- Modify: `src/index.ts`, `test/package-smoke.mjs` (export list)

**Interfaces:**
- Produces: `Outcome` pending case `{ status: 'pending'; code?: string }`.
- Produces: `ContractFixtures.token?: boolean` (default true; false skips "token failure", "401 → refreshes",
  "shares one token"). The "unsupported operator" case uses the first of `['mtn','orange','airtel']` not in
  `make().operators`, cast to `Operator`.
- Produces: `export type PawaPayConfig = { token: string; environment: 'sandbox' | 'production'; baseUrl?: string }`,
  `export function pawaPay(config: PawaPayConfig): MobileMoneyProvider & MobileMoneyPayouts` (payouts land in
  Task 2; until then the object type is `MobileMoneyProvider`).

- [ ] **Step 1: Write the failing tests** in `test/pawapay.test.ts`:
  - `describeProviderContract('pawaPay', { make, request, currency: 'XAF', token: false, sendFailure: 'rejected', paths: { send: '/v2/paymentpage', status: '/v2/deposits/<request.id>' }, accepted: { '/v2/paymentpage': { status: 200, body: { redirectUrl: PAGE } } }, expectedRef: request.id, redirectUrl: PAGE, status: { completed: dep('COMPLETED', { amount: '10', currency: 'XAF' }), failed: dep('FAILED', { failureReason: { failureCode: 'PAYMENT_NOT_APPROVED' } }), failedReason: 'declined', pending: dep('PROCESSING'), unknown: dep('SOMETHING_NEW') } })`
    with `dep(status, extra)` = `{ status: 200, body: { status: 'FOUND', data: { depositId: request.id, status, ...extra } } }`,
    `request.id` a UUID, `phone: '+237653456789'`, `operator: 'mtn'`, `returnUrl` set,
    config `{ token: 'tok_test', environment: 'sandbox', baseUrl: 'https://pawapay.test' }`.
  - `it('posts the payment page request')`: URL `https://pawapay.test/v2/paymentpage`, header
    `authorization: 'Bearer tok_test'`, body equal to
    `{ depositId: request.id, returnUrl: request.returnUrl, phoneNumber: '237653456789', amountDetails: { amount: '10', currency: 'XAF' }, country: 'CMR', language: 'FR', reason: 'Order 42' }`.
  - `it('cuts reason to 50 chars')`.
  - `it('normalises phone numbers')`: `'+237 6 53 45 67 89'`, `'653456789'`, `'237653456789'` → `phoneNumber: '237653456789'`;
    `'+233201234567'`, `'553456789'`, `'65345678'` → `rejected` / `invalid_input`, no fetch.
  - `it('rejects a non-UUID id and a missing returnUrl')` → `invalid_input`, no fetch.
  - `it('maps deposit NOT_FOUND to pending with code')`: `{ status: 'NOT_FOUND' }` → `{ status: 'pending', code: 'NOT_FOUND' }`.
  - `it('maps INSUFFICIENT_BALANCE to insufficient_funds')`.
  - `it('defaults environment URLs')`: no `baseUrl`, sandbox → `https://api.sandbox.pawapay.io/v2/paymentpage`,
    production → `https://api.pawapay.io/v2/paymentpage`.
- [ ] **Step 2: Run** `npx vitest run test/pawapay.test.ts` — expected: FAIL (module not found).
- [ ] **Step 3: Implement** the contract changes, the pending `code`, and `pawaPay` in `src/pawapay.ts`:
  `collect` validates (operator in `operators`, `validAmount`, UUID `id`, `returnUrl`, phone) before any fetch;
  network error → `rejected` / `NETWORK`; non-2xx or no `redirectUrl` → `rejected` / `providerCode`.
  `status(ref)`: `GET /v2/deposits/{encodeURIComponent(ref)}`, mapping per spec §5.3; top-level status neither
  `FOUND` nor `NOT_FOUND` → `unavailable` / `BAD_RESPONSE`; errors wrapped with `unavailable()`. Export from
  `src/index.ts`; add `pawaPay` to the smoke export list.
- [ ] **Step 4: Run** `npm test` — expected: PASS (all providers, contract included).
- [ ] **Step 5: Gates + commit** `feat: pawapay collections via payment page`

### Task 2: Payouts

**Files:**
- Modify: `src/types.ts`, `src/pawapay.ts`, `src/index.ts`, `test/pawapay.test.ts`

**Interfaces:**
- Produces in `src/types.ts`:
```ts
export interface PayoutRequest { id: string; operator: Operator; amount: number; phone: string; message?: string }
export interface MobileMoneyPayouts {
  payout(request: PayoutRequest): Promise<{ ref: string }>
  payoutStatus(ref: string): Promise<Outcome>
}
```
- `pawaPay()` now returns `MobileMoneyProvider & MobileMoneyPayouts`.

- [ ] **Step 1: Write the failing tests:**
  - `it('posts the payout')`: body `{ payoutId: id, amount: '20000', currency: 'XAF', recipient: { type: 'MMO', accountDetails: { phoneNumber: '237693456789', provider: 'ORANGE_CMR' } }, customerMessage: 'Ecolage versement' }` for `message: 'Ecolage versement'`; message under 4 or over 22 chars → no `customerMessage`.
  - `it('ACCEPTED and DUPLICATE_IGNORED resolve with the ref')`.
  - `it('REJECTED → rejected with the failure code')`: `{ status: 'REJECTED', failureReason: { failureCode: 'INVALID_PHONE_NUMBER' } }` → `{ kind: 'rejected', code: 'INVALID_PHONE_NUMBER' }`.
  - `it('REJECTED UNKNOWN_ERROR, network error, 5xx → uncertain with ref')`.
  - `it('invalid payout input → rejected before any fetch')`: non-UUID id, amount `0`/`1.5`, bad phone, operator `'airtel'`.
  - `it('maps payout statuses')`: `COMPLETED` (amount `'20000.00'`) → `completed` 20000 XAF; `FAILED` with
    `RECIPIENT_NOT_FOUND` → `{ status: 'failed', reason: 'unknown', code: 'RECIPIENT_NOT_FOUND' }`;
    `ENQUEUED` → `pending`; `NOT_FOUND` → `{ status: 'failed', reason: 'unknown', code: 'NOT_FOUND' }`;
    5xx → `unavailable`; hostile ref URL-encoded.
- [ ] **Step 2: Run** `npx vitest run test/pawapay.test.ts` — expected: FAIL.
- [ ] **Step 3: Implement** `payout` (`POST /v2/payouts`) and `payoutStatus` (`GET /v2/payouts/{id}`) per spec §5.4,
  sharing the phone and provider helpers from Task 1. Export the two types.
- [ ] **Step 4: Run** `npm test` — expected: PASS.
- [ ] **Step 5: Gates + commit** `feat: pawapay payouts`

### Task 3: Callback parser

**Files:**
- Modify: `src/pawapay.ts`, `src/index.ts`, `test/pawapay.test.ts`, `test/package-smoke.mjs`

**Interfaces:**
- Produces: `export function parsePawaPayCallback(rawBody: string): { kind: 'deposit' | 'payout' | 'refund'; ref: string } | null`.

- [ ] **Step 1: Write the failing tests:** `{"depositId":"d1","status":"COMPLETED"}` → `{ kind: 'deposit', ref: 'd1' }`;
  `{"payoutId":"p1"}` → payout; `{"refundId":"r1"}` → refund; `{}`, `'not json'`, `'[]'`, `{"depositId":5}` → `null`.
- [ ] **Step 2: Run** — expected: FAIL (not exported).
- [ ] **Step 3: Implement** (first of `depositId`, `payoutId`, `refundId` that is a non-empty string). Add to smoke list.
- [ ] **Step 4: Run** `npm test` and `npm run smoke` — expected: PASS, `smoke ok`.
- [ ] **Step 5: Gates + commit** `feat: pawapay callback parser`

### Task 4: Sandbox verification, docs, 0.3.0

**Files:**
- Create: `scripts/live-pawapay.mjs`
- Modify: `.env.example` (`PAWAPAY_TOKEN=` with a comment), `README.md` (Providers row, payouts section, callbacks,
  Observed provider behaviour, live script usage), `package.json` (`0.3.0`, description mentions pawaPay payouts)

- [ ] **Step 1: STOP — ask the user** to create the sandbox account (dashboard.sandbox.pawapay.io), generate an API
  token, put it in `.env.live` as `PAWAPAY_TOKEN`, and (after step 3) set the deposit and payout callback URLs to
  the tunnel URL. Never handle the token in chat.
- [ ] **Step 2: Write `scripts/live-pawapay.mjs`** (pattern of `live-orange-webpay.mjs`): modes
  `collect <phone> <amount>` (prints redirect URL, polls `status` every 5 s for 2 min), `payout <phone> <amount>`
  (polls `payoutStatus`), `listen <port>` (logs raw callback body and `parsePawaPayCallback`). Token redacted.
- [ ] **Step 3: Run** `cloudflared tunnel --no-autoupdate --url http://localhost:8787` and
  `node --env-file=.env.live scripts/live-pawapay.mjs listen 8787` in the background.
- [ ] **Step 4: Run** deposits MTN `237653456789` (completed) and `237653456039` (not approved), Orange
  `237693456789` (completed) and `237693456049` (insufficient balance) — complete each payment page in the browser
  pane; then payouts MTN `237653456789` (completed), `237653456089` (`RECIPIENT_NOT_FOUND`), Orange `237693456789`
  (completed), `237693456099` (`WALLET_LIMIT_REACHED`). If payouts fail with `PAWAPAY_WALLET_OUT_OF_FUNDS`, ask
  the user to top up the sandbox wallet.
- [ ] **Step 5: For every mismatch** with the mocked shapes (payment page field names, status body, amount format,
  failure codes, callback body): change the unit test to the observed payload, watch it fail, fix, watch it pass.
- [ ] **Step 6: Stop the tunnel and listener**; `pgrep -fl "cloudflared|live-pawapay"` prints nothing.
- [ ] **Step 7: Gates + `npm run smoke` + commit** `feat: pawapay verified in sandbox (0.3.0)`
- [ ] **Step 8: STOP — ask the user**, then `git merge origin/main`, push, open the PR against `dev`. Ask again
  before `npm publish`.
