import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-llm'
import { AntigravityAdapter } from './antigravity-adapter.ts'
import { GeminiAdapter } from './adapter.ts'

export { AntigravityAdapter } from './antigravity-adapter.ts'
export { GeminiAdapter } from './adapter.ts'
export {
  getAntigravityModels,
  resolveAntigravityModelInfo,
  ANTIGRAVITY_MODEL_DEFINITIONS,
  getGeminiModels,
  resolveGeminiModelInfo,
  GEMINI_MODEL_DEFINITIONS,
  GEMINI_REASONING_EFFORTS,
} from './catalog.ts'

export const name = 'llm-gemini'
export const inject = ['llm']

export interface Config {
  providerName?: string
}

export const Config = z.object({
  providerName: z.string().default('Google Gemini'),
})

export function apply(ctx: Context, config: Config): void {
  const adapterAccount2 = new AntigravityAdapter('2', 'Gemini 会员账号 2')
  const apiAdapter = new GeminiAdapter(config.providerName ?? 'Gemini API')

  ctx.llm.registerConfigurableProviders([
    {
      provider: 'gemini-2',
      displayName: 'Gemini 会员账号 2',
      settingsNs: ctx.fiber.entry?.options.id ?? name,
      settingsPath: ['account-2'],
    },
    {
      provider: 'gemini',
      displayName: 'Gemini API',
      settingsNs: ctx.fiber.entry?.options.id ?? name,
      settingsPath: ['api'],
    },
  ])

  ctx.llm.registerAdapter(['gemini-2'], adapterAccount2)
  ctx.llm.registerAdapter(['gemini'], apiAdapter)
}
