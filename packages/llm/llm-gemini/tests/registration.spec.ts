import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Llm from '@deepseek-ai/dsh-llm'
import * as Gemini from '../src/index.ts'

it('registers only the retained Google account while preserving the API channel', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(Llm)
    const plugin = await ctx.plugin(Gemini, { providerName: 'Gemini API' })
    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['gemini-2', 'gemini'])
    await plugin.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
  } finally {
    await ctx.fiber.dispose()
  }
})
