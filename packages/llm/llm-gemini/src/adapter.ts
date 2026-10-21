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
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { getGeminiModels, resolveGeminiModelInfo } from './catalog.ts'

export class GeminiAdapter extends LlmAdapter {
  constructor(private readonly providerName: string = 'Google Gemini') {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.providerName }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return getGeminiModels(provider)
  }

  override async resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return resolveGeminiModelInfo(provider, model)
  }

  override async prepareCall(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<PreparedAdapterCall> {
    const modelInfo = resolveGeminiModelInfo(provider, model)
    return {
      model: modelInfo,
      stream: (options: GenerateOptions) => this.stream(options),
    }
  }

  override async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
    if (!apiKey) {
      throw new LlmError(
        'Gemini API 密钥未配置 (GEMINI_API_KEY / GOOGLE_API_KEY)。如果您使用的是已登录的 Gemini 会员账号，请在模型选择中切换为“Gemini 会员账号 2”；如需使用自定义 API 通道，请配置环境变量 GEMINI_API_KEY。',
        'UNAUTHORIZED',
        { status: 401 },
      )
    }

    const model = options.model
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`

    // Build Gemini contents
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = []
    let systemInstruction: { parts: Array<{ text: string }> } | undefined

    for (const msg of options.messages) {
      if (msg.role === 'system') {
        const textParts: Array<{ text: string }> = []
        for (const block of msg.content) {
          if (block.type === 'text') {
            textParts.push({ text: block.text })
          }
        }
        if (textParts.length > 0) {
          systemInstruction = { parts: textParts }
        }
      } else if (msg.role === 'user') {
        const parts: Array<Record<string, unknown>> = []
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ text: block.text })
          }
        }
        if (parts.length > 0) {
          contents.push({ role: 'user', parts })
        }
      } else if (msg.role === 'assistant') {
        const parts: Array<Record<string, unknown>> = []
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ text: block.text })
          } else if (block.type === 'tool-call') {
            let args: Record<string, unknown> = {}
            try {
              args = JSON.parse(block.arguments)
            } catch {
              args = {}
            }
            parts.push({
              functionCall: {
                name: block.name,
                args,
              },
            })
          }
        }
        if (parts.length > 0) {
          contents.push({ role: 'model', parts })
        }
      } else if (msg.role === 'tool') {
        const text = msg.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map(b => b.text)
          .join('\n')
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: msg.toolCallId ? String(msg.toolCallId) : 'tool',
              response: { output: text },
            },
          }],
        })
      }
    }

    // Tools
    let toolsConfig: Array<{ functionDeclarations: Array<Record<string, unknown>> }> | undefined
    if (options.tools && options.tools.length > 0) {
      toolsConfig = [{
        functionDeclarations: options.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      }]
    }

    // Generation config (output cap and reasoning budget)
    const generationConfig: Record<string, unknown> = {}
    if (options.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = options.maxTokens
    }
    if (options.reasoningEffort) {
      const budgetMap: Record<string, number> = {
        low: 1024,
        medium: 4096,
        high: 16384,
      }
      const budget = budgetMap[options.reasoningEffort] ?? 2048
      generationConfig.thinkingConfig = {
        thinkingBudget: budget,
      }
    }

    const payload: Record<string, unknown> = {
      contents,
      ...systemInstruction ? { systemInstruction } : {},
      ...toolsConfig ? { tools: toolsConfig } : {},
      ...Object.keys(generationConfig).length > 0 ? { generationConfig } : {},
    }

    const fetchInit: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
    if (options.signal) {
      fetchInit.signal = options.signal
    }

    const response = await fetch(endpoint, fetchInit)

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      let errorJson: any = null
      try {
        errorJson = JSON.parse(errorText)
      } catch {}

      const message = errorJson?.error?.message ?? errorText ?? `HTTP error ${response.status}`
      if (response.status === 429) {
        throw new LlmError(`Gemini rate limit exceeded: ${message}`, 'QUOTA_EXCEEDED', { status: 429 })
      }
      if (response.status === 401 || response.status === 403) {
        throw new LlmError(`Gemini authentication error: ${message}`, 'UNAUTHORIZED', { status: response.status })
      }
      if (
        response.status === 400
        && /context[_ -]?length[_ -]?exceeded|context[_ -]?window[_ -]?exceeded|maximum context length|exceeds the maximum number of tokens/i.test(message)
      ) {
        throw new LlmError(`Gemini context window exceeded: ${message}`, CONTEXT_WINDOW_EXCEEDED_CODE, { status: 400 })
      }
      throw new LlmError(`Gemini API error (${response.status}): ${message}`, 'GENERAL', { status: response.status })
    }

    if (!response.body) {
      throw new LlmError('GENERAL', 'Gemini response body was empty')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let blockIndex = 0
    let currentBlock: { type: 'text' | 'reasoning'; index: number; text: string } | null = null
    let hasToolCalls = false

    const closeCurrentBlock = (): StreamChunk | null => {
      if (!currentBlock) return null
      const block = currentBlock
      currentBlock = null
      if (block.type === 'reasoning') {
        return {
          type: 'block-end',
          index: block.index,
          block: { type: 'reasoning', text: block.text },
        }
      } else {
        return {
          type: 'block-end',
          index: block.index,
          block: { type: 'text', text: block.text },
        }
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const dataStr = trimmed.slice(6)
          if (dataStr === '[DONE]') continue

          try {
            const data = JSON.parse(dataStr)
            const candidate = data.candidates?.[0]
            if (!candidate) continue

            const parts = candidate.content?.parts ?? []
            for (const part of parts) {
              if (part.thought) {
                if (currentBlock && currentBlock.type !== 'reasoning') {
                  const end = closeCurrentBlock()
                  if (end) yield end
                }
                if (!currentBlock) {
                  const idx = blockIndex++
                  currentBlock = { type: 'reasoning', index: idx, text: '' }
                  yield { type: 'block-start', index: idx, blockType: 'reasoning' }
                }
                const thoughtText = String(part.thought)
                currentBlock.text += thoughtText
                yield { type: 'reasoning-delta', index: currentBlock.index, text: thoughtText }
              }
              if (part.text) {
                if (currentBlock && currentBlock.type !== 'text') {
                  const end = closeCurrentBlock()
                  if (end) yield end
                }
                if (!currentBlock) {
                  const idx = blockIndex++
                  currentBlock = { type: 'text', index: idx, text: '' }
                  yield { type: 'block-start', index: idx, blockType: 'text' }
                }
                const textChunk = String(part.text)
                currentBlock.text += textChunk
                yield { type: 'text-delta', index: currentBlock.index, text: textChunk }
              }
              if (part.functionCall) {
                if (currentBlock) {
                  const end = closeCurrentBlock()
                  if (end) yield end
                }
                hasToolCalls = true
                const idx = blockIndex++
                const callId = ToolCallId(`call_${Math.random().toString(36).slice(2, 10)}`)
                const name = String(part.functionCall.name)
                const argsStr = JSON.stringify(part.functionCall.args ?? {})
                yield { type: 'block-start', index: idx, blockType: 'tool-call' }
                yield { type: 'tool-call-delta', index: idx, id: callId, name, argumentsDelta: argsStr }
                yield {
                  type: 'block-end',
                  index: idx,
                  block: {
                    type: 'tool-call',
                    id: callId,
                    name,
                    arguments: argsStr,
                  },
                }
              }
            }
          } catch {
            // Ignore parse errors on individual SSE chunks
          }
        }
      }

      if (currentBlock) {
        const end = closeCurrentBlock()
        if (end) yield end
      }

      yield {
        type: 'finish',
        reason: hasToolCalls ? { kind: 'tool-calls' } : { kind: 'stop' },
      }
    } finally {
      reader.releaseLock()
    }
  }
}
