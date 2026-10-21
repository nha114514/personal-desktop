import { describe, expect, it } from 'vitest'
import { parseHostResponse, withHostTools } from '../src/harness-tools.ts'
const options = { provider: 'gemini-1', model: 'gemini-3.8-flash', messages: [], tools: [{ name: 'web_search', description: 'Search', parameters: { type: 'object' } }] }

describe('Gemini host tool contract', () => {
  it('publishes actual host tool schemas and returns declared requests for host execution', () => {
    expect(withHostTools('Search', options)).toContain('web_search')
    expect(parseHostResponse('{"text":"Searching","toolCalls":[{"name":"web_search","arguments":"{\\"queries\\":[\\"Python\\"]}"}]}', options))
      .toEqual({ text: 'Searching', toolCalls: [{ name: 'web_search', arguments: '{"queries":["Python"]}' }] })
  })
  it('rejects native or undeclared delegation and malformed arguments', () => {
    for (const name of ['search_web', 'invoke_subagent', 'run_command']) {
      expect(() => parseHostResponse(JSON.stringify({ text: '', toolCalls: [{ name, arguments: '{}' }] }), options)).toThrow(/outside/)
    }
    expect(() => parseHostResponse(JSON.stringify({ text: '', toolCalls: [{ name: 'web_search', arguments: '[]' }] }), options)).toThrow(/object/)
    expect(() => parseHostResponse('not JSON', options)).toThrow(/invalid/)
  })
})
