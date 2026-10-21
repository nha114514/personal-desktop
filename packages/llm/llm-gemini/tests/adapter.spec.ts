import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { GeminiAdapter } from '../src/adapter.ts'
import { GEMINI_MODEL_DEFINITIONS } from '../src/catalog.ts'

describe('GeminiAdapter request generation config', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it.each([1234, 0])('sends maxTokens %i as maxOutputTokens without reasoning', async (maxTokens) => {
    const body = await captureRequest({ maxTokens })
    expect(body.generationConfig).toEqual({ maxOutputTokens: maxTokens })
    expect(body).not.toHaveProperty('maxTokens')
  })

  it('sends output cap alongside thinking config', async () => {
    const body = await captureRequest({ maxTokens: 1234, reasoningEffort: ReasoningEffortId('high') })
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 1234,
      thinkingConfig: { thinkingBudget: 16384 },
    })
  })

  it('omits generation config without cap or reasoning', async () => {
    expect(await captureRequest({})).not.toHaveProperty('generationConfig')
  })

  it('sends thinking config without an output cap', async () => {
    const body = await captureRequest({ reasoningEffort: ReasoningEffortId('low') })
    expect(body.generationConfig).toEqual({ thinkingConfig: { thinkingBudget: 1024 } })
    expect(body.generationConfig).not.toHaveProperty('maxOutputTokens')
  })

  async function captureRequest(options: { maxTokens?: number; reasoningEffort?: ReasoningEffortId }) {
    let body: Record<string, unknown> = {}
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_input, init) => {
      body = JSON.parse(String(init?.body))
      return new Response('data: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }))
    const adapter = new GeminiAdapter()
    for await (const chunk of adapter.stream({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      messages: [],
      ...options,
    })) {
      expect(chunk.type).toBe('finish')
    }
    return body
  }
})

describe('GeminiAdapter catalog and metadata', () => {
  const adapter = new GeminiAdapter()

  it('provides correct provider info', () => {
    const info = adapter.providerInfo('gemini')
    expect(info.id).toBe('gemini')
    expect(info.name).toBe('Google Gemini')
  })

  it('lists advertised Gemini models', async () => {
    const models = await adapter.listModels('gemini')
    expect(models.length).toBe(GEMINI_MODEL_DEFINITIONS.length)
    const pro = models.find(m => m.id === 'gemini-2.5-pro')
    expect(pro).toBeDefined()
    expect(pro?.name).toBe('Gemini 2.5 Pro (API)')
    expect(pro?.provider).toBe('gemini')
  })

  it('resolves model info properly with reasoning efforts', async () => {
    const info = await adapter.resolveModel('gemini', 'gemini-2.5-pro')
    expect(info.id).toBe('gemini-2.5-pro')
    expect(info.provider).toBe('gemini')
    expect(info.reasoning?.efforts.map(e => e.id)).toEqual(['low', 'medium', 'high'])

    const flash = await adapter.resolveModel('gemini', 'gemini-2.5-flash')
    expect(flash.id).toBe('gemini-2.5-flash')
    expect(flash.reasoning?.defaultEffort).toBe('low')

    const flash38 = await adapter.resolveModel('gemini', 'gemini-3.8-flash')
    expect(flash38.id).toBe('gemini-3.8-flash')
    expect(flash38.name).toBe('Gemini 3.8 Flash (API)')
    expect(flash38.context?.contextWindow).toBe(1_048_576)
    expect(flash38.defaultMaxTokens).toBe(65_536)
    expect(flash38.reasoning?.efforts.map(e => e.id)).toEqual(['low', 'medium', 'high'])

    const pro31 = await adapter.resolveModel('gemini', 'gemini-3.1-pro')
    expect(pro31.id).toBe('gemini-3.1-pro')
    expect(pro31.name).toBe('Gemini 3.1 Pro (API)')
    expect(pro31.context?.contextWindow).toBe(2_097_152)
    expect(pro31.reasoning?.efforts.map(e => e.id)).toEqual(['low', 'high'])
  })

  it('throws UNAUTHORIZED when no API key is present in environment', async () => {
    const originalGemini = process.env.GEMINI_API_KEY
    const originalGoogle = process.env.GOOGLE_API_KEY
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_API_KEY

    try {
      const call = await adapter.prepareCall('gemini', 'gemini-2.5-pro')
      const stream = call.stream({
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        messages: [{
          id: 'msg-1' as any,
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'hello' }],
        }],
      })
      const iter = stream[Symbol.asyncIterator]()
      await expect(iter.next()).rejects.toThrow(/Gemini API 密钥未配置/)
    } finally {
      if (originalGemini) process.env.GEMINI_API_KEY = originalGemini
      if (originalGoogle) process.env.GOOGLE_API_KEY = originalGoogle
    }
  })
})
