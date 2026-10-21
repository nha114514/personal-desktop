import { once } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, createToolResultMessage, ToolCallId, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it, vi } from 'vitest'
import { CodexAdapter } from '../src/adapter.ts'

const directories: string[] = []
const adapters: CodexAdapter[] = []
afterEach(async () => {
  for (const adapter of adapters.splice(0)) {
    const connections: unknown = Reflect.get(adapter, 'connections')
    if (!(connections instanceof Map)) continue
    for (const connection of [...connections.values()]) {
      const child: ChildProcess = connection.child
      const closed = child.exitCode === null && child.signalCode === null ? once(child, 'exit') : Promise.resolve()
      connection.dispose()
      await closed
    }
  }
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

const user = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'test' } })
const base = {
  provider: 'codex', model: 'gpt-6.1-sol',
  sessionId: brandString<NonNullable<GenerateOptions['sessionId']>>('history-replacement'),
}
async function fixture(): Promise<CodexAdapter> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-history-'))
  directories.push(directory)
  const executable = join(directory, 'fixture.js')
  await writeFile(join(directory, 'package.json'), '{"type":"module"}')
  await writeFile(executable, `
    import { createInterface } from 'node:readline';
    let threads = 0, initializes = 0, replies = 0;
    const emit = frame => process.stdout.write(JSON.stringify(frame) + '\\n');
    const complete = value => {
      emit({ method: 'item/agentMessage/delta', params: { delta: JSON.stringify(value) } });
      emit({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
    };
    createInterface({ input: process.stdin }).on('line', line => {
      const frame = JSON.parse(line);
      if (frame.method === 'initialize') {
        initializes++;
        emit({ id: frame.id, result: {} });
      } else if (frame.method === 'config/read') emit({ id: frame.id, result: { config: {} } });
      else if (frame.method === 'thread/start') emit({ id: frame.id, result: { thread: { id: 'history-' + (++threads) } } });
      else if (frame.method === 'turn/start') {
        emit({ id: frame.id, result: {} });
        const prompt = frame.params.input[0].text;
        if (prompt.includes('REQUEST_PENDING')) {
          emit({ id: 800, method: 'item/tool/call', params: { callId: 'pending-read', tool: 'read', arguments: {} } });
        } else complete({ pid: process.pid, thread: frame.params.threadId, initializes, replies, prompt });
      } else if (frame.id === 800 && frame.result) {
        replies++;
        complete({ pid: process.pid, thread: 'history-' + threads, initializes, replies, result: frame.result });
      }
    });
  `)
  vi.stubEnv('DSH_PERSONAL_CODEX_EXECUTABLE', executable)
  const adapter = new CodexAdapter()
  adapters.push(adapter)
  return adapter
}

async function textFrom(adapter: CodexAdapter, options: GenerateOptions): Promise<string> {
  let text = ''
  for await (const chunk of adapter.stream(options)) {
    if (chunk.type === 'text-delta') text += chunk.text
  }
  return text
}

it('starts distinct threads for two successive history replacements within one initialized process', async () => {
  const adapter = await fixture()
  const first = JSON.parse(await textFrom(adapter, { ...base, messages: [user('old context')] }))
  const second = JSON.parse(await textFrom(adapter, { ...base, messages: [user('summary one'), user('next one')] }))
  const third = JSON.parse(await textFrom(adapter, { ...base, messages: [user('summary two'), user('next two')] }))
  expect([first.thread, second.thread, third.thread]).toEqual(['history-1', 'history-2', 'history-3'])
  expect([second.pid, third.pid]).toEqual([first.pid, first.pid])
  expect([first.initializes, second.initializes, third.initializes]).toEqual([1, 1, 1])
  expect(second.prompt).toContain('summary one')
  expect(second.prompt).not.toContain('old context')
  expect(third.prompt).toContain('summary two')
  expect(third.prompt).not.toContain('summary one')
})

it('keeps append-only history on the same thread when top-level message ids change', async () => {
  const adapter = await fixture()
  const first = JSON.parse(await textFrom(adapter, { ...base, messages: [user('preserved')] }))
  const second = JSON.parse(await textFrom(adapter, { ...base, messages: [user('preserved'), user('appended')] }))
  expect(second.thread).toBe(first.thread)
  expect(second.pid).toBe(first.pid)
  expect(second.initializes).toBe(1)
  expect(second.prompt).toContain('appended')
})

it('isolates compaction from pending tool calls and preserves the main continuation', async () => {
  const adapter = await fixture()
  const initial = [user('REQUEST_PENDING')]
  await textFrom(adapter, { ...base, messages: initial })
  const auxiliary = JSON.parse(await textFrom(adapter, { ...base, purpose: 'compaction', messages: [user('summarize separately')] }))
  expect(auxiliary.prompt).toContain('summarize separately')
  const resumed = JSON.parse(await textFrom(adapter, {
    ...base, messages: [...initial, createToolResultMessage({
      callId: ToolCallId('pending-read'), content: [{ type: 'text', text: 'main result' }], isError: false,
    })],
  }))
  expect(resumed.pid).not.toBe(auxiliary.pid)
  expect(resumed.thread).toBe('history-1')
  expect(resumed.replies).toBe(1)
  expect(resumed.result.contentItems[0].text).toBe('main result')
})

it('replaces history with pending calls without asking for removed tool results', async () => {
  const adapter = await fixture()
  await textFrom(adapter, { ...base, messages: [user('REQUEST_PENDING')] })
  const replaced = JSON.parse(await textFrom(adapter, { ...base, messages: [user('replacement without tags')] }))
  expect(replaced.thread).toBe('history-2')
  expect(replaced.replies).toBe(0)
  expect(replaced.prompt).toContain('replacement without tags')
})

it('does not seed a main session cache from a preceding auxiliary request', async () => {
  const adapter = await fixture()
  const auxiliary = JSON.parse(await textFrom(adapter, { ...base, purpose: 'compaction', messages: [user('auxiliary')] }))
  const main = JSON.parse(await textFrom(adapter, { ...base, messages: [user('main')] }))
  expect(main.pid).not.toBe(auxiliary.pid)
  expect(main.thread).toBe('history-1')
  expect(main.prompt).not.toContain('auxiliary')
})
