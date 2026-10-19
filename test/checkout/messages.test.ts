import { expect, it } from 'vitest'
import { fill, formatAmount, messagesFor } from '../../src/checkout/messages.js'

it('formats amounts per locale, FCFA in both, no line break inside', () => {
  expect(formatAmount(20100, 'fr')).toBe('20\u202f100\u00a0FCFA')
  expect(formatAmount(20100, 'en')).toBe('20,100\u00a0FCFA')
})

it('fill replaces known placeholders and leaves unknown ones', () => {
  expect(fill('Payer {amount}', { amount: 'X' })).toBe('Payer X')
  expect(fill('{a} {b}', { a: '1' })).toBe('1 {b}')
})

it('picks the locale and applies overrides', () => {
  expect(messagesFor('fr').reason_wrong_number_title).toBe("Ce numéro n'est pas un compte {op}")
  expect(messagesFor('en').payButton).toBe('Pay {amount}')
  expect(messagesFor('fr', { payButton: 'Régler {amount}' }).payButton).toBe('Régler {amount}')
})

it('en has exactly the fr keys', () => {
  expect(Object.keys(messagesFor('en'))).toEqual(Object.keys(messagesFor('fr')))
})
