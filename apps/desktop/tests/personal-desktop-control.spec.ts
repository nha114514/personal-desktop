import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonalDesktopControl } from '../src/personal-desktop-control.ts'
import { getSharedDesktopControl, resetSharedDesktopControl } from '@deepseek-ai/dsh-computer-use-windows-mcp'

describe('PersonalDesktopControl', () => {
  let testDataDir: string

  beforeEach(() => {
    resetSharedDesktopControl()
    testDataDir = mkdtempSync(join(tmpdir(), 'dsh-test-desktop-control-'))
  })

  afterEach(() => {
    resetSharedDesktopControl()
    try {
      rmSync(testDataDir, { recursive: true, force: true })
    } catch {}
  })

  it('manages desktop control state, snapshot, and emergency stop', async () => {
    const control = new PersonalDesktopControl({ dataDirectory: testDataDir })
    const initialSnap = control.snapshot()

    expect(initialSnap.connected).toBe(false)
    expect(initialSnap.locked).toBe(false)
    expect(initialSnap.paused).toBe(false)

    // Verify stop releases any pending resources and sets paused
    const stopped = await control.stop()
    expect(stopped.connected).toBe(false)
    expect(stopped.busy).toBe(false)
    expect(stopped.paused).toBe(true)

    // Paused state prevents further automated input
    await expect(control.callTool('Click', { loc: [100, 100] }))
      .rejects.toThrow('Automated desktop input is stopped by user takeover')

    // Resume restores input readiness
    const resumed = await control.resume()
    expect(resumed.paused).toBe(false)
  })

  it('rejects all pending queued inputs on emergency stop without hanging promises', async () => {
    const control = new PersonalDesktopControl({ dataDirectory: testDataDir })
    const anyControl = control as any

    // Simulate connected state
    anyControl.connected = true

    // Mock executeToolInternal to simulate a delayed tool execution
    let executeCalls = 0
    anyControl.executeToolInternal = async (name: string) => {
      executeCalls++
      await new Promise(r => setTimeout(r, 50))
      return { tool: name, isError: false, output: 'ok', timestamp: new Date().toISOString() }
    }

    // Enqueue 3 input actions concurrently
    const p1 = control.callTool('Type', { text: 'hello' }).catch(() => undefined)
    const p2 = control.callTool('Type', { text: 'world' })
    const p3 = control.callTool('Click', { loc: [50, 50] })

    // Immediately trigger emergency stop before p2/p3 can execute
    const stopPromise = control.stop()

    // Queued actions p2 and p3 MUST reject cleanly with takeover error, NOT hang
    await expect(p2).rejects.toThrow('Automated desktop input stopped by user takeover')
    await expect(p3).rejects.toThrow('Automated desktop input stopped by user takeover')

    await stopPromise
    expect(control.snapshot().paused).toBe(true)
    try { await p1 } catch {}
  })

  it('serializes input queue in FIFO mutex order', async () => {
    const control = new PersonalDesktopControl({ dataDirectory: testDataDir })
    const anyControl = control as any
    anyControl.connected = true

    const order: number[] = []
    anyControl.executeToolInternal = async (name: string, args: Record<string, any>) => {
      const id = args.id as number
      order.push(id)
      await new Promise(r => setTimeout(r, 10))
      return { tool: name, isError: false, output: `done ${id}`, timestamp: new Date().toISOString() }
    }

    // Launch concurrent input actions
    const [r1, r2, r3] = await Promise.all([
      control.callTool('Type', { id: 1 }),
      control.callTool('Click', { id: 2 }),
      control.callTool('Shortcut', { id: 3 }),
    ])

    expect(r1.output).toBe('done 1')
    expect(r2.output).toBe('done 2')
    expect(r3.output).toBe('done 3')
    expect(order).toEqual([1, 2, 3])
  })

  it('falls back to window compositor capture when host GDI BitBlt fails, preserving error on desktop scope (R3)', async () => {
    const samplePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    let windowCaptureInvoked = false

    const control = new PersonalDesktopControl({
      dataDirectory: testDataDir,
      captureWindowScreenshot: async () => {
        windowCaptureInvoked = true
        return samplePng
      },
    })
    const anyControl = control as any
    anyControl.connected = true

    // Mock sendRpc to simulate FastMCP BitBlt Access Denied exception
    anyControl.sendRpc = async (method: string) => {
      if (method === 'tools/call') {
        return {
          content: [
            { type: 'text', text: '["Error capturing screenshot: Windows graphics function failed: BitBlt: 拒绝访问。. Please try again."]' },
          ],
          isError: true,
        }
      }
      return {}
    }

    // Default call without explicit host-window target represents a full desktop capture attempt.
    // Desktop failure must NOT be disguised as a successful capture.
    const res = await control.callTool('Screenshot', {})

    expect(windowCaptureInvoked).toBe(true)
    expect(res.isError).toBe(true)
    expect(res.imagePath).toBeTruthy()
    expect(res.imageBase64).toBe(samplePng.toString('base64'))
    expect(res.output).toContain('Desktop capture failed')
    expect(res.output).toContain('scope: host-window only, not desktop')

    // Explicit host-window capture request succeeds via host window compositor
    const windowRes = await control.callTool('Screenshot', { scope: 'host-window' })
    expect(windowRes.isError).toBe(false)
    expect(windowRes.output).toContain('Window screenshot captured via host window compositor')
  })

  it('preserves desktop screenshot failure when target is explicitly desktop (R3)', async () => {
    const samplePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    let windowCaptureInvoked = false

    const control = new PersonalDesktopControl({
      dataDirectory: testDataDir,
      captureWindowScreenshot: async () => {
        windowCaptureInvoked = true
        return samplePng
      },
    })
    const anyControl = control as any
    anyControl.connected = true

    anyControl.sendRpc = async (method: string) => {
      if (method === 'tools/call') {
        return {
          content: [
            { type: 'text', text: '["Error capturing screenshot: Windows graphics function failed: BitBlt: 拒绝访问。. Please try again."]' },
          ],
          isError: true,
        }
      }
      return {}
    }

    const res = await control.callTool('Screenshot', { scope: 'desktop' })

    expect(windowCaptureInvoked).toBe(true)
    // Desktop failure must NOT be disguised as a successful desktop capture
    expect(res.isError).toBe(true)
    expect(res.output).toContain('Desktop capture failed')
    expect(res.output).toContain('scope: host-window only, not desktop')
  })

  it('shares execution manager across controllers so stop() constraints both (R2)', async () => {
    const manager = getSharedDesktopControl({ enableFileSignal: false })
    const controlA = new PersonalDesktopControl({ executionManager: manager })
    const controlB = new PersonalDesktopControl({ executionManager: manager })

    const anyA = controlA as any
    const anyB = controlB as any
    anyA.connected = true
    anyB.connected = true

    anyA.executeToolInternal = async () => ({ tool: 'Click', isError: false, output: 'A ok', timestamp: '' })
    anyB.executeToolInternal = async () => ({ tool: 'Type', isError: false, output: 'B ok', timestamp: '' })

    // Stop on controlA stops shared manager
    await controlA.stop()

    expect(controlA.snapshot().paused).toBe(true)
    expect(controlB.snapshot().paused).toBe(true)

    // controlB calls must also be rejected
    await expect(controlB.callTool('Type', { text: 'test' }))
      .rejects.toThrow('Automated desktop input is stopped by user takeover')

    // Resuming on controlB resumes both
    await controlB.resume()
    expect(controlA.snapshot().paused).toBe(false)
    expect(controlB.snapshot().paused).toBe(false)
  })
})
