import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { AntigravityAdapter } from '../src/antigravity-adapter.ts'

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

it('resumes only matching model history and keeps auxiliary conversations separate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agy-history-'))
  directories.push(directory)
  const account = join(directory, 'antigravity/account-1/.gemini/antigravity-cli')
  await mkdir(account, { recursive: true })
  await writeFile(join(account, 'settings.json'), '{}')
  const executable = join(directory, 'agy.js')
  const capture = join(directory, 'capture.json')
  await writeFile(executable, `
    const { writeFileSync } = require('node:fs');
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => input += chunk);
    process.stdin.on('end', () => {
      const args = process.argv.slice(2);
      const index = args.indexOf('--conversation');
      const remoteId = index < 0 ? 'remote-' + process.pid : args[index + 1];
      writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ args, remoteId, input: JSON.parse(input) }));
      if (index < 0) console.log(JSON.stringify({ event: 'init', conversation_id: remoteId }));
      console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'OK' } }));
    });
  `)
  vi.stubEnv('DSH_PERSONAL_DATA_DIRECTORY', directory)
  vi.stubEnv('DSH_PERSONAL_ANTIGRAVITY_EXECUTABLE', executable)
  const adapter = new AntigravityAdapter('1', 'Gemini 1')
  const user = (text: string) => createUserMessage({ source: { kind: 'test' }, content: [{ type: 'text', text }] })
  const run = async (texts: string[], model = 'gemini-3.8-flash', purpose?: GenerateOptions['purpose']) => {
    for await (const _chunk of adapter.stream({
      provider: 'gemini-1', model, sessionId: brandString<NonNullable<GenerateOptions['sessionId']>>('history-session'),
      messages: texts.map(user), ...(purpose === undefined ? {} : { purpose }),
    })) {}
    return JSON.parse(await readFile(capture, 'utf8'))
  }
  expect((await run(['original'])).args).not.toContain('--conversation')
  expect((await run(['original', 'append'])).args).toContain('--conversation')
  expect((await run(['original'])).args).not.toContain('--conversation')
  const replaced = await run(['summary one', 'continue'])
  expect(replaced.args).not.toContain('--conversation')
  expect(replaced.input.message.content).toContain('summary one')
  expect(replaced.input.message.content).not.toContain('original')
  expect((await run(['summary two'])).args).not.toContain('--conversation')
  const main = await run(['summary two', 'before aux'])
  const mainId = main.remoteId
  expect((await run(['auxiliary'], 'gemini-3.8-flash', 'compaction')).args).not.toContain('--conversation')
  const resumed = await run(['summary two', 'before aux', 'after aux'])
  expect(resumed.args).toContain('--conversation')
  expect(resumed.args[resumed.args.indexOf('--conversation') + 1]).toBe(mainId)
  expect((await run(['summary two', 'before aux', 'after aux'], 'gemini-3.1-pro')).args).not.toContain('--conversation')
})
