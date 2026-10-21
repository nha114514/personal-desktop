import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { type Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, bindScopeParent } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import * as Policy from '../src/index.ts'

let directory: string | undefined
let ctx: Context | undefined
afterEach(async () => {
  await ctx?.fiber.dispose()
  if (directory) await rm(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function boot(primaryOnlyToolPrefixes: string[] = []) {
  directory = await mkdtemp(join(tmpdir(), 'primary-delegation-'))
  const config = join(directory, 'cordis.yml')
  await writeFile(config, `- name: '@deepseek-ai/dsh-system-prompt'
- name: '@deepseek-ai/dsh-tools'
- id: primary-delegation
  name: '@deepseek-ai/dsh-primary-delegation'
  config:
    allowedTools: [subagent, list_agents, skill]
    primaryOnlyToolPrefixes: ${JSON.stringify(primaryOnlyToolPrefixes)}
`)
  ctx = new Context()
  ctx.baseUrl = pathToFileURL(directory).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  vi.spyOn(ctx.loader.internal!, 'import').mockImplementation(async (specifier: string) => {
    if (specifier === '@deepseek-ai/dsh-system-prompt') return SystemPrompt
    if (specifier === '@deepseek-ai/dsh-tools') return Tools
    if (specifier === '@deepseek-ai/dsh-primary-delegation') return Policy
    throw new Error(`Unexpected module: ${specifier}`)
  })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) {
    await entry.fiber?.await()
  }
  return ctx
}

async function actor(context: Context, id: string, parent?: Agent): Promise<Agent> {
  const sessionId = SessionId(id)
  let actorContext = context
  const value: Agent = {
    id: sessionId,
    session: Session.create(sessionId, [], {
      version: 4, id: sessionId, createdAt: 0, isSeeded: false,
      ...(parent ? { origin: 'subagent', parentSession: parent.id, delegationDepth: 1 } : {}),
    }),
    options: {}, status: 'idle', get ctx() { return actorContext },
    inbox: unsupportedInbox(), followup() {}, steer() {}, inject() {}, send() {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await context.plugin(Object.assign((inner: Context) => {
    const scope = createScope(inner, value)
    actorContext = scope.ctx
    if (parent) bindScopeParent(value, parent)
  }, { inject: ['tools', 'systemPrompt'] }))
  return value
}

function register(context: Context, name: string, calls: string[]) {
  context.tools.register(defineTool({
    name, description: name, parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => { calls.push(name); return name },
  }))
}

async function run(context: Context, agent: Agent, name: string) {
  return context.tools.execute({ agent, name, arguments: {}, callId: ToolCallId(name),
    signal: new AbortController().signal })
}

it('keeps the primary model on coordination while the child can execute inherited and new tools', async () => {
  const context = await boot()
  const calls: string[] = []
  for (const name of ['subagent', 'list_agents', 'skill', 'read', 'pwsh', 'web_search', 'write', 'create_agent']) {
    register(context, name, calls)
  }
  const primary = await actor(context, 'primary')
  const child = await actor(context, 'child', primary)
  register(primary.ctx, 'late_tool', calls)
  const primaryPrompt = await context.systemPrompt.assemble({ scope: primary, agent: primary })
  expect(primaryPrompt.tools.map(tool => tool.name).sort()).toEqual(['list_agents', 'skill', 'subagent'])
  expect(primaryPrompt.contexts.map(section => section.text).join('\n')).toContain('Delegate all execution')
  const childPrompt = await context.systemPrompt.assemble({ scope: child, agent: child })
  expect(childPrompt.tools.map(tool => tool.name)).toContain('write')
  expect(childPrompt.contexts.map(section => section.text).join('\n')).not.toContain('Delegate all execution')
  for (const name of ['read', 'pwsh', 'web_search', 'write', 'create_agent', 'late_tool']) {
    expect((await run(context, primary, name)).isError).toBe(true)
    expect(calls).not.toContain(name)
  }
  expect((await run(context, primary, 'subagent')).isError).toBe(false)
  expect((await run(context, child, 'write')).isError).toBe(false)
  expect((await run(context, child, 'late_tool')).isError).toBe(false)
  expect(calls).toEqual(['subagent', 'write', 'late_tool'])
})

it('cannot be bypassed by a pre-execute allow and removes its guard and prompt on disposal', async () => {
  const context = await boot()
  const calls: string[] = []
  register(context, 'pwsh', calls)
  const primary = await actor(context, 'primary')
  context.on('tools/pre-execute', async () => ({ kind: 'allow' }))
  expect((await run(context, primary, 'pwsh')).isError).toBe(true)
  expect(calls).toEqual([])
  const entry = [...context.loader.entries()].find(row => row.options.id === 'primary-delegation')!
  await entry.fiber!.dispose()
  expect((await run(context, primary, 'pwsh')).isError).toBe(false)
  const prompt = await context.systemPrompt.assemble({ scope: primary, agent: primary })
  expect(prompt.tools.map(tool => tool.name)).toContain('pwsh')
  expect(prompt.contexts.map(section => section.text).join('\n')).not.toContain('Delegate all execution')
})

it('reserves desktop control for the primary model while keeping other child tools available', async () => {
  const context = await boot(['mcp__windows-mcp__'])
  const calls: string[] = []
  const desktopTools = ['mcp__windows-mcp__Click', 'mcp__windows-mcp__Snapshot']
  for (const name of ['skill', 'pwsh', 'web_search', 'mcp__other__lookup', ...desktopTools]) {
    register(context, name, calls)
  }
  const primary = await actor(context, 'primary')
  const child = await actor(context, 'child', primary)
  const primaryPrompt = await context.systemPrompt.assemble({ scope: primary, agent: primary })
  const childPrompt = await context.systemPrompt.assemble({ scope: child, agent: child })
  expect({
    primary: primaryPrompt.tools.map(tool => tool.name).sort(),
    child: childPrompt.tools.map(tool => tool.name).sort(),
  }).toMatchInlineSnapshot(`
    {
      "child": [
        "mcp__other__lookup",
        "pwsh",
        "skill",
        "web_search",
      ],
      "primary": [
        "mcp__windows-mcp__Click",
        "mcp__windows-mcp__Snapshot",
        "skill",
      ],
    }
  `)
  expect(primaryPrompt.contexts.map(section => section.text).join('\n')).toContain('Desktop control is reserved for you')
  expect(childPrompt.contexts.map(section => section.text).join('\n')).toContain('Do not perform desktop automation')
  context.on('tools/pre-execute', async () => ({ kind: 'allow' }))
  for (const name of desktopTools) {
    expect((await run(context, child, name)).isError).toBe(true)
    expect((await context.tools.execute({ name, arguments: {}, callId: ToolCallId(name),
      signal: new AbortController().signal })).isError).toBe(true)
    expect(calls).not.toContain(name)
    expect((await run(context, primary, name)).isError).toBe(false)
  }
  expect((await run(context, primary, 'pwsh')).isError).toBe(true)
  for (const name of ['skill', 'pwsh', 'web_search', 'mcp__other__lookup']) {
    expect((await run(context, child, name)).isError).toBe(false)
  }
  expect(calls).toEqual([...desktopTools, 'skill', 'pwsh', 'web_search', 'mcp__other__lookup'])
  const entry = [...context.loader.entries()].find(row => row.options.id === 'primary-delegation')!
  await entry.fiber!.dispose()
  expect((await run(context, child, desktopTools[0]!)).isError).toBe(false)
  const afterDisposal = await context.systemPrompt.assemble({ scope: child, agent: child })
  expect(afterDisposal.tools.map(tool => tool.name)).toContain(desktopTools[0])
  expect(afterDisposal.contexts.map(section => section.text).join('\n')).not.toContain('Do not perform desktop automation')
})
