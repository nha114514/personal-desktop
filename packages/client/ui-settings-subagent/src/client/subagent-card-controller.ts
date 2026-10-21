/** Shared presentation and actions for the Host-owned Subagent settings sections. */

import type { SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SubagentLimitsCardFace, SubagentLimitsCardState } from './subagent-limits-card-controller.ts'
import type { SubagentDefaultModelCardFace, SubagentDefaultModelCardState } from './subagent-default-model-card-controller.ts'
import type {
  SubagentModelSelectionCardFace, SubagentModelSelectionCardState,
} from './subagent-model-selection-card-controller.ts'

/** Existing form sources and the actions exposed by one Subagent card. */
export interface SubagentCardFace {
  hooks: SubagentLimitsCardFace['hooks'] & SubagentModelSelectionCardFace['hooks'] & SubagentDefaultModelCardFace['hooks']
  editLimit: SubagentLimitsCardFace['edit']
  resetLimit: SubagentLimitsCardFace['resetField']
  toggleEnabled: SubagentModelSelectionCardFace['toggleEnabled']
  toggleModel: SubagentModelSelectionCardFace['toggleModel']
  retryCatalog: SubagentModelSelectionCardFace['retryCatalog']
  selectDefaultModel: SubagentDefaultModelCardFace['selectModel']
  editDefaultEffort: SubagentDefaultModelCardFace['editEffort']
  /** Save valid drafts through their owning namespace controllers. */
  save: () => void
  /** Discard all drafts without changing persisted settings. */
  discard: () => void
}

/**
 * Derive the shared card state without duplicating the forms' subscriptions.
 * @param limits - Current delegation-limit form.
 * @param models - Current model-authorization form.
 * @param defaults - Current child-default route and effort form.
 * @returns Availability and settlement across the sections this Host serves.
 */
export function subagentCardShell(
  limits: SubagentLimitsCardState,
  models: SubagentModelSelectionCardState,
  defaults: SubagentDefaultModelCardState,
): SettingsFormShell {
  const sections = [limits, models, defaults].filter(section => section.available)
  const candidate = models.candidates.find(route => route.provider === defaults.provider.text && route.model === defaults.model.text)
  const effort = defaults.reasoningEffort.text
  const invalidEffort = defaults.available && defaults.dirty && candidate?.available === true && effort !== ''
    && !candidate.reasoning?.efforts.some(choice => choice.id === effort)
  return {
    available: sections.length > 0,
    writable: sections.every(section => section.writable),
    dirty: sections.some(section => section.dirty),
    invalid: sections.some(section => section.invalid)
      || (models.available && models.dirty && models.conflicted) || invalidEffort,
    saving: sections.some(section => section.saving),
    failed: sections.some(section => section.failed),
  }
}

/**
 * Compose one card from the existing forms; each write retains its namespace revision fence.
 * @param limits - Limit form source and actions.
 * @param models - Model form source and actions.
 * @param defaults - Child-default form source and actions.
 * @returns Framework-bound sources and shared save/discard actions.
 */
export function subagentCardFace(
  limits: SubagentLimitsCardFace,
  models: SubagentModelSelectionCardFace,
  defaults: SubagentDefaultModelCardFace,
): SubagentCardFace {
  return {
    hooks: { ...limits.hooks, ...models.hooks, ...defaults.hooks },
    editLimit: limits.edit,
    resetLimit: limits.resetField,
    toggleEnabled: models.toggleEnabled,
    toggleModel: models.toggleModel,
    retryCatalog: models.retryCatalog,
    selectDefaultModel: defaults.selectModel,
    editDefaultEffort: defaults.editEffort,
    save: () => {
      const limitState = limits.hooks.subagentLimitsCard.getSnapshot()
      const modelState = models.hooks.subagentModelSelectionCard.getSnapshot()
      const defaultState = defaults.hooks.subagentDefaultModelCard.getSnapshot()
      const state = subagentCardShell(limitState, modelState, defaultState)
      if (!state.available || !state.writable || !state.dirty || state.invalid || state.saving) return
      if (modelState.available && modelState.dirty) models.save()
      if (limitState.available && limitState.dirty) limits.save()
      if (defaultState.available && defaultState.dirty) defaults.save()
    },
    discard: () => {
      if (subagentCardShell(
        limits.hooks.subagentLimitsCard.getSnapshot(),
        models.hooks.subagentModelSelectionCard.getSnapshot(),
        defaults.hooks.subagentDefaultModelCard.getSnapshot(),
      ).saving) return
      limits.discard()
      models.discard()
      defaults.discard()
    },
  }
}
