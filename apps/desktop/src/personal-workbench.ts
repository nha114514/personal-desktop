/**
 * Native Task Handoff & Acceptance Workbench service for Personal Desktop.
 * Persists project tasks, handoff prompts, external reports, dual-leaf verification,
 * materials evidence, and workflow templates.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type TaskPhase =
  | 'pending'
  | 'in-progress'
  | 'waiting-user'
  | 'pending-acceptance'
  | 'failed-acceptance'
  | 'accepted'
  | 'canceled'

export interface TaskAcceptanceEvidence {
  command?: string
  exitCode?: number | null
  fileVersions?: Record<string, string>
  screenshots?: string[]
  failedItems?: string[]
  unverifiedItems?: string[]
  verifiedItems?: string[]
  leafInspector?: string
  secondaryLeafReviewer?: string
  judgment?: 'passed' | 'partially-passed' | 'failed'
  notes?: string
}

export interface TaskMaterialItem {
  id: string
  name: string
  type: 'attachment' | 'screenshot' | 'log' | 'webpage' | 'transcript' | 'diff' | 'document'
  source: string
  capturedAt: string
  completeness: 'full' | 'partial' | 'metadata-only'
  filePath?: string
  content?: string
}

export interface ExternalReportImport {
  id: string
  source: string
  importedAt: string
  summary: string
  verified: boolean
  rawReport: string
  claims: string[]
}

export const ALLOWED_TASK_PHASE_TRANSITIONS: Record<TaskPhase, TaskPhase[]> = {
  'pending': ['pending', 'in-progress', 'waiting-user', 'canceled'],
  'in-progress': ['in-progress', 'waiting-user', 'pending-acceptance', 'failed-acceptance', 'canceled'],
  'waiting-user': ['waiting-user', 'pending', 'in-progress', 'pending-acceptance', 'canceled'],
  'pending-acceptance': ['pending-acceptance', 'accepted', 'failed-acceptance', 'in-progress', 'canceled'],
  'failed-acceptance': ['failed-acceptance', 'pending-acceptance', 'in-progress', 'accepted', 'canceled'],
  'accepted': ['accepted', 'in-progress', 'canceled'],
  'canceled': ['canceled', 'pending', 'in-progress'],
}

export interface ProjectTask {
  id: string
  projectId: string
  sessionId?: string | undefined
  subtaskIds?: string[] | undefined
  title: string
  target: string
  confirmedRequirements: string[]
  designChoices: string[]
  prohibitedProposals: string[]
  routing: {
    primaryModel: string
    subagentModel: string
    reasoningEffort: string
    accountNumber?: string
  }
  phase: TaskPhase
  currentBlockers?: string
  nextSteps?: string
  acceptanceEvidence?: TaskAcceptanceEvidence
  materials: TaskMaterialItem[]
  importedReports: ExternalReportImport[]
  appliedRules?: string[] | undefined
  userConfirmed?: boolean | undefined
  createdAt: string
  updatedAt: string
}

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  category: 'development' | 'debugging' | 'experiment' | 'research'
  steps: string[]
}

export const DEFAULT_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'project-development',
    name: '项目功能开发模板',
    description: '适用于新需求、组件扩展或架构演进。澄清目标与规则后分步实现，执行真实构建与测试。',
    category: 'development',
    steps: [
      '1. 澄清需求与项目边界，确认被拒绝方案不被采纳',
      '2. 检查既有代码规范与相邻组件模式，遵循最小改动原则',
      '3. 主模型拆解设计，向已授权叶子子代理分发任务',
      '4. 子代理实施代码变更，更新必要配置与类型声明',
      '5. 运行实际测试套件与类型检查，主模型依据证据判断验收',
    ],
  },
  {
    id: 'software-debugging',
    name: '软件排错与回归修复模板',
    description: '适用于缺陷排查。坚持复现先于修改，定位根因，杜绝仅做测试特例化。',
    category: 'debugging',
    steps: [
      '1. 捕获真实错误日志并构造最小复现案例',
      '2. 调查调用链与边界条件，确定问题根本原因',
      '3. 实施修复并保持周围代码约定不变',
      '4. 运行回归测试并补充防重现用例',
      '5. 验证构建产物，由独立叶子子代理复核',
    ],
  },
  {
    id: 'experiment-report',
    name: '实验与技术调研报告模板',
    description: '适用于新库引入、性能基准或技术可行性探究。',
    category: 'experiment',
    steps: [
      '1. 明确实验假设与度量指标',
      '2. 在隔离环境运行控制对照组并记录客观数据',
      '3. 分析边界与异常路径，记录不可用项',
      '4. 汇总证据并撰写结构化结论与建议',
    ],
  },
  {
    id: 'data-research',
    name: '资料与媒体信息调研模板',
    description: '适用于多源网络与平台检索，分开记录检索发现与全文精读。',
    category: 'research',
    steps: [
      '1. 使用统一检索入口获取平台相关链接',
      '2. 分别标记搜索摘要与正文/字幕读取完整性',
      '3. 归档原始证据至任务证据库，生成附件清单',
      '4. 输出可回溯出处的综合调研摘要',
    ],
  },
]

export interface PersonalWorkbenchSnapshot {
  tasks: ProjectTask[]
  templates: WorkflowTemplate[]
  activeTaskId?: string | undefined
}

export interface WorkbenchOptions {
  dataDirectory?: string | undefined
  memory?: {
    search: (workspace: string, query: string, limit?: number) => { entry: { text: string } }[]
  } | undefined
}

export class PersonalWorkbench {
  private readonly options: WorkbenchOptions
  private readonly listeners = new Set<(snapshot: PersonalWorkbenchSnapshot) => void>()
  private tasks: ProjectTask[] = []
  private templates: WorkflowTemplate[] = [...DEFAULT_WORKFLOW_TEMPLATES]
  private activeTaskId?: string | undefined

  constructor(options: WorkbenchOptions = {}) {
    this.options = {
      dataDirectory: options.dataDirectory || 'D:\\desktop\\personal-data',
      memory: options.memory,
    }
    this.loadFromDisk()
  }

  private get tasksFilePath(): string {
    const dir = join(this.options.dataDirectory!, 'workbench')
    try { mkdirSync(dir, { recursive: true }) } catch {}
    return join(dir, 'tasks.json')
  }

  private loadFromDisk(): void {
    const file = this.tasksFilePath
    if (existsSync(file)) {
      try {
        const raw = readFileSync(file, 'utf8')
        const data = JSON.parse(raw)
        if (Array.isArray(data.tasks)) {
          this.tasks = data.tasks
        }
        if (typeof data.activeTaskId === 'string') {
          this.activeTaskId = data.activeTaskId
        }
      } catch {}
    }
  }

  private saveToDisk(): void {
    const file = this.tasksFilePath
    try {
      const data = {
        tasks: this.tasks,
        activeTaskId: this.activeTaskId,
        savedAt: new Date().toISOString(),
      }
      writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
    } catch {}
  }

  snapshot(): PersonalWorkbenchSnapshot {
    return {
      tasks: [...this.tasks],
      templates: [...this.templates],
      activeTaskId: this.activeTaskId,
    }
  }

  subscribe(listener: (snapshot: PersonalWorkbenchSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => { this.listeners.delete(listener) }
  }

  private publish(): void {
    this.saveToDisk()
    const snap = this.snapshot()
    for (const listener of this.listeners) {
      try { listener(snap) } catch {}
    }
  }

  createTask(params: Partial<ProjectTask> & { title: string; target?: string; projectId?: string }): ProjectTask {
    const now = new Date().toISOString()
    const projectId = params.projectId ?? 'default'
    let appliedRules = params.appliedRules
    if (!appliedRules && this.options.memory) {
      try {
        const query = `${params.title} ${params.target ?? ''}`.trim()
        appliedRules = this.options.memory.search(projectId, query, 5).map(r => r.entry.text)
      } catch {}
    }
    const newTask: ProjectTask = {
      id: `task-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      projectId,
      sessionId: params.sessionId,
      subtaskIds: params.subtaskIds ?? [],
      title: params.title,
      target: params.target ?? params.title,
      confirmedRequirements: params.confirmedRequirements ?? [],
      designChoices: params.designChoices ?? [],
      prohibitedProposals: params.prohibitedProposals ?? [],
      routing: params.routing ?? {
        primaryModel: 'gpt-6.1-sol',
        subagentModel: 'gemini-3.8-flash',
        reasoningEffort: 'high',
      },
      phase: params.phase ?? 'pending',
      currentBlockers: params.currentBlockers ?? '',
      nextSteps: params.nextSteps ?? '',
      materials: params.materials ?? [],
      importedReports: [],
      appliedRules: appliedRules ?? [],
      userConfirmed: params.userConfirmed,
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.unshift(newTask)
    this.activeTaskId = newTask.id
    this.publish()
    return newTask
  }

  updateTask(taskId: string, patch: Partial<ProjectTask>): ProjectTask | undefined {
    const index = this.tasks.findIndex(t => t.id === taskId)
    if (index === -1) return undefined
    const current = this.tasks[index]!

    // Immutable field checks
    if ('id' in patch && patch.id !== current.id) {
      throw new Error(`Cannot modify immutable task field: id`)
    }
    if ('projectId' in patch && patch.projectId !== current.projectId) {
      throw new Error(`Cannot modify immutable task field: projectId`)
    }
    if ('createdAt' in patch && patch.createdAt !== current.createdAt) {
      throw new Error(`Cannot modify immutable task field: createdAt`)
    }

    // Phase transition validation
    if (patch.phase && patch.phase !== current.phase) {
      const allowed = ALLOWED_TASK_PHASE_TRANSITIONS[current.phase]
      if (!allowed || !allowed.includes(patch.phase)) {
        throw new Error(`Invalid phase transition from '${current.phase}' to '${patch.phase}'`)
      }
      if (patch.phase === 'accepted') {
        const evidence = patch.acceptanceEvidence ?? current.acceptanceEvidence
        if (evidence) {
          const hasFailed = (evidence.exitCode !== 0 && evidence.exitCode != null) || (evidence.failedItems && evidence.failedItems.length > 0)
          const hasUnverified = evidence.unverifiedItems && evidence.unverifiedItems.length > 0
          if (hasFailed || hasUnverified || evidence.judgment === 'failed' || evidence.judgment === 'partially-passed') {
            throw new Error(`Cannot transition to accepted with failed or unverified acceptance evidence`)
          }
        }
      }
    }

    const updated: ProjectTask = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    this.tasks[index] = updated
    this.publish()
    return updated
  }

  listTasks(projectId?: string): ProjectTask[] {
    if (projectId) return this.tasks.filter(t => t.projectId === projectId)
    return [...this.tasks]
  }

  getTask(id: string): ProjectTask | undefined {
    return this.tasks.find(t => t.id === id)
  }

  deleteTask(taskId: string): boolean {
    const initialLen = this.tasks.length
    this.tasks = this.tasks.filter(t => t.id !== taskId)
    if (this.activeTaskId === taskId) {
      this.activeTaskId = this.tasks[0]?.id ?? undefined
    }
    const changed = this.tasks.length !== initialLen
    if (changed) this.publish()
    return changed
  }

  setActiveTask(taskId: string): void {
    if (this.tasks.some(t => t.id === taskId)) {
      this.activeTaskId = taskId
      this.publish()
    }
  }

  /**
   * “生成交接提示词”: Export copyable prompt + attachment manifest.
   */
  generateHandoffPrompt(taskId: string): string {
    const task = this.tasks.find(t => t.id === taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    const attachments = task.materials.map(m => ({
      name: m.name,
      path: m.filePath,
      type: m.type,
      source: m.source,
      completeness: m.completeness,
    }))

    const lines: string[] = [
      `# 任务交接提示词: ${task.title}`,
      '',
      `> 导出时间: ${new Date().toISOString()}`,
      `> 工作区: ${task.projectId || 'D:\\desktop\\personal-desktop'}`,
      `> 关联项目: ${task.projectId}`,
      ...(task.sessionId ? [`> 关联会话: ${task.sessionId}`] : []),
      ...(task.subtaskIds && task.subtaskIds.length > 0 ? [`> 关联子任务: ${task.subtaskIds.join(', ')}`] : []),
      `> 当前阶段: ${task.phase}`,
      '',
      '## 一、目标与用户确认要求',
      task.target,
      '',
      '### 已确认要求:',
      ...task.confirmedRequirements.map((r, i) => `${i + 1}. ${r}`),
      '',
      '### 自动检索的项目规则 (Requirement-Memory):',
      ...(task.appliedRules && task.appliedRules.length > 0
        ? task.appliedRules.map((r, i) => `${i + 1}. ${r}`)
        : ['（暂无匹配规则）']),
      '',
      '### 已禁用方案 / 拒绝方案 (禁止重新提出或采用):',
      ...task.prohibitedProposals.map((p, i) => `${i + 1}. ${p}`),
      '',
      '## 二、配置与模型约束',
      `- 决策主模型: ${task.routing.primaryModel}（主模型仅决策与设计）`,
      `- 执行子模型: ${task.routing.subagentModel} (推理档位: ${task.routing.reasoningEffort})`,
      '- 并发约束: 最多 8 个并行叶子子代理，禁止子代理派生子代理。',
      '- 环境约束: 保留用户未提交修改与全局配置，遵循原代码风格。',
      '',
      '## 三、当前阻塞与下一步计划',
      `当前阻塞: ${task.currentBlockers || '无'}`,
      `下一步: ${task.nextSteps || '待规划'}`,
      '',
      '## 四、验收标准与证据要求',
      '1. 必须运行真实测试与构建命令，记录退出码与关键输出。',
      '2. 涉及界面/桌面必须取得真实截图与窗口身份核验。',
      '3. 分别明确报告: 已实现、已验证和尚未验证项。',
      '',
      '## 五、必要附件与资料清单',
      attachments.length > 0
        ? attachments.map((a, i) => `${i + 1}. [${a.type}] ${a.name} (${a.completeness}) [来源: ${a.source}] - ${a.path || '内嵌资料'}`).join('\n')
        : '（暂无附件）',
    ]

    return lines.join('\n')
  }

  /**
   * “导入外部 AI 报告”: Records origin and marks claims as pending verification.
   * Does NOT auto-accept task.
   */
  importExternalReport(taskId: string, params: { source: string; rawReport: string; summary?: string | undefined; claims?: string[] | undefined }): ProjectTask {
    const task = this.tasks.find(t => t.id === taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    // Extract bullet claims from report or use provided claims
    const claimMatches = params.rawReport.match(/^[-*]\s+(.+)$/gm) ?? []
    const extractedClaims = claimMatches.map(c => c.replace(/^[-*]\s+/, '').trim())
    const claims = params.claims ?? extractedClaims

    const importEntry: ExternalReportImport = {
      id: `report-${Date.now()}`,
      source: params.source,
      importedAt: new Date().toISOString(),
      summary: params.summary ?? `已导入来自 ${params.source} 的报告，包含 ${claims.length} 条声明（待主模型核实）`,
      verified: false,
      rawReport: params.rawReport,
      claims,
    }

    task.importedReports.unshift(importEntry)
    // Mark status as pending-acceptance for human/subagent review, NEVER accepted directly
    if (task.phase === 'in-progress' || task.phase === 'pending') {
      task.phase = 'pending-acceptance'
    }
    task.nextSteps = `核查外部报告声明: ${params.source}`
    this.publish()
    return task
  }

  /**
   * 记录或更新主模型验收判定
   */
  recordAcceptance(taskId: string, evidence: TaskAcceptanceEvidence): ProjectTask {
    const task = this.tasks.find(t => t.id === taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    task.acceptanceEvidence = evidence
    const hasFailed = (evidence.exitCode !== 0 && evidence.exitCode != null) || (evidence.failedItems && evidence.failedItems.length > 0)
    const hasUnverified = evidence.unverifiedItems && evidence.unverifiedItems.length > 0

    if (hasFailed || evidence.judgment === 'failed') {
      task.phase = 'failed-acceptance'
    } else if (hasUnverified || evidence.judgment === 'partially-passed') {
      task.phase = 'pending-acceptance' // Retains unverified items
    } else if (evidence.judgment === 'passed') {
      task.phase = 'accepted'
    } else {
      task.phase = 'pending-acceptance'
    }
    task.updatedAt = new Date().toISOString()
    this.publish()
    return task
  }

  recordAcceptanceEvidence(taskId: string, evidence: TaskAcceptanceEvidence): ProjectTask {
    return this.recordAcceptance(taskId, evidence)
  }

  confirmTaskByHuman(taskId: string, confirmed: boolean, notes?: string): ProjectTask {
    const task = this.tasks.find(t => t.id === taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    task.userConfirmed = confirmed
    if (notes) {
      task.nextSteps = notes
    }
    task.updatedAt = new Date().toISOString()
    this.publish()
    return task
  }

  listTemplates(): WorkflowTemplate[] {
    return [...this.templates]
  }

  addMaterial(taskId: string, material: Omit<TaskMaterialItem, 'id' | 'capturedAt'>): ProjectTask {
    const task = this.tasks.find(t => t.id === taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    const item: TaskMaterialItem = {
      ...material,
      id: `mat-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      capturedAt: new Date().toISOString(),
    }
    task.materials.unshift(item)
    this.publish()
    return task
  }
}
