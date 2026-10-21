/** Real Models UI → credential/settings stores → child Agent → OpenAI-compatible API. */
import { createServer, type Server } from 'node:http'
import { lstat, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { openSettings, ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

let scaffold: WebScaffold
let browser: Browser
let page: Page
let server: Server
let overlayRoot: string
const requests: { model: string; authorized: boolean; toolResult: boolean }[] = []

beforeAll(async () => {
  overlayRoot = await mkdtemp(join(tmpdir(), 'dsh-child-api-'))
  const overlay = join(overlayRoot, 'cordis.patch.yml')
  await writeFile(join(overlayRoot, 'package.json'), JSON.stringify({
    name: '@fixture/subagent-defaults', version: '1.0.0', type: 'module',
    dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }))
  await writeFile(overlay, JSON.stringify([{ insert: [{
    id: 'subagent-default-model', name: '@deepseek-ai/dsh-subagent-default-model',
    config: { provider: 'old-provider', model: 'old-model', reasoningEffort: 'low', autoDelegate: true },
  }] }]))
  server = createServer((request, response) => {
    void (async () => {
      const buffers: Buffer[] = []
      for await (const buffer of request) {
        if (Buffer.isBuffer(buffer)) buffers.push(buffer)
        else if (typeof buffer === 'string') buffers.push(Buffer.from(buffer))
        else throw new Error('unexpected local API request buffer')
      }
      const body = JSON.parse(Buffer.concat(buffers).toString()) as {
        model: string
        messages: { role: string; content?: string }[]
        tools?: { function: { name: string } }[]
      }
      const toolResult = body.messages.some(message => message.role === 'tool' && message.content?.includes('LOCAL_CHILD_INPUT'))
      requests.push({ model: body.model, authorized: request.headers.authorization === 'Bearer local-test-only', toolResult })
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (delta: object, finish_reason: string | null) => response.write(`data: ${JSON.stringify({
        id: 'local-child-response', object: 'chat.completion.chunk', created: 1, model: body.model,
        choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`)
      if (!toolResult) {
        // Fail the assertion below if the real preset does not expose its read tool.
        const readable = body.tools?.some(tool => tool.function.name === 'read') === true
        send(readable ? { role: 'assistant', tool_calls: [{
          index: 0, id: 'local-read', type: 'function', function: {
            name: 'read', arguments: JSON.stringify({ file_path: join(scaffold.workspaceCwd, 'child-input.txt') }),
          },
        }] } : { role: 'assistant', content: 'MISSING_READ_TOOL' }, readable ? 'tool_calls' : 'stop')
      } else {
        send({ role: 'assistant', content: 'API_SUBAGENT_OK' }, 'stop')
      }
      response.end('data: [DONE]\n\n')
    })().catch(() => { response.destroy() })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  scaffold = await launchWebScaffold({
    harnessHome: join(overlayRoot, 'home'),
    profile: { packages: [{ dir: overlayRoot, enabled: true }] }, toolsMode: 'native',
  })
  await writeFile(join(scaffold.workspaceCwd, 'child-input.txt'), 'LOCAL_CHILD_INPUT\n')
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: ZH_BROWSER_LOCALE })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await scaffold?.close()
  await new Promise<void>((resolve) => { server?.close(() => { resolve() }) })
  if (overlayRoot !== undefined) await rm(overlayRoot, { recursive: true, force: true })
})

it('adds arbitrary API models and uses them as default and explicit subagent routes', async () => {
  onTestFailed(() => saveFailureShot(page, 'web-e2e-subagent-api'))
  const tripwire = watchConsole(page)
  const main = scaffold.ctx.agentDefaultModel.currentSelection()
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('local API did not bind')
  await openSettings(page, 'zh')
  const dialog = page.getByRole('dialog', { name: '设置' })
  await dialog.getByRole('button', { name: '模型', exact: true }).click()
  const add = dialog.getByRole('button', { name: '添加模型提供商' })
  await expect.poll(() => add.isEnabled(), { timeout: 10_000 }).toBe(true)
  await add.click()
  await dialog.getByRole('tab', { name: '自定义模型 API' }).click()
  const custom = dialog.getByRole('tabpanel', { name: '自定义模型 API' })
  await custom.getByLabel('Provider ID').fill('my-subagent-api')
  await custom.getByLabel('显示名称').fill('My Subagent API')
  await custom.getByLabel('API 地址').fill(`http://127.0.0.1:${address.port}/v1`)
  await custom.getByLabel('API 密钥', { exact: true }).fill('local-test-only')
  for (const [index, model] of ['arbitrary-model-a', 'arbitrary-model-b'].entries()) {
    await custom.getByRole('button', { name: '添加模型', exact: true }).click()
    await custom.getByLabel(`模型 ID ${index + 1}`, { exact: true }).fill(model)
  }
  await custom.getByRole('button', { name: '创建提供商', exact: true }).click()
  await dialog.getByText('My Subagent API', { exact: true }).waitFor({ timeout: 10_000 })
  await page.keyboard.press('Escape')
  await page.getByRole('navigation', { name: '全局面板' }).getByRole('button', { name: '插件', exact: true }).click()
  const panel = page.locator('[data-plugin-panel]')
  await panel.getByRole('button', { name: '查看 子智能体', exact: true }).click()
  const card = panel.locator('[data-plugin-config]')
  await card.getByRole('switch', { name: '允许 Agent 为子智能体选择模型' }).click()
  for (const model of ['arbitrary-model-a', 'arbitrary-model-b']) {
    await card.getByRole('checkbox', { name: new RegExp(model) }).check()
  }
  await card.getByRole('button', { name: '子智能体模型', exact: true }).click()
  await page.getByRole('menuitem', { name: 'My Subagent API · arbitrary-model-a', exact: true }).click()
  await card.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(() => card.getByRole('button', { name: '保存', exact: true }).isEnabled()).toBe(false)
  expect(scaffold.ctx.get('subagentDefaultModel')?.currentSelection()).toMatchObject({ provider: 'my-subagent-api', model: 'arbitrary-model-a' })
  expect(scaffold.ctx.get('subagentDefaultModel')?.currentSelection().reasoningEffort).toBeUndefined()
  const stored = await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')
  expect(stored).toContain('arbitrary-model-a')
  expect(stored).not.toContain('local-test-only')

  const handle = await scaffold.ctx.agents.create({
    sessionId: SessionId('custom-api-parent'), meta: { cwd: scaffold.workspaceCwd },
    setup: ctx => scaffold.ctx.agentPresets.mount(ctx).then(() => undefined),
  })
  try {
    const execute = (name: string, args: object) => scaffold.ctx.tools.execute({
      signal: AbortSignal.timeout(30_000), callId: ToolCallId(`api-${name}-${requests.length}`), name,
      arguments: args, agent: handle.agent,
    })
    const discovered = await execute('list_subagent_models', { provider: 'my-subagent-api' })
    expect(discovered.isError).toBe(false)
    expect(JSON.stringify(discovered.content)).toContain('arbitrary-model-b')
    for (const explicit of [false, true]) {
      const result = await execute('subagent', {
        description: 'Read local input', prompt: 'Read child-input.txt and reply OK.', run_in_background: false,
        ...explicit ? { provider: 'my-subagent-api', model: 'arbitrary-model-b' } : {},
      })
      expect(result.isError, JSON.stringify(result.content)).toBe(false)
      expect(JSON.stringify(result.content)).toContain('API_SUBAGENT_OK')
    }
    expect(requests.filter(request => request.toolResult).map(request => request.model)).toEqual(['arbitrary-model-a', 'arbitrary-model-b'])
    expect(requests.every(request => request.authorized)).toBe(true)
    expect(scaffold.ctx.agentDefaultModel.currentSelection()).toEqual(main)
    expect(tripwire.pageErrors).toEqual([])
  } finally {
    await handle.dispose()
  }
}, 120_000)

it('keeps the custom API, authorization, and child default usable after Host restart', async () => {
  onTestFailed(() => saveFailureShot(page, 'web-e2e-subagent-api-restart'))
  const harnessHome = scaffold.harnessHome
  await page.close()
  await scaffold.close()
  // The scaffold installs fixture links on each boot; unlink only this owned junction.
  const fixtureLink = join(harnessHome, 'profiles', 'scaffold', 'node_modules', '@fixture', 'subagent-defaults')
  expect((await lstat(fixtureLink)).isSymbolicLink()).toBe(true)
  await unlink(fixtureLink)
  scaffold = await launchWebScaffold({
    harnessHome, profile: { packages: [{ dir: overlayRoot, enabled: true }] }, toolsMode: 'native',
  })
  await writeFile(join(scaffold.workspaceCwd, 'child-input.txt'), 'LOCAL_CHILD_INPUT\n')
  expect(scaffold.ctx.get('subagentDefaultModel')?.currentSelection()).toMatchObject({
    provider: 'my-subagent-api', model: 'arbitrary-model-a', autoDelegate: true,
  })
  expect(scaffold.ctx.get('subagentDefaultModel')?.currentSelection().reasoningEffort).toBeUndefined()
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: ZH_BROWSER_LOCALE })
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await page.getByRole('navigation', { name: '全局面板' }).getByRole('button', { name: '插件', exact: true }).click()
  const panel = page.locator('[data-plugin-panel]')
  await panel.getByRole('button', { name: '查看 子智能体', exact: true }).click()
  const card = panel.locator('[data-plugin-config]')
  await expect.poll(() => card.getByRole('button', { name: '子智能体模型', exact: true }).textContent())
    .toBe('My Subagent API · arbitrary-model-a')
  for (const model of ['arbitrary-model-a', 'arbitrary-model-b']) {
    await expect.poll(() => card.getByRole('checkbox', { name: new RegExp(model) }).isChecked()).toBe(true)
  }
  const handle = await scaffold.ctx.agents.create({
    sessionId: SessionId('custom-api-restarted-parent'), meta: { cwd: scaffold.workspaceCwd },
    setup: ctx => scaffold.ctx.agentPresets.mount(ctx).then(() => undefined),
  })
  try {
    const result = await scaffold.ctx.tools.execute({
      signal: AbortSignal.timeout(30_000), callId: ToolCallId('restarted-api-child'), name: 'subagent',
      arguments: { description: 'Read local input', prompt: 'Read child-input.txt and reply OK.', run_in_background: false },
      agent: handle.agent,
    })
    expect(result.isError, JSON.stringify(result.content)).toBe(false)
    expect(JSON.stringify(result.content)).toContain('API_SUBAGENT_OK')
    expect(requests.filter(request => request.toolResult).map(request => request.model)).toEqual([
      'arbitrary-model-a', 'arbitrary-model-b', 'arbitrary-model-a',
    ])
    expect(requests.every(request => request.authorized)).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  } finally {
    await handle.dispose()
  }
}, 120_000)
