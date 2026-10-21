/** One FIFO owner retains active work until it settles and rejects results from canceled generations. */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Optional legacy stop-file support for a standalone provider. */
export interface DesktopExecutionOptions {
  dataDirectory?: string
  enableFileSignal?: boolean
}

interface Action {
  run(): Promise<void>
  cancel(reason: Error): void
}

/** Serial desktop execution; Electron Main is the owner in the personal application. */
export class DesktopExecutionManager {
  private readonly queue: Action[] = []
  private active: Action | undefined
  private processing: Promise<void> | undefined
  private paused = false
  private epoch = 0
  private readonly stopSignal: string | undefined

  constructor(options: DesktopExecutionOptions = {}) {
    this.stopSignal = options.enableFileSignal === false ? undefined
      : join(options.dataDirectory ?? 'D:\\desktop\\personal-data', 'desktop-control', 'stop.signal')
  }

  /** @returns Whether this owner or its legacy file currently requests a stop. */
  isPaused(): boolean {
    return this.paused || (this.stopSignal !== undefined && existsSync(this.stopSignal))
  }

  /** @returns Generation required by Host requests admitted by this owner. */
  getEpoch(): number { return this.epoch }

  /** Cancel active and queued work; completed native input is not undone. */
  stop(): void {
    this.paused = true
    this.cancelAll(new Error('Automated desktop input stopped by user takeover'))
    if (this.stopSignal !== undefined) {
      mkdirSync(join(this.stopSignal, '..'), { recursive: true })
      writeFileSync(this.stopSignal, String(this.epoch), 'utf8')
    }
  }

  /** Accept new-generation actions; canceled actions are never resumed. */
  resume(): void {
    if (this.stopSignal !== undefined && existsSync(this.stopSignal)) unlinkSync(this.stopSignal)
    this.paused = false
  }

  /**
   * Serialize a desktop action, fusing caller cancellation with emergency stop.
   * @param task - Action receiving the owner's cancellation signal.
   * @param signal - Optional caller cancellation.
   * @returns The result only if this action and its generation remain current.
   */
  runExclusive<T>(task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.isPaused()) return Promise.reject(new Error('Automated desktop input is stopped by user takeover. Call resume() first.'))
    if (signal?.aborted) return Promise.reject(new Error('Desktop input task aborted'))
    const admittedEpoch = this.epoch
    const abort = new AbortController()
    const combined = signal === undefined ? abort.signal : AbortSignal.any([abort.signal, signal])
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (complete: () => void): void => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        complete()
      }
      const action: Action = {
        cancel: (reason) => {
          const index = this.queue.indexOf(action)
          if (index !== -1) this.queue.splice(index, 1)
          abort.abort(reason)
          finish(() => { reject(reason) })
        },
        run: async () => {
          if (combined.aborted || admittedEpoch !== this.epoch) {
            action.cancel(new Error('Desktop input task aborted'))
            return
          }
          try {
            const value = await task(combined)
            if (combined.aborted || admittedEpoch !== this.epoch || this.isPaused()) {
              action.cancel(new Error('Desktop input result belongs to an outdated or stopped action'))
            } else finish(() => { resolve(value) })
          } catch (error) {
            finish(() => { reject(error) })
          }
        },
      }
      const onAbort = (): void => { action.cancel(new Error('Desktop input task aborted')) }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.queue.push(action)
      if (signal?.aborted) onAbort()
      this.drain()
    })
  }

  private drain(): void {
    if (this.processing !== undefined) return
    const completion = Promise.withResolvers<void>()
    const processing = completion.promise
    this.processing = processing
    void (async () => {
      while (this.queue.length > 0) {
        if (this.isPaused()) {
          this.cancelAll(new Error('Automated desktop input stopped by user takeover'))
          break
        }
        const action = this.queue.shift()!
        this.active = action
        await action.run()
        this.active = undefined
      }
    })().then(completion.resolve, completion.reject)
    void processing.finally(() => {
      if (this.processing === processing) this.processing = undefined
      if (this.queue.length > 0) this.drain()
    })
  }

  private cancelAll(reason: Error): void {
    this.epoch++
    this.active?.cancel(reason)
    for (const action of this.queue.splice(0)) action.cancel(reason)
  }

  /** Reject owned callers without releasing an action that has not settled. */
  clear(): void { this.cancelAll(new Error('Desktop execution cleared')) }

  /** @returns Number of waiting actions, excluding the active action. */
  getQueueLength(): number { return this.queue.length }

  /** @returns Completion of the currently draining FIFO, including canceled active work. */
  async whenIdle(): Promise<void> { await this.processing }
}
