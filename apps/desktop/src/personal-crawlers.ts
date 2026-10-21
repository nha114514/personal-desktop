/** Native MediaCrawler and Scrapling retrieval service for Personal Desktop. */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

export interface MediaPlatformInfo {
  id: string
  name: string
  status: 'saved' | 'idle' | 'logging-in' | 'crawling' | 'verified' | 'expired'
  busy: boolean
}

export interface CrawlerLogEntry {
  id: number
  timestamp: string
  level: 'info' | 'warning' | 'error' | 'success'
  message: string
}

export interface CrawlerResultItem {
  id: string
  platform: string
  title: string
  url: string
  snippet: string
  crawledAt: string
}

export interface PersonalCrawlersSnapshot {
  platforms: MediaPlatformInfo[]
  activePlatform?: string | undefined
  activeOperation?: 'login' | 'crawl' | undefined
  logs: CrawlerLogEntry[]
  results: CrawlerResultItem[]
}

export interface PersonalCrawlersOptions {
  pythonExecutable?: string | undefined
  mediaCrawlerDirectory?: string | undefined
  dataDirectory?: string | undefined
  worker?: string | undefined
  settingsFile?: string | undefined
  timeoutMs?: number | undefined
  codexModel?: string | undefined
}

const DEFAULT_PLATFORMS: Array<{ id: string; name: string }> = [
  { id: 'bili', name: 'B站' },
  { id: 'xhs', name: '小红书' },
  { id: 'dy', name: '抖音' },
  { id: 'ks', name: '快手' },
  { id: 'wb', name: '微博' },
  { id: 'tieba', name: '百度贴吧' },
  { id: 'zhihu', name: '知乎' },
  { id: 'youtube', name: 'YouTube' },
  { id: 'x', name: 'X / Twitter' },
]

export class PersonalCrawlers {
  readonly options: PersonalCrawlersOptions
  private readonly listeners = new Set<(snapshot: PersonalCrawlersSnapshot) => void>()
  private readonly logListeners = new Set<(log: CrawlerLogEntry) => void>()
  private platforms: MediaPlatformInfo[]
  private activePlatform?: string | undefined
  private activeOperation?: 'login' | 'crawl' | undefined
  private logs: CrawlerLogEntry[] = []
  private results: CrawlerResultItem[] = []
  private activeChild?: ChildProcess | undefined
  private activeAbort?: AbortController | undefined
  private activeTaskId?: number | undefined
  private nextTaskId = 0
  private logId = 0

  constructor(options: PersonalCrawlersOptions = {}) {
    const defaults = this.loadDefaultSettings(options.settingsFile)
    const cleanedOptions: Partial<PersonalCrawlersOptions> = {}
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined) {
        (cleanedOptions as any)[key] = value
      }
    }
    const merged = { ...defaults, ...cleanedOptions }
    if (merged.dataDirectory) {
      merged.dataDirectory = this.normalizeDataDirectory(merged.dataDirectory)
    }
    this.options = merged
    this.platforms = DEFAULT_PLATFORMS.map(p => ({
      id: p.id,
      name: p.name,
      status: this.checkPlatformSaved(p.id) ? 'saved' : 'idle',
      busy: false,
    }))
    this.loadSavedResults()
  }

  private normalizeDataDirectory(candidate?: string): string | undefined {
    if (!candidate) return undefined
    const crawlersSub = join(candidate, 'crawlers')
    if (existsSync(crawlersSub)) {
      return crawlersSub
    }
    return candidate
  }

  private loadDefaultSettings(settingsFile?: string): Partial<PersonalCrawlersOptions> {
    const file = settingsFile ?? process.env.PERSONAL_CRAWLERS_CONFIG ?? 'D:/desktop/personal-data/crawlers/settings.json'
    try {
      if (existsSync(file)) {
        const raw = JSON.parse(readFileSync(file, 'utf8'))
        return {
          pythonExecutable: raw.pythonExecutable,
          mediaCrawlerDirectory: raw.mediaCrawlerDirectory,
          dataDirectory: raw.dataDirectory,
          worker: raw.worker,
          timeoutMs: raw.timeoutMs,
        }
      }
    } catch {}
    return {
      pythonExecutable: 'D:/desktop/tools/crawler-runtime/Scripts/python.exe',
      mediaCrawlerDirectory: 'D:/desktop/tools/MediaCrawler',
      dataDirectory: 'D:/desktop/personal-data/crawlers',
      worker: 'D:/desktop/tools/personal-crawlers/crawler.py',
      timeoutMs: 60000,
    }
  }

  private checkPlatformSaved(platformId: string): boolean {
    if (platformId === 'youtube') return true
    if (platformId === 'x') return false
    const dataDir = this.options.dataDirectory
    if (!dataDir) return false
    try {
      const cookiePath1 = join(dataDir, 'browser-data', platformId, 'Default', 'Network', 'Cookies')
      const cookiePath2 = join(dataDir, 'browser-data', platformId, 'Default', 'Cookies')
      if (existsSync(cookiePath1) && statSync(cookiePath1).size > 0) return true
      if (existsSync(cookiePath2) && statSync(cookiePath2).size > 0) return true
    } catch {}
    return false
  }

  private loadSavedResults(): void {
    const dataDir = this.options.dataDirectory
    if (!dataDir) return
    const resultsDir = join(dataDir, 'results')
    if (!existsSync(resultsDir)) return
    const loaded: CrawlerResultItem[] = []
    try {
      const platformDirs = readdirSync(resultsDir)
      for (const pDir of platformDirs) {
        const pPath = join(resultsDir, pDir)
        if (!statSync(pPath).isDirectory()) continue
        const files = readdirSync(pPath).filter(f => f.endsWith('.jsonl')).sort().reverse()
        for (const file of files.slice(0, 5)) {
          try {
            const content = readFileSync(join(pPath, file), 'utf8')
            for (const line of content.split('\n')) {
              if (!line.trim()) continue
              const item = JSON.parse(line.trim())
              if (item.url && item.title) {
                loaded.push({
                  id: `${pDir}-${loaded.length}-${Date.now()}`,
                  platform: pDir,
                  title: String(item.title),
                  url: String(item.url),
                  snippet: String(item.snippet ?? item.desc ?? ''),
                  crawledAt: String(item.crawledAt ?? new Date().toISOString()),
                })
              }
            }
          } catch {}
        }
      }
      this.results = loaded.slice(0, 100)
    } catch {}
  }

  snapshot(): PersonalCrawlersSnapshot {
    return {
      platforms: this.platforms.map(p => {
        let status = p.status
        if (p.id === this.activePlatform) {
          status = this.activeOperation === 'login' ? 'logging-in' : 'crawling'
        } else if (status !== 'verified' && status !== 'expired') {
          status = this.checkPlatformSaved(p.id) ? 'saved' : 'idle'
        }
        return {
          ...p,
          status,
          busy: p.id === this.activePlatform,
        }
      }),
      activePlatform: this.activePlatform,
      activeOperation: this.activeOperation,
      logs: this.logs.slice(-200),
      results: this.results,
    }
  }

  subscribe(listener: (snapshot: PersonalCrawlersSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => { this.listeners.delete(listener) }
  }

  onLog(listener: (log: CrawlerLogEntry) => void): () => void {
    this.logListeners.add(listener)
    return () => { this.logListeners.delete(listener) }
  }

  private publish(): void {
    const snap = this.snapshot()
    for (const listener of this.listeners) {
      try { listener(snap) } catch {}
    }
  }

  private appendLog(message: string, level: CrawlerLogEntry['level'] = 'info'): CrawlerLogEntry {
    const now = new Date()
    const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    const entry: CrawlerLogEntry = {
      id: ++this.logId,
      timestamp,
      level,
      message,
    }
    this.logs.push(entry)
    if (this.logs.length > 500) this.logs = this.logs.slice(-500)
    for (const listener of this.logListeners) {
      try { listener(entry) } catch {}
    }
    return entry
  }

  private parseLogLevel(line: string): CrawlerLogEntry['level'] {
    const upper = line.toUpperCase()
    if (upper.includes('ERROR') || upper.includes('FAILED') || upper.includes('失败')) return 'error'
    if (upper.includes('WARNING') || upper.includes('WARN')) return 'warning'
    if (upper.includes('SUCCESS') || upper.includes('完成') || upper.includes('成功')) return 'success'
    return 'info'
  }

  async login(platform: string): Promise<PersonalCrawlersSnapshot> {
    if (this.activePlatform !== undefined) {
      throw new Error(`Crawler is already busy with platform ${this.activePlatform}`)
    }
    const plat = this.platforms.find(p => p.id === platform)
    if (!plat) throw new Error(`Unknown media platform: ${platform}`)

    const taskId = ++this.nextTaskId
    this.activeTaskId = taskId
    this.activePlatform = platform
    this.activeOperation = 'login'
    this.appendLog(`启动平台登录浏览器: ${plat.name} (${platform})...`, 'info')
    this.publish()

    try {
      const outputJson = await this.runProcess({
        operation: 'login',
        platform,
        query: '测试',
        maxResults: 1,
      }, taskId)
      if (platform === 'x') {
        if (outputJson?.status === 'ok') {
          plat.status = 'verified'
          this.appendLog(`平台 ${plat.name} 登录并验证成功`, 'success')
        } else {
          plat.status = 'idle'
          this.appendLog(outputJson?.message || `平台 ${plat.name} 扩展未连接或未完成登录，请在受控 Chrome 加载 OpenCLI 扩展并登录 x.com`, 'info')
        }
      } else {
        const hasSavedCookies = this.checkPlatformSaved(platform)
        const hasAuthProof = Boolean(outputJson && (
          outputJson.authenticated === true ||
          outputJson.success === true ||
          outputJson.status === 'ok' ||
          outputJson.status === 'success' ||
          (Array.isArray(outputJson.sources) && outputJson.sources.length > 0)
        ))
        if (hasAuthProof && hasSavedCookies) {
          plat.status = 'verified'
          this.appendLog(`平台 ${plat.name} 登录并验证成功`, 'success')
        } else if (hasSavedCookies) {
          plat.status = 'saved'
          this.appendLog(`平台 ${plat.name} 登录流程已结束，检测到已保存凭据`, 'info')
        } else {
          plat.status = 'idle'
          this.appendLog(`平台 ${plat.name} 未检测到有效认证凭据`, 'warning')
        }
      }
    } catch (err: any) {
      this.appendLog(`平台 ${plat.name} 登录退出: ${err?.message ?? String(err)}`, 'warning')
    } finally {
      if (this.activeTaskId === taskId) {
        this.activeTaskId = undefined
        this.activePlatform = undefined
        this.activeOperation = undefined
        this.publish()
      }
    }
    return this.snapshot()
  }

  async crawl(platform: string, keyword: string, maxCount = 5): Promise<PersonalCrawlersSnapshot> {
    if (this.activePlatform !== undefined) {
      throw new Error(`Crawler is already busy with platform ${this.activePlatform}`)
    }
    const plat = this.platforms.find(p => p.id === platform)
    if (!plat) throw new Error(`Unknown media platform: ${platform}`)
    if (!keyword.trim()) throw new Error('Crawl keyword cannot be empty')

    const taskId = ++this.nextTaskId
    this.activeTaskId = taskId
    this.activePlatform = platform
    this.activeOperation = 'crawl'
    this.appendLog(`开始抓取: [${plat.name}] 关键词: "${keyword.trim()}", 数量: ${maxCount}...`, 'info')
    this.publish()

    try {
      const outputJson = await this.runProcess({
        operation: 'crawl',
        platform,
        query: keyword.trim(),
        maxResults: Math.min(20, Math.max(1, maxCount)),
      }, taskId)

      if (outputJson && Array.isArray(outputJson.sources)) {
        const newItems: CrawlerResultItem[] = outputJson.sources.map((s: any, idx: number) => ({
          id: `${platform}-${Date.now()}-${idx}`,
          platform,
          title: String(s.title || '无标题'),
          url: String(s.url || ''),
          snippet: String(s.snippet || s.desc || ''),
          crawledAt: new Date().toISOString(),
        }))
        this.results = [...newItems, ...this.results].slice(0, 100)
        plat.status = 'verified'
        this.appendLog(`抓取完成: 成功获取 ${newItems.length} 条内容`, 'success')
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      if (/login|auth|cookie|token|expired|未登录|登录失效/i.test(msg)) {
        plat.status = 'expired'
      }
      this.appendLog(`抓取失败: ${msg}`, 'error')
      throw err
    } finally {
      if (this.activeTaskId === taskId) {
        this.activeTaskId = undefined
        this.activePlatform = undefined
        this.activeOperation = undefined
        this.publish()
      }
    }
    return this.snapshot()
  }

  async cancel(platform?: string): Promise<PersonalCrawlersSnapshot> {
    if (this.activeTaskId === undefined || this.activePlatform === undefined) return this.snapshot()
    if (platform && this.activePlatform !== platform) return this.snapshot()

    const currentTaskId = this.activeTaskId
    const currentPlatform = this.activePlatform
    const currentChild = this.activeChild
    const currentAbort = this.activeAbort

    this.appendLog(`正在取消 ${currentPlatform} 任务...`, 'warning')
    if (currentAbort) {
      currentAbort.abort('canceled')
    }
    if (currentChild) {
      try {
        if (process.platform === 'win32' && typeof currentChild.pid === 'number' && currentChild.pid > 0) {
          try {
            execFileSync('taskkill', ['/pid', String(currentChild.pid), '/t', '/f'], { stdio: 'ignore' })
          } catch {}
        } else {
          currentChild.kill('SIGTERM')
        }
      } catch {}
    }

    if (this.activeTaskId === currentTaskId) {
      this.activeTaskId = undefined
      this.activePlatform = undefined
      this.activeOperation = undefined
      this.activeChild = undefined
      this.activeAbort = undefined
      this.publish()
    }
    return this.snapshot()
  }

  getResults(platform?: string): CrawlerResultItem[] {
    if (platform) {
      return this.results.filter(r => r.platform === platform)
    }
    return this.results
  }

  private async runProcess(request: Record<string, unknown>, taskId: number): Promise<any> {
    const pythonExe = this.options.pythonExecutable || 'D:/desktop/tools/crawler-runtime/Scripts/python.exe'
    const workerScript = this.options.worker || 'D:/desktop/tools/personal-crawlers/crawler.py'
    const abort = new AbortController()
    this.activeAbort = abort

    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !/KEY|TOKEN|SECRET|PASSWORD/i.test(k))
    )

    const timeoutMs = typeof request.timeoutMs === 'number'
      ? request.timeoutMs
      : (typeof this.options.timeoutMs === 'number' ? this.options.timeoutMs : 60000)

    const payload = JSON.stringify({
      pythonExecutable: pythonExe,
      mediaCrawlerDirectory: this.options.mediaCrawlerDirectory || 'D:/desktop/tools/MediaCrawler',
      dataDirectory: this.options.dataDirectory || 'D:/desktop/personal-data/crawlers',
      searchEngine: 'duckduckgo',
      timeoutMs,
      maxBodyChars: 50000,
      ...request,
    }) + '\n'

    return new Promise<any>((resolve, reject) => {
      const child = spawn(pythonExe, [workerScript], {
        env: { ...env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' },
        windowsHide: request.operation !== 'login',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.activeChild = child

      let timeoutTimer: NodeJS.Timeout | undefined
      if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
        timeoutTimer = setTimeout(() => {
          this.appendLog(`任务超时 (${timeoutMs}ms)，正在终止进程...`, 'error')
          abort.abort('timeout')
          if (typeof child.pid === 'number' && child.pid > 0) {
            try {
              if (process.platform === 'win32') {
                execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
              } else {
                child.kill('SIGKILL')
              }
            } catch {}
          }
        }, timeoutMs)
        timeoutTimer.unref()
      }

      let stdoutRaw = ''

      child.stdout.on('data', chunk => {
        stdoutRaw += chunk.toString('utf8')
      })

      const rlErr = createInterface({ input: child.stderr })
      rlErr.on('line', line => {
        const trimmed = line.trim()
        if (trimmed) {
          const level = this.parseLogLevel(trimmed)
          this.appendLog(trimmed, level)
        }
      })

      child.on('error', err => {
        if (timeoutTimer) clearTimeout(timeoutTimer)
        if (this.activeTaskId === taskId) {
          this.activeChild = undefined
          this.activeAbort = undefined
        }
        reject(err)
      })

      child.on('close', code => {
        if (timeoutTimer) clearTimeout(timeoutTimer)
        if (this.activeTaskId === taskId) {
          this.activeChild = undefined
          this.activeAbort = undefined
        }
        if (abort.signal.aborted) {
          const reason = abort.signal.reason
          reject(new Error(reason === 'timeout' ? `Crawler timed out after ${timeoutMs}ms` : 'Operation canceled'))
          return
        }
        let parsed: any = null
        try {
          const trimmed = stdoutRaw.trim()
          if (trimmed.startsWith('{')) {
            parsed = JSON.parse(trimmed)
          }
        } catch {}
        if (parsed?.error) {
          reject(new Error(`${parsed.error.code}: ${parsed.error.message}`))
          return
        }
        if (code !== 0 && code !== null) {
          reject(new Error(`Crawler process exited with code ${code}`))
          return
        }
        resolve(parsed)
      })

      child.stdin.on('error', () => {})
      try {
        child.stdin.end(payload)
      } catch (err) {
        if (timeoutTimer) clearTimeout(timeoutTimer)
        reject(err)
      }
    })
  }

  async dispose(): Promise<void> {
    await this.cancel()
    this.listeners.clear()
    this.logListeners.clear()
  }
}
