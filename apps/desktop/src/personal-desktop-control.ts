/**
 * Native Windows Desktop Automation service for Personal Desktop.
 * Interfaces with CursorTouch Windows-MCP server (stdio JSON-RPC),
 * manages serialized input queues (mutex), screenshot evidence, and emergency stop.
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import {
  getSharedDesktopControl,
  DesktopExecutionManager,
  type DesktopMcpTool,
} from '@deepseek-ai/dsh-computer-use-windows-mcp'

export interface PersonalDesktopControlSnapshot {
  connected: boolean
  serverVersion?: string | undefined
  toolCount: number
  tools: string[]
  activeTargetWindow?: string | undefined
  busy: boolean
  locked: boolean
  paused: boolean
  epoch: number
  lastScreenshotPath?: string | undefined
  lastScreenshotBase64?: string | undefined
  lastAction?: string | undefined
  lastError?: string | undefined
}

export interface DesktopControlOptions {
  executable?: string | undefined
  dataDirectory?: string | undefined
  timeoutMs?: number | undefined
  captureWindowScreenshot?: (() => Promise<Buffer | null>) | undefined
  executionManager?: DesktopExecutionManager | undefined
  /** Native MCP server arguments; tests may use an isolated protocol fixture. */
  args?: string[] | undefined
}

export interface DesktopToolCallResult {
  tool: string
  isError: boolean
  output: string
  imagePath?: string | undefined
  imageBase64?: string | undefined
  timestamp: string
}

export class PersonalDesktopControl {
  private readonly options: DesktopControlOptions
  private readonly listeners = new Set<(snapshot: PersonalDesktopControlSnapshot) => void>()
  private child?: ChildProcess | undefined
  private rpcId = 0
  private pendingRpc = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>()
  private connected = false
  private starting: Promise<PersonalDesktopControlSnapshot> | undefined
  private closing: Promise<void> | undefined
  private stopping: Promise<PersonalDesktopControlSnapshot> | undefined
  private childExit: Promise<void> | undefined
  private toolDefinitions: DesktopMcpTool[] = []
  private serverVersion = ''
  private toolNames: string[] = []
  private activeTargetWindow?: string | undefined
  private busy = false
  private locked = false
  private lastScreenshotPath?: string | undefined
  private lastScreenshotBase64?: string | undefined
  private lastAction?: string | undefined
  private lastError?: string | undefined
  private executionManager: DesktopExecutionManager
  constructor(options: DesktopControlOptions = {}) {
    const resolvedDataDir = options.dataDirectory || 'D:\\desktop\\personal-data'
    this.options = {
      executable: options.executable || 'C:\\Users\\mouwe\\.local\\bin\\windows-mcp.exe',
      dataDirectory: resolvedDataDir,
      timeoutMs: options.timeoutMs || 30000,
      captureWindowScreenshot: options.captureWindowScreenshot,
      executionManager: options.executionManager,
      args: options.args,
    }
    this.executionManager = options.executionManager
      ?? getSharedDesktopControl({ dataDirectory: resolvedDataDir, enableFileSignal: true })
  }

  getExecutionManager(): DesktopExecutionManager {
    return this.executionManager
  }

  snapshot(): PersonalDesktopControlSnapshot {
    return {
      connected: this.connected,
      serverVersion: this.serverVersion || undefined,
      toolCount: this.toolNames.length,
      tools: [...this.toolNames],
      activeTargetWindow: this.activeTargetWindow,
      busy: this.busy,
      locked: this.locked,
      paused: this.executionManager.isPaused(),
      epoch: this.executionManager.getEpoch(),
      lastScreenshotPath: this.lastScreenshotPath,
      lastScreenshotBase64: this.lastScreenshotBase64,
      lastAction: this.lastAction,
      lastError: this.lastError,
    }
  }

  subscribe(listener: (snapshot: PersonalDesktopControlSnapshot) => void): () => void {
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

  async start(): Promise<PersonalDesktopControlSnapshot> {
    if (this.starting !== undefined) return this.starting
    const epoch = this.executionManager.getEpoch()
    const starting = (async () => {
      await this.closing
      if (epoch !== this.executionManager.getEpoch()) throw new Error('Desktop connection start canceled')
      return this.startNative()
    })()
    this.starting = starting
    try { return await starting }
    finally { if (this.starting === starting) this.starting = undefined }
  }

  private async startNative(): Promise<PersonalDesktopControlSnapshot> {
    if (this.connected && this.child && !this.child.killed) {
      return this.snapshot()
    }
    const exe = this.options.executable!
    if (!existsSync(exe)) {
      this.lastError = `Windows-MCP executable not found at ${exe}`
      this.publish()
      throw new Error(this.lastError)
    }

    const env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|TOKEN|SECRET|PASSWORD/i.test(key))),
      ANONYMIZED_TELEMETRY: 'false',
      PYTHONUTF8: '1',
      PYTHONUNBUFFERED: '1',
    }

    const child = spawn(exe, this.options.args ?? ['serve', '--transport', 'stdio'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    this.childExit = new Promise(resolve => { child.once('close', () => { resolve() }) })
    child.stderr?.resume()
    child.stdin?.on('error', () => { /* Exit and RPC deadlines settle callers. */ })

    const rl = createInterface({ input: child.stdout! })
    rl.on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('{')) return
      try {
        const msg = JSON.parse(trimmed)
        if (msg.id !== undefined && this.pendingRpc.has(msg.id)) {
          const { resolve, reject } = this.pendingRpc.get(msg.id)!
          this.pendingRpc.delete(msg.id)
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
          else resolve(msg.result)
        }
      } catch {}
    })

    child.on('exit', () => {
      rl.close()
      if (this.child !== child) return
      this.connected = false
      this.child = undefined
      for (const [, { reject }] of this.pendingRpc) {
        reject(new Error('Windows-MCP process exited'))
      }
      this.pendingRpc.clear()
      this.publish()
    })

    child.on('error', (err) => {
      this.lastError = err.message
      this.publish()
    })

    try {
      // 1. Initialize
      const initResult = await this.sendRpc('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'personal-desktop', version: '1.0.0' },
      })
      this.serverVersion = initResult?.serverInfo?.version ?? ''

      // 2. Initialized notification
      child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n')

      // 3. List tools
      const toolsResult = await this.sendRpc('tools/list', {})
      if (Array.isArray(toolsResult?.tools)) {
        this.toolDefinitions = toolsResult.tools.filter((tool: unknown): tool is DesktopMcpTool =>
          typeof tool === 'object' && tool !== null && 'name' in tool && typeof tool.name === 'string'
          && 'inputSchema' in tool && typeof tool.inputSchema === 'object' && tool.inputSchema !== null)
        this.toolNames = this.toolDefinitions.map(tool => tool.name)
      }
      this.connected = true
      this.lastError = undefined
      this.publish()
    } catch (err: any) {
      this.connected = false
      this.lastError = err?.message || String(err)
      this.publish()
      await this.closeConnection()
      throw err
    }

    return this.snapshot()
  }

  private sendRpc(method: string, params: unknown = {}, timeoutMs = 15000, signal?: AbortSignal): Promise<any> {
    if (signal?.aborted) return Promise.reject(new Error('Desktop request aborted'))
    if (!this.child || this.child.killed || !this.child.stdin) {
      return Promise.reject(new Error('Windows-MCP child is not running'))
    }
    const id = ++this.rpcId
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        this.child?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id } }) + '\n')
        this.pendingRpc.get(id)?.reject(new Error('Desktop request aborted'))
        this.pendingRpc.delete(id)
      }
      const timer = setTimeout(() => {
        if (this.pendingRpc.has(id)) {
          this.pendingRpc.delete(id)
          signal?.removeEventListener('abort', onAbort)
          reject(new Error(`Windows-MCP RPC ${method} timed out`))
        }
      }, timeoutMs)
      this.pendingRpc.set(id, {
        resolve: (val) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(val) },
        reject: (err) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(err) },
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      this.child!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      if (signal?.aborted) onAbort()
    })
  }

  /** Return the native catalog for the Host's canonical MCP projection. */
  async listMcpTools(): Promise<{ tools: DesktopMcpTool[] }> {
    await this.start()
    return { tools: this.toolDefinitions }
  }

  /** Execute a Host call on the same FIFO used by the application UI. */
  async callMcpTool(name: string, args: Record<string, unknown>, signal: AbortSignal, epoch: number): Promise<unknown> {
    if (epoch !== this.executionManager.getEpoch()) throw new Error('Desktop request belongs to an outdated generation')
    return this.executionManager.runExclusive(async (ownedSignal) => {
      if (!this.connected) await this.start()
      if (ownedSignal.aborted) throw new Error('Desktop request aborted')
      if (!this.toolNames.includes(name)) throw new Error('Unknown Windows-MCP tool')
      this.busy = true
      this.locked = true
      this.lastAction = name
      this.publish()
      try {
        return await this.sendRpc('tools/call', { name, arguments: args }, this.options.timeoutMs, ownedSignal)
      } catch (error) {
        // Cancellation must close the native reader before the next FIFO action starts.
        await this.closeConnection()
        throw error
      } finally {
        this.busy = false
        this.locked = false
        this.publish()
      }
    }, signal)
  }

  /** Execute one UI operation through the shell-owned FIFO. */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<DesktopToolCallResult> {
    return this.executionManager.runExclusive(async (signal) => {
      if (!this.connected) await this.start()
      if (signal.aborted) throw new Error('Desktop request aborted')
      return this.executeToolInternal(name, args, signal)
    })
  }

  async executeTool(name: string, args: Record<string, unknown> = {}): Promise<DesktopToolCallResult> {
    return this.callTool(name, args)
  }

  private async executeToolInternal(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<DesktopToolCallResult> {
    const resolvedName = (name === 'TakeScreenshot' || name === 'screenshot')
      ? 'Screenshot'
      : (name === 'snapshot' ? 'Snapshot' : name)
    this.busy = true
    this.locked = true
    this.lastAction = resolvedName
    this.publish()

    const evidenceDir = join(this.options.dataDirectory!, 'evidence', 'screenshots')
    try { mkdirSync(evidenceDir, { recursive: true }) } catch {}

    try {
      const res = await this.sendRpc('tools/call', { name: resolvedName, arguments: args }, this.options.timeoutMs, signal)
      if (signal?.aborted) throw new Error('Desktop request aborted')
      let outputText = ''
      let imagePath: string | undefined
      let imageBase64: string | undefined

      if (Array.isArray(res?.content)) {
        for (const item of res.content) {
          if (item.type === 'text') {
            outputText += (outputText ? '\n' : '') + String(item.text ?? '')
          } else if (item.type === 'image') {
            imageBase64 = String(item.data ?? '')
            const filename = `screenshot-${Date.now()}.png`
            const fullPath = join(evidenceDir, filename)
            try {
              writeFileSync(fullPath, Buffer.from(imageBase64, 'base64'))
              imagePath = fullPath
              this.lastScreenshotPath = fullPath
              this.lastScreenshotBase64 = imageBase64
            } catch {}
          }
        }
      }

      // Detect FastMCP tool exception text or protocol errors
      const hasErrorInText = /^\s*\[?"?(?:Error|Exception|Failed|Windows graphics function failed)/i.test(outputText)
        || outputText.includes('BitBlt: 拒绝访问')
        || outputText.includes('validation error')
      let isError = Boolean(res?.isError) || hasErrorInText

      // Fallback: If screenshot failed via GDI or returned no image, try host window compositor capture
      if (resolvedName === 'Screenshot' && (!imagePath || isError)) {
        if (typeof this.options.captureWindowScreenshot === 'function') {
          try {
            const buf = await this.options.captureWindowScreenshot()
            if (buf && buf.length > 0) {
              const filename = `window-screenshot-${Date.now()}.png`
              const fullPath = join(evidenceDir, filename)
              writeFileSync(fullPath, buf)
              imagePath = fullPath
              imageBase64 = buf.toString('base64')
              this.lastScreenshotPath = fullPath
              this.lastScreenshotBase64 = imageBase64
              const requestedHostWindowExplicitly = args.target === 'host-window' || args.scope === 'host-window'
              if (requestedHostWindowExplicitly) {
                isError = false
                outputText = `Window screenshot captured via host window compositor (${buf.length} bytes)`
              } else {
                isError = true
                outputText = `Desktop capture failed: Windows graphics function failed. Host window capture saved as fallback to ${filename} (scope: host-window only, not desktop)`
              }
            }
          } catch {}
        }
      }

      // Update target window if present in args or text
      if (typeof args.name === 'string') {
        this.activeTargetWindow = args.name
      } else if (typeof args.window_name === 'string') {
        this.activeTargetWindow = args.window_name
      }

      this.lastError = isError ? outputText : undefined
      const result: DesktopToolCallResult = {
        tool: name,
        isError,
        output: outputText,
        imagePath,
        imageBase64,
        timestamp: new Date().toISOString(),
      }
      return result
    } catch (err: any) {
      await this.closeConnection()
      if (signal?.aborted) throw new Error('Desktop request aborted')
      this.lastError = err?.message || String(err)
      return {
        tool: name,
        isError: true,
        output: this.lastError!,
        timestamp: new Date().toISOString(),
      }
    } finally {
      this.busy = false
      this.locked = false
      this.publish()
    }
  }

  private closeConnection(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    const child = this.child
    if (child === undefined) return Promise.resolve()
    const exited = this.childExit ?? Promise.resolve()
    const closing = (async () => {
      if (child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32' && child.pid !== undefined) {
          await new Promise<void>((resolve) => {
            execFile('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, timeout: 5000 }, () => {
              if (child.exitCode === null && child.signalCode === null) child.kill()
              resolve()
            })
          })
        } else child.kill('SIGTERM')
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([exited, new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Windows-MCP process did not stop')) }, 5000)
        })])
      } finally { if (timer !== undefined) clearTimeout(timer) }
      if (this.child === child) { this.child = undefined; this.connected = false }
    })()
    this.closing = closing
    void closing.finally(() => { if (this.closing === closing) this.closing = undefined }).catch(() => {})
    return closing
  }

  /** Stop active work and settle its native process before reporting completion. */
  stop(): Promise<PersonalDesktopControlSnapshot> {
    if (this.stopping !== undefined) return this.stopping
    this.executionManager.stop()
    this.lastAction = 'EMERGENCY_STOP'
    this.lastError = 'Automated desktop input stopped by user takeover'
    this.publish()
    const stopping = (async () => {
      await this.closeConnection()
      await this.starting?.catch(() => undefined)
      await this.executionManager.whenIdle()
      this.connected = false
      this.busy = false
      this.locked = false
      this.publish()
      return this.snapshot()
    })()
    this.stopping = stopping
    void stopping.finally(() => { if (this.stopping === stopping) this.stopping = undefined }).catch(() => {})
    return stopping
  }

  /** Resume only new work after the preceding stop has reached quiescence. */
  async resume(): Promise<PersonalDesktopControlSnapshot> {
    await this.stopping
    await this.closing
    this.executionManager.resume()
    this.lastAction = 'RESUME'
    this.lastError = undefined
    this.publish()
    return this.snapshot()
  }

  async dispose(): Promise<void> {
    this.listeners.clear()
    await this.stop()
  }
}
