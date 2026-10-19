// Packs the package, installs the tarball in a temp project and checks its runtime exports.
// The root check runs before React is installed: the root entry must stay React-free.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mobile-money-smoke-'))
const tarball = execFileSync('npm', ['pack', '--pack-destination', dir], { encoding: 'utf8' }).trim().split('\n').pop()
writeFileSync(join(dir, 'package.json'), '{ "type": "module" }')
execFileSync('npm', ['install', '--no-audit', '--no-fund', join(dir, tarball)], { cwd: dir, stdio: 'inherit' })
writeFileSync(
  join(dir, 'check.mjs'),
  `import * as sdk from '@halifage/mobile-money'
const want = ['MobileMoneyError', 'mtnDirect', 'orangeDirect', 'orangeWebPay', 'parsePawaPayCallback', 'pawaPay', 'signCallbackUrl', 'verifyCallback']
const got = Object.keys(sdk).sort()
if (JSON.stringify(got) !== JSON.stringify(want)) {
  console.error('unexpected exports', got)
  process.exit(1)
}
console.log('smoke ok')
`,
)
execFileSync('node', ['check.mjs'], { cwd: dir, stdio: 'inherit' })
execFileSync('npm', ['install', '--no-audit', '--no-fund', 'react@19', 'react-dom@19'], { cwd: dir, stdio: 'inherit' })
writeFileSync(
  join(dir, 'checkout.mjs'),
  `const got = Object.keys(await import('@halifage/mobile-money/checkout'))
if (JSON.stringify(got) !== JSON.stringify(['Checkout'])) {
  console.error('unexpected checkout exports', got)
  process.exit(1)
}
`,
)
execFileSync('node', ['checkout.mjs'], { cwd: dir, stdio: 'inherit' })
if (!existsSync(join(dir, 'node_modules/@halifage/mobile-money/dist/checkout.css'))) {
  console.error('checkout.css missing')
  process.exit(1)
}
console.log('checkout smoke ok')
