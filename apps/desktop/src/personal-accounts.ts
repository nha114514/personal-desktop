import { execFileSync, spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { createInterface } from 'node:readline'
import type * as NodePty from 'node-pty'
import type {
  PersonalAccountFailure, PersonalAccountId, PersonalAccountState, PersonalAccountsSnapshot,
} from '@deepseek-ai/dsh-client-ui-personal-accounts/types'
import { prepareAntigravityAccount } from './personal-antigravity.ts'

const nodeRequire = createRequire(import.meta.url)

let cachedPty: typeof NodePty | undefined
function getPty(custom?: typeof NodePty): typeof NodePty {
  if (custom !== undefined) return custom
  if (cachedPty !== undefined) return cachedPty
  try {
    cachedPty = nodeRequire('node-pty') as typeof NodePty
    return cachedPty
  } catch {
    try {
      cachedPty = nodeRequire('@deepseek-ai/dsh-subprocess-local/node_modules/node-pty') as typeof NodePty
      return cachedPty
    } catch {
      throw new Error('Terminal process support (node-pty) is unavailable')
    }
  }
}

export interface PersonalAccountsOptions {
  node?: string | undefined
  launcher?: string | undefined
  entry?: string | undefined
  dataDirectory?: string | undefined
  antigravityExecutable?: string | undefined
  codexExecutable?: string | undefined
  codexHome?: string | undefined
  codexModel?: string | undefined
  resolveCodexSelection?: (() => { model: string; reasoningEffort?: string } | undefined) | undefined
  openAuthorization?: ((url: string) => Promise<void>) | undefined
  timeoutMs?: number
  pty?: typeof NodePty | undefined
}

function resolveCodexExecutablePath(custom?: string): string | undefined {
  if (custom && existsSync(custom)) return custom
  if (process.env.DSH_PERSONAL_CODEX_EXECUTABLE && existsSync(process.env.DSH_PERSONAL_CODEX_EXECUTABLE)) {
    return process.env.DSH_PERSONAL_CODEX_EXECUTABLE
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const baseDir = join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
    if (existsSync(baseDir)) {
      try {
        const dirs = readdirSync(baseDir)
        for (const dir of dirs.reverse()) {
          const candidate = join(baseDir, dir, 'codex.exe')
          if (existsSync(candidate)) return candidate
        }
      } catch {}
    }
  }
  return undefined
}

function accountId(value: unknown): PersonalAccountId {
  if (value !== '2' && value !== 'codex') throw new Error('Personal account must be 2 or codex')
  return value
}

function stripAnsi(text: string): string {
  return text
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)?/g, '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

/** Classify known public service errors without forwarding subprocess diagnostics. */
function failureOf(output: string): PersonalAccountFailure | undefined {
  if (/UNSUPPORTED_CLIENT|client is no longer supported/i.test(output)) return 'unsupported-client'
  if (/QUOTA_EXCEEDED|RESOURCE_EXHAUSTED|usage limit|quota exceeded|exhausted your capacity/i.test(output)) return 'quota-exceeded'
  if (/UNAUTHENTICATED|authentication required|Failed to sign in|unauthorized/i.test(output)) return 'authentication-required'
  return undefined
}

interface ActiveJob {
  abort: AbortController
  done: Promise<void>
  authorizationUrl?: string
  submitCode?: (code: string) => void
  reopenAuthorization?: () => void
  kill?: () => void
}

/** One controller owns launch, timeout, cancellation, and final status for each slot. */
export class PersonalAccounts {
  private current: PersonalAccountsSnapshot = { accounts: [{ id: '2', phase: 'idle' }, { id: 'codex', phase: 'idle' }] }
  private readonly listeners = new Set<(snapshot: PersonalAccountsSnapshot) => void>()
  private readonly jobs = new Map<PersonalAccountId, ActiveJob>()

  private readonly options: PersonalAccountsOptions

  constructor(options: PersonalAccountsOptions) {
    this.options = options
    this.current = { accounts: [this.savedAccount('2'), this.savedAccount('codex')] }
  }

  get resolvedCodexHome(): string {
    if (this.options.codexHome) return this.options.codexHome
    const directory = this.options.dataDirectory
    if (directory !== undefined) {
      const dataCodex = join(directory, 'codex')
      if (existsSync(join(dataCodex, 'auth.json'))) {
        return dataCodex
      }
    }
    if (process.env.CODEX_HOME) return process.env.CODEX_HOME
    if (this.options.dataDirectory !== undefined) {
      return join(this.options.dataDirectory, 'codex')
    }
    return join(homedir(), '.codex')
  }

  /** Restore saved-login availability without reading credentials or claiming a fresh request. */
  private savedAccount(id: PersonalAccountId): PersonalAccountState {
    const directory = this.options.dataDirectory
    if (id === 'codex') {
      const codexHome = this.resolvedCodexHome
      let hasAuth = false
      try {
        const credential = lstatSync(join(codexHome, 'auth.json'))
        if (credential.isFile() && credential.size > 0) hasAuth = true
      } catch (_error) {
        return { id, phase: 'idle' }
      }
      if (!hasAuth) return { id, phase: 'idle' }
      try {
        const recordPath = join(codexHome, 'personal-verification.json')
        const recordFallback = directory !== undefined ? join(directory, 'codex', 'personal-verification.json') : recordPath
        const effectivePath = existsSync(recordPath) ? recordPath : recordFallback
        const record: unknown = JSON.parse(readFileSync(effectivePath, 'utf8'))
        if (typeof record === 'object' && record !== null && 'checkedAt' in record
          && typeof record.checkedAt === 'string' && Number.isFinite(Date.parse(record.checkedAt))) {
          const verifiedModel = typeof (record as any).verifiedModel === 'string' ? (record as any).verifiedModel : undefined
          return { id, phase: 'saved', checkedAt: record.checkedAt, ...(verifiedModel ? { verifiedModel } : {}) }
        }
      } catch (_error) {}
      return { id, phase: 'saved' }
    }
    if (directory === undefined || !isAbsolute(directory)) return { id, phase: 'idle' }
    const home = join(directory, 'antigravity', `account-${id}`)
    try {
      const credential = lstatSync(join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'))
      if (!credential.isFile() || credential.size === 0) return { id, phase: 'idle' }
    } catch (_error) {
      // A missing or unreadable credential file cannot establish saved-login availability.
      return { id, phase: 'idle' }
    }
    try {
      const record: unknown = JSON.parse(readFileSync(join(home, 'personal-verification.json'), 'utf8'))
      if (typeof record === 'object' && record !== null && 'checkedAt' in record
        && typeof record.checkedAt === 'string' && Number.isFinite(Date.parse(record.checkedAt))) {
        const verifiedModel = typeof (record as any).verifiedModel === 'string' ? (record as any).verifiedModel : undefined
        return { id, phase: 'saved', checkedAt: record.checkedAt, ...(verifiedModel ? { verifiedModel } : {}) }
      }
    } catch (_error) {
      // Optional verification history does not determine whether the CLI can reuse its login.
    }
    return { id, phase: 'saved' }
  }

  /** Check whether valid saved credentials exist on disk. */
  hasSavedCredentials(id: PersonalAccountId): boolean {
    const saved = this.savedAccount(id)
    return saved.phase === 'saved' || saved.phase === 'verified'
  }

  /** Persist only the time of a successful native request; the official CLI owns its tokens. */
  private rememberVerification(id: PersonalAccountId, checkedAt: string, verifiedModel?: string): void {
    const directory = this.options.dataDirectory
    try {
      const home = id === 'codex' ? this.resolvedCodexHome : (directory !== undefined ? join(directory, 'antigravity', `account-${id}`) : undefined)
      if (home === undefined) return
      mkdirSync(home, { recursive: true, mode: 0o700 })
      const record = { checkedAt, ...(verifiedModel ? { verifiedModel } : {}) }
      writeFileSync(join(home, 'personal-verification.json'), JSON.stringify(record) + '\n', { mode: 0o600 })
    } catch (_error) {
      // Failure to save optional history must not turn a successful account request into a login failure.
    }
  }

  snapshot(): PersonalAccountsSnapshot { return this.current }

  subscribe(listener: (snapshot: PersonalAccountsSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(account: PersonalAccountState): void {
    this.current = { accounts: this.current.accounts.map(previous => previous.id === account.id ? account : previous) }
    for (const listener of this.listeners) listener(this.current)
  }

  /** Start a fixed, keyless request. The official CLI opens and owns its OAuth callback. */
  login(value: unknown, options?: unknown): PersonalAccountsSnapshot {
    let id: PersonalAccountId
    let requestedModel: string | undefined
    if (typeof options === 'object' && options !== null && 'model' in options) {
      if (typeof options.model !== 'string' || !options.model.trim()) throw new Error('Verification model must be a nonempty string')
      requestedModel = options.model.trim()
    }
    if (typeof value === 'object' && value !== null && 'id' in value) {
      id = accountId(value.id)
      if ('model' in value) {
        if (typeof value.model !== 'string' || !value.model.trim()) throw new Error('Verification model must be a nonempty string')
        requestedModel = value.model.trim()
      }
    } else {
      id = accountId(value)
    }
    if (this.jobs.has(id)) return this.current
    if (id === 'codex') return this.loginCodex(id, requestedModel)
    const { node, launcher, entry, dataDirectory, antigravityExecutable } = this.options
    const available = antigravityExecutable !== undefined
      ? isAbsolute(antigravityExecutable) && existsSync(antigravityExecutable) && dataDirectory !== undefined && isAbsolute(dataDirectory)
      : node !== undefined && launcher !== undefined && entry !== undefined && dataDirectory !== undefined
        && [node, launcher, entry, dataDirectory].every(isAbsolute) && [node, launcher, entry].every(existsSync)
    if (!available || dataDirectory === undefined) {
      this.publish({ id, phase: 'error', failure: 'cli-unavailable' })
      return this.current
    }
    const abort = new AbortController()
    const done = Promise.withResolvers<void>()
    let authorizationUrl: string | undefined
    let killProcess = (): void => {}
    const job: ActiveJob = { abort, done: done.promise }
    this.jobs.set(id, job)
    this.publish({ id, phase: 'signing-in' })
    let failure: PersonalAccountFailure | undefined
    let successfulResult = false
    let response = ''
    let line = ''
    let errorTail = ''
    let browserConsentSent = false
    let authorizationOpened = false
    let codePromptSeen = false
    const timer = setTimeout(() => {
      abort.abort('timeout')
      killProcess()
    }, this.options.timeoutMs ?? 10 * 60_000)
    timer.unref()
    let finished = false
    const finish = (code: number | null): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      abort.signal.removeEventListener('abort', killProcess)
      this.jobs.delete(id)
      killProcess()
      if (abort.signal.aborted) failure = abort.signal.reason === 'timeout' ? 'timeout' : 'canceled'
      if (failure === 'authentication-required' && code === 0 && successfulResult && response.trim() === 'OK') failure = undefined
      if (failure === undefined && code === 0 && successfulResult && response.trim() === 'OK') {
        const checkedAt = new Date().toISOString()
        this.rememberVerification(id, checkedAt)
        this.publish({ id, phase: 'verified', checkedAt })
      } else {
        const hasSaved = this.hasSavedCredentials(id)
        if (hasSaved && failure !== 'authentication-required') {
          this.publish({ id, phase: 'saved', failure: failure ?? 'request-failed' })
        } else {
          this.publish({ id, phase: failure === 'canceled' ? (hasSaved ? 'saved' : 'idle') : 'error', failure: failure ?? 'request-failed' })
        }
      }
      done.resolve()
    }
    try {
      const prompt = 'Reply exactly OK. Do not use any tools.'
      let spec: { executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }
      if (antigravityExecutable !== undefined) {
        spec = { executable: antigravityExecutable, args: ['--model', 'gemini-3.8-flash', '--effort', 'low', '--disable-slash-commands', '--print', prompt, '--output-format', 'stream-json'], ...prepareAntigravityAccount(antigravityExecutable, dataDirectory, id, process.env) }
      } else {
        if (node === undefined || launcher === undefined || entry === undefined) throw new Error('Official CLI is unavailable')
        spec = { executable: node, args: [launcher, '--account', id, '--', '--prompt', prompt, '--output-format', 'stream-json'], cwd: join(dataDirectory, 'gemini', `account-${id}`), env: { ...process.env, DSH_PERSONAL_DATA_DIRECTORY: dataDirectory, DSH_PERSONAL_GEMINI_CLI_ENTRY: entry } }
      }
      mkdirSync(spec.cwd, { recursive: true })
      const pty = getPty(this.options.pty)
      const cleanEnv: Record<string, string> = {}
      for (const [key, val] of Object.entries(spec.env)) {
        if (val !== undefined) cleanEnv[key] = val
      }
      const term = pty.spawn(spec.executable, spec.args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: spec.cwd,
        env: cleanEnv,
      })
      killProcess = () => {
        try {
          term.kill()
        } catch {}
        try {
          if (typeof term.pid === 'number' && term.pid > 0 && term.pid !== process.pid) {
            if (process.platform === 'win32') {
              try {
                execFileSync('taskkill', ['/pid', String(term.pid), '/t', '/f'], { stdio: 'ignore' })
              } catch {}
            } else {
              try {
                process.kill(term.pid, 'SIGKILL')
              } catch {}
            }
          }
        } catch { /* ignore if already dead */ }
      }
      job.kill = killProcess
      abort.signal.addEventListener('abort', () => {
        killProcess()
        finish(null)
      }, { once: true })

      job.submitCode = (code) => {
        line = ''
        term.write(`${code}${process.platform === 'win32' ? '\r\n' : '\n'}`)
        this.publish({ id, phase: 'verifying' })
      }
      job.reopenAuthorization = () => {
        if (authorizationUrl !== undefined && this.options.openAuthorization !== undefined && !abort.signal.aborted) {
          void this.options.openAuthorization(authorizationUrl).catch(() => {})
        }
      }

      const processLine = (raw: string): void => {
        const clean = stripAnsi(raw).replace(/\r/g, '').trim()
        if (!clean) return
        const first = clean.indexOf('{')
        const last = clean.lastIndexOf('}')
        if (first !== -1 && last > first) {
          try {
            const event = JSON.parse(clean.slice(first, last + 1)) as {
              type?: string
              role?: string
              content?: string
              status?: string
              event?: string
              result?: { status?: string; response?: string }
              step_update?: { step_type?: string; text_delta?: string }
            }
            if (event.type === 'message' && event.role === 'assistant' && typeof event.content === 'string') response = (response + event.content).slice(0, 128)
            if (event.type === 'result') successfulResult = event.status === 'success'
            if (event.event === 'result') {
              if (event.result?.status?.toLowerCase() === 'success') successfulResult = true
              if (typeof event.result?.response === 'string') response = event.result.response.trim().slice(0, 128)
            }
            if (event.event === 'step_update' && event.step_update?.step_type === 'agent_response' && typeof event.step_update.text_delta === 'string') {
              response = (response + event.step_update.text_delta).slice(0, 128)
            }
          } catch { /* Native progress output is not a JSON event. */ }
        }
      }

      const classify = (text: string): void => {
        errorTail = (errorTail + text).slice(-4096)
        const cleanTail = stripAnsi(errorTail)
        const found = failureOf(cleanTail)
        if (found !== undefined && (failure === undefined || found === 'unsupported-client')) failure = found
        // Clicking login authorizes opening Google's OAuth page, not other CLI confirmations.
        if (!browserConsentSent && !abort.signal.aborted
          && /Opening authentication page in your browser\.\s*Do you want to continue\? \[Y\/n\]:/.test(cleanTail)) {
          browserConsentSent = true
          term.write(process.platform === 'win32' ? 'y\r\n' : 'y\n')
        }
        if (!authorizationOpened && !abort.signal.aborted) {
          const address = cleanTail.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/[^\s"<>\x1b]+(?=[\x1b\s]|$)/)?.[0]
          if (address !== undefined) {
            try {
              const url = new URL(address)
              if (url.origin === 'https://accounts.google.com' && (url.pathname === '/o/oauth2/v2/auth' || url.pathname === '/o/oauth2/auth')) {
                authorizationOpened = true
                authorizationUrl = url.href
                job.authorizationUrl = url.href
                if (this.options.openAuthorization !== undefined) {
                  void this.options.openAuthorization(url.href).catch(() => { if (!abort.signal.aborted) failure ??= 'request-failed' })
                }
              }
            } catch { /* ignore invalid url */ }
          }
        }
        if (!codePromptSeen && /paste the authorization code here and press Enter:/i.test(cleanTail) && !abort.signal.aborted) {
          codePromptSeen = true
          this.publish({ id, phase: 'awaiting-code' })
        }
      }

      term.onData((text: string) => {
        classify(text)
        for (const character of text) {
          if (character !== '\n') {
            if (line.length < 65_536) line += character
            continue
          }
          processLine(line)
          line = ''
        }
      })

      term.onExit(({ exitCode }) => {
        if (line.trim().length > 0) {
          processLine(line)
          line = ''
        }
        finish(exitCode)
      })
    } catch {
      failure = 'request-failed'
      finish(null)
    }
    return this.current
  }

  private loginCodex(id: PersonalAccountId, requestedModel?: string): PersonalAccountsSnapshot {
    const selection = this.options.resolveCodexSelection?.()
    const model = requestedModel ?? selection?.model ?? this.options.codexModel
    if (!model?.trim()) {
      this.publish({ ...this.savedAccount(id), failure: 'model-not-selected' })
      return this.current
    }
    const codexExe = resolveCodexExecutablePath(this.options.codexExecutable)
    if (codexExe === undefined) {
      this.publish({ id, phase: 'error', failure: 'cli-unavailable' })
      return this.current
    }
    const abort = new AbortController()
    const done = Promise.withResolvers<void>()
    let killProcess = (): void => {}
    const job: ActiveJob = { abort, done: done.promise }
    this.jobs.set(id, job)

    const isSavedReverify = this.hasSavedCredentials(id)

    this.publish({ id, phase: isSavedReverify ? 'verifying' : 'signing-in' })

    const isJs = codexExe.endsWith('.js') || codexExe.endsWith('.mjs')
    const child = spawn(
      isJs ? (this.options.node ?? process.execPath) : codexExe,
      isJs ? [codexExe, 'app-server', '--stdio'] : ['app-server', '--stdio'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          CODEX_HOME: this.resolvedCodexHome,
        },
      },
    )
    child.stdin?.on('error', () => {})

    killProcess = () => {
      try {
        child.kill()
      } catch {}
    }
    job.kill = killProcess
    abort.signal.addEventListener('abort', () => {
      killProcess()
      finish(null, false)
    }, { once: true })

    const timer = setTimeout(() => {
      abort.abort('timeout')
      killProcess()
    }, this.options.timeoutMs ?? 10 * 60_000)
    timer.unref()

    let finished = false
    let failure: PersonalAccountFailure | undefined
    let hasModelReply = false

    const finish = (_code: number | null, success = false): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      abort.signal.removeEventListener('abort', killProcess)
      this.jobs.delete(id)
      killProcess()
      if (abort.signal.aborted) failure = abort.signal.reason === 'timeout' ? 'timeout' : 'canceled'
      if (failure === undefined && success) {
        const checkedAt = new Date().toISOString()
        this.rememberVerification(id, checkedAt, model)
        this.publish({ id, phase: 'verified', checkedAt, verifiedModel: model })
      } else {
        const previous = this.current.accounts.find(account => account.id === id)
        const hasSaved = this.hasSavedCredentials(id)
        if (hasSaved && failure !== 'authentication-required') {
          this.publish({
            id,
            phase: 'saved',
            failure: failure ?? 'request-failed',
            ...(previous?.checkedAt ? { checkedAt: previous.checkedAt } : {}),
            ...(previous?.verifiedModel ? { verifiedModel: previous.verifiedModel } : {}),
          })
        } else {
          this.publish({
            id,
            phase: failure === 'canceled' ? (hasSaved ? 'saved' : 'idle') : 'error',
            failure: failure ?? 'request-failed',
            ...(previous?.checkedAt ? { checkedAt: previous.checkedAt } : {}),
            ...(previous?.verifiedModel ? { verifiedModel: previous.verifiedModel } : {}),
          })
        }
      }
      done.resolve()
    }

    let nextRpcId = 1
    const pendingRpc = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>()
    let resolveTurnCompleted: ((ok: boolean) => void) | undefined
    const turnCompletedPromise = new Promise<boolean>((resolve) => {
      resolveTurnCompleted = resolve
    })

    const sendRpc = (method: string, params: unknown = {}, timeoutMs = 15000): Promise<any> => {
      const rpcId = nextRpcId++
      return new Promise((resolve, reject) => {
        const rpcTimer = setTimeout(() => {
          if (pendingRpc.has(rpcId)) {
            pendingRpc.delete(rpcId)
            reject(new Error(`Codex RPC ${method} timed out`))
          }
        }, timeoutMs)
        pendingRpc.set(rpcId, {
          resolve: (val) => { clearTimeout(rpcTimer); resolve(val) },
          reject: (err) => { clearTimeout(rpcTimer); reject(err) },
        })
        try {
          child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params }) + '\n')
        } catch (err) {
          clearTimeout(rpcTimer)
          pendingRpc.delete(rpcId)
          reject(err)
        }
      })
    }

    job.reopenAuthorization = () => {
      if (job.authorizationUrl && this.options.openAuthorization && !abort.signal.aborted) {
        void this.options.openAuthorization(job.authorizationUrl).catch(() => {})
      }
    }

    const verifyStatusAndFinish = async () => {
      try {
        const accountRes = await sendRpc('account/read', {})
        if (accountRes?.account?.type !== 'chatgpt') {
          failure = 'authentication-required'
          finish(null, false)
          return
        }

        const rateLimitsRes = await sendRpc('account/rateLimits/read', {})
        if (rateLimitsRes?.ordinaryUsageAllowed === false || rateLimitsRes?.rateLimits?.rateLimitReachedType != null) {
          failure = 'quota-exceeded'
          finish(null, false)
          return
        }

        const threadRes = await sendRpc('thread/start', {
          cwd: this.options.dataDirectory ?? process.cwd(),
          ephemeral: true,
          config: { web_search: 'disabled' },
          model,
        })
        const threadId = threadRes?.thread?.id
        if (!threadId) {
          failure = 'request-failed'
          finish(null, false)
          return
        }

        const turnRes = await sendRpc('turn/start', {
          threadId,
          model,
          ...(selection?.reasoningEffort === undefined ? {} : { effort: selection.reasoningEffort }),
          input: [{ type: 'text', text: 'Reply only OK.', text_elements: [] }],
        })
        const turnId = turnRes?.turn?.id
        if (!turnId) {
          failure = 'request-failed'
          finish(null, false)
          return
        }

        if (turnRes?.turn?.status === 'completed') {
          finish(0, hasModelReply)
          return
        }

        const turnDone = await turnCompletedPromise
        if (turnDone && hasModelReply) {
          finish(0, true)
        } else {
          failure = 'request-failed'
          finish(null, false)
        }
      } catch (err: any) {
        const msg = err?.message ?? String(err)
        if (/quota|usage limit|resource_exhausted/i.test(msg)) {
          failure = 'quota-exceeded'
        } else if (/unauthorized|unauthenticated|login required|authentication required/i.test(msg)) {
          failure = 'authentication-required'
        } else {
          failure = 'request-failed'
        }
        finish(null, false)
      }
    }

    const rl = createInterface({ input: child.stdout! })
    rl.on('line', (line) => {
      try {
        if (!line.trim().startsWith('{')) return
        const msg = JSON.parse(line.trim())
        if (msg.method === 'item/agentMessage/delta' && typeof msg.params?.delta === 'string' && msg.params.delta.trim()) {
          hasModelReply = true
        }
        if (msg.method === 'item/completed' && msg.params?.item?.type === 'agentMessage'
          && typeof msg.params.item.text === 'string' && msg.params.item.text.trim()) hasModelReply = true
        if (msg.id !== undefined && msg.id !== null && pendingRpc.has(msg.id)) {
          const { resolve, reject } = pendingRpc.get(msg.id)!
          pendingRpc.delete(msg.id)
          if (msg.error) reject(msg.error)
          else resolve(msg.result)
          return
        }
        if (msg.method === 'account/login/completed') {
          if (msg.params?.success) {
            this.publish({ id, phase: 'verifying' })
            void verifyStatusAndFinish()
          } else {
            failure = 'request-failed'
            finish(null, false)
          }
        }
        if (msg.method === 'turn/completed') {
          const status = msg.params?.turn?.status
          if (status === 'completed') {
            resolveTurnCompleted?.(true)
          } else {
            if (msg.params?.turn?.error?.code === 'quota_exceeded' || /quota|usage limit/i.test(msg.params?.turn?.error?.message ?? '')) {
              failure = 'quota-exceeded'
            } else {
              failure = 'request-failed'
            }
            resolveTurnCompleted?.(false)
          }
        }
      } catch {}
    })

    child.on('exit', (code) => {
      finish(code, false)
    })

    ;(async () => {
      try {
        await sendRpc('initialize', {
          clientInfo: { name: 'deepseek-harness', version: '0.0.1' },
          capabilities: {},
        })

        if (isSavedReverify) {
          await verifyStatusAndFinish()
        } else {
          const loginRes = await sendRpc('account/login/start', { type: 'chatgpt' })
          if (loginRes?.type === 'chatgpt' && loginRes.authUrl) {
            job.authorizationUrl = loginRes.authUrl
            this.publish({ id, phase: 'signing-in' })
            if (this.options.openAuthorization) {
              void this.options.openAuthorization(loginRes.authUrl).catch(() => {})
            }
          } else if (loginRes?.type === 'chatgptDeviceCode' && loginRes.verificationUrl) {
            job.authorizationUrl = loginRes.verificationUrl
            this.publish({ id, phase: 'awaiting-code' })
            if (this.options.openAuthorization) {
              void this.options.openAuthorization(loginRes.verificationUrl).catch(() => {})
            }
          } else {
            failure = 'request-failed'
            finish(null, false)
          }
        }
      } catch {
        failure = 'request-failed'
        finish(null, false)
      }
    })()

    return this.current
  }

  /** Stop only the login process belonging to the selected account. */
  cancel(value: unknown): PersonalAccountsSnapshot {
    const id = accountId(value)
    const job = this.jobs.get(id)
    if (job !== undefined) {
      job.abort.abort('canceled')
      job.kill?.()
    }
    return this.current
  }

  /** Reopen the official OAuth authorization page for the active pending flow. */
  reopenAuthorization(value: unknown): PersonalAccountsSnapshot {
    const id = accountId(value)
    const job = this.jobs.get(id)
    const account = this.current.accounts.find(entry => entry.id === id)
    if (job?.authorizationUrl === undefined || job.abort.signal.aborted || (account?.phase !== 'awaiting-code' && account?.phase !== 'signing-in')) {
      throw new Error('This account has no active authorization page')
    }
    job.reopenAuthorization?.()
    return this.current
  }

  /** Send a one-time OAuth code directly to the selected pending CLI, never to a model. */
  submitCode(value: unknown, code: unknown): PersonalAccountsSnapshot {
    const id = accountId(value)
    const job = this.jobs.get(id)
    if (job?.submitCode === undefined || job.abort.signal.aborted || this.current.accounts.find(account => account.id === id)?.phase !== 'awaiting-code') {
      throw new Error('This account is not waiting for an authorization code')
    }
    if (typeof code !== 'string' || !/^[A-Za-z0-9_./+=-]{1,4096}$/.test(code.trim())) throw new Error('Invalid Google authorization code')
    job.submitCode(code.trim())
    return this.current
  }

  async dispose(): Promise<void> {
    this.listeners.clear()
    const jobs = [...this.jobs.values()]
    for (const job of jobs) {
      job.abort.abort('canceled')
      job.kill?.()
    }
    await Promise.all(jobs.map(job => job.done))
  }
}
