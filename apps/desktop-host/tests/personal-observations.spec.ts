import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { ModelRequestObservation } from '@deepseek-ai/dsh-client-ui-personal-workbench/types'
import { describe, expect, it } from 'vitest'
import { installPersonalObservations } from '../src/personal-observations.ts'

class ScriptedAdapter extends LlmAdapter {
  constructor(private readonly script: StreamChunk[]) { super() }
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> { yield* this.script }
}

describe('personal production request observation', () => {
  it('observes the real LLM waterfall, distinguishes primary/child/auxiliary, and removes listeners', async () => {
    const ctx = new Context()
    const events: ModelRequestObservation[] = []
    try {
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(SessionStore)
      ctx.llm.registerAdapter(['custom-api'], new ScriptedAdapter([
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: 'private-model-text' },
        { type: 'block-end', index: 0, block: { type: 'text', text: 'private-model-text' } },
        { type: 'finish', reason: { kind: 'stop' } },
      ]))
      ctx.llm.registerConfigurableProviders([{ provider: 'custom-api', displayName: 'Fixture', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'custom-api'] }])
      const primary = ctx.sessions.create(SessionId('root'))
      const child = ctx.sessions.create(SessionId('child'), { meta: { origin: 'subagent', parentSession: primary.id, delegationDepth: 1 } })
      const dispose = installPersonalObservations(ctx, event => { events.push(event) })
      const run = async (extra: Partial<GenerateOptions>) => {
        for await (const _chunk of ctx.llm.stream({ provider: 'custom-api', model: 'user-selected-model', messages: [], ...extra })) { /* Consume the production iterator. */ }
      }
      await run({ sessionId: primary.id })
      await run({ sessionId: child.id })
      await run({ sessionId: primary.id, purpose: 'session-title' })
      expect(events.filter(event => event.phase === 'started').map(event => event.role)).toEqual(['primary', 'subagent', 'auxiliary'])
      expect(events.filter(event => event.role === 'primary').map(event => event.phase)).toEqual(['started', 'first-event', 'first-text', 'finished'])
      expect(events.every(event => event.channelType === 'api-direct')).toBe(true)
      expect(events.find(event => event.role === 'subagent')?.parentSessionId).toBe(primary.id)
      expect(new Set(events.map(event => event.requestId)).size).toBe(3)
      expect(JSON.stringify(events)).not.toContain('private-model-text')
      dispose()
      const count = events.length
      await run({ sessionId: primary.id })
      expect(events.length).toBe(count)
    } finally { await ctx.fiber.dispose() }
  })

  it('preserves cancellation and never labels an incomplete consumer as successful', async () => {
    const ctx = new Context()
    const events: ModelRequestObservation[] = []
    try {
      await ctx.plugin(LlmRuntime)
      ctx.llm.registerAdapter(['custom-api'], new ScriptedAdapter([
        { type: 'text-delta', index: 0, text: 'first' },
        { type: 'finish', reason: { kind: 'stop' } },
      ]))
      const dispose = installPersonalObservations(ctx, event => { events.push(event) })
      const abort = new AbortController()
      for await (const _chunk of ctx.llm.stream({ provider: 'custom-api', model: 'chosen', messages: [], signal: abort.signal })) {
        abort.abort()
        break
      }
      expect(events.at(-1)).toMatchObject({ phase: 'finished', outcome: 'aborted' })
      expect(events.at(-1)?.failureCode).toBeUndefined()
      dispose()
    } finally { await ctx.fiber.dispose() }
  })

  it('keeps upstream failures out of telemetry and contains a failing publisher', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(LlmRuntime)
      ctx.llm.registerAdapter(['custom-api'], new ScriptedAdapter([{ type: 'finish', reason: { kind: 'stop' } }]))
      const dispose = installPersonalObservations(ctx, () => { throw new Error('private-publisher-failure') })
      const chunks: StreamChunk[] = []
      for await (const chunk of ctx.llm.stream({ provider: 'custom-api', model: 'chosen', messages: [] })) chunks.push(chunk)
      expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
      dispose()
    } finally { await ctx.fiber.dispose() }
  })
})
