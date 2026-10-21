import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SubagentRuntime from '../src/index.ts'
import { applyChildComposition } from '../src/child-agent.ts'
import { SubagentError } from '../src/error.ts'

function createMockAgent(id: string, options: { depth?: number; origin?: 'root' | 'subagent'; parentSession?: SessionId } = {}): Agent {
  const sessionId = SessionId(id)
  const session = Session.create(sessionId, [], {
    version: 4,
    id: sessionId,
    createdAt: Date.now(),
    isSeeded: false,
    delegationDepth: options.depth ?? 0,
    ...(options.origin ? { origin: options.origin } : {}),
    ...(options.parentSession ? { parentSession: options.parentSession } : {}),
  } as any)
  return {
    id: sessionId,
    options: {
      provider: 'mock',
      model: 'mock',
      subagentDepth: options.depth ?? 0,
    },
    session,
  } as unknown as Agent
}

describe('leaf-node enforcement: creation and delegation prevention', () => {
  it('rejects subagents.start when the caller is a subagent leaf node', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'mock-provider',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      start: () => Promise.resolve({
        id: SessionId('mock-child'),
        localAgent: undefined,
        result: Promise.resolve({ output: [], stopReason: 'completed' as const }),
        dispose: () => Promise.resolve(),
      }),
    })

    const childCaller = createMockAgent('child-caller', { depth: 1, origin: 'subagent', parentSession: SessionId('root') })
    const signal = new AbortController().signal

    await expect(ctx.subagents.start('mock-provider', {
      label: 'illegal nested child',
      prompt: [{ type: 'text', text: 'illegal' }],
      parent: childCaller,
      signal,
    })).rejects.toThrowError(SubagentError)

    await expect(ctx.subagents.start('mock-provider', {
      label: 'illegal nested child',
      prompt: [{ type: 'text', text: 'illegal' }],
      parent: childCaller,
      signal,
    })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: expect.stringContaining('subagent leaf nodes cannot delegate or create further subagents'),
    })

    await ctx.fiber.dispose()
  })

  it('strips all delegation and control tools in child composition and blocks execution via monotonic guard', async () => {
    const rootCtx = new Context()
    await rootCtx.plugin(Tools)
    await rootCtx.plugin(SystemPrompt)

    const simpleTool = (name: string) => defineTool({
      name,
      description: `${name} tool`,
      parameters: {
        text: { type: 'string' },
      },
      output: {
        schema: { type: 'string' },
        render: () => [{ type: 'text', text: `executed ${name}` }],
      },
      execute: () => Promise.resolve(`executed ${name}`),
    })

    // Register a suite of tools including delegation and execution tools
    rootCtx.tools.register(simpleTool('subagent'))
    rootCtx.tools.register(simpleTool('workflow'))
    rootCtx.tools.register(simpleTool('interrupt_agent'))
    rootCtx.tools.register(simpleTool('bash'))

    const parent = createMockAgent('root-agent')
    const childAgent = createMockAgent('child-agent', { depth: 1, origin: 'subagent' })
    const childScope = createScope(rootCtx, childAgent)
    await childScope.ctx.inject(['systemPrompt', 'tools'], async (childCtx) => {
      applyChildComposition(childCtx, parent, {})

      // Visible tools in child schema must NOT include delegation or control tools
      const childSchemas = childCtx.tools.schemas(scopeOf(childCtx)).map(s => s.name)
      expect(childSchemas).toContain('bash')
      expect(childSchemas).not.toContain('subagent')
      expect(childSchemas).not.toContain('workflow')
      expect(childSchemas).not.toContain('interrupt_agent')

      // Direct invocation via tools.execute must be blocked by monotonic guard
      const execution = await childCtx.tools.execute({
        agent: childAgent,
        name: 'subagent',
        arguments: {},
        callId: 'call-1' as any,
        signal: new AbortController().signal,
      })
      expect(execution.isError).toBe(true)
      const errText = execution.content.filter(b => b.type === 'text').map(b => (b as any).text).join('')
      expect(errText).toContain('subagent leaf nodes cannot execute delegation or agent control tools')

      // Safe execution tool remains usable
      const bashExec = await childCtx.tools.execute({
        agent: childAgent,
        name: 'bash',
        arguments: {},
        callId: 'call-2' as any,
        signal: new AbortController().signal,
      })
      expect(bashExec.isError).toBe(false)
    })

    await rootCtx.fiber.dispose()
  })
})
