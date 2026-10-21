import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  ToolCallId,
  type GenerateOptions,
} from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import * as llmCodex from '../src/index.ts'
import { getCodexModels, resolveCodexModelInfo } from '../src/catalog.ts'
import { formatCodexPrompt } from '../src/prompt.ts'
import { resolveCodexExecutable } from '../src/executable.ts'

describe('@deepseek-ai/dsh-llm-codex', () => {
  describe('catalog and model resolution', () => {
    it('advertises gpt-6.1-sol in the model catalog', async () => {
      const models = getCodexModels('codex')
      const sol = models.find(m => m.id === 'gpt-6.1-sol')
      expect(sol).toBeDefined()
      expect(sol?.name).toBe('GPT-6.1-Sol')
      expect(sol?.provider).toBe('codex')
      expect(sol?.inputModalities).toContain('text')
    })

    it('resolves gpt-6.1-sol with 6 reasoning effort levels and 1M context window', () => {
      const info = resolveCodexModelInfo('codex', 'gpt-6.1-sol')
      expect(info.id).toBe('gpt-6.1-sol')
      expect(info.context?.contextWindow).toBe(1_048_576)
      expect(info.defaultMaxTokens).toBe(65_536)
      expect(info.reasoning).toBeDefined()
      expect(info.reasoning?.defaultEffort).toBe('low')
      const effortIds = info.reasoning?.efforts.map(e => String(e.id))
      expect(effortIds).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
    })

    it('resolves legacy gpt-5.5 with capped reasoning effort levels', () => {
      const info = resolveCodexModelInfo('codex', 'gpt-5.5')
      expect(info.id).toBe('gpt-5.5')
      expect(info.context?.contextWindow).toBe(400_000)
      expect(info.reasoning?.defaultEffort).toBe('medium')
      const effortIds = info.reasoning?.efforts.map(e => String(e.id))
      expect(effortIds).toEqual(['low', 'medium', 'high', 'xhigh'])
    })
  })

  describe('executable discovery', () => {
    it('discovers a valid codex executable or package fallback', () => {
      const exe = resolveCodexExecutable()
      expect(exe).toBeDefined()
      expect(typeof exe).toBe('string')
      expect(exe!.length).toBeGreaterThan(0)
    })
  })

  describe('prompt formatting', () => {
    it('formats system prompt and single turn', () => {
      const options: GenerateOptions = {
        provider: 'codex',
        model: 'gpt-6.1-sol',
        system: 'You are an assistant.',
        messages: [
          createUserMessage({ content: [{ type: 'text', text: 'Hello!' }], source: { kind: 'test' } }),
        ],
      }
      const prompt = formatCodexPrompt(options)
      expect(prompt).toContain('[System Instructions]\nYou are an assistant.')
      expect(prompt).toContain('[User]: Hello!')
    })

    it('formats multi-turn conversation with tool calls and results', () => {
      const options: GenerateOptions = {
        provider: 'codex',
        model: 'gpt-6.1-sol',
        messages: [
          createUserMessage({ content: [{ type: 'text', text: 'What is the date?' }], source: { kind: 'test' } }),
          createAssistantMessage({
            source: { provider: 'codex', model: 'gpt-6.1-sol' },
            content: [
              {
                type: 'tool-call',
                id: ToolCallId('call_1'),
                name: 'get_date',
                arguments: '{}',
              },
            ],
          }),
          createToolResultMessage({
            callId: ToolCallId('call_1'),
            content: [{ type: 'text', text: '2026-10-02' }],
            isError: false,
          }),
          createUserMessage({ content: [{ type: 'text', text: 'Thank you.' }], source: { kind: 'test' } }),
        ],
      }
      const prompt = formatCodexPrompt(options)
      expect(prompt).toContain('[Conversation History]')
      expect(prompt).toContain('[Tool Call get_date]: {}')
      expect(prompt).toContain('[Tool Result]: 2026-10-02')
      expect(prompt).toContain('[Current Turn]\n[User]: Thank you.')
    })

    it('retains image blocks in Codex prompt format (R3)', () => {
      const options: GenerateOptions = {
        provider: 'codex',
        model: 'gpt-6.1-sol',
        messages: [
          createUserMessage({
            content: [
              { type: 'text', text: 'Analyze this UI screenshot:' },
              { type: 'image', name: 'app_window.png', mimeType: 'image/png' } as any,
            ],
            source: { kind: 'test' },
          }),
        ],
      }
      const prompt = formatCodexPrompt(options)
      expect(prompt).toContain('[Image: app_window.png (image/png)]')
    })
  })

  describe('plugin lifecycle and Cordis integration', () => {
    it('registers codex adapter and configurable provider on ctx.llm', async () => {
      const ctx = new Context()
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(llmCodex, { providerName: 'Codex' })

      const providers = ctx.llm.listProviders()
      expect(providers.some(p => p.id === 'codex')).toBe(true)

      const configurable = ctx.llm.listConfigurableProviders()
      expect(configurable.some(c => c.provider === 'codex')).toBe(true)

      const models = await ctx.llm.listModels('codex')
      expect(models.some(m => m.id === 'gpt-6.1-sol')).toBe(true)

      const resolved = await ctx.llm.resolveModelInfo('codex', 'gpt-6.1-sol')
      expect(resolved.id).toBe('gpt-6.1-sol')
      expect(resolved.reasoning?.efforts.length).toBe(6)
    })
  })
})
