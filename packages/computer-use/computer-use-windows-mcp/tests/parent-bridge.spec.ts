import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopParentBridge, isDesktopControlRequest, type DesktopParentChannel } from '../src/parent-bridge.ts'

const bridges: DesktopParentBridge[] = []
afterEach(() => { for (const bridge of bridges.splice(0)) bridge.dispose() })

function transport() {
  const events = new EventEmitter()
  const sent: object[] = []
  let connected = true
  const channel: DesktopParentChannel = {
    connected: () => connected,
    send: (message, callback) => { sent.push(message); callback(null) },
    on: (event, listener) => { events.on(event, listener) },
    off: (event, listener) => { events.off(event, listener) },
  }
  const bridge = new DesktopParentBridge(channel, 1000)
  bridges.push(bridge)
  const answer = (result: unknown, extra: Record<string, unknown> = {}) => {
    const request = sent.at(-1)
    if (!isDesktopControlRequest(request)) throw new Error('Missing test request')
    events.emit('message', { type: 'desktop-control-response', requestId: request.requestId, epoch: 0, paused: false, result, ...extra })
  }
  return { bridge, events, sent, answer, disconnect: () => { connected = false; events.emit('disconnect') } }
}

describe('Desktop parent IPC bridge', () => {
  it('correlates the native catalog and retains image blocks unchanged', async () => {
    const peer = transport()
    const listing = peer.bridge.listTools()
    peer.answer({ tools: [{ name: 'Snapshot', inputSchema: { type: 'object' } }] })
    expect((await listing)[0]?.name).toBe('Snapshot')
    const result = { content: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }], isError: false }
    const call = peer.bridge.callTool('Snapshot', {}, new AbortController().signal)
    peer.answer(result)
    expect(await call).toEqual(result)
  })

  it('sends caller cancellation and discards late replies', async () => {
    const peer = transport()
    const abort = new AbortController()
    const call = peer.bridge.callTool('App', {}, abort.signal)
    const rejected = expect(call).rejects.toThrow('aborted')
    const request = peer.sent[0]
    abort.abort()
    expect(peer.sent[1]).toMatchObject({ type: 'desktop-control-cancel' })
    if (!isDesktopControlRequest(request)) throw new Error('Missing call')
    peer.events.emit('message', { type: 'desktop-control-response', requestId: request.requestId, epoch: 0, paused: false, result: 'old' })
    await rejected
    peer.bridge.dispose()
    expect(peer.events.listenerCount('message')).toBe(0)
    expect(peer.events.listenerCount('disconnect')).toBe(0)
  })

  it('uses the shell generation after resume and never retries an old call', async () => {
    const peer = transport()
    peer.events.emit('message', { type: 'desktop-control-state', epoch: 3, paused: true })
    await expect(peer.bridge.callTool('Clipboard', {}, new AbortController().signal)).rejects.toThrow('stopped')
    expect(peer.sent).toEqual([])
    peer.events.emit('message', { type: 'desktop-control-state', epoch: 3, paused: false })
    const fresh = peer.bridge.callTool('Clipboard', {}, new AbortController().signal)
    expect(peer.sent[0]).toMatchObject({ action: 'call', epoch: 3 })
    peer.answer({ content: [] }, { epoch: 3 })
    await fresh
    expect(peer.sent.length).toBe(1)
  })

  it('settles all callers when the parent disconnects', async () => {
    const peer = transport()
    const first = peer.bridge.listTools()
    const second = peer.bridge.callTool('App', {}, new AbortController().signal)
    const rejected = [expect(first).rejects.toThrow('disconnected'), expect(second).rejects.toThrow('disconnected')]
    peer.disconnect()
    await Promise.all(rejected)
  })
})
