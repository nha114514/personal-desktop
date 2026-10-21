import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PersonalAccounts } from '../src/personal-accounts.ts'

const directories: string[] = []
const controllers: PersonalAccounts[] = []
afterEach(async () => {
  await Promise.all(controllers.splice(0).map(controller => controller.dispose()))
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function fixture(reply = true) {
  const directory = await mkdtemp(join(tmpdir(), 'personal-codex-selection-'))
  directories.push(directory)
  const home = join(directory, 'codex')
  await mkdir(home)
  await writeFile(join(home, 'auth.json'), 'private-fixture-credential')
  const calls = join(directory, 'calls.jsonl')
  const server = join(directory, 'codex.mjs')
  await writeFile(server, `
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
createInterface({input:process.stdin}).on('line',line=>{
  const request=JSON.parse(line);
  appendFileSync(${JSON.stringify(calls)},JSON.stringify({method:request.method,params:request.params})+'\\n');
  let result={};
  if(request.method==='account/read')result={account:{type:'chatgpt'}};
  if(request.method==='thread/start')result={thread:{id:'fixture-thread'}};
  if(request.method==='turn/start'){
    ${reply ? "process.stdout.write(JSON.stringify({method:'item/agentMessage/delta',params:{delta:'OK'}})+'\\n');" : ''}
    result={turn:{id:'fixture-turn',status:'completed'}};
  }
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
});
`)
  let selection: { model: string; reasoningEffort: string } | undefined
  const controller = new PersonalAccounts({ node: process.execPath, codexExecutable: server, codexHome: home, dataDirectory: directory,
    resolveCodexSelection: () => selection, timeoutMs: 3000 })
  controllers.push(controller)
  return { controller, home, calls, select: (value: typeof selection) => { selection = value } }
}

describe('Codex verification uses the selected route', () => {
  it('leaves saved sign-in intact and requests model selection without an automatic fallback', async () => {
    const test = await fixture()
    test.controller.login('codex')
    expect(test.controller.snapshot().accounts.find(account => account.id === 'codex')).toMatchObject({ phase: 'saved', failure: 'model-not-selected' })
    expect(await readFile(join(test.home, 'auth.json'), 'utf8')).toBe('private-fixture-credential')
    await expect(readFile(test.calls, 'utf8')).rejects.toThrow()
  })

  it('resolves changed model and effort at each request and sends them on the actual native protocol', async () => {
    const test = await fixture()
    for (const [model, reasoningEffort] of [['first-selected', 'high'], ['new-selected', 'max']] as const) {
      test.select({ model, reasoningEffort })
      test.controller.login('codex')
      await expect.poll(() => test.controller.snapshot().accounts.find(account => account.id === 'codex')?.phase).toBe('verified')
      expect(test.controller.snapshot().accounts.find(account => account.id === 'codex')?.verifiedModel).toBe(model)
    }
    const calls: { method: string; params: Record<string, unknown> }[] = (await readFile(test.calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(calls.filter(call => call.method === 'thread/start').map(call => call.params.model)).toEqual(['first-selected', 'new-selected'])
    expect(calls.filter(call => call.method === 'turn/start').map(call => [call.params.model, call.params.effort])).toEqual([['first-selected', 'high'], ['new-selected', 'max']])
    expect(await readFile(join(test.home, 'auth.json'), 'utf8')).toBe('private-fixture-credential')
  })

  it('does not claim model verification from a completed turn with no model reply', async () => {
    const test = await fixture(false)
    test.select({ model: 'chosen', reasoningEffort: 'high' })
    test.controller.login('codex')
    await expect.poll(() => test.controller.snapshot().accounts.find(account => account.id === 'codex')?.failure).toBe('request-failed')
    expect(test.controller.snapshot().accounts.find(account => account.id === 'codex')?.phase).toBe('saved')
  })
})
