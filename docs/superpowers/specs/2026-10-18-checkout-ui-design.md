# Checkout UI: a reusable mobile-money checkout component

Date: 2026-10-18. Status: design, for approval.
Sources: camtour `src/components/applications/PaymentPanel.tsx` (starting point); Écolage industry-parity study
(`docs/research/feature-parity-map.md` §4.3, §4.6–4.10, §5.1–5.2 and `docs/superpowers/specs/2026-10-18-industry-parity-design.md`
§3, §4 Phase 1, branch `docs/industry-parity`). Mockups the owner chose from: brainstorm session 2026-10-18.

## 1. Why

Camtour and Écolage each have their own checkout screen, and both are thin. Camtour's waiting screen doesn't say how much,
who is being paid, or what to do if the phone prompt never arrives, and it shows one generic failure message. Écolage is
about to rebuild its own (parity Phase 1). The references (MINESEC CarteScolaire, pawaPay, M-Pesa, Paystack, CinetPay)
treat the wait for approval as a designed screen with a way out, and turn each failure reason into an action. This puts
one simple checkout in `@halifage/mobile-money` so both apps get it, built from the camtour panel and those patterns.

Owner's definition of polished: **simple and intuitive, guiding the parent through checkout with recognisable visual
cues, icons and logos.**

## 2. Goals

1. A React component `Checkout`, exported from `@halifage/mobile-money/checkout`, covering every checkout state.
2. It renders only from a provider-neutral status and next action, never from a provider name.
3. French first, English included.
4. Themeable by the host app through CSS variables; works without Tailwind.
5. A static demo of every state, captured at 375, 768 and 1280 px.
6. The library's `FailureReason` gains `wrong_number` and `unavailable`, mapped by the providers that report them.

## 3. Non-goals

- Calling providers, polling, realtime, timers or persistence. The host app owns all of that.
- OTP, dial-a-menu or open-app actions (owner decision: two action kinds only).
- Vue, Svelte or framework-agnostic versions.
- A built-in dark theme (the host overrides the CSS variables).
- The "a payment is already waiting" guard and the receipt PDF/page: app features, not checkout.
- Storybook or another demo framework.

## 4. Anti-goals

- Any provider name (`pawapay`, `mtnDirect`…) reaching the UI or its props.
- Provider keys or provider calls in client code.
- The root import `@halifage/mobile-money` loading React. Server code must stay React-free.
- A wrong operator menu code shown to a parent: help is shown only for operators whose code is confirmed.
- Raw provider codes in the UI.

## 5. Decided

### 5.1 Packaging (owner approved)

- Same package, new subpath: `@halifage/mobile-money/checkout` (JS + types) and `@halifage/mobile-money/checkout.css`.
- `react` and `react-dom` (>=19) become **optional** peer dependencies. The root entry is unchanged and never imports
  `src/checkout/`.
- Source in `src/checkout/*.tsx`, built by the existing `tsc` (add `"jsx": "react-jsx"`). The CSS is a plain file copied
  to `dist/` by the build script.
- Logos are **bundled** (owner decision), as inline SVG React components, so there is no asset path for the host to configure.

### 5.2 Public API

```tsx
import { Checkout, type CheckoutStatus } from '@halifage/mobile-money/checkout'
import '@halifage/mobile-money/checkout.css'

<Checkout
  amount={20100}                      // XAF, whole units
  payee="Collège La Réussite"
  status={status}                     // CheckoutStatus, owned by the app
  onPay={({ operator, phone }) => …}  // phone is '237' + 9 digits; called by Payer and by Réessayer
  defaultOperator="mtn"               // optional prefill (e.g. after a reload in a failed state)
  defaultPhone="677123456"            // optional prefill, any common format
  summary={<p>Tranche 2 · Awa N.</p>} // optional extra lines in the summary
  actions={<a href="/receipt/…">Voir le reçu</a>} // optional, shown on success
  locale="fr"                         // 'fr' (default) | 'en'
  messages={{ payButton: 'Régler {amount}' }} // optional per-string overrides
/>
```

```ts
export type NextAction =
  | { kind: 'redirect'; url: string }
  | { kind: 'approve_on_phone'; operator: Operator }

export type CheckoutStatus =
  | { status: 'idle' }                                            // form
  | { status: 'initiated' }                                       // onPay in flight
  | { status: 'awaiting_customer'; nextAction: NextAction }
  | { status: 'pending_confirmation' }
  | { status: 'succeeded'; reference: string; paidAt: Date }
  | { status: 'failed'; reason: FailureReason }
  | { status: 'expired' }
```

- The component keeps the form values (operator, phone) itself. Retry reuses them; "Changer de numéro ou d'opérateur"
  shows the form again locally until the next `onPay`. The app does not handle "edit".
- `failed` with reason `expired` renders the same as `expired`.
- An error before anything reached the operator (rejected start) is `failed` / `unknown`, as in the parity design.

### 5.3 Layout and states (owner chose each from mockups)

**Step bar** on top, three labelled steps: `1 Détails → 2 Validation → 3 Reçu`.

| Status | Step bar | Content |
|---|---|---|
| `idle` | 1 Détails | Amount (large), payee, `summary`. Two operator tiles with logo + name (MTN MoMo, Orange Money). Number field with a fixed `+237` prefix. Button "Payer 20 100 FCFA", disabled until the number is valid |
| `initiated` | 1 Détails | Same form, disabled; button shows a spinner |
| `awaiting_customer` / `approve_on_phone` | 2 Validation | Operator logo, amount and payee on top; three numbered lines: 1 Regardez votre téléphone {opérateur}, 2 Entrez votre code secret, 3 Gardez cette page ouverte; indeterminate progress bar; folded "Pas reçu la demande ?" that opens to the operator's menu code as a tap-to-dial button (`tel:*126%23`) |
| `awaiting_customer` / `redirect` | 2 Validation | Logo of the chosen operator, "Redirection vers la page de paiement…", progress bar; the browser goes to `url` at once (`window.location.assign`) |
| `pending_confirmation` | 2 Vérification | Clock icon, "Nous vérifions votre paiement", "Vous pouvez fermer cette page : le reçu apparaîtra ici." |
| `succeeded` | 3 Reçu (all done) | Check icon, "Paiement reçu", then rows: Montant, Pour (payee), Opérateur (logo + last 4 digits `•• 34 56`), Référence, Date; then `actions` |
| `failed(reason)` / `expired` | 2 Échec (red) | Cross icon (clock icon for `expired`), reason title and line (5.5); main button "Réessayer au 6 77 12 34 56" (calls `onPay` with the same values); link "Changer de numéro ou d'opérateur" |

- **Operator choice:** the tile follows the number as it is typed (prefix table from camtour's `guessCmOperator`); the
  parent can tap the other tile, and that choice is kept until the number's prefix changes again.
- **Folded help** uses a native `<details>`/`<summary>`: no timer, works without JS state.
- **Width (owner chose B):** narrow screens are one column. From tablet width the component splits into two columns:
  summary (amount, payee, `summary`) on the left, the step bar and step content on the right.

### 5.4 Operator data

Kept in the library next to the checkout, keyed by `Operator`:

| Operator | Name shown | Logo | Menu code (help) |
|---|---|---|---|
| `mtn` | MTN MoMo | MTN logo (yellow) | `*126#` (parity map §4.3, CarteScolaire) |
| `orange` | Orange Money | Orange logo (orange) | none until confirmed (parity map §4.7: unknown) |

With no menu code, the folded help still opens, with "Ouvrez l'application {opérateur} pour voir vos validations en
attente" and no dial button.

### 5.5 Copy (drafts, the owner reviews here)

French (default). `{op}` = operator name.

| Key | FR | EN |
|---|---|---|
| steps | Détails · Validation · Reçu (Vérification, Échec) | Details · Approval · Receipt (Checking, Failed) |
| operator label | Opérateur | Operator |
| phone label | Numéro {op} | {op} number |
| invalid phone | Entrez un numéro camerounais à 9 chiffres | Enter a 9-digit Cameroon number |
| pay button | Payer {amount} | Pay {amount} |
| approve steps | Regardez votre téléphone {op} · Entrez votre code secret · Gardez cette page ouverte | Check your {op} phone · Enter your PIN · Keep this page open |
| help title | Pas reçu la demande ? | Didn't get the request? |
| help body | Composez ce code pour voir vos validations en attente : | Dial this code to see your pending approvals: |
| redirect | Redirection vers la page de paiement… | Taking you to the payment page… |
| pending | Nous vérifions votre paiement · Vous pouvez fermer cette page : le reçu apparaîtra ici. | We are checking your payment · You can close this page: the receipt will appear here. |
| success | Paiement reçu · Montant · Pour · Opérateur · Référence · Date | Payment received · Amount · To · Operator · Reference · Date |
| insufficient_funds | Solde insuffisant · Rechargez votre compte {op} puis réessayez. | Insufficient balance · Top up your {op} account and try again. |
| declined | Paiement refusé · La demande a été refusée sur le téléphone. | Payment declined · The request was declined on the phone. |
| expired | Aucune validation reçue à temps · La demande a expiré. | No approval in time · The request expired. |
| wrong_number | Ce numéro n'est pas un compte {op} · Vérifiez le numéro ou changez d'opérateur. | This number is not a {op} account · Check the number or switch operator. |
| unavailable | {op} est indisponible · Réessayez dans quelques minutes. | {op} is unavailable · Try again in a few minutes. |
| unknown | Le paiement n'a pas abouti · Réessayez ou changez de numéro. | The payment did not go through · Try again or use another number. |
| retry | Réessayer au {phone} | Try again on {phone} |
| change | Changer de numéro ou d'opérateur | Change number or operator |

Amounts: `Intl.NumberFormat` of the locale, then ` FCFA` in both languages (`20 100 FCFA`, `20,100 FCFA`).
Phone display: `6 77 12 34 56`.

### 5.6 Look (from the approved mockups)

- Card with rounded corners, light border, white surface; accent green `#0A6B3B` for the active step, selected tile and
  main button; red `#B3261E` for failure; grey for secondary text.
- Status icons in a soft round badge: check (green), cross (red), clock (grey). Phone icon on the dial button, chevron
  on the folded help. All inline SVG, no icon library.
- Exposed as CSS variables on `.mm-checkout` so the host can rebrand: `--mm-accent`, `--mm-danger`, `--mm-fg`,
  `--mm-muted`, `--mm-bg`, `--mm-border`, `--mm-radius`, `--mm-font` (defaults to `inherit`). Classes are prefixed `mm-`.
- Accessibility basics: real `<button>`s and `<label>`s, operator tiles as a radio group, `aria-live="polite"` on the
  status area, focus ring from `--mm-accent`, `prefers-reduced-motion` stops the progress animation.

### 5.7 Library change: two failure reasons (owner decision)

`FailureReason = 'insufficient_funds' | 'declined' | 'expired' | 'wrong_number' | 'unavailable' | 'unknown'`.
Mappings added where the provider reports the code:

- pawaPay: `PAYER_NOT_FOUND` → `wrong_number`, `PROVIDER_TEMPORARILY_UNAVAILABLE` → `unavailable`.
- MTN direct: `PAYER_NOT_FOUND` → `wrong_number`, `SERVICE_UNAVAILABLE` → `unavailable`.
- Orange MP and WebPay report no such codes; unchanged.

### 5.8 Demo and verification

- `npm run demo` builds, then renders every state (both kinds of `awaiting_customer`, each failure reason, help open,
  FR and one EN sample) with `react-dom/server` into a static `demo/index.html` with the CSS inlined. No new framework.
- Screenshots of the demo at 375, 768 and 1280 px are committed under `docs/checkout/` and shown in the PR.
- Tests (vitest, jsdom for the checkout files): each status renders its content; `onPay` gets the normalised phone and
  operator; the tile follows the prefix and keeps a manual override; retry calls `onPay` with the same values; "Changer"
  shows the form; redirect calls `location.assign`; the MTN help link is `tel:*126%23` and Orange has none; `en` and
  `messages` overrides; the root entry does not import React (smoke test); providers map the new reasons.
- The smoke test also checks the `./checkout` exports and that `checkout.css` ships.
- README gains a "Checkout UI" section (install, CSS import, props, status table, theming variables, logo notice).

## 6. Calls made by Claude (check while reading)

1. Prop shape (5.2): the app owns `status`; the component owns form values and the "edit" view.
2. No `nextAction()` helper in the library: mapping `{ ref, redirectUrl? }` to `NextAction` is one line in each app.
3. Two-column switch is based on the component's own width (container query, at 600 px), not the window, so it still
   fits when an app puts it in a narrow column. On a full-width page this switches at about tablet width.
4. Orange gets no menu code until confirmed (5.4), with the "open the app" line instead.
5. The "nothing was charged" line on the expired screen is dropped; the operators don't promise it.
6. Logo files: the MTN and Orange corporate logos from their public brand pages or Wikimedia Commons, source noted in
   the README. Replace them with your merchant-kit files if you have them.
7. Default colours are the mockups' (camtour green); `--mm-font` inherits the host font.
8. With no known phone (reload without `defaultPhone`), the retry button reads just "Réessayer".
9. Release (version bump, npm publish) is left to the owner after merge; this PR stops at review.
