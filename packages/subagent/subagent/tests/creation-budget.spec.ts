/** Per-turn creation admission uses real Session catalogs and no remote models. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import SubagentRuntime, { SubagentError } from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

function rejectionCode(result: Promise<unknown>): Promise<string | undefined> {
  return result.then(() => undefined, (error: unknown) => error instanceof SubagentError ? error.code : String(error))
}

async function boot(limit = 8, gate?: Promise<void>) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await liveConfig(ctx, SubagentRuntime, { maxNewSubagentsPerTurn: limit, enforceLeafSubagents: true })
  const parent = await ctx.agentLoop.create(SessionId('creation-parent'), {})
  parent.session.append('turn/start', { turn: 1 })
  let starts = 0
  for (const name of ['worker', 'reviewer']) ctx.subagents.registerProvider({
    name, capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }, inheritsParentContext: false,
    async start(request) {
      const id = SessionId(`child-${++starts}`)
      await gate
      const handle = await ctx.agents.create({
        sessionId: id,
        meta: { origin: 'subagent', parentSession: request.parent.id, delegationDepth: 1 },
      })
      return {
        id, localAgent: handle.agent,
        result: Promise.resolve({ output: [], stopReason: 'completed' as const }),
        dispose: () => handle.dispose(),
      }
    },
  })
  const start = (agent: Agent = parent, name = 'worker') => ctx.subagents.start(name, {
    parent: agent, prompt: [{ type: 'text', text: 'fixture' }], signal: new AbortController().signal,
  })
  return { ctx, parent, start, starts: () => starts }
}

it('admits eight creations across providers, then rejects the ninth even after earlier children finish', async () => {
  const { ctx, parent, start, starts } = await boot()
  for (let i = 0; i < 8; i += 1) {
    const run = await start(parent, i % 2 === 0 ? 'worker' : 'reviewer')
    await run.result
    await run.dispose()
  }
  expect(await rejectionCode(start())).toBe('CREATION_LIMIT')
  expect(await rejectionCode(ctx.subagents.startContinuable({
    provider: 'worker', label: 'alternate entry', request: { parent, prompt: [] }, signal: new AbortController().signal,
  }))).toBe('CREATION_LIMIT')
  expect(starts()).toBe(8)
})

it('restores the current turn budget from the Session log and resets only at a new parent turn', async () => {
  const { ctx, parent, start } = await boot(1)
  const run = await start()
  await run.result
  await run.dispose()
  const restored = await ctx.agents.create({ sessionId: SessionId('restored-parent'), seed: parent.session.snapshotEvents() })
  expect(await rejectionCode(start(restored.agent))).toBe('CREATION_LIMIT')
  restored.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  restored.agent.session.append('turn/start', { turn: 2 })
  expect(await rejectionCode(start(restored.agent))).toBe('CREATION_LIMIT')
  restored.agent.session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: 'next user task' }],
  }), { surfaceOp: 'append' })
  const next = await start(restored.agent)
  await next.result
  await next.dispose()
})

it('reserves creation slots before concurrent provider startup', async () => {
  const gate = Promise.withResolvers<void>()
  const { start, starts } = await boot(2, gate.promise)
  const settled = Promise.allSettled([start(), start(), start()])
  try {
    await vi.waitFor(() => { expect(starts()).toBeGreaterThanOrEqual(2) })
    expect(starts()).toBe(2)
  } finally { gate.resolve() }
  const results = await settled
  for (const result of results) if (result.status === 'fulfilled') await result.value.dispose()
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
})

it('counts a published child once while its startup reservation is still open', async () => {
  const { ctx, parent, start, starts } = await boot(2)
  let second: ReturnType<typeof start> | undefined
  ctx.on('session/event', (session, event) => {
    if (session !== parent.session || event.type !== 'subagent/catalog' || second !== undefined) return
    second = start()
    void second.catch(() => undefined)
  })
  const first = await start()
  await first.dispose()
  if (second === undefined) throw new Error('child publication did not request the next start')
  const result = await Promise.allSettled([second])
  for (const entry of result) if (entry.status === 'fulfilled') await entry.value.dispose()
  expect(result[0]?.status).toBe('fulfilled')
  expect(starts()).toBe(2)
  expect(await rejectionCode(start())).toBe('CREATION_LIMIT')
})

it.each(['origin', 'parentSession'] as const)('rejects nested creation through both service entries when only %s identifies a child', async (lineage) => {
  const { ctx, parent, start, starts } = await boot()
  const child = await ctx.agents.create({
    sessionId: SessionId(`leaf-${lineage}`),
    meta: lineage === 'origin' ? { origin: 'subagent' } : { parentSession: parent.id },
  })
  expect(await rejectionCode(start(child.agent))).toBe('UNAUTHORIZED')
  expect(await rejectionCode(ctx.subagents.startContinuable({
    provider: 'worker', label: 'nested', request: { parent: child.agent, prompt: [] }, signal: new AbortController().signal,
  }))).toBe('UNAUTHORIZED')
  expect(starts()).toBe(0)
})
