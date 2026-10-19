import type { Operator } from '../types.js'

/** 9-digit Cameroon mobile number (starts with 6), after dropping punctuation, `00`, `237` and a leading `0`; else null. */
export function localPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '').replace(/^00/, '').replace(/^237/, '').replace(/^0/, '')
  return /^6\d{8}$/.test(digits) ? digits : null
}

/** Operator from the prefix (MTN 67x, 650–654, 680–684; Orange 69x, 655–659, 685–689), or null. A hint only: numbers port. */
export function guessOperator(raw: string): Operator | null {
  const local = localPhone(raw)
  if (!local) return null
  const p3 = Number(local.slice(0, 3))
  if (p3 >= 670 && p3 <= 679) return 'mtn'
  if (p3 >= 690 && p3 <= 699) return 'orange'
  if ((p3 >= 650 && p3 <= 654) || (p3 >= 680 && p3 <= 684)) return 'mtn'
  if ((p3 >= 655 && p3 <= 659) || (p3 >= 685 && p3 <= 689)) return 'orange'
  return null
}

/** `677123456` → `6 77 12 34 56`. */
export const displayPhone = (local: string) => local.replace(/^(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4 $5')
