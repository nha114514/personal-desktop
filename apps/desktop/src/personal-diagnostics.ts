/**
 * Operational Status and Fault Diagnostics Center for Personal Desktop.
 * Tracks model routing consistency, authentication classification without false re-logins,
 * live stage progress, dependency versions, bundle staleness, and sanitized diagnostic exports.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ModelRequestObservation, ModelRequestTrace } from '@deepseek-ai/dsh-client-ui-personal-workbench/types'
import { readPersonalModelRoutes } from './personal-model-routing.ts'

export type LiveStage =
  | 'idle'
  | 'cli-launching'
  | 'protocol-connecting'
  | 'waiting-first-token'
  | 'executing-tools'
  | 'subagent-working'
  | 'canceling'
  | 'streaming'

export interface ModelRouteStatus {
  primaryModel: {
    provider: string
    model: string
    reasoningEffort: string
    accountNumber?: string
  }
  subagentModels: {
    provider: string
    model: string
  }[]
  configuredMatchesActual: boolean | null
  channelType: 'membership-cli' | 'api-direct' | 'unknown'
  actualPrimary?: ModelRequestTrace
}

export interface AuthDiagnosticItem {
  id: string
  name: string
  status: 'saved' | 'verified' | 'unverified' | 'authentication-required' | 'quota-exceeded' | 'network-error' | 'cli-unavailable'
  checkedAt?: string | undefined
  guidanceRequired: boolean
  message?: string | undefined
}

export interface DependencyDiagnosticItem {
  name: string
  path?: string | undefined
  version?: string | undefined
  status: 'available' | 'missing' | 'error'
  detail?: string | undefined
}

export interface StalenessCheckResult {
  isStale: boolean
  latestSrcMtime?: string | undefined
  bundleMtime?: string | undefined
  warning?: string | undefined
}

export interface LiveStageTracker {
  stage: LiveStage
  stageStartedAt: string
  elapsedMs: number
  lastActivityAt: string
  description?: string
}

export interface DiagnosticsSnapshot {
  modelRoutes: ModelRouteStatus
  modelRequests: ModelRequestTrace[]
  accounts: AuthDiagnosticItem[]
  liveStage: LiveStageTracker
  dependencies: DependencyDiagnosticItem[]
  staleness: StalenessCheckResult
  timestamp: string
}

export interface DiagnosticsOptions {
  workspaceRoot?: string | undefined
  dataDirectory?: string | undefined
  codexHome?: string | undefined
  configuredRoute?: Partial<ModelRouteStatus['primaryModel']> | undefined
  actualRoute?: Partial<ModelRouteStatus['primaryModel']> | undefined
}

function safeModelObservation(input: unknown): ModelRequestObservation | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
  const value = input as Record<string, unknown>
  const text = (key: string): string | undefined => typeof value[key] === 'string' && value[key].length <= 1024 ? value[key] : undefined
  const requestId = text('requestId'), provider = text('provider'), model = text('model')
  const role = value.role, phase = value.phase
  if (!requestId || !provider || !model || !['primary', 'subagent', 'auxiliary'].includes(String(role))
    || !['started', 'first-event', 'first-text', 'finished', 'tools-started', 'tools-finished'].includes(String(phase))
    || typeof value.elapsedMs !== 'number' || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0) return undefined
  const event: ModelRequestObservation = {
    requestId, provider, model, elapsedMs: value.elapsedMs,
    role: role as ModelRequestObservation['role'], phase: phase as ModelRequestObservation['phase'],
  }
  for (const key of ['sessionId', 'parentSessionId', 'reasoningEffort', 'toolName'] as const) {
    const content = text(key)
    if (content !== undefined) event[key] = content
  }
  const channel = value.channelType
  if (channel === 'membership-cli' || channel === 'api-direct' || channel === 'unknown') event.channelType = channel
  const outcome = value.outcome
  if (outcome === 'success' || outcome === 'tool-calls' || outcome === 'error' || outcome === 'aborted' || outcome === 'incomplete') event.outcome = outcome
  if (typeof value.failureCode === 'string' && /^[A-Z0-9_]{1,64}$/.test(value.failureCode)) event.failureCode = value.failureCode
  return event
}

export class PersonalDiagnostics {
  private readonly workspaceRoot: string
  private readonly dataDirectory: string
  private readonly codexHome?: string | undefined
  private configuredRoute?: Partial<ModelRouteStatus['primaryModel']> | undefined
  private actualRoute?: Partial<ModelRouteStatus['primaryModel']> | undefined
  private readonly requests = new Map<string, ModelRequestTrace>()
  private actualPrimary: ModelRequestTrace | undefined
  private readonly liveAccountStatus = new Map<string, { status: AuthDiagnosticItem['status']; message?: string | undefined; checkedAt?: string | undefined }>()
  private readonly listeners = new Set<(snapshot: DiagnosticsSnapshot) => void>()
  private liveStage: LiveStageTracker = {
    stage: 'idle',
    stageStartedAt: new Date().toISOString(),
    elapsedMs: 0,
    lastActivityAt: new Date().toISOString(),
    description: '就绪',
  }

  constructor(options: DiagnosticsOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? 'D:\\desktop\\personal-desktop'
    this.dataDirectory = options.dataDirectory ?? 'D:\\desktop\\personal-data'
    this.codexHome = options.codexHome
    this.configuredRoute = options.configuredRoute
    this.actualRoute = options.actualRoute
  }

  subscribe(listener: (snapshot: DiagnosticsSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => { this.listeners.delete(listener) }
  }

  private publish(): void {
    const snap = this.snapshot()
    for (const listener of this.listeners) {
      try { listener(snap) } catch {}
    }
  }

  setLiveStage(stage: LiveStage, description?: string): void {
    const now = new Date()
    const stageChanged = this.liveStage.stage !== stage
    const startedAt = stageChanged ? now.toISOString() : this.liveStage.stageStartedAt
    const startMs = Date.parse(startedAt)
    this.liveStage = {
      stage,
      stageStartedAt: startedAt,
      elapsedMs: Math.max(0, now.getTime() - startMs),
      lastActivityAt: now.toISOString(),
      description: description ?? (stage === 'idle' ? '就绪' : stage),
    }
    this.publish()
  }

  checkStaleness(): StalenessCheckResult {
    try {
      const candidates = [
        join(this.workspaceRoot, 'lib', 'main.js'),
        join(this.workspaceRoot, 'apps', 'desktop', 'lib', 'main.js'),
      ]
      const bundlePath = candidates.find(p => existsSync(p))
      if (!bundlePath) {
        return { isStale: true, warning: '未找到编译产物 lib/main.js，请执行构建' }
      }
      const bundleMtime = statSync(bundlePath).mtimeMs

      const srcDirCandidates = [
        join(this.workspaceRoot, 'src'),
        join(this.workspaceRoot, 'apps', 'desktop', 'src'),
      ]
      const srcDir = srcDirCandidates.find(d => existsSync(d))
      if (!srcDir) return { isStale: false }

      let latestSrcMtime = 0
      const scanDir = (dir: string): void => {
        if (!existsSync(dir)) return
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name)
          if (entry.isDirectory()) {
            scanDir(full)
          } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
            const m = statSync(full).mtimeMs
            if (m > latestSrcMtime) latestSrcMtime = m
          }
        }
      }
      scanDir(srcDir)

      const isStale = latestSrcMtime > bundleMtime
      return {
        isStale,
        latestSrcMtime: latestSrcMtime ? new Date(latestSrcMtime).toISOString() : undefined,
        bundleMtime: new Date(bundleMtime).toISOString(),
        warning: isStale ? '源码修改时间晚于 bundle，运行中可能为旧产物，请运行 pnpm run build:desktop' : undefined,
      }
    } catch {
      return { isStale: false }
    }
  }

  recordActualRoute(route: { provider: string; model: string; reasoningEffort?: string; accountNumber?: string }): void {
    this.actualRoute = { ...route }
    this.publish()
  }

  /**
   * Record only safe, correlated observations from the private Host pipeline.
   * @param input - Untrusted IPC event; prompts, arguments and error messages are discarded.
   */
  recordObservation(input: unknown): void {
    const event = safeModelObservation(input)
    if (event === undefined) return
    let trace = this.requests.get(event.requestId)
    if (event.phase === 'started') {
      if (trace !== undefined) return
      trace = {
        requestId: event.requestId, provider: event.provider, model: event.model, role: event.role,
        channelType: event.channelType ?? 'unknown', startedAt: new Date().toISOString(), elapsedMs: event.elapsedMs,
        ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
        ...(event.parentSessionId === undefined ? {} : { parentSessionId: event.parentSessionId }),
        ...(event.reasoningEffort === undefined ? {} : { reasoningEffort: event.reasoningEffort }),
      }
      this.requests.set(event.requestId, trace)
      // This UI history is bounded independently of the durable session log.
      while (this.requests.size > 32) this.requests.delete(this.requests.keys().next().value!)
      if (event.role === 'primary') {
        this.actualPrimary = trace
      }
    } else {
      if (trace === undefined || trace.provider !== event.provider || trace.model !== event.model
        || trace.sessionId !== event.sessionId || trace.role !== event.role) return
      const isTool = event.phase === 'tools-started' || event.phase === 'tools-finished'
      if (trace.outcome !== undefined && !isTool) return
      trace.elapsedMs = Math.max(trace.elapsedMs, event.elapsedMs)
      if (event.phase === 'first-event') trace.firstEventMs ??= event.elapsedMs
      if (event.phase === 'first-text') trace.firstTextMs ??= event.elapsedMs
      if (event.phase === 'finished') {
        trace.finishedMs = event.elapsedMs
        trace.outcome = event.outcome ?? 'incomplete'
        if (event.failureCode !== undefined) trace.failureCode = event.failureCode
      }
      if (event.toolName !== undefined) trace.toolName = event.toolName
    }
    if (trace === this.actualPrimary) {
      const stage: LiveStage = event.phase === 'started' || event.phase === 'first-event' ? 'waiting-first-token'
        : event.phase === 'first-text' ? 'streaming'
        : event.phase === 'tools-started' || event.outcome === 'tool-calls' ? 'executing-tools' : 'idle'
      const now = new Date().toISOString()
      const descriptions: Partial<Record<LiveStage, string>> = {
        'waiting-first-token': event.phase === 'first-event' ? '模型已有事件，等待可见文本' : '请求已进入模型适配器，等待响应',
        streaming: '正在流式生成', 'executing-tools': '正在执行工具', idle: '本次模型请求已结束',
      }
      this.liveStage = { stage, stageStartedAt: stage === this.liveStage.stage ? this.liveStage.stageStartedAt : now,
        elapsedMs: 0, lastActivityAt: now, description: descriptions[stage] ?? stage }
    } else if (trace.role === 'subagent' && trace.parentSessionId === this.actualPrimary?.sessionId && event.phase === 'started') {
      const now = new Date().toISOString()
      this.liveStage = { stage: 'subagent-working', stageStartedAt: now, elapsedMs: 0, lastActivityAt: now, description: '授权子模型正在执行任务' }
    }
    if (event.phase === 'started' && trace === this.actualPrimary) {
      this.recordActualRoute({ provider: trace.provider, model: trace.model,
        ...(trace.reasoningEffort === undefined ? {} : { reasoningEffort: trace.reasoningEffort }) })
    } else this.publish()
  }

  recordAccountEvent(id: string, event: {
    type: 'verified' | 'quota-exceeded' | 'authentication-required' | 'saved' | 'error'
    message?: string
    checkedAt?: string
  }): void {
    let status: AuthDiagnosticItem['status'] = 'saved'
    if (event.type === 'verified') status = 'verified'
    else if (event.type === 'quota-exceeded') status = 'quota-exceeded'
    else if (event.type === 'authentication-required') status = 'authentication-required'
    else if (event.type === 'error') status = 'network-error'

    this.liveAccountStatus.set(id, {
      status,
      message: event.message,
      checkedAt: event.checkedAt ?? (status === 'verified' ? new Date().toISOString() : undefined),
    })
    this.publish()
  }

  syncAccountsState(accounts: readonly { id: string; phase: string; failure?: string | undefined; checkedAt?: string | undefined }[]): void {
    for (const acc of accounts) {
      if (acc.phase === 'verified') {
        this.liveAccountStatus.set(acc.id, {
          status: 'verified',
          checkedAt: acc.checkedAt ?? new Date().toISOString(),
          message: '凭据有效且当前会话验证成功',
        })
      } else if (acc.failure === 'quota-exceeded') {
        this.liveAccountStatus.set(acc.id, {
          status: 'quota-exceeded',
          checkedAt: acc.checkedAt,
          message: '使用额度超限 (429/Resource Exhausted)，无需重新登录',
        })
      } else if (acc.failure === 'authentication-required') {
        this.liveAccountStatus.set(acc.id, {
          status: 'authentication-required',
          checkedAt: acc.checkedAt,
          message: '认证过期或无效，需要重新登录',
        })
      } else if (acc.phase === 'saved') {
        if (!this.liveAccountStatus.has(acc.id)) {
          this.liveAccountStatus.set(acc.id, {
            status: 'saved',
            checkedAt: acc.checkedAt,
            message: acc.checkedAt ? `凭据已保存 (历史验证: ${acc.checkedAt})` : '凭据已保存，会话可用',
          })
        }
      }
    }
    this.publish()
  }

  checkDependencies(): DependencyDiagnosticItem[] {
    const results: DependencyDiagnosticItem[] = []

    // 1. Windows-MCP
    const winMcpExe = 'C:\\Users\\mouwe\\.local\\bin\\windows-mcp.exe'
    const winMcpVenv = 'C:\\Users\\mouwe\\AppData\\Roaming\\uv\\tools\\windows-mcp\\Scripts\\python.exe'
    const uvSitePackages = join(
      process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
      'uv', 'tools', 'windows-mcp', 'Lib', 'site-packages',
    )
    let pkgVersion = '0.8.7'
    let fastMcpVersion = '4.0.10'
    if (existsSync(uvSitePackages)) {
      try {
        const dirs = readdirSync(uvSitePackages)
        for (const dir of dirs) {
          const mPkg = dir.match(/^windows_mcp-([0-9.]+)\.dist-info$/)
          if (mPkg && mPkg[1]) pkgVersion = mPkg[1]
          const mFast = dir.match(/^fastmcp-([0-9.]+)\.dist-info$/)
          if (mFast && mFast[1]) fastMcpVersion = mFast[1]
        }
      } catch {}
    }

    if (existsSync(winMcpExe) && existsSync(winMcpVenv)) {
      results.push({
        name: 'Windows-MCP (桌面自动化)',
        path: winMcpExe,
        version: `${pkgVersion} (FastMCP ${fastMcpVersion})`,
        status: 'available',
        detail: `stdio JSON-RPC 就绪，支持 20 个 UIA 自动化与截屏工具 (FastMCP ${fastMcpVersion})`,
      })
    } else if (existsSync(winMcpExe)) {
      results.push({
        name: 'Windows-MCP (桌面自动化)',
        path: winMcpExe,
        status: 'error',
        detail: '可执行文件存在但目标 Python 虚拟环境缺失',
      })
    } else {
      results.push({
        name: 'Windows-MCP (桌面自动化)',
        status: 'missing',
        detail: '未找到 windows-mcp.exe',
      })
    }

    // 2. Personal Crawlers
    const crawlersCmd = 'D:\\desktop\\tools\\personal-crawlers\\desktop-crawlers.cmd'
    const crawlerData = join(this.dataDirectory, 'crawlers')
    if (existsSync(crawlersCmd)) {
      results.push({
        name: 'Personal Crawlers (检索后端)',
        path: crawlersCmd,
        version: '统一检索与抓取服务',
        status: 'available',
        detail: `支持 9 大平台（含 YouTube、X/Twitter）与通用检索，共享数据目录: ${crawlerData}`,
      })
    } else {
      results.push({
        name: 'Personal Crawlers (检索后端)',
        status: 'missing',
        detail: '未找到 desktop-crawlers.cmd',
      })
    }

    // 3. Node.js
    results.push({
      name: 'Node.js 运行环境',
      path: process.execPath,
      version: process.version,
      status: 'available',
    })

    // 4. Codex CLI
    const localCodex = join(process.env.LOCALAPPDATA ?? '', 'OpenAI/Codex/bin')
    let codexFound = false
    if (existsSync(localCodex)) {
      try {
        const dirs = readdirSync(localCodex)
        for (const dir of dirs.reverse()) {
          const candidate = join(localCodex, dir, 'codex.exe')
          if (existsSync(candidate)) {
            results.push({
              name: 'Codex CLI',
              path: candidate,
              version: dir,
              status: 'available',
            })
            codexFound = true
            break
          }
        }
      } catch {}
    }
    if (!codexFound) {
      results.push({
        name: 'Codex CLI',
        status: 'missing',
        detail: '官方 Codex CLI 未在 LocalAppData 检测到',
      })
    }

    return results
  }

  checkAccounts(): AuthDiagnosticItem[] {
    const items: AuthDiagnosticItem[] = []

    const buildItem = (
      id: string,
      name: string,
      tokenExists: boolean,
      historicalCheckedAt?: string,
    ): AuthDiagnosticItem => {
      const live = this.liveAccountStatus.get(id)
      if (live) {
        return {
          id,
          name,
          status: live.status,
          checkedAt: live.checkedAt ?? historicalCheckedAt,
          guidanceRequired: live.status === 'unverified' || live.status === 'authentication-required',
          message: live.message ?? (live.status === 'quota-exceeded' ? '使用额度超限 (429/Resource Exhausted)，无需重新登录' : '当前会话已验证可用'),
        }
      }

      if (tokenExists) {
        return {
          id,
          name,
          status: 'saved',
          checkedAt: historicalCheckedAt,
          guidanceRequired: false,
          message: historicalCheckedAt
            ? `凭据已保存 (历史记录: ${historicalCheckedAt})，会话待验证`
            : '凭据已保存，会话可用',
        }
      }

      return {
        id,
        name,
        status: 'unverified',
        guidanceRequired: true,
        message: '未登录或凭据不存在',
      }
    }

    // Gemini Account 2
    const acc2Path = join(this.dataDirectory, 'antigravity/account-2/.gemini/antigravity-cli/antigravity-oauth-token')
    const acc2Verif = join(this.dataDirectory, 'antigravity/account-2/personal-verification.json')
    let acc2CheckedAt: string | undefined
    if (existsSync(acc2Verif)) {
      try { acc2CheckedAt = JSON.parse(readFileSync(acc2Verif, 'utf8')).checkedAt } catch {}
    }
    items.push(buildItem('2', 'Gemini 会员账号 2', existsSync(acc2Path), acc2CheckedAt))

    // Codex Account
    const codexHome = this.codexHome ?? (existsSync(join(this.dataDirectory, 'codex/auth.json')) ? join(this.dataDirectory, 'codex') : join(homedir(), '.codex'))
    const codexAuth = join(codexHome, 'auth.json')
    const codexVerif = join(codexHome, 'personal-verification.json')
    let codexCheckedAt: string | undefined
    if (existsSync(codexVerif)) {
      try { codexCheckedAt = JSON.parse(readFileSync(codexVerif, 'utf8')).checkedAt } catch {}
    }
    items.push(buildItem('codex', 'Codex / GPT-6.1 会员账号', existsSync(codexAuth), codexCheckedAt))

    return items
  }

  checkModelRoutes(): ModelRouteStatus {
    const configured = readPersonalModelRoutes(this.dataDirectory, this.workspaceRoot)
    const primary = { provider: '', model: '', reasoningEffort: '', ...configured.primary, ...this.configuredRoute }
    const actual = this.actualRoute
    let configuredMatchesActual: boolean | null = null
    if (actual?.provider && actual.model && primary.provider && primary.model) {
      const routeMatches = actual.provider === primary.provider && actual.model === primary.model
      configuredMatchesActual = !routeMatches ? false : !primary.reasoningEffort ? true
        : actual.reasoningEffort === undefined ? null : actual.reasoningEffort === primary.reasoningEffort
    }
    return {
      primaryModel: primary,
      subagentModels: configured.allowedModels,
      configuredMatchesActual,
      channelType: this.actualPrimary?.channelType ?? 'unknown',
      ...(this.actualPrimary === undefined ? {} : { actualPrimary: { ...this.actualPrimary } }),
    }
  }

  snapshot(): DiagnosticsSnapshot {
    return {
      modelRoutes: this.checkModelRoutes(),
      modelRequests: [...this.requests.values()].map(request => ({ ...request })),
      accounts: this.checkAccounts(),
      liveStage: { ...this.liveStage, elapsedMs: this.liveStage.stage === 'idle' ? 0 : Math.max(0, Date.now() - Date.parse(this.liveStage.stageStartedAt)) },
      dependencies: this.checkDependencies(),
      staleness: this.checkStaleness(),
      timestamp: new Date().toISOString(),
    }
  }

  exportDiagnostics(): string {
    const raw = JSON.stringify(this.snapshot(), null, 2)
    // Redact sensitive patterns
    return raw
      .replace(/("token"|"key"|"auth"|"secret"|"password"):\s*"[^"]*"/gi, '$1: "[REDACTED]"')
      .replace(/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_API_KEY]')
      .replace(/ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]')
  }
}
