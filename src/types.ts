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
  /** Where the payer returns after paying on a provider page. Required by orangeWebPay. */
  returnUrl?: string
}

export type FailureReason = 'insufficient_funds' | 'declined' | 'expired' | 'unknown'

export type Outcome =
  | { status: 'completed'; amount: number; currency: string }
  | { status: 'failed'; reason: FailureReason; code?: string }
  /** code: provider detail, e.g. pawaPay NOT_FOUND (the payer has not paid yet) */
  | { status: 'pending'; code?: string }

export interface MobileMoneyProvider {
  readonly operators: readonly Operator[]
  /** redirectUrl: when set, send the payer there to complete the payment. */
  collect(request: CollectRequest): Promise<{ ref: string; redirectUrl?: string }>
  status(ref: string): Promise<Outcome>
}

export interface PayoutRequest {
  /** App's payout id, used as the idempotency key. */
  id: string
  operator: Operator
  /** Whole units, positive integer; the recipient gets exactly this. */
  amount: number
  phone: string
  /** Shown to the recipient when the provider supports it. */
  message?: string
}

export interface MobileMoneyPayouts {
  payout(request: PayoutRequest): Promise<{ ref: string }>
  payoutStatus(ref: string): Promise<Outcome>
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
