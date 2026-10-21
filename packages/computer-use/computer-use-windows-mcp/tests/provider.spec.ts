import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ComputerUse from '@deepseek-ai/dsh-computer-use'
import * as Provider from '../src/index.ts'

describe('computer-use-windows-mcp', () => {
  it('registers provider name and handles lifecycle', async () => {
    const ctx = new Context()
    ctx.plugin(ComputerUse)

    // Plugin metadata
    expect(Provider.name).toBe('computer-use-windows-mcp')
    expect(Provider.inject).toEqual(['computerUse', 'tools'])

    // Validates config schema
    const parsed = Provider.Config({ command: 'test.exe' })
    expect(parsed.command).toBe('test.exe')
    expect(parsed.args).toEqual(['serve', '--transport', 'stdio'])
  })

  it('serializes concurrent tasks in FIFO mutex order and handles emergency takeover stop (R2)', async () => {
    const manager = new Provider.DesktopExecutionManager({ enableFileSignal: false })

    const order: number[] = []
    const t1 = manager.runExclusive(async () => {
      await new Promise(r => setTimeout(r, 20))
      order.push(1)
      return 1
    })
    const t2 = manager.runExclusive(async () => {
      await new Promise(r => setTimeout(r, 10))
      order.push(2)
      return 2
    })
    const t3 = manager.runExclusive(async () => {
      order.push(3)
      return 3
    })

    const results = await Promise.all([t1, t2, t3])
    expect(results).toEqual([1, 2, 3])
    expect(order).toEqual([1, 2, 3])

    // Test emergency stop rejecting queued tasks
    const p1 = manager.runExclusive(async () => {
      await new Promise(r => setTimeout(r, 50))
      return 'slow'
    }).catch(() => undefined)
    const p2 = manager.runExclusive(async () => 'queued-2')
    const p3 = manager.runExclusive(async () => 'queued-3')

    manager.stop()
    expect(manager.isPaused()).toBe(true)

    // Queued actions p2 and p3 must be rejected cleanly
    await expect(p2).rejects.toThrow('Automated desktop input stopped by user takeover')
    await expect(p3).rejects.toThrow('Automated desktop input stopped by user takeover')

    // New actions while paused must throw
    await expect(manager.runExclusive(async () => 'blocked'))
      .rejects.toThrow('Automated desktop input is stopped by user takeover. Call resume() first.')

    // Resume restores ability to run
    manager.resume()
    expect(manager.isPaused()).toBe(false)
    const afterResume = await manager.runExclusive(async () => 'resumed-success')
    expect(afterResume).toBe('resumed-success')
  })

  it('identifies desktop mutex tools for mouse, keyboard, and window focus (R2)', () => {
    expect(Provider.DESKTOP_MUTEX_TOOLS.has('Click')).toBe(true)
    expect(Provider.DESKTOP_MUTEX_TOOLS.has('Type')).toBe(true)
    expect(Provider.DESKTOP_MUTEX_TOOLS.has('Move')).toBe(true)
    expect(Provider.DESKTOP_MUTEX_TOOLS.has('Scroll')).toBe(true)
    expect(Provider.DESKTOP_MUTEX_TOOLS.has('Shortcut')).toBe(true)
    expect(Provider.DESKTOP_MUTEX_TOOLS.has('SwitchWindow')).toBe(true)
    expect(Provider.DESKTOP_MUTEX_TOOLS.has('ActivateWindow')).toBe(true)
  })
})
