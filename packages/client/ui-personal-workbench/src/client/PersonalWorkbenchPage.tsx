/**
 * Personal workbench main panel: task handoff, runtime diagnostics, Windows
 * desktop control status, project memory rules, and workflow templates.
 *
 * Styled exclusively through `--dsw-alias-*` tokens and `@deepseek-ai/dsh-client-ui-primitives`
 * so the page follows the active theme (dark or light) without literal color overrides.
 */

import { useEffect, useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import { Button, Pill, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  DiagnosticsSnapshot,
  MemoryEntry,
  PersonalDesktopControlSnapshot,
  ProjectMemorySnapshot,
  ProjectTask,
  TaskPhase,
  WorkflowTemplate,
} from '../types.ts'
import { zh, type PersonalWorkbenchKey } from './locales.ts'
import css from './PersonalWorkbenchPage.module.css'

type ControlSnapshot = PersonalDesktopControlSnapshot & { epoch?: number }

type TabKey = 'tasks' | 'diagnostics' | 'desktopControl' | 'memory' | 'templates'

const STATUS_LABELS: Record<string, string> = {
  pending: '待执行',
  'in-progress': '执行中',
  'waiting-user': '等待用户',
  'pending-acceptance': '待验收',
  'failed-acceptance': '验收失败',
  accepted: '已验收',
  canceled: '已取消',
}

interface DesktopBridge {
  personalWorkbench?: {
    listTasks: () => Promise<ProjectTask[]>
    listTemplates: () => Promise<WorkflowTemplate[]>
    subscribe: (listener: (tasks: ProjectTask[]) => void) => () => void
    generateHandoffPrompt: (taskId: string) => Promise<string>
    importReport: (taskId: string, report: Record<string, unknown>) => Promise<ProjectTask | undefined>
    updateTask: (taskId: string, patch: { phase: TaskPhase }) => Promise<ProjectTask | undefined>
    createTask: (input: { projectId: string; title: string; target: string }) => Promise<ProjectTask>
  }
  personalDesktopControl?: {
    status: () => Promise<ControlSnapshot>
    subscribe: (listener: (snapshot: ControlSnapshot) => void) => () => void
    stop: () => Promise<ControlSnapshot>
    resume: () => Promise<ControlSnapshot>
    executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  }
  personalDiagnostics?: {
    status: () => Promise<DiagnosticsSnapshot>
    subscribe: (listener: (snapshot: DiagnosticsSnapshot) => void) => () => void
    export: () => Promise<string>
  }
  personalMemory?: {
    snapshot: () => Promise<ProjectMemorySnapshot>
    subscribe: (listener: (snapshot: ProjectMemorySnapshot) => void) => () => void
    addEntry: (workspace: string, kind: string, text: string, source: string) => Promise<void>
    revokeEntry: (workspace: string, entryId: string) => Promise<void>
  }
}

/**
 * Render the personal workbench panel.
 * @param props - optional locale function injected by the `main` slot.
 * @returns the workbench page element.
 */
export function PersonalWorkbenchPage(props: Partial<PropsLocale<'personalWorkbench'>> = {}): ReactNode {
  const translate = props.t ?? ((key: PersonalWorkbenchKey) => zh[key])
  const [activeTab, setActiveTab] = useState<TabKey>('tasks')
  const [tasks, setTasks] = useState<ProjectTask[]>([])
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null)
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [controlSnapshot, setControlSnapshot] = useState<ControlSnapshot | null>(null)
  const [diagSnapshot, setDiagSnapshot] = useState<DiagnosticsSnapshot | null>(null)
  const [diagnosticNow, setDiagnosticNow] = useState(Date.now)
  const [memorySnapshot, setMemorySnapshot] = useState<ProjectMemorySnapshot | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copiedHandoff, setCopiedHandoff] = useState<string | null>(null)

  const [newMemoryKind, setNewMemoryKind] = useState<'confirmed' | 'decision' | 'rejected' | 'state' | 'trace'>('confirmed')
  const [newMemoryText, setNewMemoryText] = useState('')
  const [newMemorySource, setNewMemorySource] = useState('user')
  const [memorySearch, setMemorySearch] = useState('')

  const [, startTransition] = useTransition()

  const desktopApi = (globalThis as typeof globalThis & { dshDesktop?: DesktopBridge }).dshDesktop

  const updateControlSnapshot = (snapshot: ControlSnapshot): void => {
    setControlSnapshot(current => current?.epoch !== undefined
      && (snapshot.epoch === undefined || snapshot.epoch < current.epoch) ? current : snapshot)
  }

  useEffect(() => {
    if (diagSnapshot === null || diagSnapshot.liveStage.stage === 'idle') return
    const timer = setInterval(() => { setDiagnosticNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [diagSnapshot?.liveStage.stage])

  useEffect(() => {
    if (!desktopApi) return
    const disposers: Array<() => void> = []

    if (desktopApi.personalWorkbench) {
      void desktopApi.personalWorkbench.listTasks().then((list: ProjectTask[]) => {
        setTasks(list)
        if (list.length > 0 && !selectedTask) {
          setSelectedTask(list[0] ?? null)
        }
      })
      void desktopApi.personalWorkbench.listTemplates().then((tpls: WorkflowTemplate[]) => {
        setTemplates(tpls)
      })
      const off = desktopApi.personalWorkbench.subscribe((updatedTasks: ProjectTask[]) => {
        setTasks(updatedTasks)
        setSelectedTask(current => current ? (updatedTasks.find(t => t.id === current.id) ?? current) : null)
      })
      if (typeof off === 'function') disposers.push(off)
    }

    if (desktopApi.personalDesktopControl) {
      void desktopApi.personalDesktopControl.status().then((s: ControlSnapshot) => {
        updateControlSnapshot(s)
      })
      const off = desktopApi.personalDesktopControl.subscribe((s: ControlSnapshot) => {
        updateControlSnapshot(s)
      })
      if (typeof off === 'function') disposers.push(off)
    }

    if (desktopApi.personalDiagnostics) {
      void desktopApi.personalDiagnostics.status().then((s: DiagnosticsSnapshot) => {
        setDiagSnapshot(s)
      })
      const off = desktopApi.personalDiagnostics.subscribe((s: DiagnosticsSnapshot) => {
        setDiagSnapshot(s)
      })
      if (typeof off === 'function') disposers.push(off)
    }

    if (desktopApi.personalMemory) {
      void desktopApi.personalMemory.snapshot().then((m: ProjectMemorySnapshot) => {
        setMemorySnapshot(m)
      })
      const off = desktopApi.personalMemory.subscribe((m: ProjectMemorySnapshot) => {
        setMemorySnapshot(m)
      })
      if (typeof off === 'function') disposers.push(off)
    }

    return () => {
      for (const dispose of disposers) dispose()
    }
  }, [desktopApi])

  const handleGenerateHandoff = async (taskId: string): Promise<void> => {
    if (!desktopApi?.personalWorkbench) return
    const promptText = await desktopApi.personalWorkbench.generateHandoffPrompt(taskId)
    setCopiedHandoff(promptText)
    try {
      await navigator.clipboard.writeText(promptText)
      setNotice(translate('copyPromptSuccess'))
    } catch {
      setNotice('已生成提示词，请手动复制下方内容')
    }
    setTimeout(() => { setNotice(null) }, 4000)
  }

  const handleImportReport = async (taskId: string): Promise<void> => {
    if (!desktopApi?.personalWorkbench) return
    const raw = prompt('请输入外部 AI 实施报告文本或 URL 声明:')
    if (!raw) return
    const updated = await desktopApi.personalWorkbench.importReport(taskId, {
      source: '外部实施 AI',
      summary: raw.slice(0, 100),
      rawReport: raw,
      claims: ['声称已完成代码变更与测试'],
    })
    if (updated) {
      setSelectedTask(updated)
      setNotice(translate('importSuccess'))
      setTimeout(() => { setNotice(null) }, 4000)
    }
  }

  const handleUpdatePhase = async (taskId: string, phase: TaskPhase): Promise<void> => {
    if (!desktopApi?.personalWorkbench) return
    const updated = await desktopApi.personalWorkbench.updateTask(taskId, { phase })
    if (updated) setSelectedTask(updated)
  }

  const handleEmergencyStop = async (): Promise<void> => {
    if (!desktopApi?.personalDesktopControl) return
    const res = await desktopApi.personalDesktopControl.stop()
    updateControlSnapshot(res)
    setNotice('已执行紧急接管停止，自动化队列已清空。')
    setTimeout(() => { setNotice(null) }, 4000)
  }

  const handleResume = async (): Promise<void> => {
    if (!desktopApi?.personalDesktopControl) return
    const snapshot = await desktopApi.personalDesktopControl.resume()
    updateControlSnapshot(snapshot)
  }

  const handleAddMemory = async (): Promise<void> => {
    if (!desktopApi?.personalMemory || !newMemoryText.trim()) return
    try {
      await desktopApi.personalMemory.addEntry('D:\\desktop\\personal-desktop', newMemoryKind, newMemoryText, newMemorySource)
      setNewMemoryText('')
      setNotice('已成功添加项目记忆规则')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      alert(`保存失败: ${message}`)
    }
  }

  const handleExportDiagnostics = async (): Promise<void> => {
    if (!desktopApi?.personalDiagnostics) return
    const jsonStr = await desktopApi.personalDiagnostics.export()
    await navigator.clipboard.writeText(jsonStr)
    setNotice('已将脱敏诊断报告复制到剪贴板')
    setTimeout(() => { setNotice(null) }, 4000)
  }

  const filteredEntries = (memorySnapshot?.entries ?? []).filter((e: MemoryEntry) => {
    if (!memorySearch.trim()) return true
    const q = memorySearch.toLowerCase()
    return e.text.toLowerCase().includes(q) || e.label.toLowerCase().includes(q) || e.source.toLowerCase().includes(q)
  })

  const primaryRoute = diagSnapshot?.modelRoutes.primaryModel
  const primarySummary = primaryRoute?.provider && primaryRoute?.model
    ? `${primaryRoute.provider}:${primaryRoute.model}${primaryRoute.reasoningEffort ? ` (${primaryRoute.reasoningEffort})` : ''}`
    : translate('unknown')

  const tabs: readonly { key: TabKey; label: string }[] = [
    { key: 'tasks', label: translate('tabTasks') },
    { key: 'diagnostics', label: translate('tabDiagnostics') },
    { key: 'desktopControl', label: translate('tabDesktopControl') },
    { key: 'memory', label: translate('tabMemory') },
    { key: 'templates', label: translate('tabTemplates') },
  ]

  return (
    <div className={css.page}>
      <header className={css.pageHead}>
        <div className={css.titleGroup}>
          <div className={css.titleRow}>
            <h1 className={css.pageTitle}>{translate('panel')}</h1>
            <Tag tone={controlSnapshot?.connected ? 'success' : 'warning'}>
              {controlSnapshot?.connected ? 'Windows-MCP 在线 (20 工具)' : '桌面自动化未连接'}
            </Tag>
            <Tag tone="info">
              {`${translate('primaryRole')}: ${primarySummary} | ${translate('contextCompressionUnknown')}`}
            </Tag>
          </div>
        </div>
        <div className={css.actionsRow}>
          {controlSnapshot?.paused && (
            <Button variant="outline" size="sm" onClick={() => { void handleResume() }}>
              {translate('resumeAutomation')}
            </Button>
          )}
          {controlSnapshot?.connected && (
            <Button variant="outline" size="sm" onClick={() => { void handleEmergencyStop() }}>
              {translate('emergencyStop')}
            </Button>
          )}
        </div>
      </header>

      <nav className={css.tabsRow} aria-label={translate('panel')}>
        {tabs.map(tab => (
          <Pill
            key={tab.key}
            active={activeTab === tab.key}
            onClick={() => { startTransition(() => { setActiveTab(tab.key) }) }}
          >
            {tab.label}
          </Pill>
        ))}
      </nav>

      <main className={css.contentBody}>
        {notice && (
          <div className={css.noticeBanner} role="status">
            {notice}
          </div>
        )}

        {activeTab === 'tasks' && (
          <section className={css.card}>
            <div className={css.cardHeader}>
              <h2 className={css.cardTitle}>{translate('tasksTitle')}</h2>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  const title = prompt('请输入新任务标题:')
                  if (!title) return
                  const target = prompt('请输入任务最终目标:') || title
                  void desktopApi?.personalWorkbench?.createTask({
                    projectId: 'personal-desktop',
                    title,
                    target,
                  }).then((t: ProjectTask) => {
                    setSelectedTask(t)
                  })
                }}
              >
                + {translate('newTask')}
              </Button>
            </div>

            {tasks.length > 0 && (
              <div className={css.actionsRow}>
                {tasks.map(t => (
                  <Pill
                    key={t.id}
                    active={selectedTask?.id === t.id}
                    onClick={() => { setSelectedTask(t) }}
                  >
                    {t.title} ({STATUS_LABELS[t.phase] || t.phase})
                  </Pill>
                ))}
              </div>
            )}

            {selectedTask ? (
              <div className={css.metaList}>
                <div className={css.grid2}>
                  <div className={css.metaList}>
                    <div className={css.metaItem}>
                      <span className={css.metaLabel}>目标:</span>
                      <span className={css.metaValue}>{selectedTask.target}</span>
                    </div>
                    <div className={css.metaItem}>
                      <span className={css.metaLabel}>阶段状态:</span>
                      <select
                        className={`${css.input} ${css.selectInput}`}
                        value={selectedTask.phase}
                        onChange={(e) => { void handleUpdatePhase(selectedTask.id, e.target.value as TaskPhase) }}
                      >
                        <option value="pending">待执行</option>
                        <option value="in-progress">执行中</option>
                        <option value="waiting-user">等待用户</option>
                        <option value="pending-acceptance">待验收</option>
                        <option value="failed-acceptance">验收失败</option>
                        <option value="accepted">已验收</option>
                        <option value="canceled">已取消</option>
                      </select>
                    </div>
                    <div className={css.metaItem}>
                      <span className={css.metaLabel}>模型路由:</span>
                      <span className={css.metaValue}>
                        主: {selectedTask.routing.primaryModel} | 子: {selectedTask.routing.subagentModel} ({selectedTask.routing.reasoningEffort})
                      </span>
                    </div>
                  </div>

                  <div className={css.metaList}>
                    <div className={css.metaItem}>
                      <span className={css.metaLabel}>已确认要求:</span>
                      <div className={css.tagGroup}>
                        {selectedTask.confirmedRequirements.map((r, i) => (
                          <Tag key={i} tone="success">✓ {r}</Tag>
                        ))}
                      </div>
                    </div>
                    <div className={css.metaItem}>
                      <span className={css.metaLabel}>已禁用方案:</span>
                      <div className={css.tagGroup}>
                        {selectedTask.prohibitedProposals.map((p, i) => (
                          <Tag key={i} tone="danger">✗ {p}</Tag>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className={css.actionsRow}>
                  <Button variant="primary" size="sm" onClick={() => { void handleGenerateHandoff(selectedTask.id) }}>
                    {translate('generateHandoff')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { void handleImportReport(selectedTask.id) }}>
                    {translate('importReport')}
                  </Button>
                </div>

                {selectedTask.importedReports.length > 0 && (
                  <div className={css.metaList}>
                    <h4 className={css.subTitle}>导入的外部实施报告 (待核实，非自动验收):</h4>
                    {selectedTask.importedReports.map(r => (
                      <div key={r.id} className={css.insetModule}>
                        <div className={css.cardHeader}>
                          <span className={css.caption}>来源: {r.source} ({r.importedAt})</span>
                          <Tag tone="warning">待核实 (未自动通过)</Tag>
                        </div>
                        <p className={css.caption}>{r.summary}</p>
                      </div>
                    ))}
                  </div>
                )}

                {copiedHandoff && (
                  <div className={css.metaList}>
                    <h4 className={css.subTitle}>交接提示词预览:</h4>
                    <pre className={css.codeBox}>{copiedHandoff}</pre>
                  </div>
                )}
              </div>
            ) : (
              <div className={css.emptyState}>
                暂无选中任务，点击上方新建任务或选择既有任务。
              </div>
            )}
          </section>
        )}

        {activeTab === 'diagnostics' && (
          <section className={css.card}>
            <div className={css.cardHeader}>
              <h2 className={css.cardTitle}>{translate('diagnosticsTitle')}</h2>
              <div className={css.actionsRow}>
                <Button variant="outline" size="sm" onClick={() => { void handleExportDiagnostics() }}>
                  {translate('exportDiag')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    void desktopApi?.personalDiagnostics?.status().then((s: DiagnosticsSnapshot) => {
                      setDiagSnapshot(s)
                      setNotice('本地状态已重新刷新')
                      setTimeout(() => { setNotice(null) }, 2000)
                    })
                  }}
                >
                  {translate('refreshDiag')}
                </Button>
              </div>
            </div>

            {diagSnapshot && (
              <div className={css.contentBody}>
                <div className={css.grid2}>
                  <div className={css.insetModule}>
                    <h3 className={css.subTitle}>{translate('modelRoute')}</h3>
                    <div className={css.metaItem}>
                      <span className={css.metaLabel}>{translate('configuredPrimary')}:</span>
                      <span className={css.metaValue}>
                        {diagSnapshot.modelRoutes.primaryModel.provider || translate('unknown')}:{diagSnapshot.modelRoutes.primaryModel.model || translate('unknown')} ({diagSnapshot.modelRoutes.primaryModel.reasoningEffort || translate('unknown')})
                      </span>
                    </div>
                    <div className={css.metaItem}>
                      <span className={css.metaLabel}>{translate('actualPrimary')}:</span>
                      <span className={css.metaValue}>
                        {diagSnapshot.modelRoutes.actualPrimary
                          ? `${diagSnapshot.modelRoutes.actualPrimary.provider}:${diagSnapshot.modelRoutes.actualPrimary.model}`
                          : translate('unknown')}
                      </span>
                    </div>
                    <div className={css.metaItem}>
                      <span className={css.metaLabel}>{translate('channel')}:</span>
                      <span className={css.metaValue}>
                        {diagSnapshot.modelRoutes.channelType === 'unknown' ? translate('unknown') : diagSnapshot.modelRoutes.channelType}
                      </span>
                    </div>
                    <div className={css.metaItem}>
                      <span className={css.metaLabel}>路由一致性:</span>
                      <Tag
                        tone={
                          diagSnapshot.modelRoutes.configuredMatchesActual === null
                            ? 'warning'
                            : diagSnapshot.modelRoutes.configuredMatchesActual
                              ? 'success'
                              : 'danger'
                        }
                      >
                        {diagSnapshot.modelRoutes.configuredMatchesActual === null
                          ? translate('routeUnknown')
                          : diagSnapshot.modelRoutes.configuredMatchesActual
                            ? translate('routeMatch')
                            : translate('routeDifferent')}
                      </Tag>
                    </div>
                    <div className={css.metaItem}>
                      <span className={css.metaLabel}>{translate('contextCompression')}:</span>
                      <Tag tone="warning">{translate('contextCompressionUnknown')}</Tag>
                    </div>
                    <div className={css.metaItem}>
                      <span className={css.metaLabel}>子模型池:</span>
                      <div className={css.tagGroup}>
                        {diagSnapshot.modelRoutes.subagentModels.map((m, i) => (
                          <Tag key={i} tone="neutral">{m.provider}:{m.model}</Tag>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className={css.insetModule}>
                    <h3 className={css.subTitle}>{translate('liveStage')}</h3>
                    <div className={css.metaItem}>
                      <span className={css.metaLabel}>当前阶段:</span>
                      <Tag tone="info">{diagSnapshot.liveStage.description || diagSnapshot.liveStage.stage}</Tag>
                    </div>
                    <div className={css.metaItem}>
                      <span className={css.metaLabel}>阶段耗时:</span>
                      <span className={css.metaValue}>
                        {Math.round((diagSnapshot.liveStage.stage === 'idle' ? 0 : Math.max(diagSnapshot.liveStage.elapsedMs, diagnosticNow - Date.parse(diagSnapshot.liveStage.stageStartedAt))) / 1000)} 秒
                      </span>
                    </div>
                    <div className={css.metaItem}>
                      <span className={css.metaLabel}>最后活动时间:</span>
                      <span className={css.metaValue}>{diagSnapshot.liveStage.lastActivityAt}</span>
                    </div>
                  </div>
                </div>

                <div className={css.insetModule}>
                  <h3 className={css.subTitle}>{translate('requestTrace')}</h3>
                  {(diagSnapshot.modelRequests ?? []).length === 0
                    ? <p className={css.caption}>{translate('unknown')}</p>
                    : (
                      <div className={css.list}>
                        {(diagSnapshot.modelRequests ?? []).slice().reverse().map(request => (
                          <div key={request.requestId} className={css.listRow}>
                            <div className={css.listRowMain}>
                              <span className={css.listRowTitle}>
                                {request.role === 'primary'
                                  ? translate('primaryRole')
                                  : request.role === 'subagent'
                                    ? translate('subagentRole')
                                    : translate('auxiliaryRole')}: {request.provider}:{request.model}
                              </span>
                              <span className={css.listRowMeta}>
                                {translate('requestFirstEvent')}: {request.firstEventMs === undefined ? translate('unknown') : `${Math.round(request.firstEventMs)} ms`} · {translate('requestFirstText')}: {request.firstTextMs === undefined ? translate('unknown') : `${Math.round(request.firstTextMs)} ms`} · {translate('requestFinished')}: {request.finishedMs === undefined ? translate('unknown') : `${Math.round(request.finishedMs)} ms`}
                              </span>
                            </div>
                            <Tag tone={request.failureCode ? 'danger' : 'neutral'}>
                              {request.failureCode ?? request.outcome ?? request.startedAt}
                            </Tag>
                          </div>
                        ))}
                      </div>
                    )}
                </div>

                <div className={css.insetModule}>
                  <h3 className={css.subTitle}>{translate('accounts')}</h3>
                  <div className={css.list}>
                    {diagSnapshot.accounts.map(acc => (
                      <div key={acc.id} className={css.listRow}>
                        <div className={css.listRowMain}>
                          <span className={css.listRowTitle}>{acc.name}</span>
                          <span className={css.listRowMeta}>{acc.message}</span>
                        </div>
                        <Tag
                          tone={
                            acc.status === 'verified' ? 'success'
                              : acc.status === 'saved' ? 'info'
                                : acc.status === 'quota-exceeded' ? 'warning'
                                  : 'danger'
                          }
                        >
                          {acc.status === 'verified' ? `验证通过 (${acc.checkedAt || '刚刚'})`
                            : acc.status === 'saved' ? '已保存登录'
                              : acc.status === 'quota-exceeded' ? '额度不足 (不强制重登)'
                                : acc.status === 'unverified' ? translate('notVerified')
                                  : acc.status === 'network-error' ? translate('networkError')
                                    : acc.status === 'cli-unavailable' ? translate('cliUnavailable')
                                      : '需要重新登录'}
                        </Tag>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={css.insetModule}>
                  <h3 className={css.subTitle}>{translate('dependencies')}</h3>
                  <div className={css.list}>
                    {diagSnapshot.dependencies.map((dep, i) => (
                      <div key={i} className={css.listRow}>
                        <div className={css.listRowMain}>
                          <span className={css.listRowTitle}>
                            {dep.name} {dep.version && `(${dep.version})`}
                          </span>
                          <span className={css.listRowMeta}>{dep.path || dep.detail}</span>
                        </div>
                        <Tag tone={dep.status === 'available' ? 'success' : 'danger'}>
                          {dep.status === 'available' ? '就绪' : '缺失'}
                        </Tag>
                      </div>
                    ))}
                  </div>
                </div>

                {diagSnapshot.staleness.warning && (
                  <div className={css.warningBanner} role="alert">
                    ⚠️ {diagSnapshot.staleness.warning}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {activeTab === 'desktopControl' && (
          <section className={css.card}>
            <div className={css.cardHeader}>
              <h2 className={css.cardTitle}>{translate('desktopControlTitle')}</h2>
              <div className={css.actionsRow}>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    void desktopApi?.personalDesktopControl?.executeTool('Snapshot', {}).then(() => {
                      setNotice('已成功获取当前 Windows 窗口与可访问性快照')
                      setTimeout(() => { setNotice(null) }, 3000)
                    })
                  }}
                >
                  捕获窗口快照
                </Button>
                <Button variant="outline" size="sm" onClick={() => { void handleEmergencyStop() }}>
                  {translate('emergencyStop')}
                </Button>
              </div>
            </div>

            <div className={css.noticeBanner}>
              {translate('takeoverNotice')}
            </div>

            <div className={css.grid2}>
              <div className={css.metaList}>
                <div className={css.metaItem}>
                  <span className={css.metaLabel}>连接状态:</span>
                  <Tag tone={controlSnapshot?.connected ? 'success' : 'warning'}>
                    {controlSnapshot?.connected ? `已连接 (${controlSnapshot.serverVersion || '0.8.7'})` : '未连接'}
                  </Tag>
                </div>
                <div className={css.metaItem}>
                  <span className={css.metaLabel}>目标窗口:</span>
                  <span className={css.metaValue}>{controlSnapshot?.activeTargetWindow || '未锁定 (随操作焦点)'}</span>
                </div>
                <div className={css.metaItem}>
                  <span className={css.metaLabel}>输入互斥锁:</span>
                  <Tag tone={controlSnapshot?.locked ? 'warning' : 'success'}>
                    {controlSnapshot?.locked ? '排队锁定中' : '空闲可用'}
                  </Tag>
                </div>
              </div>

              <div className={css.metaList}>
                <span className={css.metaLabel}>可用宿主工具 ({controlSnapshot?.toolCount || 20} 个):</span>
                <div className={css.tagGroup}>
                  {(controlSnapshot?.tools.length ? controlSnapshot.tools : [
                    'App', 'DisplayInventory', 'PowerShell', 'FileSystem', 'Snapshot', 'Screenshot',
                    'Click', 'Type', 'Scroll', 'Move', 'Shortcut', 'Wait', 'WaitFor', 'Scrape',
                    'MultiSelect', 'MultiEdit', 'Clipboard', 'Process', 'Notification', 'Registry',
                  ]).map((tool, i) => (
                    <Tag key={i} tone="neutral">{tool}</Tag>
                  ))}
                </div>
              </div>
            </div>

            {controlSnapshot?.lastScreenshotPath && (
              <div className={css.metaList}>
                <h4 className={css.subTitle}>最近截图证据 ({controlSnapshot.lastScreenshotPath}):</h4>
                {controlSnapshot.lastScreenshotBase64 ? (
                  <img
                    src={`data:image/png;base64,${controlSnapshot.lastScreenshotBase64}`}
                    alt="Desktop Screenshot"
                    className={css.screenshotPreview}
                  />
                ) : (
                  <p className={css.caption}>文件已存储至本机: {controlSnapshot.lastScreenshotPath}</p>
                )}
              </div>
            )}
          </section>
        )}

        {activeTab === 'memory' && (
          <section className={css.card}>
            <div className={css.cardHeader}>
              <h2 className={css.cardTitle}>{translate('memoryTitle')}</h2>
              <span className={css.caption}>
                工作区: {memorySnapshot?.workspace || 'D:\\desktop\\personal-desktop'}
              </span>
            </div>

            <input
              type="text"
              className={css.input}
              placeholder="搜索记忆规则条目..."
              value={memorySearch}
              onChange={(e) => { setMemorySearch(e.target.value) }}
            />

            <div className={css.grid2}>
              <div className={css.insetModule}>
                <h3 className={css.subTitle}>规则条目 ({filteredEntries.length} 条)</h3>
                <div className={`${css.list} ${css.scrollableList}`}>
                  {filteredEntries.map(e => (
                    <div key={e.id} className={css.listRow}>
                      <div className={css.listRowMain}>
                        <div className={css.actionsRow}>
                          <Tag
                            tone={
                              e.kind === 'confirmed' ? 'success'
                                : e.kind === 'rejected' ? 'danger'
                                  : e.kind === 'decision' ? 'info'
                                    : 'neutral'
                            }
                          >
                            {e.label}
                          </Tag>
                          <span className={css.listRowTitle}>{e.text}</span>
                        </div>
                        <span className={css.listRowMeta}>{e.timestamp} (来源: {e.source})</span>
                      </div>
                      {!e.revoked && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void desktopApi?.personalMemory?.revokeEntry('D:\\desktop\\personal-desktop', e.id)
                          }}
                        >
                          撤销
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className={css.insetModule}>
                <h3 className={css.subTitle}>新增记忆规则 (自动阻断敏感密钥)</h3>
                <label className={css.field}>
                  <span className={css.fieldLabel}>类型</span>
                  <select
                    className={`${css.input} ${css.selectInput}`}
                    value={newMemoryKind}
                    onChange={(e) => { setNewMemoryKind(e.target.value as typeof newMemoryKind) }}
                  >
                    <option value="confirmed">CONFIRMED (已确认要求)</option>
                    <option value="decision">DECISION (批准的决定)</option>
                    <option value="rejected">REJECTED (禁用的方案)</option>
                    <option value="state">STATE (已验证状态)</option>
                    <option value="trace">TRACE (追溯凭据)</option>
                  </select>
                </label>
                <label className={css.field}>
                  <span className={css.fieldLabel}>规则内容</span>
                  <textarea
                    className={css.textarea}
                    placeholder="输入具体要求或设计准则..."
                    value={newMemoryText}
                    onChange={(e) => { setNewMemoryText(e.target.value) }}
                  />
                </label>
                <label className={css.field}>
                  <span className={css.fieldLabel}>来源</span>
                  <input
                    type="text"
                    className={css.input}
                    value={newMemorySource}
                    onChange={(e) => { setNewMemorySource(e.target.value) }}
                  />
                </label>
                <div className={css.actionsRow}>
                  <Button variant="primary" size="sm" onClick={() => { void handleAddMemory() }}>
                    保存至项目记忆库
                  </Button>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'templates' && (
          <section className={css.card}>
            <div className={css.cardHeader}>
              <h2 className={css.cardTitle}>{translate('templatesTitle')}</h2>
            </div>
            <div className={css.grid2}>
              {templates.map(tpl => (
                <div key={tpl.id} className={css.insetModule}>
                  <h3 className={css.subTitle}>{tpl.name}</h3>
                  <p className={css.caption}>{tpl.description}</p>
                  <div className={css.list}>
                    {tpl.steps.map((s, i) => (
                      <div key={i} className={css.listRow}>
                        <span className={css.listRowTitle}>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
