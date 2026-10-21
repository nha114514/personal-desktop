import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parsePersonalPatch } from './configure-gemini.mjs'

test('personal retrieval keeps one child messaging interface and the authorized leaf delegates', () => {
  const rows = parsePersonalPatch(readFileSync(new URL('./personal.patch.yml', import.meta.url), 'utf8'))
  assert.equal(rows.find(row => row.id === 'tool-agent-team')?.disabled, true)
  const preset = rows.flatMap(row => row.insert ?? []).find(row => row.id === 'preset-personal')
  const delegation = preset.config.plugins.find(row => row.id === 'delegation').config
  assert.ok(delegation.some(row => row.id === 'tool-subagent-control' && row.disabled !== true))
  assert.equal(delegation.find(row => row.id === 'tool-subagent').config.backgroundMode, 'continuable')
  for (const id of ['tool-subagent-gemini-1', 'tool-subagent-gemini-2']) {
    assert.equal(delegation.find(row => row.id === id).config.maxDepth, 1)
  }
  assert.equal(rows.find(row => row.id === 'subagent').config.maxActiveSubagents, 8)
})
