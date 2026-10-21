import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WelcomeApi } from '../src/welcome-api.ts'

const exposed = vi.hoisted(() => vi.fn<(name: string, api: WelcomeApi) => void>())
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: exposed },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}))
beforeEach(() => { vi.resetModules(); exposed.mockClear() })
afterEach(() => { vi.unstubAllGlobals() })

describe('welcome preload identity', () => {
  it.each(['en', 'zh-CN'])('retains the personal %s title, heading and image description', async language => {
    vi.stubGlobal('process', { ...process, argv: ['electron', `--dsh-welcome-locale=${language}`, '--dsh-welcome-personal=1'] })
    await import('../src/preload-welcome.ts')
    const api = exposed.mock.calls[0]![1]
    expect(api.id).toBe(language)
    expect(api.messages.welcomeTitle).toBe('Personal Desktop')
    expect(api.messages.welcomeBrand).toBe('Personal Desktop')
    expect(api.messages.welcomeTaglineBrand).toBe('Personal Desktop')
  })

  it('preserves the official default when the window did not select personal mode', async () => {
    vi.stubGlobal('process', { ...process, argv: ['electron', '--dsh-welcome-locale=en'] })
    await import('../src/preload-welcome.ts')
    expect(exposed.mock.calls[0]![1].messages.welcomeTitle).toBe('DeepSeek Harness')
  })
})
