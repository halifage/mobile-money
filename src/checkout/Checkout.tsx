import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import type { FailureReason, Operator } from '../types.js'
import { CheckIcon, ChevronIcon, ClockIcon, CrossIcon, PhoneIcon } from './icons.js'
import { fill, formatAmount, type Locale, type Messages, messagesFor } from './messages.js'
import { OPERATORS } from './operators.js'
import { displayPhone, guessOperator, localPhone } from './phone.js'

export type NextAction = { kind: 'redirect'; url: string } | { kind: 'approve_on_phone'; operator: Operator }

export type CheckoutStatus =
  | { status: 'idle' }
  | { status: 'initiated' }
  | { status: 'awaiting_customer'; nextAction: NextAction }
  | { status: 'pending_confirmation' }
  | { status: 'succeeded'; reference: string; paidAt: Date }
  | { status: 'failed'; reason: FailureReason }
  | { status: 'expired' }

export type CheckoutProps = {
  /** XAF, whole units. */
  amount: number
  payee: string
  status: CheckoutStatus
  /** phone is `237` + 9 digits. Called by Payer and by Réessayer. */
  onPay: (payment: { operator: Operator; phone: string }) => void
  defaultOperator?: Operator
  /** Any common format. */
  defaultPhone?: string
  summary?: ReactNode
  /** Shown on success. */
  actions?: ReactNode
  locale?: Locale
  messages?: Partial<Messages>
}

const OPERATOR_ORDER: Operator[] = ['mtn', 'orange']

export function Checkout({
  amount,
  payee,
  status,
  onPay,
  defaultOperator,
  defaultPhone = '',
  summary,
  actions,
  locale = 'fr',
  messages,
}: CheckoutProps) {
  const m = messagesFor(locale, messages)
  const [phone, setPhone] = useState(defaultPhone)
  const [operator, setOperator] = useState<Operator>(defaultOperator ?? guessOperator(defaultPhone) ?? 'mtn')
  const lastGuess = useRef(guessOperator(defaultPhone))
  const [touched, setTouched] = useState(false)
  const [editing, setEditing] = useState(false)
  const sentRef = useRef(false)
  const radioName = useId()
  const [sent, setSent] = useState(false)

  // A new status from the app re-arms the buttons.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the status object on purpose
  useEffect(() => {
    sentRef.current = false
    setSent(false)
  }, [status])

  const redirectUrl =
    status.status === 'awaiting_customer' && status.nextAction.kind === 'redirect' ? status.nextAction.url : null
  useEffect(() => {
    if (redirectUrl) window.location.assign(redirectUrl)
  }, [redirectUrl])

  const local = localPhone(phone)
  const op = OPERATORS[operator]
  const amountText = formatAmount(amount, locale)

  function changePhone(value: string) {
    setPhone(value)
    const guess = guessOperator(value)
    if (guess && guess !== lastGuess.current) {
      lastGuess.current = guess
      setOperator(guess)
    }
  }

  function pay() {
    if (sentRef.current || !local) return
    sentRef.current = true
    setSent(true)
    setEditing(false)
    onPay({ operator, phone: `237${local}` })
  }

  const busy = status.status === 'initiated'
  const failedReason: FailureReason | null =
    status.status === 'expired' ? 'expired' : status.status === 'failed' ? status.reason : null
  // "Changer…" only overrides a failed screen: any other status from the app wins.
  const showForm = (editing && failedReason !== null) || status.status === 'idle' || status.status === 'initiated'

  let step: 1 | 2 | 3 = 2
  let stepLabel = m.stepApproval
  if (showForm) step = 1
  else if (status.status === 'succeeded') step = 3
  else if (status.status === 'pending_confirmation') stepLabel = m.stepChecking
  else if (failedReason) stepLabel = m.stepFailed
  const failed = !showForm && failedReason !== null
  const approving = status.status === 'awaiting_customer' && status.nextAction.kind === 'approve_on_phone'
  const SummaryLogo =
    !showForm && status.status === 'awaiting_customer' && status.nextAction.kind === 'approve_on_phone'
      ? OPERATORS[status.nextAction.operator].Logo
      : null
  // ponytail: on narrow screens the summary shows only where the mockups show it (form, approval)
  const summaryAside = !showForm && !approving

  const steps = [
    { n: 1, label: m.stepDetails },
    { n: 2, label: stepLabel },
    { n: 3, label: m.stepReceipt },
  ]

  let body: ReactNode
  if (showForm) {
    const formDisabled = busy || sent
    body = (
      <form
        className="mm-form"
        onSubmit={(event) => {
          event.preventDefault()
          pay()
        }}
      >
        <fieldset className="mm-field" disabled={formDisabled}>
          <legend className="mm-label">{m.operatorLabel}</legend>
          <div className="mm-tiles">
            {OPERATOR_ORDER.map((id) => {
              const { name, Logo } = OPERATORS[id]
              return (
                <label key={id} className="mm-tile">
                  <input
                    type="radio"
                    name={radioName}
                    value={id}
                    checked={operator === id}
                    onChange={() => setOperator(id)}
                  />
                  <Logo />
                  <span>{name}</span>
                </label>
              )
            })}
          </div>
        </fieldset>
        <label className="mm-field">
          <span className="mm-label">{fill(m.phoneLabel, { op: op.name })}</span>
          <span className="mm-phone">
            <span className="mm-prefix">+237</span>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="6XX XX XX XX"
              value={phone}
              disabled={formDisabled}
              aria-invalid={touched && phone !== '' && !local}
              onChange={(event) => changePhone(event.target.value)}
              onBlur={() => setTouched(true)}
            />
          </span>
          {touched && phone !== '' && !local && <span className="mm-error">{m.invalidPhone}</span>}
        </label>
        <button type="submit" className="mm-button" disabled={!local || formDisabled} aria-busy={busy}>
          {busy && <span className="mm-spinner" aria-hidden="true" />}
          {fill(m.payButton, { amount: amountText })}
        </button>
      </form>
    )
  } else if (status.status === 'awaiting_customer' && status.nextAction.kind === 'approve_on_phone') {
    const approveOp = OPERATORS[status.nextAction.operator]
    body = (
      <>
        <ol className="mm-numbered">
          <li>{fill(m.approveCheckPhone, { op: approveOp.name })}</li>
          <li>{m.approveEnterPin}</li>
          <li>{m.approveKeepOpen}</li>
        </ol>
        <div className="mm-progress" />
        <details className="mm-help">
          <summary>
            {m.helpTitle}
            <ChevronIcon />
          </summary>
          {approveOp.menuCode ? (
            <>
              <p>{m.helpDial}</p>
              <a className="mm-dial" href={`tel:${encodeURIComponent(approveOp.menuCode)}`}>
                <PhoneIcon />
                {approveOp.menuCode}
              </a>
            </>
          ) : (
            <p>{fill(m.helpOpenApp, { op: approveOp.name })}</p>
          )}
        </details>
      </>
    )
  } else if (status.status === 'awaiting_customer') {
    body = (
      <>
        <op.Logo />
        <p className="mm-title">{m.redirect}</p>
        <div className="mm-progress" />
      </>
    )
  } else if (status.status === 'pending_confirmation') {
    body = (
      <>
        <span className="mm-badge mm-badge--wait">
          <ClockIcon />
        </span>
        <p className="mm-title">{m.pendingTitle}</p>
        <p className="mm-muted">{m.pendingBody}</p>
      </>
    )
  } else if (status.status === 'succeeded') {
    const rows: [string, ReactNode][] = [
      [m.successAmount, <strong key="a">{amountText}</strong>],
      [m.successPayee, payee],
      [
        m.successOperator,
        <span key="o" className="mm-operator">
          <op.Logo />
          {local && `•• ${local.slice(5, 7)} ${local.slice(7)}`}
        </span>,
      ],
      [m.successReference, status.reference],
      [
        m.successDate,
        new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(status.paidAt),
      ],
    ]
    body = (
      <>
        <span className="mm-badge mm-badge--ok">
          <CheckIcon />
        </span>
        <p className="mm-title">{m.successTitle}</p>
        <dl className="mm-receipt">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {actions && <div className="mm-actions">{actions}</div>}
      </>
    )
  } else {
    const reason = failedReason ?? 'unknown'
    body = (
      <>
        <span className="mm-badge mm-badge--fail">{reason === 'expired' ? <ClockIcon /> : <CrossIcon />}</span>
        <p className="mm-title">{fill(m[`reason_${reason}_title`], { op: op.name })}</p>
        <p className="mm-muted">{fill(m[`reason_${reason}_body`], { op: op.name })}</p>
        <button type="button" className="mm-button" disabled={sent} onClick={() => (local ? pay() : setEditing(true))}>
          {local ? fill(m.retry, { phone: displayPhone(local) }) : m.retryNoPhone}
        </button>
        <button type="button" className="mm-link" onClick={() => setEditing(true)}>
          {m.change}
        </button>
      </>
    )
  }

  return (
    <div className="mm-checkout">
      <div className="mm-layout">
        <ol className="mm-stepbar">
          {steps.map(({ n, label }) => {
            const state = n < step || status.status === 'succeeded' ? 'done' : n === step ? 'current' : 'todo'
            return (
              <li
                key={n}
                className={`mm-step mm-step--${state}${failed && n === step ? ' mm-step--failed' : ''}`}
                aria-current={n === step ? 'step' : undefined}
              >
                {n}
                {(state !== 'done' || n === step) && <span className="mm-step-label"> {label}</span>}
              </li>
            )
          })}
        </ol>
        <div className={`mm-summary${summaryAside ? ' mm-summary--aside' : ''}`}>
          {SummaryLogo && <SummaryLogo />}
          <div>
            <p className="mm-amount">{amountText}</p>
            <p className="mm-payee">{payee}</p>
            {summary}
          </div>
        </div>
        <div
          className={`mm-body${showForm || status.status === 'awaiting_customer' ? '' : ' mm-body--center'}`}
          aria-live="polite"
        >
          {body}
        </div>
      </div>
    </div>
  )
}
