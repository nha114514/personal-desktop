/**
 * Windows desktop automation provider using CursorTouch Windows-MCP.
 * Connects the 20 Windows automation tools to Harness tool runtime,
 * enforces exclusive computer-use registration, input mutex queuing,
 * and emergency takeover stop.
 * @module
 */

import { DesktopExecutionManager, type DesktopExecutionOptions } from './execution.ts'
import { desktopParentChannel, DesktopParentBridge } from './parent-bridge.ts'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ComputerUseProviderName } from '@deepseek-ai/dsh-computer-use/brand'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-computer-use'
import type {} from '@deepseek-ai/dsh-tools'

/** Cordis plugin identity. */
export const name = 'computer-use-windows-mcp'
export { isDesktopControlRequest } from './parent-bridge.ts'
export type { DesktopMcpTool, DesktopControlRequest, DesktopControlCancel, DesktopControlState, DesktopControlResponse } from './parent-bridge.ts'

/** Required services before starting automation. */
export const inject = ['computerUse', 'tools']

export interface Config {
  /** Executable path; defaults to `C:\Users\mouwe\.local\bin\windows-mcp.exe`. */
  command: string
  /** Arguments; defaults to `['serve', '--transport', 'stdio']`. */
  args: string[]
  /** Per-call timeout in milliseconds. */
  toolCallTimeoutMs?: number
  /** Reconnection configuration. */
  reconnect?: McpClient.ReconnectConfig
}

export const Config: z<Partial<Config>, Config> = z.object({
  command: z.string().default('C:\\Users\\mouwe\\.local\\bin\\windows-mcp.exe'),
  args: z.array(String).default(['serve', '--transport', 'stdio']),
  toolCallTimeoutMs: z.number().min(1).default(60000),
  reconnect: z.object({
    enabled: z.boolean().default(false),
    initialDelayMs: z.number().min(1).default(1000),
    maxDelayMs: z.number().min(1).default(10000),
    maxAttempts: z.number().min(1).step(1).default(3),
  }).default({ enabled: false, initialDelayMs: 1000, maxDelayMs: 10000, maxAttempts: 3 }),
})

/**
 * Tools that interact with system desktop inputs or window focus
 * and must be exclusively serialized across parallel subagents.
 */
export const DESKTOP_MUTEX_TOOLS = new Set([
  'Click',
  'Type',
  'Move',
  'Scroll',
  'Shortcut',
  'MultiSelect',
  'MultiEdit',
  'Drag',
  'PressKey',
  'ReleaseKey',
  'SwitchWindow',
  'ActivateWindow',
  'MaximizeWindow',
  'MinimizeWindow',
  'RestoreWindow',
  'CloseWindow',
  'App',
  'Clipboard',
])

export { DesktopExecutionManager } from './execution.ts'
export type { DesktopExecutionOptions } from './execution.ts'

let globalSharedDesktopControl: DesktopExecutionManager | undefined

export function getSharedDesktopControl(options?: DesktopExecutionOptions): DesktopExecutionManager {
  if (!globalSharedDesktopControl) {
    globalSharedDesktopControl = new DesktopExecutionManager(options)
  }
  return globalSharedDesktopControl
}

export function setSharedDesktopControl(manager: DesktopExecutionManager | undefined): void {
  globalSharedDesktopControl = manager
}

export function resetSharedDesktopControl(): void {
  if (globalSharedDesktopControl) {
    globalSharedDesktopControl.clear()
    globalSharedDesktopControl = undefined
  }
}

/**
 * Reserve computer-use capability, connect Windows-MCP server, and install
 * around-dispatch tool execution queue and emergency stop.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const parent = process.env.DSH_DESKTOP_PERSONAL === '1' ? desktopParentChannel() : undefined
  if (parent !== undefined) {
    const bridge = new DesktopParentBridge(parent, config.toolCallTimeoutMs ?? 60000)
    ctx.effect(() => () => { bridge.dispose() }, 'windows-mcp.parent')
    ctx.effect(() => ctx.computerUse.register(ComputerUseProviderName('windows-mcp')), 'windows-mcp.owner')
    const tools = await bridge.listTools()
    for (const tool of tools) {
      const definition = McpClient.createMcpToolDefinition(ctx, {
        name: `mcp__windows-mcp__${tool.name}`,
        rawName: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        call: (args, execution) => {
          const header = execution.agent?.session.header
          if (header === undefined || header.origin === 'subagent' || header.parentSession !== undefined
            || (header.delegationDepth ?? 0) !== 0) throw new Error('Desktop control is available only to the primary model')
          return bridge.callTool(tool.name, args, execution.signal)
        },
      })
      ctx.effect(() => ctx.tools.register(definition), `windows-mcp.tool.${tool.name}`)
    }
    return
  }
  const sharedControl = getSharedDesktopControl()

  const connection = McpClient.Config({
    command: config.command,
    args: config.args,
    env: {
      ANONYMIZED_TELEMETRY: 'false',
      PYTHONUTF8: '1',
      PYTHONUNBUFFERED: '1',
    },
    toolCallTimeoutMs: config.toolCallTimeoutMs ?? 60000,
    reconnect: config.reconnect ?? { enabled: false, initialDelayMs: 1000, maxDelayMs: 10000, maxAttempts: 3 },
    transport: 'stdio',
    serverName: 'windows-mcp',
    failOnStartupError: true,
  })

  let child!: Fiber
  ctx.effect(function* () {
    yield ctx.computerUse.register(ComputerUseProviderName('windows-mcp'))
    child = ctx.plugin(McpClient, connection)
    yield child.dispose
    yield () => { sharedControl.clear() }
  }, 'computer-use-windows-mcp.connection')

  // Around-dispatch waterfall for FIFO input mutex and emergency stop
  ctx.on('tools/execute', async (exec, next) => {
    const isWindowsMcp = exec.name.startsWith('mcp__windows-mcp__')
    if (!isWindowsMcp) {
      return next()
    }

    if (sharedControl.isPaused()) {
      throw new Error('Automated desktop input is stopped by user takeover. Call resume() first.')
    }

    return sharedControl.runExclusive(async (signal) => {
        exec.signal = signal
        if (sharedControl.isPaused()) {
          throw new Error('Automated desktop input is stopped by user takeover. Call resume() first.')
        }
        return next()
      }, exec.signal)
  })

  await child.await()
}

export default { name, inject, Config, apply }
