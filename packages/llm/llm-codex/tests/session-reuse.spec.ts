import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createUserMessage,
  createToolResultMessage,
  ToolCallId,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { CodexAdapter } from '../src/adapter.ts'

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // Ignore cleanup failures on transient Windows locks
    }
  }
})

describe('CodexAdapter session reuse and tool continuation', () => {
  it('reuses the connection and thread on subsequent turns with the same sessionId', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codex-reuse-stream-'))
    directories.push(directory)
    const executable = join(directory, 'codex.js')
    await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))

    // Mock app-server that tracks turn count and verifies thread reuse
    await writeFile(
      executable,
      `
      import { createInterface } from 'node:readline';
      const input = createInterface({ input: process.stdin });
      const send = frame => console.log(JSON.stringify(frame));
      let turnCount = 0;
      let initCount = 0;

      input.on('line', line => {
        const frame = JSON.parse(line);
        if (frame.method === 'config/read') {
          send({ id: frame.id, result: { config: {} } });
        } else if (frame.method === 'initialize') {
          initCount++;
          send({ id: frame.id, result: {} });
        } else if (frame.method === 'thread/start') {
          send({ id: frame.id, result: { thread: { id: 'thread-reuse-1' } } });
        } else if (frame.method === 'turn/start') {
          turnCount++;
          send({ id: frame.id, result: { turn: { id: 'turn-' + turnCount } } });
          send({ method: 'turn/started', params: { turn: { id: 'turn-' + turnCount } } });
          send({ method: 'item/agentMessage/delta', params: { delta: 'Answer ' + turnCount } });
          send({ method: 'turn/completed', params: { turn: { id: 'turn-' + turnCount, status: 'completed' } } });
        }
      });
    `,
    )

    vi.stubEnv('DSH_PERSONAL_CODEX_EXECUTABLE', executable)
    const adapter = new CodexAdapter()
    const sessionId = 'test-session-reuse' as any

    // Turn 1
    const chunksTurn1: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'codex',
      model: 'gpt-6.1-sol',
      sessionId,
      messages: [createUserMessage({ content: [{ type: 'text', text: 'turn 1' }], source: { kind: 'test' } })],
    })) {
      chunksTurn1.push(chunk)
    }

    expect(chunksTurn1).toContainEqual({ type: 'text-delta', index: 0, text: 'Answer 1' })
    expect(chunksTurn1).toContainEqual({ type: 'finish', reason: { kind: 'stop' } })

    // Turn 2 on same session
    const chunksTurn2: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'codex',
      model: 'gpt-6.1-sol',
      sessionId,
      messages: [
        createUserMessage({ content: [{ type: 'text', text: 'turn 1' }], source: { kind: 'test' } }),
        createUserMessage({ content: [{ type: 'text', text: 'turn 2' }], source: { kind: 'test' } }),
      ],
    })) {
      chunksTurn2.push(chunk)
    }

    expect(chunksTurn2).toContainEqual({ type: 'text-delta', index: 0, text: 'Answer 2' })
    expect(chunksTurn2).toContainEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('delivers real tool results to pending tool RPC and completes turn without process restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codex-tool-roundtrip-'))
    directories.push(directory)
    const executable = join(directory, 'codex.js')
    await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))

    // Mock server that requests a tool call and verifies the result received
    await writeFile(
      executable,
      `
      import { createInterface } from 'node:readline';
      const input = createInterface({ input: process.stdin });
      const send = frame => console.log(JSON.stringify(frame));
      let receivedToolResult = null;

      input.on('line', line => {
        const frame = JSON.parse(line);
        if (frame.method === 'config/read') {
          send({ id: frame.id, result: { config: {} } });
        } else if (frame.method === 'initialize') {
          send({ id: frame.id, result: {} });
        } else if (frame.method === 'thread/start') {
          send({ id: frame.id, result: { thread: { id: 'thread-tool-1' } } });
        } else if (frame.method === 'turn/start') {
          send({ id: frame.id, result: { turn: { id: 'turn-1' } } });
          send({ method: 'turn/started', params: { turn: { id: 'turn-1' } } });
          send({ id: 0, method: 'item/tool/call', params: { callId: 'call-read-file', tool: 'view_file', arguments: { path: 'a.txt' } } });
        } else if (frame.result && frame.id === 0) {
          // Received tool response for id: 0!
          receivedToolResult = frame.result.contentItems?.[0]?.text;
          send({ method: 'item/agentMessage/delta', params: { delta: 'File content was: ' + receivedToolResult } });
          send({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } });
        }
      });
    `,
    )

    vi.stubEnv('DSH_PERSONAL_CODEX_EXECUTABLE', executable)
    const adapter = new CodexAdapter()
    const sessionId = 'test-session-tool' as any

    // Step 1: Model requests tool
    const chunksStep1: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'codex',
      model: 'gpt-6.1-sol',
      sessionId,
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Read a.txt' }], source: { kind: 'test' } })],
      tools: [{ name: 'view_file', description: 'Read file', parameters: { type: 'object', properties: {} } }],
    })) {
      chunksStep1.push(chunk)
    }

    expect(chunksStep1).toContainEqual(expect.objectContaining({ type: 'tool-call-delta', name: 'view_file', id: 'call-read-file' }))
    expect(chunksStep1).toContainEqual({ type: 'finish', reason: { kind: 'tool-calls' } })

    // Step 2: Client provides real tool result
    const chunksStep2: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'codex',
      model: 'gpt-6.1-sol',
      sessionId,
      messages: [
        createUserMessage({ content: [{ type: 'text', text: 'Read a.txt' }], source: { kind: 'test' } }),
        createToolResultMessage({
          callId: ToolCallId('call-read-file'),
          content: [{ type: 'text', text: 'HELLO_WORLD_CONTENTS' }],
          isError: false,
        }),
      ],
    })) {
      chunksStep2.push(chunk)
    }

    expect(chunksStep2).toContainEqual({ type: 'text-delta', index: 0, text: 'File content was: HELLO_WORLD_CONTENTS' })
    expect(chunksStep2).toContainEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('maps summary text deltas and summary parts to reasoning chunks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codex-summary-'))
    directories.push(directory)
    const executable = join(directory, 'codex.js')
    await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))

    await writeFile(
      executable,
      `
      import { createInterface } from 'node:readline';
      const input = createInterface({ input: process.stdin });
      const send = frame => console.log(JSON.stringify(frame));

      input.on('line', line => {
        const frame = JSON.parse(line);
        if (frame.method === 'config/read') {
          send({ id: frame.id, result: { config: {} } });
        } else if (frame.method === 'initialize') {
          send({ id: frame.id, result: {} });
        } else if (frame.method === 'thread/start') {
          send({ id: frame.id, result: { thread: { id: 'thread-s1' } } });
        } else if (frame.method === 'turn/start') {
          send({ id: frame.id, result: { turn: { id: 'turn-1' } } });
          send({ method: 'item/reasoning/summaryTextDelta', params: { delta: 'Analyzing problem...' } });
          send({ method: 'item/reasoning/summaryPartAdded', params: {} });
          send({ method: 'item/reasoning/textDelta', params: { delta: 'Step 1: Check code.' } });
          send({ method: 'item/agentMessage/delta', params: { delta: 'Done.' } });
          send({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } });
        }
      });
    `,
    )

    vi.stubEnv('DSH_PERSONAL_CODEX_EXECUTABLE', executable)
    const adapter = new CodexAdapter()

    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'codex',
      model: 'gpt-6.1-sol',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Hi' }], source: { kind: 'test' } })],
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toContainEqual({ type: 'reasoning-delta', index: 0, text: 'Analyzing problem...' })
    expect(chunks).toContainEqual({ type: 'reasoning-delta', index: 1, text: 'Step 1: Check code.' })
    expect(chunks).toContainEqual({ type: 'text-delta', index: 2, text: 'Done.' })
  })
})
