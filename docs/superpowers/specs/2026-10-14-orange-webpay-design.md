# Orange Web Payment provider (`orangeWebPay`), SDK 0.2.0

Status: design approved in chat 2026-10-14 ("implement"; spec and plan review gates waived by the user).

## Why

The Orange Cameroon local API (`orangeDirect`) has no sandbox and a merchant PIN that locks the line when wrong. The
official Orange Developer API, Orange Money Web Payment (`api.orange.com`), has a sandbox (`dev` path, test currency
`OUV`) and no PIN. Add it as a second Orange provider. Sources: developer.orange.com/apis/om-webpay (gated reference),
tranzit `supabase/functions/_shared/orangeMoney.ts` (prod `cm/v1`), Ibracilinks/OrangeMoney and own-pay/OwnPay
(sandbox `dev/v1`, `OUV`, status body `{ order_id, amount, pay_token }`).

## Interface (additive)

- `CollectRequest.returnUrl?: string`: where the payer returns after paying on a provider page. Required by
  `orangeWebPay`, ignored by the others.
- `collect()` resolves `{ ref: string; redirectUrl?: string }`. When `redirectUrl` is set, the app sends the payer there.

## Provider

`orangeWebPay({ clientId, clientSecret, merchantKey, environment: 'dev' | 'cm', baseUrl = 'https://api.orange.com' })`,
`operators: ['orange']`, currency `OUV` (dev) or `XAF` (cm).

- Token: `POST /oauth/v3/token`, Basic `clientId:clientSecret`, form `grant_type=client_credentials`.
- collect: `operator` must be `orange`, `amount` a positive integer and `returnUrl` set, else `rejected/invalid_input`.
  `POST /orange-money-webpay/{environment}/v1/webpayment` with `{ merchant_key, currency, order_id: id, amount,
  return_url, cancel_url: returnUrl, notif_url: callbackUrl, lang: 'fr', reference: description }`.
  - 2xx with `pay_token` and `payment_url` → `{ ref, redirectUrl: payment_url }`; `ref` is base64url JSON of
    `{ payToken, orderId, amount }` because the status call needs all three.
  - Anything else, including network errors and 5xx → `rejected`: without `payment_url` the payer cannot pay, so no
    money can move.
- status: decode `ref` (invalid → `unavailable/BAD_REF`), `POST …/transactionstatus` with `{ order_id, amount, pay_token }`.
  `SUCCESS`/`SUCCESSFULL`/`SUCCESSFUL` → `completed` (amount and currency from the response, falling back to the ref's
  amount and the environment currency when absent); `FAILED` → `failed/unknown`; `CANCELLED` → `failed/declined`;
  `EXPIRED` → `failed/expired`; empty → `unavailable`; anything else → `pending`.

## Contract changes

- `collect returns the ref` matches `{ ref }` and checks `redirectUrl` against an optional fixture.
- Send failures expect `uncertain` with ref by default; fixture `sendFailure: 'rejected'` for providers without a
  pollable ref before success.
- The ref-encoding case becomes: a hostile ref never reaches a request URL unencoded.

## Testing

Contract plus web-pay cases (returnUrl required, dev vs cm path and currency, ref round-trip, tampered ref, body
fields). `scripts/live-orange-webpay.mjs` prints the `payment_url`, then polls `status()`. To confirm in the sandbox:
token path (v3 vs v2), `order_id` length limit, status spellings.
