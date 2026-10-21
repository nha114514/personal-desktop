import { describe, expect, it } from 'vitest'
import { parsePersonalModelRoutes, selectedCodexModel } from '../src/personal-model-routing.ts'

describe('personal model routing', () => {
  it('uses the effective selected Codex submodel when the primary is an API model', () => {
    const routes = parsePersonalModelRoutes(`
- id: agent-default-model
  config: { provider: custom-api, model: private-model }
- insert:
    - id: subagent-default-model
      config: { provider: gemini-2, model: gemini-3.8-flash }
- id: subagent-default-model
  config: { provider: codex, model: chosen-codex-model, reasoningEffort: max }
`)
    expect(routes.primary).toEqual({ provider: 'custom-api', model: 'private-model' })
    expect(routes.subagent).toEqual({ provider: 'codex', model: 'chosen-codex-model', reasoningEffort: 'max' })
    expect(selectedCodexModel(routes)).toBe('chosen-codex-model')
  })

  it('never selects an allowed but unchosen model or invents a fallback', () => {
    const routes = parsePersonalModelRoutes(`
- id: agent-default-model
  config: { provider: custom-api, model: private-model }
- id: subagent-model-selection-settings
  config:
    allowedModels: [{ provider: codex, model: allowed-but-not-selected }]
`)
    expect(selectedCodexModel(routes)).toBeUndefined()
    expect(selectedCodexModel(parsePersonalModelRoutes('[]'))).toBeUndefined()
  })

  it('replaces later configs and honors disabled entries', () => {
    const routes = parsePersonalModelRoutes(`
- id: agent-default-model
  config: { provider: codex, model: first, reasoningEffort: high }
- id: agent-default-model
  config: { model: user-selected }
- id: subagent-default-model
  disabled: true
  config: { provider: codex, model: disabled-model }
`)
    expect(routes.primary).toBeUndefined()
    expect(routes.subagent).toBeUndefined()
    expect(selectedCodexModel(routes)).toBeUndefined()
  })

  it('parses quoted model names and reads API route identities without returning credentials', () => {
    const routes = parsePersonalModelRoutes(`
- id: agent-default-model
  config: { provider: custom-api, model: 'selected model #1' }
- id: llm-pi-ai
  config:
    providers:
      custom-api: { apiKey: private-test-credential, baseURL: 'https://private.invalid' }
`)
    expect(routes.primary?.model).toBe('selected model #1')
    expect(routes.apiProviders).toEqual(['custom-api'])
    expect(JSON.stringify(routes)).not.toContain('private-test-credential')
    expect(JSON.stringify(routes)).not.toContain('private.invalid')
  })

  it('does not evaluate YAML expressions or use model rows in an unselected preset', () => {
    const routes = parsePersonalModelRoutes(`
- id: unrelated
  disabled: !!js 'process.exit(9)'
- id: agent-default-model
  config: { provider: custom-api, model: chosen }
- insert:
    - id: preset-not-selected
      config:
        plugins:
          - id: agent-default-model
            config: { provider: codex, model: wrong-scope }
`)
    expect(routes.status).toBe('loaded')
    expect(selectedCodexModel(routes)).toBeUndefined()
  })

  it('replaces provider catalogs instead of retaining removed providers', () => {
    const routes = parsePersonalModelRoutes(`
- id: llm-pi-ai
  config: { providers: { removed: {} } }
- id: llm-pi-ai
  config: { providers: { current: {} } }
`)
    expect(routes.apiProviders).toEqual(['current'])
  })

  it('skips inserts targeting missing entries or non-group entries', () => {
    for (const target of ['', '- id: target\n  name: ordinary-plugin\n']) {
      const routes = parsePersonalModelRoutes(`${target}
- id: target
  insert:
    - id: subagent-default-model
      config: { provider: codex, model: skipped }
`)
      expect(routes.subagent).toBeUndefined()
    }
  })

  it('indexes inserted groups so later inserts and config replacements apply', () => {
    const routes = parsePersonalModelRoutes(`
- insert:
    - id: target
      group: true
      config: []
- id: target
  insert:
    - id: subagent-default-model
      config: { provider: codex, model: first, reasoningEffort: high }
- id: subagent-default-model
  config: { provider: codex, model: latest }
`)
    expect(routes.subagent).toEqual({ provider: 'codex', model: 'latest' })
  })

  it('returns unknown configuration on malformed input without exposing YAML source', () => {
    const routes = parsePersonalModelRoutes('- id: [broken\nsecret: private-test-credential')
    expect(routes.status).toBe('invalid')
    expect(routes.primary).toBeUndefined()
    expect(JSON.stringify(routes)).not.toContain('private-test-credential')
  })
})
