import { describe, expect, it } from 'vitest'
import { displayPhone, guessOperator, localPhone } from '../../src/checkout/phone.js'

describe('localPhone', () => {
  it.each(['+237 6 77 12 34 56', '00237677123456', '0677123456', '677-12-34-56'])('normalises %s', (raw) => {
    expect(localPhone(raw)).toBe('677123456')
  })

  it.each(['577123456', '67712345', ''])('rejects %j', (raw) => {
    expect(localPhone(raw)).toBeNull()
  })
})

describe('guessOperator', () => {
  it.each([
    ['677123456', 'mtn'],
    ['650123456', 'mtn'],
    ['684123456', 'mtn'],
    ['699123456', 'orange'],
    ['655123456', 'orange'],
    ['689123456', 'orange'],
    ['662123456', null],
    ['67712', null],
  ])('%s → %s', (raw, operator) => {
    expect(guessOperator(raw)).toBe(operator)
  })
})

it('displayPhone groups the local number', () => {
  expect(displayPhone('677123456')).toBe('6 77 12 34 56')
})
