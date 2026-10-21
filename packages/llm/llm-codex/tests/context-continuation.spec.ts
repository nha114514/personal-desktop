import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  createDeveloperMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
  ToolCallId,
  type GenerateOptions,
} from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexAdapter } from '../src/adapter.ts'

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

async function executableWith(handler: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-context-'))
  directories.push(directory)
  await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
  const executable = join(directory, 'codex.js')
  await writeFile(executable, `
    import { createInterface } from 'node:readline';
    const send = frame => console.log(JSON.stringify(frame));
    const complete = text => {
      send({ method: 'item/agentMessage/delta', params: { delta: text } });
      send({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } });
    };
    ${handler}
  `)
  return executable
}

async function textFrom(adapter: CodexAdapter, options: GenerateOptions): Promise<string> {
  let text = ''
  for await (const chunk of adapter.stream(options)) {
    if (chunk.type === 'text-delta') text += chunk.text
  }
  return text
}

describe('Codex continuation receives all new Harness messages', () => {
  it('matches each pending call and delivers child relays once alongside tool results', async () => {
    const executable = await executableWith(`
      const replies = {};
      createInterface({ input: process.stdin }).on('line', line => {
        const frame = JSON.parse(line);
        if (frame.method === 'config/read') send({ id: frame.id, result: { config: {} } });
        else if (frame.method === 'initialize') send({ id: frame.id, result: {} });
        else if (frame.method === 'thread/start') send({ id: frame.id, result: { thread: { id: 'thread-1' } } });
        else if (frame.method === 'turn/start') {
          send({ id: frame.id, result: { turn: { id: 'turn-1' } } });
          // Deliver this test's simultaneous calls in one batch, independent of pipe scheduling.
          process.stdout.write([
            { id: 0, method: 'item/tool/call', params: { callId: 'child-start', tool: 'subagent', arguments: {} } },
            { id: 90, method: 'item/tool/call', params: { callId: 'read-status', tool: 'list_agents', arguments: {} } },
          ].map(frame => JSON.stringify(frame)).join(String.fromCharCode(10)) + String.fromCharCode(10));
        } else if (frame.result && (frame.id === 0 || frame.id === 90)) {
          replies[frame.id] = frame.result;
          if (Object.keys(replies).length === 2) {
            complete(JSON.stringify(replies));
            setTimeout(() => process.exit(0), 50);
          }
        }
      });
    `)
    vi.stubEnv('DSH_PERSONAL_CODEX_EXECUTABLE', executable)
    const adapter = new CodexAdapter()
    const sessionId = brandString<NonNullable<GenerateOptions['sessionId']>>('relay-session')
    const user = createUserMessage({ content: [{ type: 'text', text: 'Search with my child.' }], source: { kind: 'test' } })
    for await (const _chunk of adapter.stream({ provider: 'codex', model: 'gpt-6.1-sol', sessionId, messages: [user] })) {
      // The next request supplies both tool results and newly accepted relays.
    }
    const reply = JSON.parse(await textFrom(adapter, {
      provider: 'codex', model: 'gpt-6.1-sol', sessionId,
      messages: [
        user,
        createToolResultMessage({ callId: ToolCallId('child-start'), content: [{ type: 'text', text: 'started child-1' }], isError: false }),
        createToolResultMessage({ callId: ToolCallId('read-status'), content: [{ type: 'text', text: 'status unavailable' }], isError: true }),
        createUserMessage({ content: [{ type: 'text', text: 'Agent child-1 sent a message: https://github.com/D4Vinci/Scrapling' }], source: { kind: 'test' } }),
        createUserMessage({ content: [{ type: 'text', text: 'Agent child-1 finished successfully.' }], source: { kind: 'test' } }),
      ],
    }))
    expect(reply['0'].contentItems[0].text).toBe('started child-1')
    expect(reply['90'].contentItems[0].text).toBe('status unavailable')
    expect(reply['0'].success).toBe(true)
    expect(reply['90'].success).toBe(false)
    const output = JSON.stringify(reply)
    expect(output).toContain('https://github.com/D4Vinci/Scrapling')
    expect(output).toContain('Agent child-1 finished successfully.')
    expect(output.match(/Agent child-1 sent a message/g)).toHaveLength(1)
    expect(output).not.toContain('Search with my child.')
  })

  it('keeps every new context message on a reused thread without replaying old inputs', async () => {
    const executable = await executableWith(`
      let turns = 0;
      createInterface({ input: process.stdin }).on('line', line => {
        const frame = JSON.parse(line);
        if (frame.method === 'config/read') send({ id: frame.id, result: { config: {} } });
        else if (frame.method === 'initialize') send({ id: frame.id, result: {} });
        else if (frame.method === 'thread/start') send({ id: frame.id, result: { thread: { id: 'thread-1' } } });
        else if (frame.method === 'turn/start') {
          send({ id: frame.id, result: { turn: { id: 'turn-1' } } });
          complete(frame.params.input[0].text);
          if (++turns === 2) setTimeout(() => process.exit(0), 50);
        }
      });
    `)
    vi.stubEnv('DSH_PERSONAL_CODEX_EXECUTABLE', executable)
    const adapter = new CodexAdapter()
    const sessionId = brandString<NonNullable<GenerateOptions['sessionId']>>('new-context-session')
    const initial = [createSystemMessage('ORIGINAL_SYSTEM'), createUserMessage({ content: [{ type: 'text', text: 'ORIGINAL_TASK' }], source: { kind: 'test' } })]
    await textFrom(adapter, { provider: 'codex', model: 'gpt-6.1-sol', sessionId, messages: initial })
    const text = await textFrom(adapter, {
      provider: 'codex', model: 'gpt-6.1-sol', sessionId,
      messages: [
        ...initial,
        createDeveloperMessage({ content: [{ type: 'text', text: 'Tool update is available.' }], source: { kind: 'test' } }),
        createUserMessage({ content: [{ type: 'text', text: 'Child search result: https://github.com/D4Vinci/Scrapling' }], source: { kind: 'test' } }),
        createUserMessage({ content: [{ type: 'text', text: 'Current time context.' }], source: { kind: 'test' } }),
      ],
    })
    expect(text).toContain('Tool update is available.')
    expect(text).toContain('https://github.com/D4Vinci/Scrapling')
    expect(text).toContain('Current time context.')
    expect(text).not.toContain('ORIGINAL_SYSTEM')
    expect(text).not.toContain('ORIGINAL_TASK')
  })
})
