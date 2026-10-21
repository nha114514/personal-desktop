import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-llm'
import { CodexAdapter } from './adapter.ts'

export { CodexAdapter } from './adapter.ts'
export { getCodexModels, resolveCodexModelInfo, CODEX_MODEL_DEFINITIONS, CODEX_REASONING_EFFORTS } from './catalog.ts'
export { resolveCodexExecutable, getCodexAppServerArgv } from './executable.ts'
export { formatCodexPrompt } from './prompt.ts'

export const name = 'llm-codex'
export const inject = ['llm']

const PROVIDER = 'codex'

export interface Config {
  providerName?: string
}

export const Config = z.object({
  providerName: z.string().default('Codex'),
})

export function apply(ctx: Context, config: Config): void {
  const adapter = new CodexAdapter(config.providerName ?? 'Codex')

  ctx.llm.registerConfigurableProviders([
    {
      provider: PROVIDER,
      displayName: 'OpenAI Codex',
      settingsNs: ctx.fiber.entry?.options.id ?? name,
      settingsPath: [],
    },
  ])

  ctx.llm.registerAdapter([PROVIDER], adapter)
}
