/** Local pipe activation for the personal Windows desktop. */
import { createServer, type Server } from 'node:net'

/**
 * Create an activation server whose short-lived clients cannot crash the owner.
 * @param activate - reveal the owner's primary window before acknowledging.
 * @returns an unbound server; its caller owns listening and shutdown.
 */
export function createPersonalDesktopActivationServer(activate: () => void): Server {
  return createServer((socket) => {
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE' && error.code !== 'ECONNRESET') {
        console.warn('desktop activation client:', error.code ?? 'unknown-error')
      }
      socket.destroy()
    })
    try {
      activate()
      socket.end('ok')
    } catch {
      socket.end('error')
    }
  })
}
