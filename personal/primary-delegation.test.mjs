import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { configurePrimaryDelegation } from './Configure-Primary-Delegation.mjs'
import { parsePersonalPatch } from './configure-gemini.mjs'

const template = readFileSync(new URL('./personal.patch.yml', import.meta.url), 'utf8')
test('installs the main coordination policy while preserving model choices and leaf limits', () => {
  const original = '# user configuration\n- id: agent-default-model\n  config:\n    provider: codex\n    model: gpt-6-astra\n    reasoningEffort: ultra\n- id: subagent\n  config:\n    maxActiveSubagents: 8\n- id: subagent-default-model\n  config:\n    provider: my-api\n    model: my-selected-model\n    reasoningEffort: high\n'
  const next = configurePrimaryDelegation(original, template)
  assert.ok(next.startsWith('# user configuration\n'))
  const rows = parsePersonalPatch(next)
  assert.deepEqual(rows.filter(row => !row.insert), parsePersonalPatch(original))
  const policy = rows.flatMap(row => row.insert ?? []).find(row => row.id === 'primary-delegation')
  assert.equal(policy.name, '@deepseek-ai/dsh-primary-delegation')
  assert.deepEqual(policy.config.primaryOnlyToolPrefixes, ['mcp__windows-mcp__'])
  for (const name of ['subagent', 'list_agents', 'skill']) assert.ok(policy.config.allowedTools.includes(name))
  for (const name of ['read', 'write', 'pwsh', 'web_search', 'subagent_codex', 'create_agent']) {
    assert.equal(policy.config.allowedTools.includes(name), false)
  }
  assert.equal(configurePrimaryDelegation(next, template), next)
})
