// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Checkout, type CheckoutProps, type CheckoutStatus } from '../../src/checkout/index.js'
import type { FailureReason } from '../../src/types.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const idle: CheckoutStatus = { status: 'idle' }

function setup(props: Partial<CheckoutProps> = {}) {
  const onPay = vi.fn()
  const all = { amount: 20100, payee: 'Collège La Réussite', status: idle, onPay, ...props }
  const view = render(<Checkout {...all} />)
  const rerender = (next: Partial<CheckoutProps>) => view.rerender(<Checkout {...all} {...next} />)
  return { onPay, rerender }
}

const phoneInput = () => screen.getByRole('textbox')
const type = (value: string) => fireEvent.change(phoneInput(), { target: { value } })
const payButton = () => screen.getByRole('button', { name: /^(Payer|Pay|Régler)/ })
const tile = (name: string) => screen.getByRole('radio', { name: new RegExp(name) }) as HTMLInputElement
const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ')

describe('idle', () => {
  it('shows amount, payee, operators, prefix and summary; pays once the number is valid', () => {
    const { onPay } = setup({ summary: <p>Tranche 2 · Awa N.</p> })
    expect(screen.getByText('20 100 FCFA')).toBeTruthy()
    expect(screen.getByText('Collège La Réussite')).toBeTruthy()
    expect(tile('MTN MoMo')).toBeTruthy()
    expect(tile('Orange Money')).toBeTruthy()
    expect(screen.getByText('+237')).toBeTruthy()
    expect(screen.getByText('Tranche 2 · Awa N.')).toBeTruthy()
    expect(payButton().hasAttribute('disabled')).toBe(true)
    type('677123456')
    expect(payButton().hasAttribute('disabled')).toBe(false)
    expect(text(payButton())).toBe('Payer 20 100 FCFA')
    fireEvent.click(payButton())
    expect(onPay).toHaveBeenCalledTimes(1)
    expect(onPay).toHaveBeenCalledWith({ operator: 'mtn', phone: '237677123456' })
  })

  it('sends a pasted international number normalised', () => {
    const { onPay } = setup()
    type('+237 6 77 12 34 56')
    fireEvent.click(payButton())
    expect(onPay).toHaveBeenCalledWith({ operator: 'mtn', phone: '237677123456' })
  })

  it('calls onPay once on a double tap', () => {
    const { onPay } = setup()
    type('677123456')
    fireEvent.click(payButton())
    fireEvent.click(payButton())
    expect(onPay).toHaveBeenCalledTimes(1)
  })

  it('the tile follows the prefix, keeps a manual choice, ignores unknown prefixes', () => {
    setup()
    type('699123456')
    expect(tile('Orange Money').checked).toBe(true)
    fireEvent.click(tile('MTN MoMo'))
    type('6991234567')
    type('699123456')
    expect(tile('MTN MoMo').checked).toBe(true)
    type('662123456')
    expect(tile('MTN MoMo').checked).toBe(true)
    expect(payButton().hasAttribute('disabled')).toBe(false)
  })

  it('shows the invalid number line after leaving a bad number', () => {
    setup()
    type('57712')
    fireEvent.blur(phoneInput())
    expect(screen.getByText('Entrez un numéro camerounais à 9 chiffres')).toBeTruthy()
  })
})

it('initiated: form disabled, button busy', () => {
  setup({ status: { status: 'initiated' }, defaultPhone: '677123456' })
  expect(phoneInput().hasAttribute('disabled')).toBe(true)
  expect(tile('MTN MoMo').matches(':disabled')).toBe(true)
  expect(payButton().getAttribute('aria-busy')).toBe('true')
  expect(payButton().hasAttribute('disabled')).toBe(true)
})

describe('approve on phone', () => {
  it('mtn: three steps and the dial code', () => {
    setup({ status: { status: 'awaiting_customer', nextAction: { kind: 'approve_on_phone', operator: 'mtn' } } })
    expect(screen.getByText('Regardez votre téléphone MTN MoMo')).toBeTruthy()
    expect(screen.getByText('Entrez votre code secret')).toBeTruthy()
    expect(screen.getByText('Gardez cette page ouverte')).toBeTruthy()
    expect(screen.getByText('Pas reçu la demande ?')).toBeTruthy()
    expect(screen.getByRole('link', { name: /\*126#/ }).getAttribute('href')).toBe('tel:*126%23')
  })

  it('orange: no dial code, open-the-app line', () => {
    setup({ status: { status: 'awaiting_customer', nextAction: { kind: 'approve_on_phone', operator: 'orange' } } })
    expect(screen.getByText('Regardez votre téléphone Orange Money')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText("Ouvrez l'application Orange Money pour voir vos validations en attente")).toBeTruthy()
  })
})

it('redirect: goes to the url once, even on re-render', () => {
  const assign = vi.fn()
  vi.stubGlobal('location', { ...window.location, assign })
  const status = (): CheckoutStatus => ({
    status: 'awaiting_customer',
    nextAction: { kind: 'redirect', url: 'https://pay.example/x' },
  })
  const { rerender } = setup({ status: status(), defaultOperator: 'orange' })
  rerender({ status: status() })
  expect(assign).toHaveBeenCalledTimes(1)
  expect(assign).toHaveBeenCalledWith('https://pay.example/x')
  expect(screen.getByText('Redirection vers la page de paiement…')).toBeTruthy()
})

it('pending confirmation', () => {
  setup({ status: { status: 'pending_confirmation' } })
  expect(screen.getByText('Nous vérifions votre paiement')).toBeTruthy()
  expect(screen.getByText('Vous pouvez fermer cette page : le reçu apparaîtra ici.')).toBeTruthy()
})

it('succeeded: receipt rows and app actions', () => {
  setup({
    status: { status: 'succeeded', reference: 'MP1', paidAt: new Date(2026, 9, 18, 14, 2) },
    defaultPhone: '677123456',
    actions: <a href="/receipt">Voir le reçu</a>,
  })
  expect(screen.getByText('Paiement reçu')).toBeTruthy()
  expect(screen.getByText('MP1')).toBeTruthy()
  expect(screen.getByText('•• 34 56')).toBeTruthy()
  expect(screen.getByText('18/10/2026 14:02')).toBeTruthy()
  expect(screen.getByText('Voir le reçu')).toBeTruthy()
})

describe('failed', () => {
  it.each<[FailureReason, string]>([
    ['insufficient_funds', 'Solde insuffisant'],
    ['declined', 'Paiement refusé'],
    ['expired', 'Aucune validation reçue à temps'],
    ['wrong_number', "Ce numéro n'est pas un compte MTN MoMo"],
    ['unavailable', 'MTN MoMo est indisponible'],
    ['unknown', "Le paiement n'a pas abouti"],
  ])('%s shows its title', (reason, title) => {
    setup({ status: { status: 'failed', reason }, defaultOperator: 'mtn' })
    expect(screen.getByText(title)).toBeTruthy()
  })

  it('expired status renders like failed expired', () => {
    setup({ status: { status: 'expired' } })
    expect(screen.getByText('Aucune validation reçue à temps')).toBeTruthy()
    expect(screen.getByText('La demande a expiré.')).toBeTruthy()
  })

  it('retries to the same number in one tap', () => {
    const { onPay } = setup({ status: { status: 'failed', reason: 'declined' }, defaultPhone: '677123456' })
    const retry = screen.getByRole('button', { name: 'Réessayer au 6 77 12 34 56' })
    fireEvent.click(retry)
    fireEvent.click(retry)
    expect(onPay).toHaveBeenCalledTimes(1)
    expect(onPay).toHaveBeenCalledWith({ operator: 'mtn', phone: '237677123456' })
  })

  it('without a known number the retry button reads Réessayer and opens the form', () => {
    const { onPay } = setup({ status: { status: 'failed', reason: 'declined' } })
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(onPay).not.toHaveBeenCalled()
    expect(phoneInput()).toBeTruthy()
  })

  it('"Changer" shows the form with the values kept, on step 1', () => {
    setup({ status: { status: 'failed', reason: 'declined' }, defaultPhone: '699123456' })
    fireEvent.click(screen.getByRole('button', { name: "Changer de numéro ou d'opérateur" }))
    expect((phoneInput() as HTMLInputElement).value).toBe('699123456')
    expect(tile('Orange Money').checked).toBe(true)
    expect(screen.getByText('Détails').closest('[aria-current="step"]')).toBeTruthy()
  })
})

it('english and overrides', () => {
  setup({ locale: 'en', defaultPhone: '677123456' })
  expect(text(payButton())).toBe('Pay 20,100 FCFA')
  cleanup()
  setup({ messages: { payButton: 'Régler {amount}' }, defaultPhone: '677123456' })
  expect(text(payButton())).toBe('Régler 20 100 FCFA')
})
