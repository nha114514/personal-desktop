/** Windows-MCP requests carried on the existing Desktop Host parent IPC channel. */

/** Advertised native tool, retained without replacing its schema or image output. */
export interface DesktopMcpTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: unknown
}

/** Messages accepted only from the shell's own Host child. */
export type DesktopControlRequest = {
  type: 'desktop-control-request'
  requestId: number
} & ({ action: 'list' } | {
  action: 'call'
  epoch: number
  name: string
  arguments: Record<string, unknown>
})

/** Cancellation targets one already admitted Host request. */
export interface DesktopControlCancel {
  type: 'desktop-control-cancel'
  requestId: number
}

/** Shell-owned state; generations change on cancellation, never by a model argument. */
export interface DesktopControlState {
  type: 'desktop-control-state'
  epoch: number
  paused: boolean
}

/** Correlated result; raw MCP blocks remain in result. */
export interface DesktopControlResponse {
  type: 'desktop-control-response'
  requestId: number
  epoch: number
  paused: boolean
  result?: unknown
  error?: string
}

/** Small injectable view of Node parent IPC, also usable by isolated protocol tests. */
export interface DesktopParentChannel {
  connected(): boolean
  send(message: object, callback: (error: Error | null) => void): void
  on(event: 'message' | 'disconnect', listener: (message?: unknown) => void): void
  off(event: 'message' | 'disconnect', listener: (message?: unknown) => void): void
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate only the private request vocabulary before dispatching to the owner.
 * @param value - Child-process message.
 * @returns Whether this is a complete desktop request or cancellation.
 */
export function isDesktopControlRequest(value: unknown): value is DesktopControlRequest | DesktopControlCancel {
  if (!object(value) || !Number.isSafeInteger(value.requestId) || Number(value.requestId) < 1) return false
  if (value.type === 'desktop-control-cancel') return true
  if (value.type !== 'desktop-control-request') return false
  if (value.action === 'list') return true
  return value.action === 'call' && Number.isSafeInteger(value.epoch) && Number(value.epoch) >= 0
    && typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 128 && object(value.arguments)
}

/**
 * Bind the current Node parent channel; standalone profiles must use their native connection.
 * @returns A parent transport only when this process is attached to a parent.
 */
export function desktopParentChannel(): DesktopParentChannel | undefined {
  if (!process.connected || process.send === undefined) return undefined
  return {
    connected: () => process.connected,
    send: (message, callback) => {
      if (!process.connected || process.send === undefined) { callback(new Error('Desktop owner disconnected')); return }
      process.send(message, callback)
    },
    on: (event, listener) => { process.on(event, listener) },
    off: (event, listener) => { process.off(event, listener) },
  }
}

/** Host request multiplexer; it never launches a second Windows-MCP process. */
let nextRequestId = 0
export class DesktopParentBridge {
  private epoch = 0
  private paused = false
  private disposed = false
  private readonly pending = new Map<number, { finish(error?: Error, result?: unknown): void }>()
  private readonly receive = (message?: unknown): void => {
    if (!object(message) || !['desktop-control-state', 'desktop-control-response'].includes(String(message.type))
      || !Number.isSafeInteger(message.epoch) || typeof message.paused !== 'boolean') return
    if (Number(message.epoch) >= this.epoch) {
      this.epoch = Number(message.epoch)
      this.paused = message.paused
    }
    if (message.type === 'desktop-control-response' && Number.isSafeInteger(message.requestId)) {
      const request = this.pending.get(Number(message.requestId))
      if (message.error !== undefined && typeof message.error !== 'string') {
        request?.finish(new Error('Invalid desktop owner response'))
      } else request?.finish(typeof message.error === 'string' ? new Error(message.error) : undefined, message.result)
    }
  }
  private readonly disconnect = (): void => { this.dispose() }

  constructor(private readonly channel: DesktopParentChannel, private readonly timeoutMs: number) {
    channel.on('message', this.receive)
    channel.on('disconnect', this.disconnect)
  }

  private request(action: 'list' | 'call', name?: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (this.disposed || !this.channel.connected()) return Promise.reject(new Error('Desktop owner disconnected'))
    if (signal?.aborted) return Promise.reject(new Error('Desktop request aborted'))
    if (action === 'call' && this.paused) return Promise.reject(new Error('Desktop automation is stopped by user takeover'))
    const requestId = ++nextRequestId
    const message: DesktopControlRequest = action === 'list'
      ? { type: 'desktop-control-request', requestId, action }
      : { type: 'desktop-control-request', requestId, action, epoch: this.epoch, name: name!, arguments: args! }
    return new Promise((resolve, reject) => {
      const cancel = (): void => {
        this.channel.send({ type: 'desktop-control-cancel', requestId }, () => {})
      }
      const onAbort = (): void => { cancel(); this.pending.get(requestId)?.finish(new Error('Desktop request aborted')) }
      const timer = setTimeout(() => {
        cancel()
        this.pending.get(requestId)?.finish(new Error('Desktop owner request timed out'))
      }, this.timeoutMs)
      timer.unref()
      this.pending.set(requestId, {
        finish: (error, result) => {
          if (!this.pending.delete(requestId)) return
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          if (error) reject(error)
          else resolve(result)
        },
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      this.channel.send(message, error => { if (error) this.pending.get(requestId)?.finish(new Error('Desktop owner disconnected')) })
      if (signal?.aborted) onAbort()
    })
  }

  /** @returns Native tool definitions advertised by the sole shell connection. */
  async listTools(): Promise<DesktopMcpTool[]> {
    const result = await this.request('list')
    if (!object(result) || !Array.isArray(result.tools)) throw new Error('Invalid desktop owner tool catalog')
    return result.tools.map((tool: unknown) => {
      if (!object(tool) || typeof tool.name !== 'string' || !object(tool.inputSchema)) throw new Error('Invalid desktop owner tool definition')
      return {
        name: tool.name, inputSchema: tool.inputSchema,
        ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
        ...('outputSchema' in tool ? { outputSchema: tool.outputSchema } : {}),
      }
    })
  }

  /**
   * Forward one admitted tool call without losing MCP content blocks.
   * @param name - Advertised raw MCP tool name.
   * @param args - Arguments already validated by the tool registry.
   * @param signal - Exact caller cancellation.
   * @returns Raw MCP result for the existing canonical projection.
   */
  callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    return this.request('call', name, args, signal)
  }

  /** Reject all in-flight callers and release parent listeners. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.channel.off('message', this.receive)
    this.channel.off('disconnect', this.disconnect)
    for (const [requestId, request] of [...this.pending]) {
      if (this.channel.connected()) this.channel.send({ type: 'desktop-control-cancel', requestId }, () => {})
      request.finish(new Error('Desktop owner disconnected'))
    }
  }
}
