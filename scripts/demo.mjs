// Renders every checkout state into demo/index.html (static, CSS inlined). Run with `npm run demo`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Checkout } from '../dist/checkout/index.js'

const base = {
  amount: 20100,
  payee: 'Collège La Réussite',
  onPay: () => {},
  summary: h('p', null, 'Tranche 2 · Awa N.'),
}
const approve = (operator) => ({ status: 'awaiting_customer', nextAction: { kind: 'approve_on_phone', operator } })
const reasons = ['insufficient_funds', 'declined', 'expired', 'wrong_number', 'unavailable', 'unknown']

const states = [
  ['idle (empty)', { status: { status: 'idle' } }],
  ['idle (valid MTN number)', { status: { status: 'idle' }, defaultPhone: '677123456' }],
  ['initiated', { status: { status: 'initiated' }, defaultPhone: '677123456' }],
  ['awaiting_customer / approve_on_phone mtn (help open)', { status: approve('mtn'), defaultPhone: '677123456' }, true],
  [
    'awaiting_customer / approve_on_phone orange (help open)',
    { status: approve('orange'), defaultPhone: '699123456' },
    true,
  ],
  [
    'awaiting_customer / redirect',
    { status: { status: 'awaiting_customer', nextAction: { kind: 'redirect', url: '#' } }, defaultOperator: 'orange' },
  ],
  ['pending_confirmation', { status: { status: 'pending_confirmation' } }],
  [
    'succeeded',
    {
      status: { status: 'succeeded', reference: 'MP261018.1402.A12345', paidAt: new Date(2026, 9, 18, 14, 2) },
      defaultPhone: '677123456',
      actions: h('a', { href: '#' }, 'Voir le reçu'),
    },
  ],
  ...reasons.map((reason) => [
    `failed / ${reason}`,
    { status: { status: 'failed', reason }, defaultPhone: '677123456' },
  ]),
  ['expired', { status: { status: 'expired' }, defaultPhone: '677123456' }],
  [
    'idle (long payee)',
    { status: { status: 'idle' }, payee: 'Groupe Scolaire Bilingue Les Petits Génies de la Cité Verte, Yaoundé' },
  ],
  ['idle (locale en)', { status: { status: 'idle' }, defaultPhone: '677123456', locale: 'en' }],
]

const sections = states.map(([title, props, helpOpen]) => {
  let html = renderToStaticMarkup(h(Checkout, { ...base, ...props }))
  if (helpOpen) html = html.replace('<details class="mm-help">', '<details class="mm-help" open="">')
  return `<section><h2>${title}</h2>${html}</section>`
})

const css = readFileSync(new URL('../dist/checkout.css', import.meta.url), 'utf8')
mkdirSync(new URL('../demo/', import.meta.url), { recursive: true })
writeFileSync(
  new URL('../demo/index.html', import.meta.url),
  `<!doctype html>
<html lang="fr">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Checkout demo</title>
<style>
body { margin: 0; padding: 16px; background: #f4f4f4; font-family: system-ui, sans-serif; }
section { margin-bottom: 32px; }
h2 { margin: 0 0 8px; font: 600 13px/1.4 ui-monospace, monospace; color: #555; }
${css}
</style>
<body>
${sections.join('\n')}
</body>
</html>
`,
)
console.log('demo/index.html')
