import {
  ReasoningEffortId,
  type LlmModelInfo,
  type LlmReasoningEffortInfo,
  type LlmResolvedModelInfo,
} from '@deepseek-ai/dsh-llm'

export const GEMINI_REASONING_EFFORTS: readonly LlmReasoningEffortInfo[] = [
  {
    id: ReasoningEffortId('low'),
    name: 'low',
    description: 'Fast responses with lighter reasoning budget',
  },
  {
    id: ReasoningEffortId('medium'),
    name: 'medium',
    description: 'Balanced speed and reasoning depth for standard tasks',
  },
  {
    id: ReasoningEffortId('high'),
    name: 'high',
    description: 'Maximum reasoning depth for complex tasks',
  },
]

export interface GeminiModelDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly defaultEffort?: string
  readonly supportsReasoning?: boolean
  readonly supportedEfforts?: readonly string[]
  readonly contextWindow?: number
  readonly defaultMaxTokens?: number
}

/** Default context capacity for Gemini and Antigravity models (1M tokens). */
export const DEFAULT_GEMINI_CONTEXT_WINDOW = 1_048_576

/** Default output token reservation for Gemini and Antigravity models (64K tokens). */
export const DEFAULT_GEMINI_MAX_TOKENS = 65_536

/**
 * Verified models supported by official Antigravity CLI for member accounts.
 */
export const ANTIGRAVITY_MODEL_DEFINITIONS: readonly GeminiModelDefinition[] = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    description: 'Next-generation flagship workhorse model with scalable reasoning.',
    defaultEffort: 'low',
    supportsReasoning: true,
    supportedEfforts: ['low', 'medium', 'high'],
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    description: 'High-efficiency multimodal workhorse model with scalable thinking.',
    defaultEffort: 'low',
    supportsReasoning: true,
    supportedEfforts: ['low', 'medium', 'high'],
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    description: 'Fast workhorse model with hybrid reasoning.',
    defaultEffort: 'low',
    supportsReasoning: true,
    supportedEfforts: ['low', 'medium', 'high'],
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    description: 'Google flagship intelligence and coding model with advanced reasoning.',
    defaultEffort: 'low',
    supportsReasoning: true,
    supportedEfforts: ['low', 'high'],
    contextWindow: 2_097_152,
    defaultMaxTokens: 65_536,
  },
]

/**
 * Models supported via Google Generative Language API (requires API Key).
 */
export const GEMINI_MODEL_DEFINITIONS: readonly GeminiModelDefinition[] = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    description: 'Next-generation flagship workhorse model with scalable reasoning.',
    defaultEffort: 'low',
    supportsReasoning: true,
    supportedEfforts: ['low', 'medium', 'high'],
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    description: 'High-efficiency multimodal workhorse model with scalable thinking.',
    defaultEffort: 'low',
    supportsReasoning: true,
    supportedEfforts: ['low', 'medium', 'high'],
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    description: 'Fast workhorse model with hybrid reasoning.',
    defaultEffort: 'low',
    supportsReasoning: true,
    supportedEfforts: ['low', 'medium', 'high'],
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    description: 'Google flagship intelligence and coding model with advanced reasoning.',
    defaultEffort: 'low',
    supportsReasoning: true,
    supportedEfforts: ['low', 'high'],
    contextWindow: 2_097_152,
    defaultMaxTokens: 65_536,
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description: 'Google flagship intelligence and coding model with advanced reasoning.',
    defaultEffort: 'medium',
    supportsReasoning: true,
    supportedEfforts: ['low', 'medium', 'high'],
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Fast, highly efficient workhorse model with scalable thinking.',
    defaultEffort: 'low',
    supportsReasoning: true,
    supportedEfforts: ['low', 'medium', 'high'],
    contextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    description: 'Next-gen multimodal workhorse model for low-latency tasks.',
    supportsReasoning: false,
    contextWindow: 1_048_576,
    defaultMaxTokens: 32_768,
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    description: 'Versatile model with 2M token context window.',
    supportsReasoning: false,
    contextWindow: 2_097_152,
    defaultMaxTokens: 32_768,
  },
]

export function getAntigravityModels(provider: string): readonly LlmModelInfo[] {
  const channelSuffix = provider === 'gemini-1'
    ? ' (会员账号 1)'
    : provider === 'gemini-2'
      ? ' (会员账号 2)'
      : ''
  return ANTIGRAVITY_MODEL_DEFINITIONS.map(def => ({
    provider,
    id: def.id,
    name: `${def.name}${channelSuffix}`,
    description: def.description,
    inputModalities: ['text', 'image'],
  }))
}

export function resolveAntigravityModelInfo(provider: string, modelId: string): LlmResolvedModelInfo {
  const channelSuffix = provider === 'gemini-1'
    ? ' (会员账号 1)'
    : provider === 'gemini-2'
      ? ' (会员账号 2)'
      : ''
  const def = ANTIGRAVITY_MODEL_DEFINITIONS.find(m => m.id === modelId)
  if (!def) {
    return {
      provider,
      id: modelId,
      name: `${modelId}${channelSuffix}`,
      description: `Antigravity model ${modelId}`,
      inputModalities: ['text', 'image'],
      context: { contextWindow: DEFAULT_GEMINI_CONTEXT_WINDOW },
      defaultMaxTokens: DEFAULT_GEMINI_MAX_TOKENS,
    }
  }

  return {
    provider,
    id: def.id,
    name: `${def.name}${channelSuffix}`,
    description: def.description,
    inputModalities: ['text', 'image'],
    context: { contextWindow: def.contextWindow ?? DEFAULT_GEMINI_CONTEXT_WINDOW },
    defaultMaxTokens: def.defaultMaxTokens ?? DEFAULT_GEMINI_MAX_TOKENS,
    ...def.supportsReasoning
      ? {
        reasoning: {
          efforts: def.supportedEfforts !== undefined
            ? GEMINI_REASONING_EFFORTS.filter(e => def.supportedEfforts!.includes(e.name))
            : GEMINI_REASONING_EFFORTS,
          defaultEffort: def.defaultEffort !== undefined
            ? ReasoningEffortId(def.defaultEffort)
            : ReasoningEffortId('low'),
        },
      }
      : {},
  }
}

export function getGeminiModels(provider: string): readonly LlmModelInfo[] {
  return GEMINI_MODEL_DEFINITIONS.map(def => ({
    provider,
    id: def.id,
    name: `${def.name} (API)`,
    description: def.description,
    inputModalities: ['text', 'image'],
  }))
}

export function resolveGeminiModelInfo(provider: string, modelId: string): LlmResolvedModelInfo {
  const def = GEMINI_MODEL_DEFINITIONS.find(m => m.id === modelId)
  if (!def) {
    return {
      provider,
      id: modelId,
      name: `${modelId} (API)`,
      description: `Gemini model ${modelId}`,
      inputModalities: ['text', 'image'],
      context: { contextWindow: DEFAULT_GEMINI_CONTEXT_WINDOW },
      defaultMaxTokens: DEFAULT_GEMINI_MAX_TOKENS,
    }
  }

  return {
    provider,
    id: def.id,
    name: `${def.name} (API)`,
    description: def.description,
    inputModalities: ['text', 'image'],
    context: { contextWindow: def.contextWindow ?? DEFAULT_GEMINI_CONTEXT_WINDOW },
    defaultMaxTokens: def.defaultMaxTokens ?? DEFAULT_GEMINI_MAX_TOKENS,
    ...def.supportsReasoning
      ? {
        reasoning: {
          efforts: def.supportedEfforts !== undefined
            ? GEMINI_REASONING_EFFORTS.filter(e => def.supportedEfforts!.includes(e.name))
            : GEMINI_REASONING_EFFORTS,
          defaultEffort: def.defaultEffort !== undefined
            ? ReasoningEffortId(def.defaultEffort)
            : ReasoningEffortId('low'),
        },
      }
      : {},
  }
}

