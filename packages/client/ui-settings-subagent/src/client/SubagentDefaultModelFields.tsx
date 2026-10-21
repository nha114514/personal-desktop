/** Model defaults use the same live directory as subagent route authorization. */
import { useState } from 'react'
import { Button, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SubagentDefaultModelCardState } from './subagent-default-model-card-controller.ts'
import type { SubagentModelSelectionCardState } from './subagent-model-selection-card-controller.ts'
import type { SubagentCardFace } from './subagent-card-controller.ts'
import css from './SubagentDefaultModelFields.module.css'

type Props = PropsLocale<'settings.subagent'>
  & Pick<SubagentCardFace, 'selectDefaultModel' | 'editDefaultEffort' | 'retryCatalog'>
  & { state: SubagentDefaultModelCardState; models: SubagentModelSelectionCardState }

/**
 * Render model and effort choices from the Host's live model directory.
 * @param props - Localized defaults, catalogue, and staged form actions.
 * @returns Default route and reasoning controls.
 */
export function SubagentDefaultModelFields({ t, state, models, selectDefaultModel, editDefaultEffort, retryCatalog }: Props) {
  const [modelOpen, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  const current = models.candidates.find(route => route.provider === state.provider.text && route.model === state.model.text)
  const choices = models.candidates.filter(route => route.available)
  const effort = state.reasoningEffort.text
  const effortName = current?.reasoning?.efforts.find(choice => choice.id === effort)?.name ?? effort
  const disabled = !state.writable || state.saving
  return (
    <div className={css.fields}>
      {state.primary !== undefined && state.primary.provider && state.primary.model ? (
        <>
          <div className={css.row}>
            <span className={css.label}>{t('subagentPrimaryConfigured')}</span>
            <span className={css.hint}>
              {`${state.primary.provider} · ${state.primary.model}`}
              {state.primary.reasoningEffort ? ` (${state.primary.reasoningEffort})` : ''}
            </span>
          </div>
          <p className={css.hint}>{t('subagentPrimaryHint')}</p>
        </>
      ) : null}
      <p className={css.hint}>{t('subagentDefaultModelHint')}</p>
      <div className={css.row}>
        <span className={css.label}>{t('subagentDefaultModel')}</span>
        <Menu open={modelOpen} portal selectedId={current?.key}
          anchor={<Button variant="outline" size="sm" aria-label={t('subagentDefaultModel')}
            aria-haspopup="menu" aria-expanded={modelOpen} disabled={disabled || choices.length === 0}
            onClick={() => { setModelOpen(!modelOpen) }}>
            {current === undefined ? `${state.provider.text}/${state.model.text}` : `${current.providerName} · ${current.modelName}`}
          </Button>}
          items={choices.map(route => ({ id: route.key, label: `${route.providerName} · ${route.modelName}` }))}
          onClose={() => { setModelOpen(false) }} onSelect={(key) => {
            const route = choices.find(candidate => candidate.key === key)
            if (route !== undefined) selectDefaultModel(route.provider, route.model)
            setModelOpen(false)
          }} />
      </div>
      <div className={css.row}>
        <span className={css.label}>{t('subagentDefaultEffort')}</span>
        <Menu open={effortOpen} portal selectedId={effort === '' ? 'default' : `effort:${effort}`}
          anchor={<Button variant="outline" size="sm" aria-label={t('subagentDefaultEffort')}
            aria-haspopup="menu" aria-expanded={effortOpen} disabled={disabled}
            onClick={() => { setEffortOpen(!effortOpen) }}>
            {effort === '' ? t('subagentProviderDefault') : effortName}
          </Button>}
          items={[
            { id: 'default', label: t('subagentProviderDefault') },
            ...current?.reasoning?.efforts.map(choice => ({ id: `effort:${choice.id}`, label: choice.name })) ?? [],
          ]}
          onClose={() => { setEffortOpen(false) }} onSelect={(key) => {
            editDefaultEffort(key === 'default' ? '' : key.slice('effort:'.length))
            setEffortOpen(false)
          }} />
      </div>
      {models.catalogStatus === 'loading' && <p className={css.hint} role="status">{t('subagentModelSelectionLoading')}</p>}
      {models.catalogStatus === 'error' && <p className={css.invalid} role="alert">{t('subagentModelSelectionLoadFailed')}</p>}
      {models.catalogStatus === 'ready' && current?.available !== true
        && <p className={css.hint}>{t('subagentDefaultUnavailable')}</p>}
      {current?.available === true && effort !== '' && !current.reasoning?.efforts.some(choice => choice.id === effort)
        && <p className={css.invalid}>{t('subagentDefaultEffortInvalid')}</p>}
      <Button variant="ghost" size="sm" disabled={state.saving || models.catalogStatus === 'loading'}
        onClick={retryCatalog}>{t('subagentRefreshModels')}</Button>
    </div>
  )
}
