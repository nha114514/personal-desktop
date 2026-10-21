/**
 * Assign coordination and primary-only tools by session role; children execute other tasks.
 * @module @deepseek-ai/dsh-primary-delegation
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin identity. */
export const name = 'primary-delegation'
/** Services used for prompt projection and execution enforcement. */
export const inject = ['tools', 'systemPrompt']

/** Deployment-owned coordination tools exposed to the primary model. */
export interface Config {
  /** Exact coordination tool names; alternate agent creation tools must be omitted. */
  allowedTools: string[]
  /** Tool namespaces reserved for primary sessions, including desktop-control providers. */
  primaryOnlyToolPrefixes?: string[]
}

/** Require an explicit deployment tool list. */
export const Config = z.object({
  allowedTools: z.array(z.string()).required(),
  primaryOnlyToolPrefixes: z.array(z.string()).default([]),
})

const PRIMARY_POLICY_START = 'You are the primary decision and design agent. Own requirements, design direction, task breakdown, important decisions, and evaluation of reported evidence.'
const PRIMARY_POLICY_END = 'Use subagent with the selected defaults or an explicitly authorized model; do not start alternate agents. Load skills for guidance; assign other execution to children. Children are execution leaf nodes and must not delegate again. If a child is unavailable or fails, report the blocker or retry an authorized child; never take over its delegated execution or change the selected main model.'
const CHILD_DESKTOP_POLICY = 'Desktop control belongs to the primary model. Do not perform desktop automation through tools, terminals, scripts or MCP. Report desktop work to the primary model. Other authorized skills and task tools remain available.'

function isPrimary(agent: Agent | undefined): agent is Agent {
  const header = agent?.session.header
  return header !== undefined && header.origin !== 'subagent' && header.parentSession === undefined
    && (header.delegationDepth ?? 0) === 0
}

/**
 * Project role-specific tools and enforce the same rules on direct and nested dispatch.
 * @param ctx - plugin owner; registrations are removed with its fiber.
 * @param config - deployment's explicit coordination tool list.
 */
export function apply(ctx: Context, config: Config): void {
  const allowed = new Set(config.allowedTools)
  const primaryOnlyToolPrefixes = config.primaryOnlyToolPrefixes ?? []
  const isPrimaryOnly = (name: string): boolean => primaryOnlyToolPrefixes.some(prefix => name.startsWith(prefix))
  const executionPolicy = primaryOnlyToolPrefixes.length > 0
    ? 'Delegate file access, code, commands, testing, debugging, search, scraping and browser retrieval to user-authorized subagents. Desktop control is reserved for you; never assign desktop automation to a child. All other authorized skills remain available to children, including project memory.'
    : 'Delegate all execution to user-authorized subagents: reading or changing files, writing code, running commands, testing, debugging, search, scraping, browser and computer actions.'
  const primaryPolicy = `${PRIMARY_POLICY_START} ${executionPolicy} ${PRIMARY_POLICY_END}`
  ctx.systemPrompt.context({
    name: 'primary-delegation',
    order: ctx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION'),
    text: ({ agent }) => isPrimary(agent) ? primaryPolicy
      : primaryOnlyToolPrefixes.length > 0 ? CHILD_DESKTOP_POLICY : '',
  })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const primary = isPrimary(context.agent)
    return {
      ...assembled,
      tools: assembled.tools.filter(tool => primary
        ? allowed.has(tool.name) || isPrimaryOnly(tool.name)
        : !isPrimaryOnly(tool.name)),
    }
  })
  ctx.tools.guard(exec => {
    const primary = isPrimary(exec.agent)
    if (isPrimaryOnly(exec.name)) {
      return primary ? undefined : `Tool '${exec.name}' is reserved for the primary model. Report desktop work to the primary model.`
    }
    return primary && !allowed.has(exec.name)
      ? `Assign '${exec.name}' to an authorized subagent; the primary model only coordinates and uses its reserved tools.`
      : undefined
  })
}
