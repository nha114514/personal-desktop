/** Mounts the shell-owned Windows update document inside the main window's content area. */
import { ipcRenderer } from 'electron'
import { MANDATORY_IPC } from './mandatory-update-ipc.ts'
import type { MandatoryUpdateView } from './mandatory-update-window.ts'
import { isPersonalDesktop } from './personal-product.ts'
import { WINDOWS_TITLEBAR_HEIGHT } from './windows-layout.ts'

/** Runtime process shape available inside Electron's sandboxed preload environment. */
export interface MandatoryUpdateOverlayProcess {
  readonly platform?: string
  readonly env?: NodeJS.ProcessEnv
  readonly argv?: readonly string[]
}

/**
 * Determine whether the current preload runtime disables the mandatory update overlay.
 * Personal Desktop does not instantiate `DesktopMandatoryUpdatePolicy` or `DesktopMandatoryUpdateWindow`
 * in the main process, so the preload must not mount the overlay or query `dsh-desktop:mandatory-status`.
 */
export function isMandatoryUpdateOverlayDisabled(runtime: MandatoryUpdateOverlayProcess = process): boolean {
  const argv = Array.isArray(runtime.argv) ? runtime.argv : []
  if (
    argv.includes('--dsh-mandatory-update=0')
    || argv.includes('--dsh-personal-desktop=1')
    || argv.includes('--dsh-welcome-personal=1')
  ) {
    return true
  }
  if (
    argv.includes('--dsh-mandatory-update=1')
    || argv.includes('--dsh-personal-desktop=0')
    || argv.includes('--dsh-welcome-personal=0')
  ) {
    return false
  }
  try {
    return typeof runtime.env === 'object' && runtime.env !== null && isPersonalDesktop(runtime.env)
  } catch {
    return false
  }
}

/** Keep update actions on a private channel to the shell frame; the shared product DOM is not a tamper-proof display. */
export function installMandatoryUpdateOverlay(): void {
  if (isMandatoryUpdateOverlayDisabled()) return
  let disposed = false
  let state: MandatoryUpdateView | undefined
  let host: HTMLDivElement | undefined
  let frame: HTMLIFrameElement | undefined
  let port: MessagePort | undefined
  let closing: ReturnType<typeof setTimeout> | undefined
  const publish = (): void => { port?.postMessage({ type: 'dsh-mandatory-state', state }) }
  const remove = (): void => { port?.close(); port = undefined; host?.remove(); host = undefined; frame = undefined }
  const render = (): void => {
    if (state === undefined || document.readyState === 'loading') return
    if (!state.policy.blocking) {
      if (frame === undefined || closing !== undefined) return
      publish()
      closing = setTimeout(remove, 150)
      return
    }
    clearTimeout(closing)
    closing = undefined
    if (frame === undefined) {
      host = document.createElement('div')
      host.style.cssText = `position:fixed;top:${WINDOWS_TITLEBAR_HEIGHT}px;left:0;right:0;bottom:0;z-index:2147483647`
      const shadow = host.attachShadow({ mode: 'closed' })
      frame = document.createElement('iframe')
      frame.title = state.locale.messages.mandatoryTitle
      frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:transparent'
      frame.src = 'dsh-app://shell/mandatory-update.html'
      shadow.append(frame)
      document.documentElement.append(host)
      frame.addEventListener('load', () => {
        port?.close()
        const channel = new MessageChannel()
        port = channel.port1
        port.onmessage = message
        frame?.contentWindow?.postMessage({ type: 'dsh-mandatory-connect' }, 'dsh-app://shell', [channel.port2])
        publish()
        frame?.focus()
      })
    }
    publish()
  }
  const receive = (_event: Electron.IpcRendererEvent, next: MandatoryUpdateView): void => { state = next; render() }
  const message = (event: MessageEvent<unknown>): void => {
    const value = event.data
    if (typeof value !== 'object' || value === null || !('type' in value)) return
    if (value.type !== 'dsh-mandatory-action' || !('id' in value) || !Number.isSafeInteger(value.id)
      || !('action' in value) || !('version' in value) || !('revision' in value)) return
    const target = port
    if (target === undefined) return
    void ipcRenderer.invoke(MANDATORY_IPC.action, value.action, value.version, value.revision).then(
      () => { target.postMessage({ type: 'dsh-mandatory-result', id: value.id, ok: true }) },
      () => { target.postMessage({ type: 'dsh-mandatory-result', id: value.id, ok: false }) },
    )
  }
  const blockBackgroundKey = (event: KeyboardEvent): void => {
    if (frame === undefined || state?.policy.blocking !== true
      || event.composedPath().some(target => target instanceof HTMLElement && target.hasAttribute('data-windows-menu'))) return
    event.preventDefault()
    event.stopImmediatePropagation()
    frame.focus()
  }
  ipcRenderer.on(MANDATORY_IPC.state, receive)
  void ipcRenderer.invoke(MANDATORY_IPC.status).then((initial: MandatoryUpdateView) => {
    if (!disposed && state === undefined) { state = initial; render() }
  }, () => {
    // Development may omit policy configuration; a later main-frame load still resynchronizes configured policy.
  })
  window.addEventListener('keydown', blockBackgroundKey, true)
  window.addEventListener('DOMContentLoaded', render, { once: true })
  window.addEventListener('pagehide', () => {
    disposed = true
    clearTimeout(closing)
    remove()
    ipcRenderer.off(MANDATORY_IPC.state, receive)
    window.removeEventListener('keydown', blockBackgroundKey, true)
    window.removeEventListener('DOMContentLoaded', render)
  }, { once: true })
}
