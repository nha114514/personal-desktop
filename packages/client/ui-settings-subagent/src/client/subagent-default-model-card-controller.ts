/** Staged child-model defaults backed by the existing Host settings namespace. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsTextField,
  type SettingsFieldState, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Host namespace for the default route of new in-process child tasks. */
export const SUBAGENT_DEFAULT_MODEL_NS = 'subagent-default-model'

/** Child defaults; API credentials remain in their separate store. */
export interface SubagentDefaultModelSettings {
  provider: string
  model: string
  reasoningEffort?: string
  autoDelegate?: boolean
}

export interface PrimaryModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Effective route, effort, and staged form state. */
export interface SubagentDefaultModelCardState extends SettingsFormShell {
  provider: SettingsFieldState
  model: SettingsFieldState
  reasoningEffort: SettingsFieldState
  primary?: PrimaryModelSelection | undefined
}

/** Observable state and write actions bound by the slot renderer. */
export interface SubagentDefaultModelCardFace {
  hooks: { subagentDefaultModelCard: SnapshotStore<SubagentDefaultModelCardState> }
  selectModel: (provider: string, model: string) => void
  editEffort: (effort: string) => void
  save: () => void
  discard: () => void
}

/** Reuse the shared form's atomic, revision-fenced saves without copying API credentials. */
export class SubagentDefaultModelCardController {
  private readonly form: SettingsFormModel<SubagentDefaultModelSettings>
  private readonly store: SnapshotStore<SubagentDefaultModelCardState>
  private unbindPrimary?: () => void

  /**
   * @param scope - The Host's child-default settings form.
   * @param primaryScope - Optional scope for the primary agent default model.
   */
  constructor(
    scope: SettingsFormScope<SubagentDefaultModelSettings>,
    private readonly primaryScope?: SettingsFormScope<{ provider: string; model: string; reasoningEffort?: string }>,
  ) {
    this.form = new SettingsFormModel(scope, [
      ...['provider', 'model'].map(field => ({
        ...settingsTextField(field),
        parse: (text: string) => text.trim() === '' ? undefined : { kind: 'set' as const, value: text.trim() },
      })),
      {
        ...settingsTextField('reasoningEffort'),
        // An explicit blank masks a composition-layer effort from the previous model.
        parse: text => ({ kind: 'set', value: text.trim() }),
      },
    ])
    const project = (): SubagentDefaultModelCardState => {
      const primaryVal = this.primaryScope?.getSnapshot().value
      const primary = primaryVal !== undefined && primaryVal.provider && primaryVal.model
        ? {
          provider: primaryVal.provider,
          model: primaryVal.model,
          ...primaryVal.reasoningEffort ? { reasoningEffort: primaryVal.reasoningEffort } : {},
        }
        : undefined
      return {
        ...this.form.shell(),
        provider: this.form.field('provider'),
        model: this.form.field('model'),
        reasoningEffort: this.form.field('reasoningEffort'),
        primary,
      }
    }
    this.store = this.form.bind(project)
    if (this.primaryScope !== undefined) {
      this.unbindPrimary = this.primaryScope.subscribe(() => { this.store.set(project()) })
    }
  }

  /**
   * Bind the child-default editor to the slot renderer.
   * @returns The default-model snapshot and staged actions for the renderer.
   */
  inject(): SubagentDefaultModelCardFace {
    const actions = this.form.actions()
    const editable = () => {
      const state = this.store.getSnapshot()
      return state.available && state.writable && !state.saving
    }
    return {
      hooks: { subagentDefaultModelCard: this.store },
      selectModel: (provider, model) => {
        if (!editable()) return
        const state = this.store.getSnapshot()
        if (provider === state.provider.text && model === state.model.text) return
        actions.edit('provider', provider)
        actions.edit('model', model)
        actions.edit('reasoningEffort', '')
      },
      editEffort: (effort) => { if (editable()) actions.edit('reasoningEffort', effort) },
      save: actions.save,
      discard: actions.discard,
    }
  }

  /** Discard old drafts and ignore writes settling after a Host reconnect. */
  resetConnection(): void { this.form.resetConnection() }

  /** Release the accepted-value subscription and suppress late settlements. */
  dispose(): void {
    this.unbindPrimary?.()
    this.form.dispose()
  }
}
