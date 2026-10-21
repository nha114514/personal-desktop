import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import {
  LlmAdapter,
  LlmError,
  ToolCallId,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type PreparedAdapterCall,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  isAntigravityAccountConfigured,
  prepareAntigravityAccount,
  resolveAntigravityExecutable,
  resolvePersonalDataDirectory,
  type PersonalAccountId,
} from './account.ts'
import { getAntigravityModels, resolveAntigravityModelInfo } from './catalog.ts'
import { formatFullPrompt, formatLatestTurn } from './prompt.ts'
import { HARNESS_AGENT, parseHostResponse, prepareHarnessAgent, withHostTools } from './harness-tools.ts'

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

export class AntigravityAdapter extends LlmAdapter {
  private readonly accountId: PersonalAccountId
  private readonly providerDisplayName: string
  private readonly sessionConversations = new Map<string, { id: string; model: string; messages: string[] }>()

  constructor(
    accountId: PersonalAccountId,
    providerDisplayName: string,
  ) {
    super()
    this.accountId = accountId
    this.providerDisplayName = providerDisplayName
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.providerDisplayName }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return getAntigravityModels(provider)
  }

  override async resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return resolveAntigravityModelInfo(provider, model)
  }

  override async prepareCall(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<PreparedAdapterCall> {
    const modelInfo = resolveAntigravityModelInfo(provider, model)
    return {
      model: modelInfo,
      stream: (options: GenerateOptions) => this.stream(options),
    }
  }

  override async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const executable = resolveAntigravityExecutable()
    if (!executable) {
      throw new LlmError(
        'Official Antigravity CLI (agy.exe) not found. Please verify local Antigravity installation.',
        'CLI_NOT_FOUND',
      )
    }

    const dataDirectory = resolvePersonalDataDirectory()
    if (!isAntigravityAccountConfigured(dataDirectory, this.accountId)) {
      throw new LlmError(
        `Gemini 会员账号 ${this.accountId} 尚未登录或验证。请先在个人账号页完成登录与验证。`,
        'UNAUTHENTICATED',
        { status: 401 },
      )
    }

    let prep: { cwd: string; env: NodeJS.ProcessEnv }
    try {
      prep = prepareAntigravityAccount(executable, dataDirectory, this.accountId, process.env)
      prepareHarnessAgent(prep.cwd)
    } catch (err) {
      throw new LlmError(
        err instanceof Error ? err.message : 'Failed to prepare isolated Antigravity account home',
        'ACCOUNT_INIT_FAILED',
        { cause: err },
      )
    }

    const sessionId = options.sessionId && options.purpose === undefined ? String(options.sessionId) : undefined
    const messages = options.messages.map(({ id: _id, ...message }) => JSON.stringify(message))
    const previous = sessionId ? this.sessionConversations.get(sessionId) : undefined
    const canResume = previous?.model === options.model
      && previous.messages.every((message, index) => messages[index] === message)
    const conversationId = canResume ? previous.id : undefined
    let remoteConversationId = conversationId
    if (sessionId && previous && !canResume) this.sessionConversations.delete(sessionId)

    const promptText = withHostTools(conversationId ? formatLatestTurn(options) : formatFullPrompt(options), options)
    const usingHostTools = Boolean(options.tools?.length)
    const requestId = randomUUID()

    const args = [
      '--model', options.model,
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--agent', HARNESS_AGENT,
      '--disable-slash-commands',
    ]

    if (options.reasoningEffort !== undefined) {
      args.push('--effort', String(options.reasoningEffort))
    }

    if (conversationId) {
      args.push('--conversation', conversationId)
    }

    const queue = new ChunkQueue()
    let child: ReturnType<typeof spawn> | undefined
    let turnSettled = false

    try {
      const spawnFile = executable.endsWith('.js') ? process.execPath : executable
      const spawnArgs = executable.endsWith('.js') ? [executable, ...args] : args
      child = spawn(spawnFile, spawnArgs, {
        cwd: prep.cwd,
        env: prep.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (err) {
      throw new LlmError(
        err instanceof Error ? err.message : 'Failed to spawn Antigravity CLI process',
        'SPAWN_FAILED',
        { cause: err },
      )
    }

    child.stderr?.resume()

    const rl = createInterface({ input: child.stdout! })
    let blockIndex = 0
    let hostResponse = ''
    let currentBlock: { type: 'text'; index: number; text: string } | null = null

    function closeCurrentBlock(): void {
      if (!currentBlock) return
      queue.push({
        type: 'block-end',
        index: currentBlock.index,
        block: { type: 'text', text: currentBlock.text },
      })
      currentBlock = null
    }

    rl.on('line', (line) => {
      try {
        if (!line.trim().startsWith('{')) return
        const msg = JSON.parse(line)

        if (msg.event === 'init') {
          if (typeof msg.conversation_id === 'string' && msg.conversation_id) {
            remoteConversationId = msg.conversation_id
          }
          return
        }

        if (msg.event === 'step_update') {
          const update = msg.step_update
          if (!update) return

          if (update.step_type === 'agent_response') {
            const delta = update.text_delta
            if (typeof delta === 'string' && delta.length > 0) {
              if (usingHostTools) {
                hostResponse += delta
                if (hostResponse.length > 1_000_000) throw new LlmError('Gemini host response exceeded its limit.', 'INVALID_TOOL_RESPONSE')
              } else {
                if (!currentBlock) {
                const idx = blockIndex++
                currentBlock = { type: 'text', index: idx, text: '' }
                queue.push({ type: 'block-start', index: idx, blockType: 'text' })
                }
                currentBlock.text += delta
                queue.push({ type: 'text-delta', index: currentBlock.index, text: delta })
              }
            }

            if (update.state === 'DONE' && update.usage) {
              queue.push({
                type: 'usage',
                usage: {
                  inputTokens: update.usage.input_tokens ?? 0,
                  outputTokens: update.usage.output_tokens ?? 0,
                  reasoningTokens: update.usage.thinking_tokens,
                },
              })
            }
          } else if (update.step_type === 'tool' && update.tool_call) {
            // A CLI tool event has already executed remotely; it is never a host request.
            turnSettled = true
            child?.kill()
            queue.fail(new LlmError('Gemini attempted a native CLI tool outside the Harness tool route.', 'NATIVE_TOOL_NOT_ALLOWED'))
          }
          return
        }

        if (msg.event === 'result') {
          const result = msg.result
          turnSettled = true
          closeCurrentBlock()

          if (result?.status === 'SUCCESS') {
            let calls: Array<{ name: string; arguments: string }> = []
            if (usingHostTools) {
              const response = parseHostResponse(typeof result.response === 'string' ? result.response : hostResponse, options)
              if (response.text) {
                const index = blockIndex++
                queue.push({ type: 'block-start', index, blockType: 'text' })
                queue.push({ type: 'text-delta', index, text: response.text })
                queue.push({ type: 'block-end', index, block: { type: 'text', text: response.text } })
              }
              calls = response.toolCalls
              for (const call of calls) {
                const index = blockIndex++
                const id = ToolCallId(`agy_${requestId}_${index}`)
                queue.push({ type: 'block-start', index, blockType: 'tool-call' })
                queue.push({ type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: call.arguments })
                queue.push({ type: 'block-end', index, block: { type: 'tool-call', id, ...call } })
              }
            }
            if (result.usage) {
              queue.push({
                type: 'usage',
                usage: {
                  inputTokens: result.usage.input_tokens ?? 0,
                  outputTokens: result.usage.output_tokens ?? 0,
                  reasoningTokens: result.usage.thinking_tokens,
                },
              })
            }
            if (sessionId && remoteConversationId) {
              this.sessionConversations.set(sessionId, { id: remoteConversationId, model: options.model, messages })
            }
            queue.push({ type: 'finish', reason: { kind: calls.length ? 'tool-calls' : 'stop' } })
            queue.close()
          } else {
            const errorMsg = result?.error ?? 'Antigravity execution failed'
            const isOverflow = typeof errorMsg === 'string'
              && /context[_ -]?length[_ -]?exceeded|context[_ -]?window[_ -]?exceeded|maximum context length|exceeds the maximum number of tokens/i.test(errorMsg)
            queue.fail(new LlmError(errorMsg, isOverflow ? 'CONTEXT_WINDOW_EXCEEDED' : 'TURN_FAILED'))
          }
          return
        }
      } catch (error) {
        if (error instanceof LlmError) {
          turnSettled = true
          child?.kill()
          queue.fail(error)
        }
        // Ignore non-JSON CLI diagnostics.
      }
    })

    child.on('error', (err) => {
      if (!turnSettled) {
        queue.fail(new LlmError(err.message, 'SUBPROCESS_ERROR', { cause: err }))
      }
    })

    child.on('exit', (code) => {
      if (!turnSettled) {
        turnSettled = true
        closeCurrentBlock()
        if (code !== 0 && code !== null) {
          queue.fail(
            new LlmError(
              `Antigravity CLI process exited with code ${code}. Check its account and network state.`,
              'PROCESS_EXITED',
            ),
          )
        } else {
          queue.fail(new LlmError('Antigravity CLI exited without a completed model result.', 'PROCESS_EXITED'))
        }
      }
    })

    if (options.signal) {
      if (options.signal.aborted) {
        child.kill()
        throw new LlmError('Request aborted', 'ABORTED')
      }
      options.signal.addEventListener(
        'abort',
        () => {
          if (!turnSettled) {
            turnSettled = true
            try {
              child?.kill()
            } catch {}
            queue.fail(new LlmError('Request aborted', 'ABORTED'))
          }
        },
        { once: true },
      )
    }

    child.stdin?.on('error', (error) => {
      if (turnSettled) return
      turnSettled = true
      child?.kill()
      queue.fail(new LlmError('Could not send the prompt to Antigravity CLI.', 'SUBPROCESS_ERROR', { cause: error }))
    })

    const images: Array<Record<string, unknown>> = []
    for (const msg of options.messages) {
      if (typeof msg.content === 'object' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'image') {
            const img = block as any
            images.push({
              data: img.data || img.attachment?.data || img.image?.data,
              mimeType: img.mimeType || img.mediaType || img.attachment?.mimeType || img.image?.mediaType || img.image?.mimeType || 'image/png',
              path: img.filePath || img.attachment?.filePath || img.image?.filePath || img.image?.path,
              id: img.id || img.image?.id || img.name || img.attachment?.fileName,
            })
          }
        }
      }
    }

    const payload: Record<string, unknown> = {
      event: 'user',
      message: {
        content: promptText,
        ...(images.length > 0 ? { images } : {}),
      },
    }
    child.stdin?.end(JSON.stringify(payload) + '\n', 'utf8')

    try {
      for await (const chunk of queue) {
        yield chunk
      }
    } finally {
      turnSettled = true
      try {
        child.kill()
      } catch {}
    }
  }
}
