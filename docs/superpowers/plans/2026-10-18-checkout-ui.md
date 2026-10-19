# Checkout UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a React `Checkout` component at `@halifage/mobile-money/checkout` that renders every mobile-money checkout state from a provider-neutral status, plus the `wrong_number` / `unavailable` failure reasons.

**Architecture:** The app owns the payment status and passes it in as a prop. The component owns the form values (operator, phone) and the local "edit details" view. The root entry stays React-free; the checkout is a separate subpath built by the same `tsc`, with one plain CSS file copied into `dist/`.

**Tech Stack:** TypeScript 6, React 19 (optional peer), vitest 4 + jsdom + @testing-library/react, biome, plain CSS (container queries).

**Spec:** `docs/superpowers/specs/2026-10-18-checkout-ui-design.md` (approved 2026-10-18). Read it first; §5.5 copy and §5.3 state table are normative.

## Global Constraints

- Worktree `~/dev/mobile-money-checkout`, branch `feat/checkout-ui` (from `origin/dev` 15ceb2e). PR against `dev`.
- Before every commit: `npm test`, `npm run type-check`, `npm run lint`, `npm run build`. Before push also `npm run smoke`.
- No provider name anywhere in `src/checkout/` or its props.
- `src/index.ts` must never import from `src/checkout/`.
- `react` / `react-dom` `>=19`: `peerDependencies` + `peerDependenciesMeta` `{ optional: true }`. No runtime `dependencies`.
- No icon, i18n, styling or demo libraries. Icons and logos are inline SVG.
- CSS classes prefixed `mm-`; variables `--mm-accent` (`#0A6B3B`), `--mm-danger` (`#B3261E`), `--mm-fg`, `--mm-muted`, `--mm-bg`, `--mm-border`, `--mm-radius`, `--mm-font` (`inherit`) on `.mm-checkout`.
- Imports inside `src/` use `.js` extensions (NodeNext).
- Copy: exactly spec §5.5. Amounts `Intl.NumberFormat(locale)` + ` FCFA`. Phone display `6 77 12 34 56`.
- Commit messages: conventional, caveman-terse, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Parent pastes `+237 6 77 12 34 56`, `00237677123456` or `0677123456`: accepted and sent as `237677123456`. (Task 2 test.)
2. Double tap on Payer or Réessayer before the app updates `status`: `onPay` fires once. (Task 4 test.)
3. Number with a prefix outside the MTN/Orange table (e.g. Nexttel `66…`): still valid, tile stays on the parent's choice. (Task 2 + Task 4 tests.)
4. Re-render with the same redirect `nextAction`: `location.assign` called once. (Task 4 test.)
5. Long payee name (60+ chars) at 375 px: wraps, no horizontal scroll. (Task 5 demo includes one; checked in screenshots.)

---

### Task 1: Failure reasons `wrong_number` and `unavailable`

**Files:**
- Modify: `src/types.ts:18`, `src/pawapay.ts:22-25`, `src/mtn.ts:28-32`
- Test: `test/pawapay.test.ts`, `test/mtn.test.ts`

**Interfaces:**
- Produces: `FailureReason = 'insufficient_funds' | 'declined' | 'expired' | 'wrong_number' | 'unavailable' | 'unknown'`

- [x] **Step 1: Failing tests**, next to the existing reason tests, same style:
  - pawaPay `failureCode: 'PAYER_NOT_FOUND'` → `{ status: 'failed', reason: 'wrong_number', code: 'PAYER_NOT_FOUND' }`
  - pawaPay `failureCode: 'PROVIDER_TEMPORARILY_UNAVAILABLE'` → `reason: 'unavailable'`
  - MTN `reason: { code: 'PAYER_NOT_FOUND' }` → `reason: 'wrong_number'`; `reason: 'SERVICE_UNAVAILABLE'` → `reason: 'unavailable'`
- [x] **Step 2:** `npx vitest run test/pawapay.test.ts test/mtn.test.ts` → the 4 new tests FAIL.
- [x] **Step 3:** Extend the union in `src/types.ts`; add the two entries to `DEPOSIT_FAILURE` (pawaPay) and `REASONS` (MTN).
- [x] **Step 4:** Same command → PASS. Run the four checks.
- [x] **Step 5:** Commit `feat: wrong_number and unavailable failure reasons`. README "Outcomes" section: list the six reasons.

### Task 2: Checkout tooling + phone helpers

**Files:**
- Modify: `package.json` (devDeps, peerDeps), `tsconfig.json` (`"jsx": "react-jsx"`, `include` already covers `src`/`test`)
- Create: `src/checkout/phone.ts`
- Test: `test/checkout/phone.test.ts`

**Interfaces:**
- Produces (from `src/checkout/phone.ts`, ported from camtour `src/lib/payments/msisdn.ts`):
  - `localPhone(raw: string): string | null`: 9 digits starting with 6, after dropping non-digits, a leading `00`, `237`, `0`.
  - `guessOperator(raw: string): Operator | null`: MTN `67x, 650–654, 680–684`; Orange `69x, 655–659, 685–689`; else null.
  - `displayPhone(local: string): string`: `'677123456'` → `'6 77 12 34 56'`.

- [x] **Step 1:** `npm i -D react@19 react-dom@19 @types/react@19 @types/react-dom@19 @testing-library/react jsdom` (exact versions pinned like the existing devDeps); add `peerDependencies` `{ "react": ">=19", "react-dom": ">=19" }` + `peerDependenciesMeta` both `{ "optional": true }`.
- [x] **Step 2: Failing tests** `test/checkout/phone.test.ts`:
  - `localPhone` of `'+237 6 77 12 34 56'`, `'00237677123456'`, `'0677123456'`, `'677-12-34-56'` → `'677123456'`; of `'577123456'`, `'67712345'`, `''` → `null`.
  - `guessOperator`: `'677…'`→`'mtn'`, `'650…'`→`'mtn'`, `'684…'`→`'mtn'`, `'699…'`→`'orange'`, `'655…'`→`'orange'`, `'689…'`→`'orange'`, `'662123456'`→`null`, invalid → `null`.
  - `displayPhone('677123456')` → `'6 77 12 34 56'`.
- [x] **Step 3:** Run → FAIL. Implement. Run → PASS. Four checks.
- [x] **Step 4:** Commit `feat(checkout): phone helpers and react tooling`.

### Task 3: Messages, operators, icons

**Files:**
- Create: `src/checkout/messages.ts`, `src/checkout/operators.tsx`, `src/checkout/icons.tsx`
- Test: `test/checkout/messages.test.ts`

**Interfaces:**
- Produces:
  - `type Locale = 'fr' | 'en'`; `type Messages = typeof fr` (flat record of strings; keys cover every row of spec §5.5, one key per string, reason keys `reason_<FailureReason>_title` / `reason_<FailureReason>_body`).
  - `messagesFor(locale: Locale, overrides?: Partial<Messages>): Messages`
  - `fill(template: string, vars: Record<string, string>): string`: replaces `{name}`; unknown placeholders left as is.
  - `formatAmount(amount: number, locale: Locale): string`
  - `OPERATORS: Record<Operator, { name: string; menuCode?: string; Logo: () => JSX.Element }>`: mtn `{ name: 'MTN MoMo', menuCode: '*126#' }`, orange `{ name: 'Orange Money' }`.
  - Icons: `CheckIcon`, `CrossIcon`, `ClockIcon`, `PhoneIcon`, `ChevronIcon`, each `() => JSX.Element`, `aria-hidden`, `currentColor`, 24×24 viewBox.

- [x] **Step 1: Failing tests** `test/checkout/messages.test.ts`:
  - `formatAmount(20100, 'fr')` → `'20 100 FCFA'`; `formatAmount(20100, 'en')` → `'20,100 FCFA'`.
  - `fill('Payer {amount}', { amount: 'X' })` → `'Payer X'`; `fill('{a} {b}', { a: '1' })` → `'1 {b}'`.
  - `messagesFor('fr').reason_wrong_number_title` → `"Ce numéro n'est pas un compte {op}"`; `messagesFor('en').payButton` → `'Pay {amount}'`; `messagesFor('fr', { payButton: 'Régler {amount}' }).payButton` → `'Régler {amount}'`.
  - `Object.keys(messagesFor('en'))` equals `Object.keys(messagesFor('fr'))`.
- [x] **Step 2:** Run → FAIL. Implement messages from spec §5.5 verbatim.
- [x] **Step 3:** Logos: fetch the MTN and Orange corporate logo SVGs from Wikimedia Commons (`File:MTN Logo.svg`, `File:Orange logo.svg`; if a file is missing, the operator's public brand page). Strip metadata, inline the paths as JSX in `operators.tsx`, `role="img"` + `aria-label` = operator name. Note each source URL in a comment above the component (README credit in Task 5).
- [x] **Step 4:** Icons: simple stroke paths (check, x, clock, phone handset, chevron-down).
- [x] **Step 5:** Run → PASS. Four checks. Commit `feat(checkout): copy, operator data, logos, icons`.

### Task 4: `Checkout` component and CSS

**Files:**
- Create: `src/checkout/Checkout.tsx`, `src/checkout/index.ts`, `src/checkout/checkout.css`
- Test: `test/checkout/checkout.test.tsx` (first line `// @vitest-environment jsdom`)

**Interfaces:**
- Consumes: Task 2 phone helpers, Task 3 messages/operators/icons, `Operator`, `FailureReason` from `../types.js`.
- Produces (`src/checkout/index.ts` exports exactly): `Checkout`, types `CheckoutProps`, `CheckoutStatus`, `NextAction`, `Locale`, `Messages`. Prop and status shapes exactly as spec §5.2.

Behaviour to implement (spec §5.3 is the state table):
- View = form when `status` is `idle` or `initiated`, or when local `editing` is true; `editing` is set by "Changer…" and cleared on the next `onPay`.
- Step bar: idle/initiated → step 1 active; awaiting → step 2 "Validation"; pending → step 2 "Vérification"; failed/expired → step 2 "Échec" with `mm-step--failed`; succeeded → all three done.
- Operator follows `guessOperator(phone)` whenever the guess changes to a non-null value different from the previous guess; a tile tap overrides until then.
- `onPay` guard: a local `sent` flag set on call, cleared when `status` changes; Payer and Réessayer disabled while `sent` or `initiated`.
- Redirect: `useEffect` on `nextAction.url` calls `window.location.assign(url)`; keyed on the url so a re-render doesn't repeat it.
- Help: `<details class="mm-help"><summary>` title + chevron; body: menu code as `<a href={'tel:' + encodeURIComponent(menuCode)}>` with phone icon, or the "open the app" line when no code.
- Layout: root `div.mm-checkout` (`container-type: inline-size`), inner `.mm-layout` grid: one column; `@container (min-width: 600px)` → summary column left (amount, payee, `summary`), step column right. Status region `aria-live="polite"`. `prefers-reduced-motion` stops the progress-bar animation. `overflow-wrap: anywhere` on payee.

- [ ] **Step 1: Failing tests** (render with `amount={20100} payee="Collège La Réussite"`, `onPay = vi.fn()`):
  - `idle`: shows `'20 100 FCFA'`, payee, both tile names, `+237`, the `summary` node; Payer disabled; typing `677123456` enables it; click → `onPay` called once with `{ operator: 'mtn', phone: '237677123456' }`.
  - Double click Payer → `onPay` called once (Review Focus 2).
  - Typing `699123456` selects Orange tile (`aria-checked="true"`); tapping MTN then typing more digits of the same prefix keeps MTN; typing `662123456` keeps the current tile (Review Focus 3).
  - `initiated`: inputs disabled, Payer `aria-busy="true"`.
  - `approve_on_phone` mtn: text `'Regardez votre téléphone MTN MoMo'`, `'Entrez votre code secret'`; summary `'Pas reçu la demande ?'`; link `href="tel:*126%23"`. Same with orange: no `tel:` link, "open the app" line present.
  - `redirect`: `window.location.assign` (stubbed) called once with the url; re-render with an equal new status object → still once (Review Focus 4).
  - `pending_confirmation`: `'Nous vérifions votre paiement'`.
  - `succeeded` with `reference: 'MP1'`, `paidAt`, `defaultPhone="677123456"`: `'Paiement reçu'`, `'MP1'`, `'•• 34 56'`, `actions` content rendered.
  - each `failed` reason: its §5.5 title with `{op}` filled (`defaultOperator="mtn"` → `'Ce numéro n'est pas un compte MTN MoMo'`); `failed('expired')` and `expired` both show `'Aucune validation reçue à temps'`.
  - failed + `defaultPhone`: button `'Réessayer au 6 77 12 34 56'` → `onPay({ operator: 'mtn', phone: '237677123456' })`; without a known phone the button reads `'Réessayer'`.
  - "Changer de numéro ou d'opérateur" → form shown with values kept, step bar back on step 1.
  - `locale="en"` idle → `'Pay 20,100 FCFA'`; `messages={{ payButton: 'Régler {amount}' }}` → `'Régler 20 100 FCFA'`.
- [ ] **Step 2:** Run → FAIL. Implement `Checkout.tsx` + `index.ts`.
- [ ] **Step 3:** Write `checkout.css` per spec §5.6 (card, step bar, tiles, `+237` prefix field, numbered list, indeterminate bar, icon badges, buttons, link, two-column container query). Match the approved mockups (copies in `docs/superpowers/mockups/checkout/`; spec §5.3/§5.6 are normative).
- [ ] **Step 4:** Run → PASS. Four checks. Commit `feat(checkout): checkout component`.

### Task 5: Packaging, demo, screenshots, README

**Files:**
- Modify: `package.json` (`exports`, `build`, `demo` script), `test/package-smoke.mjs`, `.gitignore` (`demo/`), `README.md`
- Create: `scripts/demo.mjs`, `docs/checkout/*.png`

**Interfaces:**
- Consumes: built `dist/checkout/index.js`, `dist/checkout.css`.

- [ ] **Step 1:** `package.json`:
  - `exports["./checkout"] = { types: "./dist/checkout/index.d.ts", import: "./dist/checkout/index.js" }`, `exports["./checkout.css"] = "./dist/checkout.css"`.
  - `build`: `tsc -p tsconfig.build.json && cp src/checkout/checkout.css dist/checkout.css`.
  - `demo`: `npm run build && node scripts/demo.mjs`.
- [ ] **Step 2:** Smoke test: keep the root check in the temp project **before** React is installed (proves the root is React-free); then `npm install react@19 react-dom@19` there and check `Object.keys(await import('@halifage/mobile-money/checkout'))` equals `['Checkout']` and that `node_modules/@halifage/mobile-money/dist/checkout.css` exists. `npm run smoke` → `smoke ok`.
- [ ] **Step 3:** `scripts/demo.mjs`: `renderToStaticMarkup` one `Checkout` per state into `demo/index.html` with `checkout.css` inlined, each under a heading naming the state. States: idle (empty), idle (valid MTN number), initiated, approve_on_phone mtn (help open: render then replace `<details class="mm-help">` with `<details class="mm-help" open>` in the string), approve_on_phone orange, redirect, pending_confirmation, succeeded (with an `actions` link), failed × 6 reasons, expired, idle with a 70-char payee, idle `locale="en"`. Page body max-width none so each state shows at the viewport width.
- [ ] **Step 4:** `npm run demo`, open `demo/index.html` in a browser (Playwright MCP or the in-app browser), full-page screenshots at 375, 768 and 1280 px → `docs/checkout/checkout-375.png`, `-768.png`, `-1280.png`. Check: no horizontal scroll at 375 (`document.documentElement.scrollWidth <= 375`), two columns at 768 and 1280, long payee wraps.
- [ ] **Step 5:** README: new "Checkout UI" section after "Callbacks": install (`react >=19`), CSS import, props table, status table (from spec §5.2/§5.3), theming variables, one example of wiring `{ ref, redirectUrl? }` to `NextAction`, logo sources + "trademarks of their owners" notice, `npm run demo` in Development.
- [ ] **Step 6:** Four checks + `npm run smoke`. Commit `feat(checkout): package export, demo, readme`.
- [ ] **Step 7:** Push `feat/checkout-ui`, open PR against `dev` (caveman body: what, screenshots via `docs/checkout/*.png` raw links, test list, "release left to owner"), ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Ledger

- Ruling (Task 1): biome lint failed on the committed mockup HTML (24 a11y errors) — excluded `docs/superpowers/mockups` in `biome.json` — cost if wrong: mockups go unlinted (they are reference only).
- Ruling (Task 3): `formatAmount` keeps Intl's narrow no-break space in fr and joins ` FCFA` with a no-break space, so an amount never wraps — tests compare with `\u202f`/`\u00a0` — cost if wrong: hosts comparing plain-space strings.
- Ruling (Task 3): copy the spec gives only in FR — EN "Open the {op} app to see your pending approvals" (help without menu code) and "Try again" (retry without phone) are my translations — cost if wrong: two strings to edit.
- Owner decision (Task 3 stop, 2026-10-18): corporate logos rejected. MTN = 2022 MTN brand (`File:MTN_2022_logo.svg`, black on `#FFCC00`); Orange = Orange Money arrow mark only (`File:Logo_Orange_Money.svg`, cropped to the arrows). No free MTN MoMo product logo exists; swap in merchant-kit files if obtained.

## Stop points

- After Task 3: show the owner the logos rendered (one screenshot) before building the component on them.
- After Task 5 Step 4: show the owner the three screenshots before writing the README and opening the PR.
