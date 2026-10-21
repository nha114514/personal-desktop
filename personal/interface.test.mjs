import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { addPersonalInterface } from './configure-interface.mjs'
import { parsePersonalPatch } from './configure-gemini.mjs'

const template = readFileSync(new URL('./personal.patch.yml', import.meta.url), 'utf8')

test('adds the personal interface without rewriting unrelated profile data', () => {
  const current = '# user comment\n- id: unrelated\n  config:\n    choice: keep\n'
  const next = addPersonalInterface(current, template)
  assert.ok(next.startsWith(current))
  const rows = parsePersonalPatch(next)
  assert.equal(rows.find(row => row.id === 'ui-sidebar').config.showBrandMark, false)
  assert.equal(rows.find(row => row.id === 'ui-sidebar').config.brandName, 'Personal Desktop')
  assert.equal(rows.find(row => row.id === 'ui-conversation').config.heroTitle, '我的电脑助手')
  assert.equal(rows.find(row => row.id === 'ui-settings-account').disabled, true)
  assert.equal(rows.flatMap(row => row.insert ?? []).filter(row => row.id === 'ui-personal-accounts').length, 1)
  assert.equal(addPersonalInterface(next, template), next)
})

test('repeated installation preserves user-edited interface rows', () => {
  const customized = template.replace('brandName: Personal Desktop', 'brandName: My Desktop')
  assert.equal(addPersonalInterface(customized, template), customized)
})
