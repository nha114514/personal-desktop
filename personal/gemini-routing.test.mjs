import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { addGeminiAccountRoutes, parsePersonalPatch } from './configure-gemini.mjs'

const template = readFileSync(new URL('./personal.patch.yml', import.meta.url), 'utf8')

test('personal preset exposes only account 2 with leaf-node spawn execution', () => {
  const rows = parsePersonalPatch(template)
  const inserted = rows.flatMap(row => row.insert ?? [])
  const preset = inserted.find(row => row.id === 'preset-personal')
  const delegation = preset.config.plugins.find(row => row.id === 'delegation')
  assert.equal(delegation.config.some(row => row.id === 'tool-subagent-gemini-1'), false)
  for (const account of ['2']) {
    const preset = inserted.find(row => row.id === 'preset-personal')
    const delegation = preset.config.plugins.find(row => row.id === 'delegation')
    const tool = delegation.config.find(row => row.id === `tool-subagent-gemini-${account}`)
    assert.equal(tool.config.toolName, `subagent_gemini_${account}`)
    assert.equal(tool.config.provider, 'spawn')
    assert.equal(tool.config.agentOptions.provider, `gemini-${account}`)
    assert.equal(tool.config.agentOptions.model, 'gemini-3.8-flash')
    assert.equal(tool.config.backgroundMode, 'one-shot')
    assert.equal(tool.config.maxDepth, 1)
    assert.equal(tool.config.modelSelectionSettings, undefined)
  }
})

test('adds missing account routes while preserving existing text and user configuration', () => {
  const original = '# user comment\n- id: unrelated\n  config:\n    choice: keep\n- insert:\n    - id: preset-personal\n      name: personal\n      config:\n        plugins:\n          - id: delegation\n            group: true\n            config:\n              - id: tool-subagent-codex\n                config:\n                  userModel: keep-me\n'
  const next = addGeminiAccountRoutes(original, template)
  assert.ok(next.startsWith('# user comment\n'))
  assert.ok(next.includes('    choice: keep\n'))
  assert.ok(next.includes('                  userModel: keep-me\n'))
  const rows = parsePersonalPatch(next)
  assert.equal(rows[0].config.choice, 'keep')
  const delegation = rows.find(row => row.insert?.[0]?.id === 'preset-personal').insert[0].config.plugins[0]
  assert.equal(delegation.config.filter(row => row.id?.startsWith('tool-subagent-gemini-')).length, 1)
})

test('repeated installation preserves existing account route edits byte for byte', () => {
  const customized = template.replace('toolName: subagent_gemini_2', 'toolName: my_google_account')
  assert.equal(addGeminiAccountRoutes(customized, template), customized)
})

test('rejects ambiguous or missing insertion point without replacing the profile', () => {
  assert.throws(() => addGeminiAccountRoutes('# customized profile\n', template), /personal preset|entry list/i)
})
