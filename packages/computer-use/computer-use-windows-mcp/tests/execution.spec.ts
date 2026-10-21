import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopExecutionManager } from '../src/index.ts'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('desktop execution cancellation', () => {
  it('does not latch a stop signal read from another owner after that owner resumes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'desktop-execution-'))
    directories.push(directory)
    const owner = new DesktopExecutionManager({ dataDirectory: directory })
    const reader = new DesktopExecutionManager({ dataDirectory: directory })
    owner.stop()
    expect(reader.isPaused()).toBe(true)
    owner.resume()
    expect(reader.isPaused()).toBe(false)
  })

  it('removes a canceled queued action immediately', async () => {
    const manager = new DesktopExecutionManager({ enableFileSignal: false })
    const gate = Promise.withResolvers<void>()
    const active = manager.runExclusive(() => gate.promise)
    const cancel = new AbortController()
    const queued = manager.runExclusive(async () => 'must not run', cancel.signal)
    const rejection = expect(queued).rejects.toThrow(/abort/i)
    cancel.abort()
    expect(manager.getQueueLength()).toBe(0)
    gate.resolve()
    await Promise.all([active, rejection])
  })

  it('rejects the old active result and keeps the FIFO occupied until it has actually settled', async () => {
    const manager = new DesktopExecutionManager({ enableFileSignal: false })
    const gate = Promise.withResolvers<string>()
    const active = manager.runExclusive(() => gate.promise)
    const rejected = expect(active).rejects.toThrow(/stopped|abort|outdated/i)
    manager.stop()
    manager.resume()
    let entered = false
    const fresh = manager.runExclusive(async () => { entered = true; return 'new' })
    await Promise.resolve()
    expect(entered).toBe(false)
    gate.resolve('stale result')
    await rejected
    expect(await fresh).toBe('new')
  })

  it('settles queued callers during disposal without releasing an in-flight action early', async () => {
    const manager = new DesktopExecutionManager({ enableFileSignal: false })
    const gate = Promise.withResolvers<void>()
    const active = manager.runExclusive(() => gate.promise)
    const activeRejected = expect(active).rejects.toThrow(/clear|abort|stopped/i)
    const queued = manager.runExclusive(async () => 'must not run')
    const queuedRejected = expect(queued).rejects.toThrow(/clear|abort|stopped/i)
    manager.clear()
    gate.resolve()
    await Promise.all([activeRejected, queuedRejected])
  })
})
