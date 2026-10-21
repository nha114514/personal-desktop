/** Locale bundles for the Subagent settings page. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys the page renders. */
export type SubagentSettingsLocaleKey =
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable'
  | 'save' | 'saving' | 'saveFailed'
  | 'subagentTitle' | 'subagentDescription' | 'subagentLimitsTitle'
  | 'subagentMaxDepth'
  | 'subagentDepthHelpLabel' | 'subagentDepthHelp'
  | 'subagentDepthZero' | 'subagentDepthOne' | 'subagentDepthOverride'
  | 'subagentMaxActive'
  | 'subagentCapacityHelpLabel' | 'subagentCapacityHelp'
  | 'subagentDepthInvalid'
  | 'subagentCapacityInvalid'
  | 'subagentModelSelectionTitle'
  | 'subagentModelSelectionToggle' | 'subagentModelSelectionChoose' | 'subagentModelSelectionAllowed'
  | 'subagentModelSelectionLoading' | 'subagentModelSelectionLoadFailed' | 'subagentModelSelectionRetry'
  | 'subagentModelSelectionPartial' | 'subagentModelSelectionUnavailable'
  | 'subagentModelSelectionUnavailableGroup' | 'subagentModelSelectionEmpty'
  | 'subagentModelSelectionRequired' | 'subagentModelSelectionConflict' | 'subagentModelSelectionOff'
  | 'subagentAddApiHint' | 'subagentDefaultTitle' | 'subagentDefaultModel' | 'subagentDefaultModelHint'
  | 'subagentDefaultEffort' | 'subagentProviderDefault' | 'subagentDefaultUnavailable'
  | 'subagentDefaultEffortInvalid' | 'subagentRefreshModels'
  | 'subagentLeafNotice' | 'subagentPrimaryTitle' | 'subagentPrimaryHint'
  | 'subagentPrimaryConfigured' | 'subagentPrimaryEffort'

/** English copy. */
export const en: Record<SubagentSettingsLocaleKey, string> = {
  subagentAddApiHint: 'Add a provider under Settings → Models → Custom model API, then authorize its models here. API keys stay in the credential store.',
  subagentDefaultTitle: 'Default Subagent model',
  subagentDefaultModel: 'Subagent model',
  subagentDefaultModelHint: 'Used for new in-process Subagent tasks that do not specify a model. The main agent model is unchanged. Account CLI tools retain their own defaults.',
  subagentDefaultEffort: 'Reasoning effort',
  subagentProviderDefault: 'Provider default',
  subagentDefaultUnavailable: 'The configured model is not currently advertised. Add its API provider or select an available model.',
  subagentDefaultEffortInvalid: 'This model does not advertise the saved reasoning effort. Select a supported effort or the provider default.',
  subagentLeafNotice: 'Subagents are execution leaf nodes: they perform coding, debugging, and retrieval tasks, and cannot create or delegate further subagents.',
  subagentPrimaryTitle: 'Primary agent model',
  subagentPrimaryHint: 'Core thinking, overall planning, architecture choices, and final acceptance are handled by the user-selected primary model. Subagents never assume primary control.',
  subagentPrimaryConfigured: 'Primary model (main control)',
  subagentPrimaryEffort: 'Primary reasoning effort',
  subagentRefreshModels: 'Refresh models',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  subagentTitle: 'Subagent',
  subagentDescription: 'Set Subagent recursion depth, count, and models.',
  subagentLimitsTitle: 'Limits',
  subagentMaxDepth: 'Maximum recursion depth',
  subagentDepthHelpLabel: 'About maximum recursion depth',
  subagentDepthHelp: 'Limits how many levels of Subagents an Agent can create.',
  subagentDepthZero: 'Disable Subagents',
  subagentDepthOne: 'Only the main Agent can create Subagents',
  subagentDepthOverride: 'If a tool defines its own maximum recursion depth, that setting takes precedence.',
  subagentMaxActive: 'Subagent parallelism limit',
  subagentCapacityHelpLabel: 'About the Subagent parallelism limit',
  subagentCapacityHelp: 'Total live Subagents under the same main Agent, across all recursion levels. The main Agent is excluded. New start requests are rejected when the limit is reached.',
  subagentDepthInvalid: 'Enter a whole number of 0 or more.',
  subagentCapacityInvalid: 'Enter a whole number of 1 or more.',
  subagentModelSelectionTitle: 'Model selection',
  subagentModelSelectionToggle: 'Allow agents to choose models for Subagents',
  subagentModelSelectionChoose: 'Agents may choose only the authorized models below. Authorization changes apply to subsequent delegations and resumed child requests, including existing sessions.',
  subagentModelSelectionAllowed: 'Models agents may choose',
  subagentModelSelectionLoading: 'Loading models…',
  subagentModelSelectionLoadFailed: 'Models could not be loaded.',
  subagentModelSelectionRetry: 'Retry',
  subagentModelSelectionPartial: 'Some model providers could not be loaded; saved choices remain removable.',
  subagentModelSelectionUnavailable: 'Currently unavailable',
  subagentModelSelectionUnavailableGroup: 'Saved but currently unavailable',
  subagentModelSelectionEmpty: 'No model provider currently advertises a model.',
  subagentModelSelectionRequired: 'Select at least one model before saving.',
  subagentModelSelectionConflict: 'Settings changed elsewhere. Discard your draft and try again.',
  subagentModelSelectionOff: 'Subagents use configured defaults or inherit the parent agent\'s model. Saved model choices are retained.',
}

/** Simplified Chinese copy. */
export const zh: Record<SubagentSettingsLocaleKey, string> = {
  subagentAddApiHint: '在“设置 → 模型 → 自定义模型 API”新增提供方，再到这里勾选授权模型。API 密钥保存在凭据存储中。',
  subagentDefaultTitle: '子智能体默认模型',
  subagentDefaultModel: '子智能体模型',
  subagentDefaultModelHint: '用于未指定模型的进程内子智能体新任务，主代理模型保持不变。账号 CLI 工具使用各自的默认配置。',
  subagentDefaultEffort: '推理强度',
  subagentProviderDefault: '提供方默认',
  subagentDefaultUnavailable: '当前模型未出现在可用目录中。请添加对应 API 提供方或选择可用模型。',
  subagentDefaultEffortInvalid: '当前模型未声明已保存的推理强度，请选择支持的等级或“提供方默认”。',
  subagentLeafNotice: '子智能体为执行叶节点：负责代码编写、调试与检索等具体执行任务，不得继续创建或间接委派子智能体。',
  subagentPrimaryTitle: '主智能体模型',
  subagentPrimaryHint: '核心思考、总体规划、架构决策与最终验收由用户选择的主模型负责。子智能体不得接替主控职责。',
  subagentPrimaryConfigured: '主模型（主控职责）',
  subagentPrimaryEffort: '主模型推理强度',
  subagentRefreshModels: '刷新模型',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  subagentTitle: '子智能体',
  subagentDescription: '设置子智能体的递归层级、数量和模型。',
  subagentLimitsTitle: '运行限制',
  subagentMaxDepth: '最大递归深度',
  subagentDepthHelpLabel: '最大递归深度说明',
  subagentDepthHelp: '限制 Agent 创建子智能体的递归层级。',
  subagentDepthZero: '禁用子智能体',
  subagentDepthOne: '仅允许主 Agent 创建子智能体',
  subagentDepthOverride: '如果某个工具单独设置了最大递归深度，以该工具的设置为准。',
  subagentMaxActive: '子智能体并行数量上限',
  subagentCapacityHelpLabel: '子智能体并行数量上限说明',
  subagentCapacityHelp: '同一主 Agent 下，所有递归层级同时存活的子智能体总数，主 Agent 不计入。达到上限时，新的启动请求会被拒绝。',
  subagentDepthInvalid: '请输入不小于 0 的整数。',
  subagentCapacityInvalid: '请输入不小于 1 的整数。',
  subagentModelSelectionTitle: '模型选择',
  subagentModelSelectionToggle: '允许 Agent 为子智能体选择模型',
  subagentModelSelectionChoose: 'Agent 只能从下方已勾选的模型中选择。授权变更立即约束后续派发和复用请求，包括已有会话。',
  subagentModelSelectionAllowed: 'Agent 可选择的模型',
  subagentModelSelectionLoading: '正在加载模型…',
  subagentModelSelectionLoadFailed: '无法加载模型。',
  subagentModelSelectionRetry: '重试',
  subagentModelSelectionPartial: '部分模型提供方暂时无法加载；已保存的选择仍可移除。',
  subagentModelSelectionUnavailable: '当前不可用',
  subagentModelSelectionUnavailableGroup: '已保存但当前不可用',
  subagentModelSelectionEmpty: '当前没有模型提供方公布模型。',
  subagentModelSelectionRequired: '保存前请至少选择一个模型。',
  subagentModelSelectionConflict: '设置已在其他位置更新。请放弃修改后重试。',
  subagentModelSelectionOff: '关闭后，子智能体使用配置的默认模型或继承父 Agent 的模型；已选模型会保留。',
}

/**
 * The form frame's copy, read from this page's dictionary.
 * @param t - the page's locale reader.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: SubagentSettingsLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
