/** Built preloads must execute with only Electron's sandbox-supported require. */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const preload = (name: string): string => fileURLToPath(new URL(`../lib/${name}.cjs`, import.meta.url))

/**
 * Browser globals a sandboxed Electron preload sees. A preload runs while the
 * document is still loading, so the theme preload defers its first read to
 * `DOMContentLoaded` and observes later `html[data-ds-theme-source]` changes.
 * @returns context globals plus the root attribute transitions the Web UI performs.
 */
function browserEnvironment() {
  const attributes = new Map<string, string>()
  const listeners = new Map<string, Array<() => void>>()
  const observers: Array<() => void> = []
  const document = {
    readyState: 'loading',
    documentElement: {
      dataset: {} as Record<string, string>,
      style: { setProperty: (): void => {} },
      getAttribute: (name: string): string | null => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string): void => { attributes.set(name, value) },
    },
  }
  const window = {
    addEventListener: (type: string, listener: () => void): void => {
      listeners.set(type, [...listeners.get(type) ?? [], listener])
    },
    removeEventListener: (): void => {},
  }
  class SandboxMutationObserver {
    constructor(callback: () => void) { observers.push(callback) }
    observe(): void {}
  }
  return {
    globals: { document, window, MutationObserver: SandboxMutationObserver },
    /** Writes the theme root attribute and settles the document, as the theme bootstrap does before DOMContentLoaded. */
    loadTheme(value: string): void {
      attributes.set('data-ds-theme-source', value)
      for (const listener of listeners.get('DOMContentLoaded') ?? []) listener()
    },
    /** Applies a later theme preference change through the observer the preload registered. */
    changeTheme(value: string): void {
      attributes.set('data-ds-theme-source', value)
      for (const observer of observers) observer()
    },
  }
}

describe.skipIf(!existsSync(preload('preload-app')))('built sandboxed Desktop preloads', () => {
  it.each(['preload-app', 'preload-welcome'])('%s loads without filesystem module access', async (name) => {
    const exposed = new Map<string, Record<string, unknown>>()
    const invoke = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.resolve({ languages: ['en-US'], preference: 'zh' }))
    const send = vi.fn()
    const browser = browserEnvironment()
    const electron = {
      contextBridge: { exposeInMainWorld: (key: string, value: Record<string, unknown>) => { exposed.set(key, value) } },
      ipcRenderer: { invoke, send, on: vi.fn(), off: vi.fn() },
    }
    runInNewContext(readFileSync(preload(name), 'utf8'), {
      ...browser.globals,
      require: (id: string) => {
        if (id !== 'electron') throw new Error(`sandbox cannot load ${id}`)
        return electron
      },
      process: { argv: ['electron', '--dsh-welcome-locale=en'], isMainFrame: true },
      location: new URL('dsh-app://app/'),
      exports: {},
    })
    if (name === 'preload-app') {
      const product = exposed.get('dshDesktop') as { deviceInfo(): Promise<string> }
      invoke.mockResolvedValueOnce('platform=darwin; memory_gib=32.0')
      await expect(product.deviceInfo()).resolves.toBe('platform=darwin; memory_gib=32.0')
      expect(invoke).toHaveBeenCalledWith('dsh-desktop:device-info')
      browser.loadTheme('dark')
      expect(send).toHaveBeenCalledWith('dsh-desktop:native-theme-set', 'dark')
      browser.changeTheme('light')
      expect(send).toHaveBeenCalledWith('dsh-desktop:native-theme-set', 'light')
      const bridge = exposed.get('__DSH_LOCALE__') as { read(): unknown; onChange(locale: string): void }
      bridge.read()
      expect(invoke).toHaveBeenCalledWith('dsh-desktop:locale-bootstrap')
      bridge.onChange('zh')
      expect(send).toHaveBeenCalledWith('dsh-desktop:locale-changed', 'zh')
    } else {
      expect(exposed.has('dshWelcome')).toBe(true)
      const bridge = exposed.get('dshWelcome') as { takeNotice(): Promise<unknown> }
      void bridge.takeNotice()
      expect(invoke).toHaveBeenCalledWith('dsh-welcome:take-notice')
    }
  })

  it('built preload-app skips dsh-desktop:mandatory-status IPC in personal mode on Windows', () => {
    for (const [personal, expectedCalls] of [['1', 0], ['0', 1]] as const) {
      const invoke = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.resolve({ languages: ['en-US'], preference: 'zh' }))
      const browser = browserEnvironment()
      const electron = {
        contextBridge: { exposeInMainWorld: vi.fn() },
        ipcRenderer: { invoke, send: vi.fn(), on: vi.fn(), off: vi.fn() },
      }
      runInNewContext(readFileSync(preload('preload-app'), 'utf8'), {
        ...browser.globals,
        require: (id: string) => {
          if (id !== 'electron') throw new Error(`sandbox cannot load ${id}`)
          return electron
        },
        process: { platform: 'win32', env: { DSH_DESKTOP_PERSONAL: personal }, argv: ['electron'], isMainFrame: true },
        location: new URL('dsh-app://app/'),
        exports: {},
      })
      const mandatoryStatusCalls = invoke.mock.calls.filter(([channel]) => channel === 'dsh-desktop:mandatory-status')
      expect(mandatoryStatusCalls).toHaveLength(expectedCalls)
    }
  })
})
