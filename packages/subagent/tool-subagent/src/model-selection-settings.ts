/** Host-owned opt-in setting for model-selectable subagent delegation. */
import type { Volatile } from '@deepseek-ai/cordis'

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertAllowedModelSelection } from './model-selection.ts'
import {
  AllowedModelRouteSchema,
  assertAllowedModelRoutes,
  type AllowedModelRoute,
} from './model-selection.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Current user authorization for delegation and subsequent child model requests. */
    subagentModelSelection: SubagentModelSelectionConfig
  }
}

/** Stored user preference; the shipped composition defaults it off. */
export interface SubagentModelSelectionSettings {
  /** Whether eligible Sessions may select a child model. */
  enabled: boolean
  /** Exact child LLM routes currently authorized by the user. */
  allowedModels: AllowedModelRoute[]
}

/** Optional deployment base for the preference. */
export interface Config {
  /** Enforce the current list on every child model request, including resumed children. */
  enforceAllowedModels: Volatile<boolean>
  /** Initial enabled state inherited when the user document does not override it. */
  enabled: Volatile<boolean>
  /** Initial route list inherited when the user document does not override it. */
  allowedModels: Volatile<AllowedModelRoute[]>
}

/** Singleton settings owner read during composition, delegation, and child requests. */
export class SubagentModelSelectionConfig extends Service {
  static Config = z.object({
    enforceAllowedModels: z.boolean().default(false).volatile(),
    enabled: z.boolean().default(false).volatile(),
    allowedModels: z.array(AllowedModelRouteSchema).default([]).volatile(),
  })

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'subagentModelSelection')
    ctx.on('agent/request', async ({ agent }, next) => {
      const resolved = await next()
      const header = agent.session.header
      if (this.config.enforceAllowedModels.get()
        && (header.origin === 'subagent' || header.parentSession !== undefined
          || (header.delegationDepth ?? 0) > 0 || (agent.options.subagentDepth ?? 0) > 0)) {
        assertAllowedModelSelection({ routes: this.current().allowedModels }, {}, resolved)
      }
      return resolved
    })
  }

  /**
   * Read a detached copy of the current selection preference.
   * @returns the enabled state and exact allowed routes.
   */
  current(): SubagentModelSelectionSettings {
    const enabled = this.config.enabled.get()
    const allowedModels = this.config.allowedModels.get()
    assertAllowedModelRoutes(allowedModels)
    if (enabled && allowedModels.length === 0) {
      throw new Error('enabled subagent model selection requires at least one allowed model')
    }
    return { enabled, allowedModels: allowedModels.map(route => ({ ...route })) }
  }

}

export const name = 'subagent-model-selection-settings'
export default SubagentModelSelectionConfig
