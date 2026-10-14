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
