import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SubagentDefaultModelConfig from '../src/index.ts'

describe('SubagentDefaultModelConfig service', () => {
  it('uses the provider default when the user clears an inherited effort', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentDefaultModelConfig, {
      provider: 'my-api', model: 'custom-model', reasoningEffort: '', autoDelegate: true,
    })
    expect(ctx.subagentDefaultModel.currentSelection()).toEqual({
      provider: 'my-api', model: 'custom-model', autoDelegate: true,
    })
    await ctx.fiber.dispose()
  })
  it('initializes with default values and autoDelegate', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentDefaultModelConfig, {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      reasoningEffort: 'low',
      autoDelegate: true,
    })

    const service = ctx.get('subagentDefaultModel')
    expect(service).toBeDefined()
    const config = service!.currentSelection()
    expect(config.provider).toBe('gemini')
    expect(config.model).toBe('gemini-2.5-flash')
    expect(config.reasoningEffort).toBe('low')
    expect(config.autoDelegate).toBe(true)
  })

  it('updates selection properly', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentDefaultModelConfig, {
      provider: 'codex',
      model: 'gpt-6-astra',
      reasoningEffort: 'low',
      autoDelegate: true,
    })

    const service = ctx.get('subagentDefaultModel')
    expect(service).toBeDefined()
    let config = service!.currentSelection()
    expect(config.provider).toBe('codex')
    expect(config.model).toBe('gpt-6-astra')

    // test updating
    await service!.saveSelection({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      reasoningEffort: 'medium' as any,
      autoDelegate: false,
    })
    expect(service).toBeDefined()
  })
})
