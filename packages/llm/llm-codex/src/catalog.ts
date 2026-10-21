import {
  ReasoningEffortId,
  type LlmModelInfo,
  type LlmReasoningEffortInfo,
  type LlmResolvedModelInfo,
} from '@deepseek-ai/dsh-llm'

export const CODEX_REASONING_EFFORTS: readonly LlmReasoningEffortInfo[] = [
  {
    id: ReasoningEffortId('low'),
    name: 'low',
    description: 'Fast responses with lighter reasoning',
  },
  {
    id: ReasoningEffortId('medium'),
    name: 'medium',
    description: 'Balances speed and reasoning depth for everyday tasks',
  },
  {
    id: ReasoningEffortId('high'),
    name: 'high',
    description: 'Greater reasoning depth for complex problems',
  },
  {
    id: ReasoningEffortId('xhigh'),
    name: 'xhigh',
    description: 'Extra high reasoning depth for complex problems',
  },
  {
    id: ReasoningEffortId('max'),
    name: 'max',
    description: 'Maximum reasoning depth for the hardest problems',
  },
  {
    id: ReasoningEffortId('ultra'),
    name: 'ultra',
    description: 'Maximum reasoning with automatic task delegation',
  },
]

export interface CodexModelDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly defaultEffort: string
  readonly maxEffort?: string
  readonly contextWindow?: number
  readonly defaultMaxTokens?: number
}

/** Default context capacity for Codex models (1M tokens). */
export const DEFAULT_CODEX_CONTEXT_WINDOW = 1_048_576

/** Default output token reservation for Codex models (64K tokens). */
export const DEFAULT_CODEX_MAX_TOKENS = 65_536

export const CODEX_MODEL_DEFINITIONS: readonly CodexModelDefinition[] = [
  {
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1-Sol',
    description: 'Latest workhorse model for coding and everyday work.',
    defaultEffort: 'low',
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
  },
  {
    id: 'gpt-6-astra',
    name: 'GPT-6-Astra',
    description: 'Frontier intelligence for the most demanding work.',
    defaultEffort: 'low',
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
  },
  {
    id: 'gpt-6-sol',
    name: 'GPT-6-Sol',
    description: 'Previous generation workhorse model.',
    defaultEffort: 'medium',
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
  },
  {
    id: 'gpt-6-luna',
    name: 'GPT-6-Luna',
    description: 'Fast and affordable model for easier tasks.',
    defaultEffort: 'medium',
    maxEffort: 'max',
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6-Sol',
    description: 'Older generation workhorse model.',
    defaultEffort: 'low',
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6-Terra',
    description: 'Older balanced model for straightforward work.',
    defaultEffort: 'medium',
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6-Luna',
    description: 'Older fast and efficient model.',
    defaultEffort: 'medium',
    maxEffort: 'max',
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    description: 'Legacy coding model.',
    defaultEffort: 'medium',
    maxEffort: 'xhigh',
    contextWindow: 400_000,
    defaultMaxTokens: 32_768,
  },
]

export function getCodexModels(provider: string): readonly LlmModelInfo[] {
  return CODEX_MODEL_DEFINITIONS.map(def => ({
    provider,
    id: def.id,
    name: def.name,
    ...(def.description !== undefined ? { description: def.description } : {}),
    inputModalities: ['text', 'image'],
  }))
}

export function resolveCodexModelInfo(provider: string, modelId: string): LlmResolvedModelInfo {
  const def = CODEX_MODEL_DEFINITIONS.find(d => d.id === modelId)
  const efforts = def?.maxEffort === 'xhigh'
    ? CODEX_REASONING_EFFORTS.slice(0, 4)
    : def?.maxEffort === 'max'
      ? CODEX_REASONING_EFFORTS.slice(0, 5)
      : CODEX_REASONING_EFFORTS

  const defaultEffort = def?.defaultEffort ? ReasoningEffortId(def.defaultEffort) : ReasoningEffortId('low')

  return {
    provider,
    id: modelId,
    name: def?.name ?? modelId,
    ...(def?.description !== undefined ? { description: def.description } : {}),
    inputModalities: ['text', 'image'],
    context: {
      contextWindow: def?.contextWindow ?? DEFAULT_CODEX_CONTEXT_WINDOW,
    },
    defaultMaxTokens: def?.defaultMaxTokens ?? DEFAULT_CODEX_MAX_TOKENS,
    reasoning: {
      efforts,
      defaultEffort,
    },
  }
}
