/** Activation clients may close their pipe before the desktop replies. */
import { Socket } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { createPersonalDesktopActivationServer } from '../src/personal-activation.ts'

afterEach(() => { vi.restoreAllMocks() })

it.each(['EPIPE', 'ECONNRESET'])('contains a disconnected activation client (%s)', (code) => {
  const activate = vi.fn()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const server = createPersonalDesktopActivationServer(activate)
  const socket = new Socket()
  vi.spyOn(socket, 'end').mockReturnValue(socket)
  server.emit('connection', socket)
  expect(() => { socket.emit('error', Object.assign(new Error('client disconnected'), { code })) }).not.toThrow()
  expect(socket.destroyed).toBe(true)
  expect(activate).toHaveBeenCalledExactlyOnceWith()
  expect(warn).not.toHaveBeenCalled()
})

it('replies only after processing activation and reports an activation failure', () => {
  const socket = new Socket()
  const end = vi.spyOn(socket, 'end').mockReturnValue(socket)
  const activate = vi.fn(() => { expect(end).not.toHaveBeenCalled() })
  createPersonalDesktopActivationServer(activate).emit('connection', socket)
  expect(end).toHaveBeenCalledWith('ok')
  socket.destroy()
  const failedSocket = new Socket()
  const failedEnd = vi.spyOn(failedSocket, 'end').mockReturnValue(failedSocket)
  createPersonalDesktopActivationServer(() => { throw new Error('unavailable') }).emit('connection', failedSocket)
  expect(failedEnd).toHaveBeenCalledWith('error')
  failedSocket.destroy()
})
