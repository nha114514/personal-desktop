import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePersonalPatch } from './configure-gemini.mjs'
import { retainGoogleAccountTwo } from './single-google-account.mjs'

test('retains custom providers, selected models and account 2 overrides during retirement', () => {
  const source = `# user settings
- id: agent-default-model
  config: { provider: qwen, model: deepseek-v4.1-flash-1017, reasoningEffort: high }
- id: llm-pi-ai
  config: { providers: [{ id: qwen, apiKey: private-fixture, models: [{ id: new-model }] }] }
- id: subagent-default-model
  config: { provider: codex, model: gpt-5.6-sol, reasoningEffort: max }
- id: subagent-model-selection-settings
  config:
    allowedModels:
      - { provider: gemini-1, model: gemini-3.8-flash }
      - { provider: gemini-2, model: gemini-3.8-flash }
      - { provider: qwen, model: new-model }
      - { provider: gemini-1, model: custom-gemini-model }
`
  const before = parsePersonalPatch(source)
  const result = retainGoogleAccountTwo(source)
  const after = parsePersonalPatch(result)
  assert.ok(result.startsWith('# user settings\n'))
  assert.deepEqual(after.slice(0, 3), before.slice(0, 3))
  assert.deepEqual(after[3].config.allowedModels, [
    { provider: 'gemini-2', model: 'gemini-3.8-flash' },
    { provider: 'qwen', model: 'new-model' },
    { provider: 'gemini-2', model: 'custom-gemini-model' },
  ])
  assert.equal(retainGoogleAccountTwo(result), result)
})

test('removes only the retired fixed route and keeps user-repurposed and generic subagents', () => {
  const source = `- insert:
    - id: preset-personal
      config:
        plugins:
          - id: delegation
            group: true
            config:
              - id: tool-subagent-gemini-1
                config: { agentOptions: { provider: gemini-1, model: old } }
              - id: tool-subagent-gemini-1
                config: { agentOptions: { provider: qwen, model: new } }
              - id: tool-subagent
                config: { provider: spawn, modelSelectionSettings: true }
              - id: tool-subagent-gemini-2
                config: { agentOptions: { provider: gemini-2, model: selected } }
`
  const rows = parsePersonalPatch(retainGoogleAccountTwo(source))
  const tools = rows[0].insert[0].config.plugins[0].config
  assert.equal(tools.length, 3)
  assert.equal(tools[0].config.agentOptions.provider, 'qwen')
  assert.equal(tools[1].id, 'tool-subagent')
  assert.equal(tools[2].config.agentOptions.model, 'selected')
})

test('rejects malformed profiles without producing replacement settings', () => {
  assert.throws(() => retainGoogleAccountTwo('- config: ['), /Invalid personal profile/)
})
