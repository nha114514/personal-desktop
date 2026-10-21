import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUserMessage, ReasoningEffortId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { AntigravityAdapter } from '../src/antigravity-adapter.ts'
import { ANTIGRAVITY_MODEL_DEFINITIONS } from '../src/catalog.ts'

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // Ignore cleanup failures on transient Windows locks
    }
  }
})

describe('AntigravityAdapter', () => {
  const adapter1 = new AntigravityAdapter('1', 'Gemini 会员账号 1')
  const adapter2 = new AntigravityAdapter('2', 'Gemini 会员账号 2')

  it('provides correct provider info for member accounts', () => {
    expect(adapter1.providerInfo('gemini-1')).toEqual({ id: 'gemini-1', name: 'Gemini 会员账号 1' })
    expect(adapter2.providerInfo('gemini-2')).toEqual({ id: 'gemini-2', name: 'Gemini 会员账号 2' })
  })

  it('lists verified models for Antigravity member accounts with channel indicators', async () => {
    const models1 = await adapter1.listModels('gemini-1')
    expect(models1).toHaveLength(ANTIGRAVITY_MODEL_DEFINITIONS.length)
    expect(models1.map(m => m.id)).toEqual([
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.1-pro',
    ])
    expect(models1[0]!.name).toBe('Gemini 3.8 Flash (会员账号 1)')

    const models2 = await adapter2.listModels('gemini-2')
    expect(models2[0]!.name).toBe('Gemini 3.8 Flash (会员账号 2)')
  })

  it('resolves model reasoning capabilities accurately', async () => {
    const flash38 = await adapter1.resolveModel('gemini-1', 'gemini-3.8-flash')
    expect(flash38.reasoning?.efforts.map(e => e.id)).toEqual(['low', 'medium', 'high'])
    expect(flash38.reasoning?.defaultEffort).toBe('low')

    const pro31 = await adapter1.resolveModel('gemini-1', 'gemini-3.1-pro')
    expect(pro31.reasoning?.efforts.map(e => e.id)).toEqual(['low', 'high'])
    expect(pro31.reasoning?.defaultEffort).toBe('low')
  })

  it('throws UNAUTHENTICATED when account is not configured', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'dsh-test-data-'))
    directories.push(dataDir)
    vi.stubEnv('DSH_PERSONAL_DATA_DIRECTORY', dataDir)

    const call = await adapter1.prepareCall('gemini-1', 'gemini-3.8-flash')
    const stream = call.stream({
      provider: 'gemini-1',
      model: 'gemini-3.8-flash',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'test' } })],
    })

    const iter = stream[Symbol.asyncIterator]()
    await expect(iter.next()).rejects.toThrow(/尚未登录或验证/)
  })

  it('streams text deltas, usage and completion from Antigravity stream-json output', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'dsh-test-agy-'))
    directories.push(baseDir)

    // Set up mock account
    const accountDir = join(baseDir, 'antigravity', 'account-1', '.gemini', 'antigravity-cli')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(accountDir, { recursive: true })
    await writeFile(join(accountDir, 'settings.json'), JSON.stringify({ enableTelemetry: false }))

    // Set up mock executable
    const executable = join(baseDir, 'mock-agy.js')
    await writeFile(join(baseDir, 'package.json'), JSON.stringify({ type: 'module' }))
    await writeFile(executable, `
      console.log(JSON.stringify({ event: 'init', conversation_id: 'agy-conv-1' }));
      console.log(JSON.stringify({
        event: 'step_update',
        step_update: { step_type: 'agent_response', text_delta: 'Hello from Antigravity!' }
      }));
      console.log(JSON.stringify({
        event: 'step_update',
        step_update: {
          step_type: 'agent_response',
          state: 'DONE',
          text_delta: '\\n',
          usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 2 }
        }
      }));
      console.log(JSON.stringify({
        event: 'result',
        result: { status: 'SUCCESS', usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 2 } }
      }));
    `)

    vi.stubEnv('DSH_PERSONAL_DATA_DIRECTORY', baseDir)
    vi.stubEnv('DSH_PERSONAL_ANTIGRAVITY_EXECUTABLE', executable)

    const chunks: StreamChunk[] = []
    for await (const chunk of adapter1.stream({
      provider: 'gemini-1',
      model: 'gemini-3.8-flash',
      reasoningEffort: ReasoningEffortId('low'),
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'test' } })],
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toContainEqual({ type: 'block-start', index: 0, blockType: 'text' })
    expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'Hello from Antigravity!' })
    expect(chunks).toContainEqual({
      type: 'usage',
      usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 2 },
    })
    expect(chunks).toContainEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('provides channel indicator for Gemini API and guides users when API key is missing', async () => {
    const { GeminiAdapter } = await import('../src/adapter.ts')
    const apiAdapter = new GeminiAdapter('Gemini API')

    const models = await apiAdapter.listModels('gemini')
    expect(models[0]!.name).toBe('Gemini 3.8 Flash (API)')

    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_API_KEY

    const stream = apiAdapter.stream({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'test' } })],
    })

    const iter = stream[Symbol.asyncIterator]()
    await expect(iter.next()).rejects.toThrow(/Gemini API 密钥未配置.*会员账号/)
  })
})

