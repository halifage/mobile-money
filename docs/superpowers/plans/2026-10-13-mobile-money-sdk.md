# Mobile Money SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@halifage/mobile-money@0.1.0`: a stateless TypeScript SDK with `orangeDirect` and `mtnDirect` providers behind one `MobileMoneyProvider` interface, plus signed-callback helpers.

**Architecture:** Each provider is a factory returning `{ operators, collect, status }`. Shared plumbing (fetch with timeout, token cache with 401 retry, outcome helpers) lives in `src/http.ts`. A shared contract test runs against every provider so future aggregators prove they fit the same interface.

**Tech Stack:** Node 22+, TypeScript 6.0.3 (ESM, NodeNext), vitest 4.1.11, Biome 2.5.15, native `fetch`, `node:crypto`. Zero runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-13-mobile-money-sdk-design.md`

## Global Constraints

- `engines.node >= 22`, `"type": "module"`, zero runtime `dependencies`.
- Dev dependencies pinned: `typescript` 6.0.3, `vitest` 4.1.11, `@types/node` 25.6.0, `@biomejs/biome` 2.5.15.
- HTTP: native `fetch`, 20 s timeout (`AbortSignal.timeout`), `redirect: 'error'`.
- Token cached per provider instance until `expires_in − 60 s`; one shared in-flight fetch; 401 → clear token, retry once.
- Unknown provider status strings → `pending`. Never `failed`, never `completed`.
- `completed` only for a positive safe-integer amount in the provider's currency, else `unavailable/BAD_AMOUNT`.
- Secrets (password, PIN, API keys, tokens) never in error messages.
- Error kinds: `rejected` (nothing sent), `uncertain` (maybe sent; `ref` set when known), `unavailable` (status lookup failed).
- Invalid input → `rejected` with code `invalid_input`, before any network call.
- Imports inside `src` and `test` use `.js` extensions (NodeNext).
- Branch `claude/sdk-v1` off `dev`; PR targets `dev`.
- Every task ends with: `npm test`, `npm run type-check`, `npm run lint`, `npm run build` all green, then commit.

## Review Focus

- Gateway returns an HTML error page with HTTP 200 on a status lookup → `unavailable`, never `pending` (contract test "non-JSON status body", Task 3).
- Provider sends `expires_in` under 60 s or as a string → no stale token reuse, no crash (Task 1, tokenCache tests).
- App's callback URL already carries query params → they survive signing (Task 2).
- Empty callback secret → throws instead of producing forgeable signatures (Task 2).
- `ref` containing `/`, `?` or `..` → percent-encoded in the status URL (contract test "encodes ref", Task 3).

---

### Task 1: Scaffold, core types and HTTP plumbing

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `biome.json`, `.gitignore`, `.github/workflows/verify.yml`
- Create: `src/types.ts`, `src/http.ts`
- Test: `test/fetch.ts` (helper), `test/http.test.ts`

**Interfaces:**
- Produces (`src/types.ts`): `Operator`, `CollectRequest`, `FailureReason`, `Outcome`, `MobileMoneyProvider`, `ErrorKind`, `class MobileMoneyError(kind, code, ref?)`.
- Produces (`src/http.ts`):
  - `type HttpResult = { status: number; body: unknown }`
  - `send(url: string, init?: RequestInit): Promise<HttpResult>`, which throws on a network error or timeout
  - `ok(result): boolean`, `record(value): Record<string, unknown>`, `str(value): string`
  - `type Tokens = { get(): Promise<string>; clear(): void }`
  - `tokenCache(fetchToken: () => Promise<HttpResult>): Tokens`, which throws `MobileMoneyError('rejected', 'TOKEN_FAILED')`
  - `authorized(tokens, call: (token) => Promise<HttpResult>): Promise<HttpResult>`
  - `validAmount(n): boolean`
  - `providerCode(result): string`
  - `completed(amount: unknown, currency: string, expected: string): Outcome`
  - `unavailable(error: unknown): MobileMoneyError`
- Produces (`test/fetch.ts`): `type Reply`, `type Call`, `mockFetch(routes): { calls: Call[] }`, `headersOf(call)`, `bodyOf(call)`

- [ ] **Step 1: Scaffold the package**

`package.json`:
```json
{
  "name": "@halifage/mobile-money",
  "version": "0.1.0",
  "description": "Mobile money collections for Cameroon: Orange and MTN direct, extensible to aggregators",
  "license": "MIT",
  "repository": "github:halifage/mobile-money",
  "type": "module",
  "engines": { "node": ">=22" },
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "type-check": "tsc",
    "lint": "biome check .",
    "smoke": "npm run build && node test/package-smoke.mjs",
    "prepublishOnly": "npm run build"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.15",
    "@types/node": "25.6.0",
    "typescript": "6.0.3",
    "vitest": "4.1.11"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "declaration": true, "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.15/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "formatter": { "indentStyle": "space", "lineWidth": 120 },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "asNeeded" } }
}
```

`.gitignore`:
```
node_modules
dist
.env*
*.tgz
```

`.github/workflows/verify.yml`:
```yaml
name: verify
on:
  pull_request:
  push:
    branches: [dev, main]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run type-check
      - run: npm run lint
      - run: npm run smoke
```

Run: `cd ~/dev/mobile-money && npm install`
Expected: `package-lock.json` created, 0 vulnerabilities reported or only dev-dep advisories.

- [ ] **Step 2: Write the fetch mock helper**

`test/fetch.ts`:
```ts
import { vi } from 'vitest'

export type Reply = { status: number; body?: unknown; raw?: string } | Error
export type Call = { url: string; init: RequestInit }

/** Stubs global fetch. Routes match by URL substring (longest wins); an array replies in order, repeating its last entry. */
export function mockFetch(routes: Record<string, Reply | Reply[]>) {
  const calls: Call[] = []
  const queues = new Map(Object.entries(routes).map(([key, reply]) => [key, Array.isArray(reply) ? [...reply] : [reply]]))
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, init })
    const key = [...queues.keys()].filter((k) => url.includes(k)).sort((a, b) => b.length - a.length)[0]
    const queue = key === undefined ? undefined : queues.get(key)
    if (!queue) throw new Error(`unmocked fetch ${url}`)
    const reply = queue.length > 1 ? queue.shift() : queue[0]
    if (reply instanceof Error) throw reply
    if (!reply) throw new Error(`empty route ${key}`)
    const body = reply.raw ?? (reply.body === undefined ? null : JSON.stringify(reply.body))
    return new Response(body, { status: reply.status })
  })
  return { calls }
}

export const headersOf = (call: Call | undefined) => (call?.init.headers ?? {}) as Record<string, string>
export const bodyOf = (call: Call | undefined) => JSON.parse(String(call?.init.body))
```

- [ ] **Step 3: Write the failing tests**

`test/http.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorized, completed, type HttpResult, send, tokenCache } from '../src/http.js'
import { MobileMoneyError } from '../src/types.js'
import { mockFetch } from './fetch.js'

const token = (expires_in: number | string = 3600): HttpResult => ({
  status: 200,
  body: { access_token: 'tok', expires_in },
})

describe('send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses JSON, refuses redirects and sets a timeout signal', async () => {
    const { calls } = mockFetch({ 'x.test': { status: 200, body: { a: 1 } } })
    await expect(send('https://x.test/a')).resolves.toEqual({ status: 200, body: { a: 1 } })
    expect(calls[0]?.init.redirect).toBe('error')
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('turns a non-JSON body into null', async () => {
    mockFetch({ 'x.test': { status: 502, raw: '<html>Bad gateway</html>' } })
    await expect(send('https://x.test/a')).resolves.toEqual({ status: 502, body: null })
  })
})

describe('tokenCache', () => {
  it('shares one fetch across concurrent callers and caches the token', async () => {
    const fetchToken = vi.fn(async () => token())
    const tokens = tokenCache(fetchToken)
    await expect(Promise.all([tokens.get(), tokens.get()])).resolves.toEqual(['tok', 'tok'])
    await tokens.get()
    expect(fetchToken).toHaveBeenCalledTimes(1)
  })

  it('accepts expires_in as a string', async () => {
    const fetchToken = vi.fn(async () => token('3600'))
    const tokens = tokenCache(fetchToken)
    await tokens.get()
    await tokens.get()
    expect(fetchToken).toHaveBeenCalledTimes(1)
  })

  it('refetches every time when expires_in is under 60 s', async () => {
    const fetchToken = vi.fn(async () => token(30))
    const tokens = tokenCache(fetchToken)
    await tokens.get()
    await tokens.get()
    expect(fetchToken).toHaveBeenCalledTimes(2)
  })

  it('refetches after clear()', async () => {
    const fetchToken = vi.fn(async () => token())
    const tokens = tokenCache(fetchToken)
    await tokens.get()
    tokens.clear()
    await tokens.get()
    expect(fetchToken).toHaveBeenCalledTimes(2)
  })

  it('throws rejected TOKEN_FAILED on a bad response or network error', async () => {
    const failures: Array<() => Promise<HttpResult>> = [
      async () => ({ status: 401, body: null }),
      async () => ({ status: 200, body: { expires_in: 3600 } }),
      async () => {
        throw new TypeError('fetch failed')
      },
    ]
    for (const fetchToken of failures) {
      await expect(tokenCache(fetchToken).get()).rejects.toMatchObject({ kind: 'rejected', code: 'TOKEN_FAILED' })
    }
  })

  it('recovers after a failed fetch', async () => {
    const fetchToken = vi
      .fn<() => Promise<HttpResult>>()
      .mockResolvedValueOnce({ status: 500, body: null })
      .mockResolvedValue(token())
    const tokens = tokenCache(fetchToken)
    await expect(tokens.get()).rejects.toBeInstanceOf(MobileMoneyError)
    await expect(tokens.get()).resolves.toBe('tok')
  })
})

describe('authorized', () => {
  it('clears the token and retries once on 401', async () => {
    let n = 0
    const tokens = tokenCache(async () => ({ status: 200, body: { access_token: `tok${++n}`, expires_in: 3600 } }))
    const call = vi.fn(async (t: string) => ({ status: t === 'tok1' ? 401 : 200, body: null }))
    await expect(authorized(tokens, call)).resolves.toEqual({ status: 200, body: null })
    expect(call.mock.calls.map((c) => c[0])).toEqual(['tok1', 'tok2'])
  })

  it('returns a second 401 instead of looping', async () => {
    const tokens = tokenCache(async () => token())
    const call = vi.fn(async () => ({ status: 401, body: null }))
    await expect(authorized(tokens, call)).resolves.toEqual({ status: 401, body: null })
    expect(call).toHaveBeenCalledTimes(2)
  })
})

describe('completed', () => {
  it('accepts a positive integer amount in the expected currency', () => {
    expect(completed('10', 'XAF', 'XAF')).toEqual({ status: 'completed', amount: 10, currency: 'XAF' })
    expect(completed(10, 'XAF', 'XAF')).toEqual({ status: 'completed', amount: 10, currency: 'XAF' })
  })

  it.each([
    ['10.5', 'XAF'],
    ['0', 'XAF'],
    ['', 'XAF'],
    [undefined, 'XAF'],
    ['10', 'EUR'],
  ])('rejects amount %s in %s', (amount, currency) => {
    expect(() => completed(amount, currency, 'XAF')).toThrow(MobileMoneyError)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../src/http.js'` (or similar resolution error).

- [ ] **Step 5: Write `src/types.ts`**

```ts
export type Operator = 'mtn' | 'orange'

export interface CollectRequest {
  /** App's attempt id, used as the idempotency key. */
  id: string
  operator: Operator
  /** Whole units, positive integer. */
  amount: number
  /** E.164 or local; the provider normalises it. */
  phone: string
  description: string
  /** Passed through as is; sign it with signCallbackUrl. */
  callbackUrl: string
}

export type FailureReason = 'insufficient_funds' | 'declined' | 'expired' | 'unknown'

export type Outcome =
  | { status: 'completed'; amount: number; currency: string }
  | { status: 'failed'; reason: FailureReason; code?: string }
  | { status: 'pending' }

export interface MobileMoneyProvider {
  readonly operators: readonly Operator[]
  collect(request: CollectRequest): Promise<{ ref: string }>
  status(ref: string): Promise<Outcome>
}

/**
 * rejected: nothing was sent, no money moved.
 * uncertain: the request may have reached the provider; poll status(ref) when ref is set.
 * unavailable: a status lookup failed; retry later.
 */
export type ErrorKind = 'rejected' | 'uncertain' | 'unavailable'

export class MobileMoneyError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly code: string,
    readonly ref?: string,
  ) {
    super(`${kind}: ${code}`)
    this.name = 'MobileMoneyError'
  }
}
```

- [ ] **Step 6: Write `src/http.ts`**

```ts
import { MobileMoneyError, type Outcome } from './types.js'

const TIMEOUT_MS = 20_000

export type HttpResult = { status: number; body: unknown }

/** fetch with a timeout and no redirects; non-JSON bodies become null. Throws on network error or timeout. */
export async function send(url: string, init: RequestInit = {}): Promise<HttpResult> {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) })
  const text = await response.text()
  try {
    return { status: response.status, body: text ? JSON.parse(text) : null }
  } catch {
    return { status: response.status, body: null }
  }
}

export const ok = (result: HttpResult) => result.status >= 200 && result.status < 300

export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

export type Tokens = { get(): Promise<string>; clear(): void }

/** Bearer token cached until expires_in − 60 s; concurrent callers share one fetch. */
export function tokenCache(fetchToken: () => Promise<HttpResult>): Tokens {
  let cached: { token: string; expiresAt: number } | null = null
  let inflight: Promise<string> | null = null

  const load = async () => {
    const result = await fetchToken().catch(() => {
      throw new MobileMoneyError('rejected', 'TOKEN_FAILED')
    })
    const body = record(result.body)
    const token = str(body.access_token)
    const expiresIn = Number(body.expires_in)
    if (!ok(result) || !token || !Number.isFinite(expiresIn)) throw new MobileMoneyError('rejected', 'TOKEN_FAILED')
    cached = { token, expiresAt: Date.now() + Math.max(expiresIn - 60, 0) * 1000 }
    return token
  }

  return {
    get() {
      if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.token)
      inflight ??= load().finally(() => {
        inflight = null
      })
      return inflight
    },
    clear() {
      cached = null
    },
  }
}

/** Calls with a bearer token; on 401 clears the token and retries once. */
export async function authorized(tokens: Tokens, call: (token: string) => Promise<HttpResult>): Promise<HttpResult> {
  const first = await call(await tokens.get())
  if (first.status !== 401) return first
  tokens.clear()
  return call(await tokens.get())
}

export const validAmount = (amount: number) => Number.isSafeInteger(amount) && amount > 0

export function providerCode(result: HttpResult): string {
  const body = record(result.body)
  return (str(body.code) || str(body.message)).slice(0, 64) || `HTTP_${result.status}`
}

/** `completed` only for a positive integer amount in the expected currency. */
export function completed(amount: unknown, currency: string, expected: string): Outcome {
  const value = Number(str(amount))
  if (!Number.isSafeInteger(value) || value <= 0 || currency !== expected) {
    throw new MobileMoneyError('unavailable', 'BAD_AMOUNT')
  }
  return { status: 'completed', amount: value, currency }
}

export function unavailable(error: unknown): MobileMoneyError {
  return new MobileMoneyError('unavailable', error instanceof MobileMoneyError ? error.code : 'NETWORK')
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, all `test/http.test.ts` cases green.

- [ ] **Step 8: Format and run the full check**

Run: `npx biome check --write . && npm run type-check && npm run lint && npm run build`
Expected: all exit 0; `dist/types.js`, `dist/http.js` and `.d.ts` files emitted.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold sdk, core types, http plumbing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Signed callback URLs

**Files:**
- Create: `src/callback.ts`
- Test: `test/callback.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `signCallbackUrl(url: string, id: string, secret: string): string`, `verifyCallback(request: Request, secret: string): string | null`. Query params `id` and `sig` (hex HMAC-SHA256 of `id`).

- [ ] **Step 1: Write the failing tests**

`test/callback.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { signCallbackUrl, verifyCallback } from '../src/callback.js'

const secret = 'test-secret'
const verify = (url: string, key = secret) => verifyCallback(new Request(url, { method: 'POST' }), key)

describe('callbacks', () => {
  it('verifies a signed URL and keeps existing query params', () => {
    const url = signCallbackUrl('https://app.test/cb?tenant=a', 'attempt-1', secret)
    expect(new URL(url).searchParams.get('tenant')).toBe('a')
    expect(verify(url)).toBe('attempt-1')
  })

  it('rejects a tampered id', () => {
    const url = new URL(signCallbackUrl('https://app.test/cb', 'attempt-1', secret))
    url.searchParams.set('id', 'attempt-2')
    expect(verify(url.toString())).toBeNull()
  })

  it('rejects a tampered, non-hex or missing signature', () => {
    const url = new URL(signCallbackUrl('https://app.test/cb', 'attempt-1', secret))
    for (const sig of ['00'.repeat(32), 'zz', '']) {
      url.searchParams.set('sig', sig)
      expect(verify(url.toString())).toBeNull()
    }
    expect(verify('https://app.test/cb?id=attempt-1')).toBeNull()
    expect(verify('https://app.test/cb')).toBeNull()
  })

  it('rejects a signature made with another secret', () => {
    expect(verify(signCallbackUrl('https://app.test/cb', 'attempt-1', 'other'))).toBeNull()
  })

  it('refuses an empty secret', () => {
    expect(() => signCallbackUrl('https://app.test/cb', 'attempt-1', '')).toThrow(TypeError)
    expect(() => verify('https://app.test/cb?id=a&sig=00', '')).toThrow(TypeError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/callback.test.ts`
Expected: FAIL, cannot resolve `../src/callback.js`.

- [ ] **Step 3: Write `src/callback.ts`**

```ts
import { Buffer } from 'node:buffer'
import { createHmac, timingSafeEqual } from 'node:crypto'

function sign(id: string, secret: string): string {
  if (!secret) throw new TypeError('callback secret is empty')
  return createHmac('sha256', secret).update(id).digest('hex')
}

/** Appends id and an HMAC of it, so callbacks can be authenticated without trusting their body. */
export function signCallbackUrl(url: string, id: string, secret: string): string {
  const signed = new URL(url)
  signed.searchParams.set('id', id)
  signed.searchParams.set('sig', sign(id, secret))
  return signed.toString()
}

/** Returns the signed id, or null. Reads only the query string, never the body. */
export function verifyCallback(request: Request, secret: string): string | null {
  const params = new URL(request.url).searchParams
  const id = params.get('id')
  const expected = Buffer.from(sign(id ?? '', secret), 'hex')
  const actual = Buffer.from(params.get('sig') ?? '', 'hex')
  return id && actual.length === expected.length && timingSafeEqual(actual, expected) ? id : null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/callback.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Format and full check**

Run: `npx biome check --write . && npm test && npm run type-check && npm run lint && npm run build`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: signed callback urls

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Provider contract and Orange direct adapter

**Files:**
- Create: `src/orange.ts`
- Test: `test/contract.ts` (shared suite, not collected on its own), `test/orange.test.ts`

**Interfaces:**
- Consumes: `send`, `ok`, `record`, `str`, `tokenCache`, `authorized`, `validAmount`, `providerCode`, `completed`, `unavailable`, `HttpResult` from `src/http.ts`; `MobileMoneyError`, `MobileMoneyProvider`, `Outcome`, `CollectRequest`, `FailureReason` from `src/types.ts`; `mockFetch`, `Reply`, `Call`, `headersOf`, `bodyOf` from `test/fetch.ts`.
- Produces: `orangeDirect(config: OrangeDirectConfig): MobileMoneyProvider` and `type OrangeDirectConfig = { username; password; authToken; merchantMsisdn; pin; baseUrl? }`.
  - `describeProviderContract(name: string, fixtures: ContractFixtures)`, `type ContractFixtures`, `TOKEN: Reply`, `caught(promise): Promise<MobileMoneyError>`, all exported from `test/contract.ts`.

- [ ] **Step 1: Write the shared contract**

`test/contract.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CollectRequest, type FailureReason, MobileMoneyError, type MobileMoneyProvider } from '../src/types.js'
import { type Call, mockFetch, type Reply } from './fetch.js'

export type ContractFixtures = {
  make: () => MobileMoneyProvider
  request: CollectRequest
  currency: string
  /** mockFetch route keys: the call that hands the payment to the provider, and the status lookup */
  paths: { send: string; status: string }
  /** routes, besides the token, that make collect succeed */
  accepted: Record<string, Reply>
  expectedRef: string
  status: { completed: Reply; failed: Reply; failedReason: FailureReason; pending: Reply; unknown: Reply }
}

export const TOKEN: Reply = { status: 200, body: { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 } }

export async function caught(promise: Promise<unknown>): Promise<MobileMoneyError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(MobileMoneyError)
  return error as MobileMoneyError
}

const tokenCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/token')).length

export function describeProviderContract(name: string, f: ContractFixtures) {
  describe(`${name} contract`, () => {
    afterEach(() => vi.unstubAllGlobals())
    const ref = f.expectedRef

    it('collect returns the ref', async () => {
      mockFetch({ '/token': TOKEN, ...f.accepted })
      await expect(f.make().collect(f.request)).resolves.toEqual({ ref })
    })

    it('4xx on send → rejected', async () => {
      mockFetch({ '/token': TOKEN, ...f.accepted, [f.paths.send]: { status: 400, body: { message: 'bad' } } })
      expect((await caught(f.make().collect(f.request))).kind).toBe('rejected')
    })

    it('network error on send → uncertain with ref', async () => {
      mockFetch({ '/token': TOKEN, ...f.accepted, [f.paths.send]: new TypeError('fetch failed') })
      expect(await caught(f.make().collect(f.request))).toMatchObject({ kind: 'uncertain', ref })
    })

    it('5xx on send → uncertain with ref', async () => {
      mockFetch({ '/token': TOKEN, ...f.accepted, [f.paths.send]: { status: 503 } })
      expect(await caught(f.make().collect(f.request))).toMatchObject({ kind: 'uncertain', ref })
    })

    it('token failure → rejected and nothing sent', async () => {
      const { calls } = mockFetch({ '/token': { status: 500 }, ...f.accepted })
      expect(await caught(f.make().collect(f.request))).toMatchObject({ kind: 'rejected', code: 'TOKEN_FAILED' })
      expect(calls.some((c) => c.url.includes(f.paths.send))).toBe(false)
    })

    it('invalid amount → rejected before any network call', async () => {
      const { calls } = mockFetch({})
      for (const amount of [0, -5, 10.5, Number.NaN]) {
        const error = await caught(f.make().collect({ ...f.request, amount }))
        expect(error).toMatchObject({ kind: 'rejected', code: 'invalid_input' })
      }
      expect(calls).toHaveLength(0)
    })

    it('unsupported operator → rejected before any network call', async () => {
      const { calls } = mockFetch({})
      const operator = f.request.operator === 'mtn' ? 'orange' : 'mtn'
      const error = await caught(f.make().collect({ ...f.request, operator }))
      expect(error).toMatchObject({ kind: 'rejected', code: 'invalid_input' })
      expect(calls).toHaveLength(0)
    })

    it('maps completed', async () => {
      mockFetch({ '/token': TOKEN, [f.paths.status]: f.status.completed })
      await expect(f.make().status(ref)).resolves.toEqual({
        status: 'completed',
        amount: f.request.amount,
        currency: f.currency,
      })
    })

    it('maps failed', async () => {
      mockFetch({ '/token': TOKEN, [f.paths.status]: f.status.failed })
      await expect(f.make().status(ref)).resolves.toMatchObject({ status: 'failed', reason: f.status.failedReason })
    })

    it('maps pending, and unknown statuses to pending', async () => {
      mockFetch({ '/token': TOKEN, [f.paths.status]: [f.status.pending, f.status.unknown] })
      const provider = f.make()
      await expect(provider.status(ref)).resolves.toEqual({ status: 'pending' })
      await expect(provider.status(ref)).resolves.toEqual({ status: 'pending' })
    })

    it('status 5xx, network error or non-JSON body → unavailable', async () => {
      const replies: Reply[] = [{ status: 500 }, new TypeError('fetch failed'), { status: 200, raw: '<html>oops</html>' }]
      for (const reply of replies) {
        mockFetch({ '/token': TOKEN, [f.paths.status]: reply })
        expect((await caught(f.make().status(ref))).kind).toBe('unavailable')
      }
    })

    it('401 → refreshes the token and retries once', async () => {
      const { calls } = mockFetch({ '/token': TOKEN, [f.paths.status]: [{ status: 401 }, f.status.completed] })
      await expect(f.make().status(ref)).resolves.toMatchObject({ status: 'completed' })
      expect(tokenCalls(calls)).toBe(2)
    })

    it('shares one token across concurrent and sequential calls', async () => {
      const { calls } = mockFetch({ '/token': TOKEN, [f.paths.status]: f.status.pending })
      const provider = f.make()
      await Promise.all([provider.status(ref), provider.status(ref)])
      await provider.status(ref)
      expect(tokenCalls(calls)).toBe(1)
    })

    it('encodes the ref in the status URL', async () => {
      const { calls } = mockFetch({ '/token': TOKEN, [f.paths.status]: f.status.pending })
      await f.make().status('../x?y')
      expect(calls.find((c) => c.url.includes(f.paths.status))?.url).toContain('..%2Fx%3Fy')
    })
  })
}
```

- [ ] **Step 2: Write the failing Orange tests**

`test/orange.test.ts`:
```ts
import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { orangeDirect } from '../src/orange.js'
import type { CollectRequest } from '../src/types.js'
import { caught, describeProviderContract, TOKEN } from './contract.js'
import { bodyOf, headersOf, mockFetch, type Reply } from './fetch.js'

const config = {
  username: 'user',
  password: 'pass',
  authToken: 'xauth',
  merchantMsisdn: '699000000',
  pin: '4242',
  baseUrl: 'https://orange.test',
}
const request: CollectRequest = {
  id: 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  operator: 'orange',
  amount: 10,
  phone: '+237690000000',
  description: 'Order 42',
  callbackUrl: 'https://app.test/cb?id=x&sig=y',
}
const INIT: Reply = { status: 200, body: { message: 'Payment request successfully initiated', data: { payToken: 'MP123' } } }
const PAY: Reply = { status: 200, body: { message: 'Merchant payment successfully initiated', data: { status: 'PENDING' } } }
const statusReply = (status: string, amount: unknown = '10'): Reply => ({ status: 200, body: { data: { status, amount } } })
const accepted = { '/mp/init': INIT, '/mp/pay': PAY }

describeProviderContract('orangeDirect', {
  make: () => orangeDirect(config),
  request,
  currency: 'XAF',
  paths: { send: '/mp/pay', status: '/mp/paymentstatus' },
  accepted,
  expectedRef: 'MP123',
  status: {
    completed: statusReply('SUCCESSFULL'),
    failed: statusReply('CANCELLED'),
    failedReason: 'declined',
    pending: statusReply('PENDING'),
    unknown: statusReply('WAITING_FOR_SOMETHING'),
  },
})

describe('orangeDirect', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('authenticates with Basic for the token, then Bearer + X-AUTH-TOKEN', async () => {
    const { calls } = mockFetch({ '/token': TOKEN, ...accepted })
    await orangeDirect(config).collect(request)
    expect(calls[0]?.url).toBe('https://orange.test/token')
    expect(headersOf(calls[0]).authorization).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`)
    expect(calls[0]?.init.body).toBe('grant_type=client_credentials')
    for (const call of calls.slice(1)) {
      expect(headersOf(call)).toMatchObject({ authorization: 'Bearer tok', 'x-auth-token': 'xauth' })
    }
    expect(calls.map((c) => c.url)).toEqual([
      'https://orange.test/token',
      'https://orange.test/omcoreapis/1.0.2/mp/init',
      'https://orange.test/omcoreapis/1.0.2/mp/pay',
    ])
  })

  it('sends the pay body', async () => {
    const { calls } = mockFetch({ '/token': TOKEN, ...accepted })
    await orangeDirect(config).collect(request)
    expect(bodyOf(calls[2])).toEqual({
      notifUrl: 'https://app.test/cb?id=x&sig=y',
      channelUserMsisdn: '699000000',
      amount: '10',
      subscriberMsisdn: '690000000',
      pin: '4242',
      orderId: request.id,
      description: 'Order 42',
      payToken: 'MP123',
    })
  })

  it.each(['+237690000000', '237690000000', '690 00 00 00', '690-000-000'])('normalises phone %s', async (phone) => {
    const { calls } = mockFetch({ '/token': TOKEN, ...accepted })
    await orangeDirect(config).collect({ ...request, phone })
    expect(bodyOf(calls[2]).subscriberMsisdn).toBe('690000000')
  })

  it.each(['+33612345678', '2376900', '790000000'])('rejects phone %s before any network call', async (phone) => {
    const { calls } = mockFetch({})
    expect(await caught(orangeDirect(config).collect({ ...request, phone }))).toMatchObject({
      kind: 'rejected',
      code: 'invalid_input',
    })
    expect(calls).toHaveLength(0)
  })

  it.each<Reply>([{ status: 500 }, new TypeError('fetch failed'), { status: 200, body: { data: {} } }])(
    'init failure → rejected and pay never sent',
    async (init) => {
      const { calls } = mockFetch({ '/token': TOKEN, '/mp/init': init, '/mp/pay': PAY })
      expect((await caught(orangeDirect(config).collect(request))).kind).toBe('rejected')
      expect(calls.some((c) => c.url.endsWith('/mp/pay'))).toBe(false)
    },
  )

  it.each(['SUCCESSFULL', 'SUCCESSFUL', 'SUCCESS', 'successful'])('treats %s as completed', async (status) => {
    mockFetch({ '/token': TOKEN, '/mp/paymentstatus': statusReply(status, 10) })
    await expect(orangeDirect(config).status('MP123')).resolves.toEqual({
      status: 'completed',
      amount: 10,
      currency: 'XAF',
    })
  })

  it('maps FAILED and EXPIRED', async () => {
    mockFetch({ '/token': TOKEN, '/mp/paymentstatus': [statusReply('FAILED'), statusReply('EXPIRED')] })
    const provider = orangeDirect(config)
    await expect(provider.status('MP123')).resolves.toEqual({ status: 'failed', reason: 'unknown', code: 'FAILED' })
    await expect(provider.status('MP123')).resolves.toEqual({ status: 'failed', reason: 'expired', code: 'EXPIRED' })
  })

  it('success with a bad amount or a missing status → unavailable', async () => {
    for (const reply of [statusReply('SUCCESSFULL', '10.5'), statusReply('SUCCESSFULL', null), statusReply('')]) {
      mockFetch({ '/token': TOKEN, '/mp/paymentstatus': reply })
      expect((await caught(orangeDirect(config).status('MP123'))).kind).toBe('unavailable')
    }
  })

  it('never puts the PIN or credentials in errors', async () => {
    for (const pay of [{ status: 500 }, { status: 400, body: { message: 'Invalid subscriber' } }]) {
      mockFetch({ '/token': TOKEN, '/mp/init': INIT, '/mp/pay': pay })
      const error = await caught(orangeDirect(config).collect(request))
      const text = `${error.message} ${JSON.stringify(error)}`
      for (const secret of ['4242', 'pass', 'xauth', 'tok']) expect(text).not.toContain(secret)
    }
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/orange.test.ts`
Expected: FAIL, cannot resolve `../src/orange.js`.

- [ ] **Step 4: Write `src/orange.ts`**

```ts
import { Buffer } from 'node:buffer'
import {
  authorized,
  completed,
  type HttpResult,
  ok,
  providerCode,
  record,
  send,
  str,
  tokenCache,
  unavailable,
  validAmount,
} from './http.js'
import { MobileMoneyError, type MobileMoneyProvider, type Outcome } from './types.js'

export type OrangeDirectConfig = {
  username: string
  password: string
  /** X-AUTH-TOKEN issued with the merchant account */
  authToken: string
  /** channelUserMsisdn: the merchant's number */
  merchantMsisdn: string
  pin: string
  baseUrl?: string
}

const API = '/omcoreapis/1.0.2/mp'

/** 9-digit local number (Orange refuses the country code), or null. */
function localPhone(phone: string): string | null {
  const digits = phone.replace(/[\s-]/g, '').replace(/^\+?237/, '')
  return /^6\d{8}$/.test(digits) ? digits : null
}

function outcome(data: Record<string, unknown>): Outcome {
  switch (str(data.status).toUpperCase()) {
    case 'SUCCESSFULL':
    case 'SUCCESSFUL':
    case 'SUCCESS':
      return completed(data.amount, 'XAF', 'XAF')
    case 'FAILED':
      return { status: 'failed', reason: 'unknown', code: 'FAILED' }
    case 'CANCELLED':
      return { status: 'failed', reason: 'declined', code: 'CANCELLED' }
    case 'EXPIRED':
      return { status: 'failed', reason: 'expired', code: 'EXPIRED' }
    case '':
      throw new MobileMoneyError('unavailable', 'BAD_RESPONSE')
    default:
      return { status: 'pending' }
  }
}

/** Orange Money Cameroon local API (api-s1.orange.cm). */
export function orangeDirect(config: OrangeDirectConfig): MobileMoneyProvider {
  const base = config.baseUrl ?? 'https://api-s1.orange.cm'
  const basic = Buffer.from(`${config.username}:${config.password}`).toString('base64')
  const tokens = tokenCache(() =>
    send(`${base}/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    }),
  )
  const call = (path: string, init: RequestInit = {}) =>
    authorized(tokens, (token) =>
      send(`${base}${API}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, 'x-auth-token': config.authToken, 'content-type': 'application/json' },
      }),
    )

  return {
    operators: ['orange'],

    async collect(request) {
      const subscriberMsisdn = localPhone(request.phone)
      if (request.operator !== 'orange' || !subscriberMsisdn || !validAmount(request.amount)) {
        throw new MobileMoneyError('rejected', 'invalid_input')
      }

      // init only reserves a payToken, so any failure here means nothing was charged
      const init = await call('/init', { method: 'POST' }).catch((error: unknown) => {
        throw error instanceof MobileMoneyError ? error : new MobileMoneyError('rejected', 'NETWORK')
      })
      const payToken = str(record(record(init.body).data).payToken)
      if (!ok(init) || !payToken) throw new MobileMoneyError('rejected', providerCode(init))

      let pay: HttpResult
      try {
        pay = await call('/pay', {
          method: 'POST',
          body: JSON.stringify({
            notifUrl: request.callbackUrl,
            channelUserMsisdn: config.merchantMsisdn,
            amount: String(request.amount),
            subscriberMsisdn,
            pin: config.pin,
            orderId: request.id,
            description: request.description,
            payToken,
          }),
        })
      } catch (error) {
        // a MobileMoneyError here is a token failure: pay was never sent
        if (error instanceof MobileMoneyError) throw error
        throw new MobileMoneyError('uncertain', 'NETWORK', payToken)
      }
      if (ok(pay)) return { ref: payToken }
      if (pay.status < 500) throw new MobileMoneyError('rejected', providerCode(pay))
      throw new MobileMoneyError('uncertain', `HTTP_${pay.status}`, payToken)
    },

    async status(ref) {
      try {
        const result = await call(`/paymentstatus/${encodeURIComponent(ref)}`)
        if (!ok(result)) throw new MobileMoneyError('unavailable', `HTTP_${result.status}`)
        return outcome(record(record(result.body).data))
      } catch (error) {
        throw unavailable(error)
      }
    },
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/orange.test.ts`
Expected: PASS, contract and Orange cases green.

- [ ] **Step 6: Format and full check**

Run: `npx biome check --write . && npm test && npm run type-check && npm run lint && npm run build`
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: orange direct adapter, shared provider contract

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: MTN direct adapter

**Files:**
- Create: `src/mtn.ts`
- Test: `test/mtn.test.ts`

**Interfaces:**
- Consumes: the same `src/http.ts` and `src/types.ts` exports as Task 3, plus `FailureReason`; `describeProviderContract`, `TOKEN`, `caught` from `test/contract.ts`; `mockFetch`, `headersOf`, `bodyOf`, `Reply` from `test/fetch.ts`.
- Produces: `mtnDirect(config: MtnDirectConfig): MobileMoneyProvider`, `type MtnDirectConfig = { subscriptionKey; apiUser; apiKey; environment: 'sandbox' | 'mtncameroon'; baseUrl? }`.

- [ ] **Step 1: Write the failing tests**

`test/mtn.test.ts`:
```ts
import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type MtnDirectConfig, mtnDirect } from '../src/mtn.js'
import type { CollectRequest } from '../src/types.js'
import { caught, describeProviderContract, TOKEN } from './contract.js'
import { bodyOf, headersOf, mockFetch, type Reply } from './fetch.js'

const config: MtnDirectConfig = {
  subscriptionKey: 'sub',
  apiUser: 'user',
  apiKey: 'key',
  environment: 'mtncameroon',
  baseUrl: 'https://mtn.test',
}
const request: CollectRequest = {
  id: 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  operator: 'mtn',
  amount: 10,
  phone: '677000000',
  description: 'Order 42',
  callbackUrl: 'https://app.test/cb?id=x&sig=y',
}
const body = (status: string, extra: Record<string, unknown> = {}): Reply => ({
  status: 200,
  body: { status, amount: '10', currency: 'XAF', ...extra },
})

describeProviderContract('mtnDirect', {
  make: () => mtnDirect(config),
  request,
  currency: 'XAF',
  paths: { send: 'requesttopay', status: 'requesttopay/' },
  accepted: { requesttopay: { status: 202 } },
  expectedRef: request.id,
  status: {
    completed: body('SUCCESSFUL'),
    failed: body('FAILED', { reason: 'NOT_ENOUGH_FUNDS' }),
    failedReason: 'insufficient_funds',
    pending: body('PENDING'),
    unknown: body('ONGOING'),
  },
})

describe('mtnDirect', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the documented headers and body', async () => {
    const { calls } = mockFetch({ '/token': TOKEN, requesttopay: { status: 202 } })
    await mtnDirect(config).collect(request)
    expect(calls[0]?.url).toBe('https://mtn.test/collection/token/')
    expect(headersOf(calls[0])).toMatchObject({
      authorization: `Basic ${Buffer.from('user:key').toString('base64')}`,
      'ocp-apim-subscription-key': 'sub',
    })
    expect(calls[1]?.url).toBe('https://mtn.test/collection/v1_0/requesttopay')
    expect(headersOf(calls[1])).toMatchObject({
      authorization: 'Bearer tok',
      'ocp-apim-subscription-key': 'sub',
      'x-target-environment': 'mtncameroon',
      'x-reference-id': request.id,
      'x-callback-url': request.callbackUrl,
    })
    expect(bodyOf(calls[1])).toEqual({
      amount: '10',
      currency: 'XAF',
      externalId: request.id,
      payer: { partyIdType: 'MSISDN', partyId: '237677000000' },
      payerMessage: 'Order 42',
      payeeNote: 'Order 42',
    })
  })

  it('treats 409 (reference already used) as accepted', async () => {
    mockFetch({ '/token': TOKEN, requesttopay: { status: 409, body: { code: 'RESOURCE_ALREADY_EXIST' } } })
    await expect(mtnDirect(config).collect(request)).resolves.toEqual({ ref: request.id })
  })

  it('rejects a non-UUID id before any network call', async () => {
    const { calls } = mockFetch({})
    expect(await caught(mtnDirect(config).collect({ ...request, id: 'order-42' }))).toMatchObject({
      kind: 'rejected',
      code: 'invalid_input',
    })
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['APPROVAL_REJECTED', 'declined'],
    ['EXPIRED', 'expired'],
    ['INTERNAL_PROCESSING_ERROR', 'unknown'],
  ])('maps FAILED reason %s to %s', async (reason, expected) => {
    mockFetch({ '/token': TOKEN, 'requesttopay/': body('FAILED', { reason }) })
    await expect(mtnDirect(config).status(request.id)).resolves.toEqual({
      status: 'failed',
      reason: expected,
      code: reason,
    })
  })

  it('reads a FAILED reason given as an object', async () => {
    mockFetch({ '/token': TOKEN, 'requesttopay/': body('FAILED', { reason: { code: 'NOT_ENOUGH_FUNDS' } }) })
    await expect(mtnDirect(config).status(request.id)).resolves.toMatchObject({ reason: 'insufficient_funds' })
  })

  it('404 → failed NOT_FOUND', async () => {
    mockFetch({ '/token': TOKEN, 'requesttopay/': { status: 404 } })
    await expect(mtnDirect(config).status(request.id)).resolves.toEqual({
      status: 'failed',
      reason: 'unknown',
      code: 'NOT_FOUND',
    })
  })

  it('success in the wrong currency → unavailable', async () => {
    mockFetch({ '/token': TOKEN, 'requesttopay/': body('SUCCESSFUL', { currency: 'EUR' }) })
    expect(await caught(mtnDirect(config).status(request.id))).toMatchObject({ kind: 'unavailable', code: 'BAD_AMOUNT' })
  })

  it('refuses sandbox MSISDNs in production', async () => {
    const { calls } = mockFetch({})
    expect((await caught(mtnDirect(config).collect({ ...request, phone: '46733123450' }))).code).toBe('invalid_input')
    expect(calls).toHaveLength(0)
  })

  it('sandbox: default base URL, EUR, test MSISDNs accepted', async () => {
    const { calls } = mockFetch({ '/token': TOKEN, requesttopay: { status: 202 } })
    await mtnDirect({ ...config, environment: 'sandbox', baseUrl: undefined }).collect({
      ...request,
      phone: '46733123450',
    })
    expect(calls[1]?.url).toBe('https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay')
    expect(headersOf(calls[1])['x-target-environment']).toBe('sandbox')
    expect(bodyOf(calls[1])).toMatchObject({ currency: 'EUR', payer: { partyId: '46733123450' } })
  })

  it('production default base URL', async () => {
    const { calls } = mockFetch({ '/token': TOKEN, requesttopay: { status: 202 } })
    await mtnDirect({ ...config, baseUrl: undefined }).collect(request)
    expect(calls[0]?.url).toBe('https://proxy.momoapi.mtn.com/collection/token/')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/mtn.test.ts`
Expected: FAIL, cannot resolve `../src/mtn.js`.

- [ ] **Step 3: Write `src/mtn.ts`**

```ts
import { Buffer } from 'node:buffer'
import {
  authorized,
  completed,
  type HttpResult,
  ok,
  providerCode,
  record,
  send,
  str,
  tokenCache,
  unavailable,
  validAmount,
} from './http.js'
import { type FailureReason, MobileMoneyError, type MobileMoneyProvider } from './types.js'

export type MtnDirectConfig = {
  subscriptionKey: string
  apiUser: string
  apiKey: string
  environment: 'sandbox' | 'mtncameroon'
  baseUrl?: string
}

const BASE = { sandbox: 'https://sandbox.momodeveloper.mtn.com', mtncameroon: 'https://proxy.momoapi.mtn.com' }
const CURRENCY = { sandbox: 'EUR', mtncameroon: 'XAF' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REASONS: Record<string, FailureReason> = {
  NOT_ENOUGH_FUNDS: 'insufficient_funds',
  APPROVAL_REJECTED: 'declined',
  EXPIRED: 'expired',
}

/** 2376XXXXXXXX, or a sandbox test number in sandbox, or null. */
function partyId(phone: string, sandbox: boolean): string | null {
  const digits = phone.replace(/[\s-]/g, '').replace(/^\+/, '')
  const msisdn = /^6\d{8}$/.test(digits) ? `237${digits}` : digits
  if (/^2376\d{8}$/.test(msisdn)) return msisdn
  // ponytail: sandbox test numbers (e.g. 46733123450) have no fixed shape, so any 8–15 digits pass there
  return sandbox && /^\d{8,15}$/.test(digits) ? digits : null
}

/** MTN MoMo Collections API. */
export function mtnDirect(config: MtnDirectConfig): MobileMoneyProvider {
  const base = config.baseUrl ?? BASE[config.environment]
  const currency = CURRENCY[config.environment]
  const sandbox = config.environment === 'sandbox'
  const basic = Buffer.from(`${config.apiUser}:${config.apiKey}`).toString('base64')
  const tokens = tokenCache(() =>
    send(`${base}/collection/token/`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'ocp-apim-subscription-key': config.subscriptionKey },
    }),
  )
  const call = (path: string, init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {}) =>
    authorized(tokens, (token) =>
      send(`${base}/collection/v1_0${path}`, {
        ...init,
        headers: {
          ...init.headers,
          authorization: `Bearer ${token}`,
          'ocp-apim-subscription-key': config.subscriptionKey,
          'x-target-environment': config.environment,
        },
      }),
    )

  return {
    operators: ['mtn'],

    async collect(request) {
      const payer = partyId(request.phone, sandbox)
      if (request.operator !== 'mtn' || !UUID.test(request.id) || !payer || !validAmount(request.amount)) {
        throw new MobileMoneyError('rejected', 'invalid_input')
      }

      let result: HttpResult
      try {
        result = await call('/requesttopay', {
          method: 'POST',
          headers: {
            'x-reference-id': request.id,
            'x-callback-url': request.callbackUrl,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            amount: String(request.amount),
            currency,
            externalId: request.id,
            payer: { partyIdType: 'MSISDN', partyId: payer },
            payerMessage: request.description,
            payeeNote: request.description,
          }),
        })
      } catch (error) {
        // a MobileMoneyError here is a token failure: the request was never sent
        if (error instanceof MobileMoneyError) throw error
        throw new MobileMoneyError('uncertain', 'NETWORK', request.id)
      }
      // 409: this reference was already accepted, so a retry is idempotent
      if (ok(result) || result.status === 409) return { ref: request.id }
      if (result.status < 500) throw new MobileMoneyError('rejected', providerCode(result))
      throw new MobileMoneyError('uncertain', `HTTP_${result.status}`, request.id)
    },

    async status(ref) {
      try {
        const result = await call(`/requesttopay/${encodeURIComponent(ref)}`)
        if (result.status === 404) return { status: 'failed', reason: 'unknown', code: 'NOT_FOUND' }
        if (!ok(result)) throw new MobileMoneyError('unavailable', `HTTP_${result.status}`)
        const body = record(result.body)
        const status = str(body.status).toUpperCase()
        if (status === 'SUCCESSFUL') return completed(body.amount, str(body.currency), currency)
        if (status === 'FAILED') {
          const code = (str(body.reason) || str(record(body.reason).code)).toUpperCase()
          return { status: 'failed', reason: REASONS[code] ?? 'unknown', code: code || 'FAILED' }
        }
        if (!status) throw new MobileMoneyError('unavailable', 'BAD_RESPONSE')
        return { status: 'pending' }
      } catch (error) {
        throw unavailable(error)
      }
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/mtn.test.ts`
Expected: PASS, contract and MTN cases green.

- [ ] **Step 5: Format and full check**

Run: `npx biome check --write . && npm test && npm run type-check && npm run lint && npm run build`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: mtn direct adapter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Public entry, package smoke test, live script, README

**Files:**
- Create: `src/index.ts`, `test/package-smoke.mjs`, `scripts/live-orange.mjs`, `README.md`

**Interfaces:**
- Consumes: all of `src/`.
- Produces: the package's public surface. Runtime exports, sorted: `MobileMoneyError`, `mtnDirect`, `orangeDirect`, `signCallbackUrl`, `verifyCallback`. Type exports: `CollectRequest`, `ErrorKind`, `FailureReason`, `MobileMoneyProvider`, `MtnDirectConfig`, `Operator`, `OrangeDirectConfig`, `Outcome`.

- [ ] **Step 1: Write the failing smoke test**

`test/package-smoke.mjs`:
```js
// Packs the package, installs the tarball in a temp project and checks its runtime exports.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mobile-money-smoke-'))
const tarball = execFileSync('npm', ['pack', '--pack-destination', dir], { encoding: 'utf8' }).trim().split('\n').pop()
writeFileSync(join(dir, 'package.json'), '{ "type": "module" }')
execFileSync('npm', ['install', '--no-audit', '--no-fund', join(dir, tarball)], { cwd: dir, stdio: 'inherit' })
writeFileSync(
  join(dir, 'check.mjs'),
  `import * as sdk from '@halifage/mobile-money'
const want = ['MobileMoneyError', 'mtnDirect', 'orangeDirect', 'signCallbackUrl', 'verifyCallback']
const got = Object.keys(sdk).sort()
if (JSON.stringify(got) !== JSON.stringify(want)) {
  console.error('unexpected exports', got)
  process.exit(1)
}
console.log('smoke ok')
`,
)
execFileSync('node', ['check.mjs'], { cwd: dir, stdio: 'inherit' })
```

Run: `npm run smoke`
Expected: FAIL. `tsc` builds, but the import fails with `ERR_MODULE_NOT_FOUND` / missing `dist/index.js`.

- [ ] **Step 2: Write `src/index.ts`**

```ts
export { signCallbackUrl, verifyCallback } from './callback.js'
export { type MtnDirectConfig, mtnDirect } from './mtn.js'
export { type OrangeDirectConfig, orangeDirect } from './orange.js'
export {
  type CollectRequest,
  type ErrorKind,
  type FailureReason,
  MobileMoneyError,
  type MobileMoneyProvider,
  type Operator,
  type Outcome,
} from './types.js'
```

Run: `npm run smoke`
Expected: ends with `smoke ok`.

- [ ] **Step 3: Write the live Orange script**

`scripts/live-orange.mjs`:
```js
// Live Orange Money test. Moves real money.
// Usage: npm run build && node --env-file=.env.live scripts/live-orange.mjs 6XXXXXXXX [amount=10]
// .env.live: ORANGE_USERNAME, ORANGE_PASSWORD, ORANGE_AUTH_TOKEN, ORANGE_MERCHANT_MSISDN, ORANGE_PIN
import { randomUUID } from 'node:crypto'
import { orangeDirect } from '../dist/index.js'

const env = process.env
const [phone, amount = '10'] = process.argv.slice(2)
if (!phone) {
  console.error('usage: node --env-file=.env.live scripts/live-orange.mjs 6XXXXXXXX [amount]')
  process.exit(1)
}

const secrets = [env.ORANGE_PIN, env.ORANGE_PASSWORD, env.ORANGE_AUTH_TOKEN].filter(Boolean)
const redact = (text) =>
  secrets
    .reduce((out, secret) => out.replaceAll(secret, '***'), text)
    .replace(/"access_token"\s*:\s*"[^"]+"/g, '"access_token":"***"')

// log every raw provider response, redacted, to record real status spellings
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  const response = await realFetch(url, init)
  const body = await response.clone().text()
  console.log(`${init?.method ?? 'GET'} ${new URL(url).pathname} → ${response.status} ${redact(body)}`)
  return response
}

const provider = orangeDirect({
  username: env.ORANGE_USERNAME,
  password: env.ORANGE_PASSWORD,
  authToken: env.ORANGE_AUTH_TOKEN,
  merchantMsisdn: env.ORANGE_MERCHANT_MSISDN,
  pin: env.ORANGE_PIN,
})

let ref
try {
  ;({ ref } = await provider.collect({
    id: randomUUID(),
    operator: 'orange',
    amount: Number(amount),
    phone,
    description: 'mobile-money live test',
    callbackUrl: 'https://example.com/cb',
  }))
} catch (error) {
  console.error('collect failed', error.kind, error.code, error.ref ?? '')
  if (!error.ref) process.exit(1)
  ref = error.ref
}

console.log('ref', ref, '— approve the payment on the phone')
const deadline = Date.now() + 180_000
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 5000))
  const outcome = await provider.status(ref).catch((error) => ({ error: `${error.kind}:${error.code}` }))
  console.log(new Date().toISOString(), JSON.stringify(outcome))
  if (outcome.status === 'completed' || outcome.status === 'failed') break
}
```

Run: `node --check scripts/live-orange.mjs`
Expected: exit 0 (syntax only; the user runs it for real in Task 6).

- [ ] **Step 4: Write `README.md`**

````md
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
| `mtnDirect` | `mtn` | `subscriptionKey`, `apiUser`, `apiKey`, `environment` (`sandbox` or `mtncameroon`), `baseUrl?` |

- Orange wants a 9-digit local payer number; the SDK strips `+237`.
- MTN requires `id` to be a UUID and uses it as the `ref`. Sandbox works in EUR and accepts MTN's test numbers.
- MTN `status()` returns `failed` with code `NOT_FOUND` for a payment MTN never received. After an `uncertain`
  collect, wait a few minutes before treating `NOT_FOUND` as final.

Your app picks the provider per operator. To add an aggregator (Paynote, pawaPay), implement
`MobileMoneyProvider` and run `describeProviderContract` from `test/contract.ts` against it.

## Observed provider behaviour

- Orange: documented statuses `PENDING` and `SUCCESSFULL`. Results of the first live test go here.

## Development

```bash
npm test          # vitest
npm run type-check
npm run lint      # biome
npm run build     # dist/
npm run smoke     # pack, install, import
```

Live Orange test (moves real money): put `ORANGE_USERNAME`, `ORANGE_PASSWORD`, `ORANGE_AUTH_TOKEN`,
`ORANGE_MERCHANT_MSISDN` and `ORANGE_PIN` in `.env.live` (gitignored), then:

```bash
npm run build && node --env-file=.env.live scripts/live-orange.mjs 6XXXXXXXX 10
```

It prints every raw provider response with secrets redacted and polls `status()` for up to 3 minutes.
````

- [ ] **Step 5: Format and full check**

Run: `npx biome check --write . && npm test && npm run type-check && npm run lint && npm run build && npm run smoke`
Expected: all exit 0, smoke prints `smoke ok`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: public entry, package smoke, live orange script, readme

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: PR, live Orange test, release

**Files:**
- Modify: `README.md` ("Observed provider behaviour"), and `src/orange.ts` `outcome()` only if the live test shows new status spellings.

- [ ] **Step 1: Push and open the PR to `dev`**

```bash
git push -u origin claude/sdk-v1
gh pr create --base dev --title "feat: mobile money sdk v1 (orange + mtn direct)" --body "..."
```
The body lists the tasks, the test counts and the live-test plan, and ends with the Claude Code attribution line.
Expected: CI `verify` job green.

- [ ] **Step 2: User runs the live Orange test**

The user fills `.env.live` and runs, in their own terminal:
```bash
npm run build && node --env-file=.env.live scripts/live-orange.mjs 6XXXXXXXX 10
```
Expected: `ref MP…`, then status lines ending in `completed`. The user shares the redacted output.

- [ ] **Step 3: Record findings**

Replace the Orange line under "Observed provider behaviour" in `README.md` with the observed facts: each status
string seen, the minimum accepted amount, whether TLS verified, and the date. If a terminal status appeared that
`outcome()` does not map, add a failing case to `test/orange.test.ts`, then the mapping, run the full check, and commit
to the PR.

- [ ] **Step 4: Merge and release**

After the user approves: merge PR → `dev`, open and merge `dev` → `main`. The user runs:
```bash
npm publish --access public
```
Expected: `@halifage/mobile-money@0.1.0` on npm.
