import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createUserMessage, ReasoningEffortId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { CodexAdapter } from '../src/adapter.ts'

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

it('returns a Codex tool request whose server-generated id is zero', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-tool-stream-'))
  directories.push(directory)
  const executable = join(directory, 'codex.js')
  await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(executable, `
    import { createInterface } from 'node:readline';
    const input = createInterface({ input: process.stdin });
    const send = frame => console.log(JSON.stringify(frame));
    input.on('line', line => {
      const frame = JSON.parse(line);
      if (frame.method === 'config/read') {
        send({ id: frame.id, result: { config: {} } });
      } else if (frame.method === 'initialize' || frame.method === 'thread/settings/update') {
        send({ id: frame.id, result: {} });
      } else if (frame.method === 'thread/start') {
        send({ id: frame.id, result: { thread: { id: 'thread-1' } } });
      } else if (frame.method === 'turn/start') {
        send({ id: frame.id, result: { turn: { id: 'turn-1' } } });
        send({ method: 'turn/started', params: { turn: { id: 'turn-1' } } });
        send({ id: 0, method: 'item/tool/call', params: { callId: 'call-1', tool: 'diagnostic_ping', arguments: {} } });
      }
    });
  `)
  vi.stubEnv('DSH_PERSONAL_CODEX_EXECUTABLE', executable)
  const chunks: StreamChunk[] = []
  const request = (async () => {
    for await (const chunk of new CodexAdapter().stream({
      provider: 'codex', model: 'gpt-6-astra', reasoningEffort: ReasoningEffortId('max'),
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Run the diagnostic.' }], source: { kind: 'test' } })],
      tools: [{ name: 'diagnostic_ping', description: 'A harmless diagnostic', parameters: { type: 'object', properties: {} } }],
      signal: AbortSignal.timeout(1500),
    })) chunks.push(chunk)
    return chunks
  })()
  await expect(request).resolves.toContainEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  expect(chunks).toContainEqual(expect.objectContaining({ type: 'tool-call-delta', name: 'diagnostic_ping', id: 'call-1' }))
})
