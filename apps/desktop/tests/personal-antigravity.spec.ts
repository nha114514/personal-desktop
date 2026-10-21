import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

it('isolates each official remote-auth profile and removes unrelated credentials', async () => {
  const adapter = await import('../src/personal-antigravity.ts').catch(() => undefined)
  expect(adapter, 'Antigravity account profile support').toBeDefined()
  if (adapter === undefined) return
  const directory = await mkdtemp(join(tmpdir(), 'personal-antigravity-'))
  directories.push(directory)
  const environment = { ...process.env, GEMINI_API_KEY: 'private-key', GOOGLE_APPLICATION_CREDENTIALS: 'private-path', AGY_ADC_AUTH: '1', CUSTOM_SECRET: 'private-secret' }
  const first = adapter.prepareAntigravityAccount(process.execPath, directory, '1', environment)
  const second = adapter.prepareAntigravityAccount(process.execPath, directory, '2', environment)
  expect(first.cwd).not.toBe(second.cwd)
  expect(first.env.USERPROFILE).toBe(first.cwd)
  expect(first.env.HOME).toBe(first.cwd)
  expect(first.env.SSH_CONNECTION).toBeDefined()
  expect(first.env.GEMINI_API_KEY).toBeUndefined()
  expect(first.env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined()
  expect(first.env.AGY_ADC_AUTH).toBeUndefined()
  expect(first.env.CUSTOM_SECRET).toBeUndefined()
  expect(environment.GEMINI_API_KEY).toBe('private-key')
  const settings = join(first.cwd, '.gemini', 'antigravity-cli', 'settings.json')
  await writeFile(settings, JSON.stringify({ modelProvider: 'gemini' }))
  expect(() => adapter.prepareAntigravityAccount(process.execPath, directory, '1', environment)).toThrow('account authentication')
  expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({ modelProvider: 'gemini' })
})
