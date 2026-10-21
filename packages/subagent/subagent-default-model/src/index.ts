/**
 * Default model selection and auto-delegation setting for Subagents.
 *
 * @module @deepseek-ai/dsh-subagent-default-model
 */
import type {} from '@deepseek-ai/dsh-settings'
import type { Volatile } from '@deepseek-ai/cordis'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-config-editor'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Default model and auto-delegation configuration for Subagents. */
    subagentDefaultModel: SubagentDefaultModelConfig
  }
}

export interface SubagentSelection extends ModelSelection {
  /** Whether tasks should be automatically delegated to subagents. */
  autoDelegate?: boolean
}

/** Subagent model selection supplied by plugin configuration. */
export interface Config {
  /** Registered provider route (e.g. 'gemini', 'codex', 'deepseek-account'). */
  provider: Volatile<string>
  /** Provider-owned model id. */
  model: Volatile<string>
  /** Adapter-owned reasoning effort; omission or an explicit blank follows provider default. */
  reasoningEffort: Volatile<string | undefined>
  /** Whether to automatically delegate tasks to subagents. */
  autoDelegate: Volatile<boolean>
}

/** Project stored settings onto the Subagent-facing selection type. */
function selection(settings: {
  provider: string
  model: string
  reasoningEffort?: string
  autoDelegate?: boolean
}): SubagentSelection {
  return {
    provider: settings.provider,
    model: settings.model,
    ...settings.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(settings.reasoningEffort) },
    autoDelegate: settings.autoDelegate ?? true,
  }
}

/**
 * Owns the subagent default model and auto-delegation selection.
 */
export class SubagentDefaultModelConfig extends Service {
  private saves: Promise<void> = Promise.resolve()

  static Config = z.object({
    provider: z.string().required().volatile(),
    model: z.string().required().volatile(),
    reasoningEffort: z.string().volatile(),
    autoDelegate: z.boolean().default(true).volatile(),
  })

  constructor(private readonly ownerContext: Context, private config: Config) {
    super(ownerContext, 'subagentDefaultModel')

    ownerContext.inject(['settings'], (child) => {
      child.effect(() => child.settings.configure({ auto: false }, ownerContext.fiber))
    })
  }

  /**
   * Read the current subagent default model selection and auto-delegation mode.
   */
  currentSelection(): SubagentSelection {
    const reasoningEffort = this.config.reasoningEffort.get()?.trim() || undefined
    const autoDelegate = this.config.autoDelegate.get()
    return selection({
      provider: this.config.provider.get(),
      model: this.config.model.get(),
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
      autoDelegate: autoDelegate ?? true,
    })
  }

  /**
   * Save the complete subagent default model selection.
   */
  async saveSelection(next: SubagentSelection): Promise<void> {
    const entry = this.ownerContext.fiber.entry
    if (entry === undefined) return
    const editor = this.ctx.get('configEditor')
    if (editor === undefined) return
    const config = {
      provider: next.provider,
      model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
      autoDelegate: next.autoDelegate ?? true,
    }
    const saved = this.saves.then(() => editor.edit(entry, () => config))
    this.saves = saved.catch(() => {})
    await saved
  }
}

export default SubagentDefaultModelConfig
