import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as Crawlers from '../src/index.ts'

const exec = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile: exec }))
let root: string | undefined
let ctx: Context | undefined
afterEach(async () => {
  await ctx?.fiber.dispose()
  if (root) await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

it('loads the configured provider through flat YAML and unregisters it for reload', async () => {
  root = await mkdtemp(join(tmpdir(), 'personal-crawlers-loader-'))
  const settingsFile = join(root, 'settings.json')
  await writeFile(settingsFile, JSON.stringify({ pythonExecutable: process.execPath, mediaCrawlerDirectory: root,
    dataDirectory: root, searchEngine: 'duckduckgo', timeoutMs: 1000, maxBodyChars: 1000 }))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, `- name: '@deepseek-ai/dsh-web'\n  config:\n    searchProvider: personal-crawlers\n    fetchProvider: personal-crawlers\n- name: '@deepseek-ai/dsh-web-crawlers'\n  id: crawler\n  config:\n    settingsFile: ${JSON.stringify(settingsFile)}\n`)
  exec.mockImplementation((_file, _args, _options, callback) => {
    callback(null, JSON.stringify({ sources: [{ url: 'https://example.com', title: 'Example' }], truncated: false }), '')
    return { stdin: { end: vi.fn() } }
  })
  ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  // Preserve the real loader; replace only its external module import seam.
  expect(ctx.loader.internal).toBeDefined()
  vi.spyOn(ctx.loader.internal!, 'import').mockImplementation(async (specifier: string) => {
    if (specifier === '@deepseek-ai/dsh-web') return WebRuntime
    if (specifier === '@deepseek-ai/dsh-web-crawlers') return Crawlers
    throw new Error(`Unexpected module ${specifier}`)
  })
  const include = await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  await expect(ctx.web.search({ query: 'example' })).resolves.toMatchObject({ sources: [{ title: 'Example' }] })
  await ctx.loader.resolve(include).fiber!.dispose()
  ctx.loader.remove(include)
  await ctx.loader.await()
  // A complete re-load must not retain the former provider registration.
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  await expect(ctx.web.search({ query: 'example' })).resolves.toMatchObject({ sources: [{ title: 'Example' }] })
})
