import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  LlmAdapter,
  LlmError,
  ToolCallId,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type PreparedAdapterCall,
  type RequestMessage,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { getCodexModels, resolveCodexModelInfo } from './catalog.ts'
import { getCodexAppServerArgv } from './executable.ts'
import { formatCodexPrompt, formatCodexTurnPrompt, codexMessageText } from './prompt.ts'

const NATIVE_EXECUTION_FEATURES = [
  'shell_tool', 'unified_exec', 'browser_use', 'computer_use', 'view_image',
  'apps', 'multi_agent', 'multi_agent_v2', 'plugins', 'hooks', 'worktrees',
  'workspace_dependencies', 'image_generation', 'goals',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Keep native CLI capabilities outside the Harness-owned tool executor. */
function harnessThreadConfig(response: unknown): Record<string, unknown> {
  if (!isRecord(response) || !isRecord(response.config)) {
    throw new LlmError('Codex did not return its native tool configuration', 'INVALID_NATIVE_TOOL_CONFIG')
  }
  const servers = response.config.mcp_servers ?? {}
  const plugins = response.config.plugins ?? {}
  if (!isRecord(servers) || !isRecord(plugins)) {
    throw new LlmError('Codex returned invalid native tool configuration', 'INVALID_NATIVE_TOOL_CONFIG')
  }
  const disabledServers = Object.fromEntries(Object.keys(servers).map(name => {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      throw new LlmError('Codex MCP server names must use letters, numbers, underscores or hyphens to disable native tools safely', 'INVALID_NATIVE_TOOL_CONFIG')
    }
    return [`mcp_servers.${name}.enabled`, false]
  }))
  return {
    web_search: 'disabled',
    features: { ...Object.fromEntries(NATIVE_EXECUTION_FEATURES.map(name => [name, false])), code_mode_host: true },
    // Flat overrides preserve transports without round-tripping nullable configuration values.
    ...disabledServers,
    plugins: Object.fromEntries(Object.keys(plugins).map(name => [name, { enabled: false }])),
  }
}

class ChunkQueue {
  private chunks: StreamChunk[] = []
  private waiters: Array<() => void> = []
  private done = false
  private error: unknown = null

  push(chunk: StreamChunk): void {
    this.chunks.push(chunk)
    const waiter = this.waiters.shift()
    if (waiter) waiter()
  }

  fail(err: unknown): void {
    this.error = err
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) waiter()
  }

  close(): void {
    this.done = true
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) waiter()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<StreamChunk> {
    while (true) {
      while (this.chunks.length > 0) {
        yield this.chunks.shift()!
      }
      if (this.error) throw this.error
      if (this.done) return
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
      })
    }
  }
}

interface PendingToolCall {
  rpcId: number | string
  callId: ToolCallId
  tool: string
  arguments: string
}

class CodexConnection {
  readonly child: ReturnType<typeof spawn>
  readonly rl: ReturnType<typeof createInterface>
  model: string
  initialized = false
  deliveredMessages: string[] = []
  activeThreadId?: string
  activeTurnId?: string
  lastUsedAt: number
  idleTimer?: NodeJS.Timeout | undefined
  stderrBuffer = ''

  private nextRpcId = 1
  readonly pendingRpc = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>()
  readonly pendingToolCalls = new Map<string, PendingToolCall>()
  readonly deliveredMessageIds = new Set<string>()

  readonly sessionId: string
  private readonly onExit: (conn: CodexConnection) => void
  currentQueue?: ChunkQueue | undefined
  turnSettled = false
  blockIndex = 0
  currentBlock: { type: 'reasoning' | 'text'; index: number; text: string } | null = null

  constructor(
    sessionId: string,
    model: string,
    onExit: (conn: CodexConnection) => void,
  ) {
    this.sessionId = sessionId
    this.model = model
    this.onExit = onExit
    this.lastUsedAt = Date.now()

    const argv = getCodexAppServerArgv()
    this.child = spawn(argv[0]!, [
      ...argv.slice(1),
      ...NATIVE_EXECUTION_FEATURES.flatMap(feature => ['--disable', feature]),
      '--enable', 'code_mode_host',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.child.stderr?.on('data', (chunk) => {
      this.stderrBuffer += chunk.toString()
      if (this.stderrBuffer.length > 8192) {
        this.stderrBuffer = this.stderrBuffer.slice(-8192)
      }
    })

    this.rl = createInterface({ input: this.child.stdout! })
    this.setupListeners()
  }

  closeCurrentBlock(): void {
    if (!this.currentBlock || !this.currentQueue) return
    if (this.currentBlock.type === 'reasoning') {
      this.currentQueue.push({
        type: 'block-end',
        index: this.currentBlock.index,
        block: { type: 'reasoning', text: this.currentBlock.text },
      })
    } else if (this.currentBlock.type === 'text') {
      this.currentQueue.push({
        type: 'block-end',
        index: this.currentBlock.index,
        block: { type: 'text', text: this.currentBlock.text },
      })
    }
    this.currentBlock = null
  }

  send(method: string, params: unknown, timeoutMs = 15000): Promise<any> {
    const id = this.nextRpcId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRpc.has(id)) {
          this.pendingRpc.delete(id)
          reject(new LlmError(`Codex RPC '${method}' timed out after ${timeoutMs}ms`, 'TIMEOUT'))
        }
      }, timeoutMs)

      this.pendingRpc.set(id, {
        resolve: (val) => {
          clearTimeout(timer)
          resolve(val)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })

      try {
        this.child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      } catch (err) {
        clearTimeout(timer)
        this.pendingRpc.delete(id)
        reject(err)
      }
    })
  }

  sendToolResponse(rpcId: number | string, text: string, contextText: string, success: boolean): void {
    this.child.stdin!.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          contentItems: [
            { type: 'inputText', text: text || '(empty output)' },
            ...(contextText ? [{ type: 'inputText', text: `[New Harness Messages]\n${contextText}` }] : []),
          ],
          success,
        },
      }) + '\n',
    )
  }

  rememberMessages(messages: readonly RequestMessage[]): void {
    this.deliveredMessages = messages.map(({ id: _id, ...message }) => JSON.stringify(message))
    this.deliveredMessageIds.clear()
    for (const message of messages) {
      if (message.id !== undefined) this.deliveredMessageIds.add(message.id)
    }
  }

  private setupListeners(): void {
    this.rl.on('line', (line) => {
      try {
        if (!line.trim().startsWith('{')) return
        const msg = JSON.parse(line)

        // Handle JSON-RPC response from server (strict regression guard for id: 0)
        if (msg.id !== undefined && msg.id !== null && this.pendingRpc.has(msg.id)) {
          const { resolve, reject } = this.pendingRpc.get(msg.id)!
          this.pendingRpc.delete(msg.id)
          if (msg.error) reject(msg.error)
          else resolve(msg.result)
          return
        }

        const queue = this.currentQueue

        // Dynamic tool call from Codex app-server
        if (msg.id !== undefined && msg.id !== null && msg.method === 'item/tool/call') {
          this.closeCurrentBlock()
          const toolIdx = this.blockIndex++
          const toolCallId = ToolCallId(msg.params?.callId ?? `call_${toolIdx}`)
          const toolName = String(msg.params?.tool ?? 'unknown')
          const argsStr =
            typeof msg.params?.arguments === 'string'
              ? msg.params.arguments
              : JSON.stringify(msg.params?.arguments ?? {})

          // Hold the pending request on this connection without killing the process
          this.pendingToolCalls.set(String(toolCallId), {
            rpcId: msg.id,
            callId: toolCallId,
            tool: toolName,
            arguments: argsStr,
          })

          if (queue) {
            queue.push({ type: 'block-start', index: toolIdx, blockType: 'tool-call' })
            queue.push({
              type: 'tool-call-delta',
              index: toolIdx,
              id: toolCallId,
              name: toolName,
              argumentsDelta: argsStr,
            })
            queue.push({
              type: 'block-end',
              index: toolIdx,
              block: {
                type: 'tool-call',
                id: toolCallId,
                name: toolName,
                arguments: argsStr,
              },
            })
            queue.push({ type: 'finish', reason: { kind: 'tool-calls' } })
            this.turnSettled = true
            queue.close()
          }
          return
        }

        // Notifications
        if (msg.method === 'turn/started') {
          this.activeTurnId = msg.params?.turn?.id
          return
        }

        // Reasoning deltas and summary stream events
        if (
          msg.method === 'item/reasoning/textDelta' ||
          msg.method === 'item/reasoning/summaryTextDelta'
        ) {
          const delta = msg.params?.delta
          if (typeof delta === 'string' && delta.length > 0 && queue) {
            if (this.currentBlock && this.currentBlock.type !== 'reasoning') {
              this.closeCurrentBlock()
            }
            if (!this.currentBlock) {
              const idx = this.blockIndex++
              this.currentBlock = { type: 'reasoning', index: idx, text: '' }
              queue.push({ type: 'block-start', index: idx, blockType: 'reasoning' })
            }
            this.currentBlock.text += delta
            queue.push({ type: 'reasoning-delta', index: this.currentBlock.index, text: delta })
          }
          return
        }

        if (msg.method === 'item/reasoning/summaryPartAdded') {
          this.closeCurrentBlock()
          return
        }

        // Agent message deltas
        if (msg.method === 'item/agentMessage/delta') {
          const delta = msg.params?.delta
          if (typeof delta === 'string' && delta.length > 0 && queue) {
            if (this.currentBlock && this.currentBlock.type !== 'text') {
              this.closeCurrentBlock()
            }
            if (!this.currentBlock) {
              const idx = this.blockIndex++
              this.currentBlock = { type: 'text', index: idx, text: '' }
              queue.push({ type: 'block-start', index: idx, blockType: 'text' })
            }
            this.currentBlock.text += delta
            queue.push({ type: 'text-delta', index: this.currentBlock.index, text: delta })
          }
          return
        }

        if (msg.method === 'error') {
          const err = msg.params?.error
          if (err?.codexErrorInfo === 'usageLimitExceeded' && queue) {
            this.turnSettled = true
            this.closeCurrentBlock()
            queue.fail(new LlmError(err.message, 'QUOTA_EXCEEDED', { status: 429 }))
          } else if (
            queue
            && (err?.codexErrorInfo === 'contextWindowExceeded'
              || (typeof err?.message === 'string'
                && /context[_ -]?length[_ -]?exceeded|context[_ -]?window[_ -]?exceeded|maximum context length/i.test(err.message)))
          ) {
            this.turnSettled = true
            this.closeCurrentBlock()
            queue.fail(new LlmError(err.message ?? 'Context window exceeded', CONTEXT_WINDOW_EXCEEDED_CODE))
          }
          return
        }

        if (msg.method === 'turn/completed') {
          this.turnSettled = true
          this.closeCurrentBlock()
          const turn = msg.params?.turn
          if (!queue) return

          if (!turn) {
            queue.close()
            return
          }

          if (turn.status === 'completed') {
            if (turn.usage) {
              queue.push({
                type: 'usage',
                usage: {
                  inputTokens: turn.usage.inputTokens ?? 0,
                  outputTokens: turn.usage.outputTokens ?? 0,
                  reasoningTokens: turn.usage.reasoningTokens,
                },
              })
            }
            queue.push({ type: 'finish', reason: { kind: 'stop' } })
            queue.close()
          } else if (turn.status === 'failed') {
            const err = turn.error
            if (err?.codexErrorInfo === 'usageLimitExceeded') {
              queue.fail(new LlmError(err.message, 'QUOTA_EXCEEDED', { status: 429 }))
            } else if (
              err?.codexErrorInfo === 'contextWindowExceeded'
              || (typeof err?.message === 'string'
                && /context[_ -]?length[_ -]?exceeded|context[_ -]?window[_ -]?exceeded|maximum context length/i.test(err.message))
            ) {
              queue.fail(new LlmError(err?.message ?? 'Context window exceeded', CONTEXT_WINDOW_EXCEEDED_CODE))
            } else {
              queue.fail(new LlmError(err?.message ?? 'Codex turn failed', 'TURN_FAILED'))
            }
          } else if (turn.status === 'interrupted') {
            queue.push({
              type: 'finish',
              reason: {
                kind: 'aborted',
                failure: { message: 'Turn was interrupted', code: 'ABORTED' },
              },
            })
            queue.close()
          } else {
            queue.close()
          }
        }
      } catch {
        // Ignore unparseable frames
      }
    })

    this.child.on('error', (err) => {
      if (this.currentQueue && !this.turnSettled) {
        this.currentQueue.fail(new LlmError(err.message, 'SUBPROCESS_ERROR', { cause: err }))
      }
      this.dispose()
    })

    this.child.on('exit', (code) => {
      if (this.currentQueue && !this.turnSettled) {
        this.currentQueue.fail(
          new LlmError(
            `Codex app-server exited with code ${code}. Diagnostics: ${this.stderrBuffer.trim() || 'none'}`,
            'PROCESS_EXITED',
          ),
        )
      }
      this.dispose()
    })
  }

  touch(): void {
    this.lastUsedAt = Date.now()
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
  }

  scheduleIdleCleanup(ttlMs = 10 * 60_000): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      this.dispose()
    }, ttlMs)
    this.idleTimer.unref()
  }

  dispose(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
    for (const [, { reject }] of this.pendingRpc) {
      reject(new LlmError('Connection disposed', 'DISPOSED'))
    }
    this.pendingRpc.clear()
    this.pendingToolCalls.clear()

    try {
      this.child.kill()
    } catch {}

    this.onExit(this)
  }
}

export class CodexAdapter extends LlmAdapter {
  private readonly providerName: string
  private readonly connections = new Map<string, CodexConnection>()

  constructor(providerName: string = 'Codex') {
    super()
    this.providerName = providerName
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.providerName }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return getCodexModels(provider)
  }

  override async resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return resolveCodexModelInfo(provider, model)
  }

  override async prepareCall(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<PreparedAdapterCall> {
    const modelInfo = resolveCodexModelInfo(provider, model)
    return {
      model: modelInfo,
      stream: (options: GenerateOptions) => this.stream(options),
    }
  }

  override async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const sessionId = options.sessionId && options.purpose === undefined ? String(options.sessionId) : undefined
    const queue = new ChunkQueue()

    let connection: CodexConnection
    const isEphemeral = !sessionId

    if (sessionId) {
      const existing = this.connections.get(sessionId)
      if (existing) {
        if (existing.model !== options.model) {
          // Model switched; cleanly dispose previous thread/process
          existing.dispose()
          connection = this.createConnection(sessionId, options.model)
        } else {
          connection = existing
          connection.touch()
        }
      } else {
        connection = this.createConnection(sessionId, options.model)
      }
    } else {
      connection = new CodexConnection(`ephemeral-${Date.now()}`, options.model, () => {})
    }

    // Attach active stream queue to connection
    connection.currentQueue = queue
    connection.turnSettled = false
    connection.blockIndex = 0
    connection.currentBlock = null

    // Abort listener
    if (options.signal) {
      if (options.signal.aborted) {
        if (isEphemeral) connection.dispose()
        throw new LlmError('Request aborted', 'ABORTED')
      }
      options.signal.addEventListener(
        'abort',
        () => {
          if (!connection.turnSettled) {
            connection.turnSettled = true
            if (connection.activeThreadId && connection.activeTurnId) {
              void connection
                .send('turn/interrupt', {
                  threadId: connection.activeThreadId,
                  turnId: connection.activeTurnId,
                })
                .catch(() => {})
            }
            if (isEphemeral) {
              connection.dispose()
            }
            queue.fail(new LlmError('Request aborted', 'ABORTED'))
          }
        },
        { once: true },
      )
    }

    // Launch or continue in background
    ;(async () => {
      try {
        const messages = options.messages.map(({ id: _id, ...message }) => JSON.stringify(message))
        if (!connection.deliveredMessages.every((message, index) => messages[index] === message)) {
          delete connection.activeThreadId
          delete connection.activeTurnId
          connection.pendingToolCalls.clear()
          connection.deliveredMessageIds.clear()
          connection.deliveredMessages = []
        }
        const newMessages = options.messages.slice(connection.deliveredMessages.length)
        // If connection has pending tool calls awaiting fulfillment
        if (connection.pendingToolCalls.size > 0) {
          const results = [...connection.pendingToolCalls.entries()].map(([callId, pending]) => {
            const result = options.messages.find(message =>
              message.role === 'tool' && message.toolCallId === pending.callId)
            if (!result || result.role !== 'tool') {
              throw new LlmError(`No result was supplied for Codex tool call '${callId}'`, 'TOOL_RESULT_MISSING')
            }
            return { callId, pending, result }
          })
          const contextMessages = newMessages.filter(message =>
            message.role === 'user' || message.role === 'developer' || message.role === 'system')
          const contextText = contextMessages.length
            ? formatCodexTurnPrompt({ ...options, messages: contextMessages })
            : ''
          for (const [index, { callId, pending, result }] of results.entries()) {
            connection.sendToolResponse(pending.rpcId, codexMessageText(result), index === 0 ? contextText : '', result.isError !== true)
            connection.pendingToolCalls.delete(callId)
          }
          connection.rememberMessages(options.messages)
          return
        }

        // Needs thread start or continuation
        if (!connection.activeThreadId) {
          if (!connection.initialized) {
            await connection.send('initialize', {
              clientInfo: {
                name: 'deepseek-harness',
                title: 'DeepSeek Harness',
                version: '0.0.1',
              },
              capabilities: {
                experimentalApi: true,
              },
            })
            connection.child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n')
            connection.initialized = true
          }

          const nativeConfig: unknown = await connection.send('config/read', { includeLayers: false })

          const dynamicTools = (options.tools ?? []).map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            inputSchema: tool.parameters,
            ...(tool.deferLoading ? { deferLoading: true } : {}),
          }))

          const threadRes = await connection.send('thread/start', {
            cwd: process.cwd(),
            ephemeral: true,
            model: options.model,
            approvalPolicy: 'never',
            allowProviderModelFallback: false,
            sandbox: 'read-only',
            environments: [],
            selectedCapabilityRoots: [],
            developerInstructions: 'Use only the dynamic tools supplied by the Harness. Native CLI execution, browser, computer, MCP, plugins and independent agent creation are disabled. Follow the Harness role and delegation policy; do not substitute another model or execute a delegated task through native tools.',
            config: harnessThreadConfig(nativeConfig),
            ...(dynamicTools.length > 0 ? { dynamicTools } : {}),
          })

          connection.activeThreadId = threadRes?.thread?.id
          if (!connection.activeThreadId) {
            throw new Error('Codex app-server did not return a thread id')
          }

          if (options.reasoningEffort !== undefined) {
            await connection.send('thread/settings/update', {
              threadId: connection.activeThreadId,
              effort: String(options.reasoningEffort),
            })
          }

          const promptText = formatCodexPrompt(options)
          const inputElements: Array<Record<string, unknown>> = [
            { type: 'text', text: promptText, text_elements: [] },
          ]
          for (const msg of options.messages) {
            if (typeof msg.content === 'object' && Array.isArray(msg.content)) {
              for (const block of msg.content) {
                if (block.type === 'image') {
                  const img = block as any
                  const filePath = img.filePath || img.attachment?.filePath || img.image?.filePath || img.image?.path
                  if (filePath) {
                    inputElements.push({ type: 'image', path: filePath })
                  } else if (img.data || img.attachment?.data || img.image?.data) {
                    inputElements.push({
                      type: 'image',
                      data: img.data || img.attachment?.data || img.image?.data,
                      mimeType: img.mimeType || img.mediaType || img.attachment?.mimeType || img.image?.mediaType || img.image?.mimeType || 'image/png',
                    })
                  } else if (img.id || img.image?.id) {
                    inputElements.push({
                      type: 'image',
                      id: img.id || img.image?.id,
                      mimeType: img.mimeType || img.mediaType || img.attachment?.mimeType || img.image?.mediaType || img.image?.mimeType || 'image/png',
                    })
                  }
                }
              }
            }
          }
          await connection.send('turn/start', {
            threadId: connection.activeThreadId,
            input: inputElements,
            ...(options.reasoningEffort !== undefined
              ? { effort: String(options.reasoningEffort) }
              : {}),
          })
        } else {
          // Reusing existing thread on the same session
          if (options.reasoningEffort !== undefined) {
            await connection.send('thread/settings/update', {
              threadId: connection.activeThreadId,
              effort: String(options.reasoningEffort),
            }).catch(() => {})
          }

          const promptText = formatCodexTurnPrompt({ ...options, messages: newMessages })
          const inputElements: Array<Record<string, unknown>> = [
            { type: 'text', text: promptText, text_elements: [] },
          ]
          for (const msg of newMessages) {
            if (typeof msg.content === 'object' && Array.isArray(msg.content)) {
              for (const block of msg.content) {
                if (block.type === 'image') {
                  const img = block as any
                  const filePath = img.filePath || img.attachment?.filePath || img.image?.filePath || img.image?.path
                  if (filePath) {
                    inputElements.push({ type: 'image', path: filePath })
                  } else if (img.data || img.attachment?.data || img.image?.data) {
                    inputElements.push({
                      type: 'image',
                      data: img.data || img.attachment?.data || img.image?.data,
                      mimeType: img.mimeType || img.mediaType || img.attachment?.mimeType || img.image?.mediaType || img.image?.mimeType || 'image/png',
                    })
                  } else if (img.id || img.image?.id) {
                    inputElements.push({
                      type: 'image',
                      id: img.id || img.image?.id,
                      mimeType: img.mimeType || img.mediaType || img.attachment?.mimeType || img.image?.mediaType || img.image?.mimeType || 'image/png',
                    })
                  }
                }
              }
            }
          }
          await connection.send('turn/start', {
            threadId: connection.activeThreadId,
            input: inputElements,
            ...(options.reasoningEffort !== undefined
              ? { effort: String(options.reasoningEffort) }
              : {}),
          })
        }
        connection.rememberMessages(options.messages)
      } catch (err: unknown) {
        if (!connection.turnSettled) {
          connection.turnSettled = true
          queue.fail(
            err instanceof LlmError
              ? err
              : new LlmError(
                  err instanceof Error ? err.message
                    : isRecord(err) && typeof err.message === 'string' ? err.message : String(err),
                  'DISPATCH_FAILED',
                  { cause: err },
                ),
          )
        }
      }
    })()

    try {
      for await (const chunk of queue) {
        yield chunk
      }
    } finally {
      connection.turnSettled = true
      connection.currentQueue = undefined
      if (isEphemeral) {
        connection.dispose()
      } else {
        connection.scheduleIdleCleanup()
      }
    }
  }

  private createConnection(sessionId: string, model: string): CodexConnection {
    const conn = new CodexConnection(sessionId, model, (c) => {
      if (this.connections.get(sessionId) === c) {
        this.connections.delete(sessionId)
      }
    })
    this.connections.set(sessionId, conn)
    return conn
  }
}
