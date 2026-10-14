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
