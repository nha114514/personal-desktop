import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { CodexAdapter } from '../src/adapter.ts'

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

it('disables native execution and inherited MCP or plugins while preserving chosen dynamic tools', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-harness-tools-'))
  directories.push(directory)
  const executable = join(directory, 'codex.js')
  await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(executable, `
    import { createInterface } from 'node:readline';
    const send = frame => console.log(JSON.stringify(frame));
    let protectedThread = false;
    createInterface({ input: process.stdin }).on('line', line => {
      const request = JSON.parse(line);
      if (request.method === 'config/read') {
        send({ id: request.id, result: { config: { mcp_servers: { 'my-server': { command: 'external', tool_timeout_sec: null } }, plugins: { 'local@personal': { enabled: true } } } } });
      } else if (request.method === 'thread/start') {
        const p = request.params;
        protectedThread = p.sandbox === 'read-only'
          && p.environments?.length === 0 && p.selectedCapabilityRoots?.length === 0
          && p.config?.features?.shell_tool === false && p.config?.features?.multi_agent === false
          && p.config?.features?.apps === false && p.config?.features?.browser_use === false
          && p.config?.features?.code_mode_host === true
          && p.config?.['mcp_servers.my-server.enabled'] === false
          && !Object.hasOwn(p.config, 'mcp_servers')
          && p.config?.plugins?.['local@personal']?.enabled === false
          && p.config?.web_search === 'disabled'
          && p.dynamicTools?.map(tool => tool.name).join(',') === 'subagent';
        send({ id: request.id, result: { thread: { id: 'protected-thread' } } });
      } else if (request.method === 'turn/start') {
        send({ id: request.id, result: { turn: { id: 'turn' } } });
        send({ method: 'item/agentMessage/delta', params: { delta: protectedThread ? 'protected' : 'unprotected' } });
        send({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'completed' } } });
      } else if (request.id !== undefined) {
        send({ id: request.id, result: {} });
      }
    });
  `)
  vi.stubEnv('DSH_PERSONAL_CODEX_EXECUTABLE', executable)
  const chunks: StreamChunk[] = []
  for await (const chunk of new CodexAdapter().stream({
    provider: 'codex', model: 'gpt-6.1-sol',
    tools: [{ name: 'subagent', description: 'Delegate execution', parameters: { type: 'object' } }],
    messages: [createUserMessage({ content: [{ type: 'text', text: 'Delegate this task.' }], source: { kind: 'test' } })],
  })) chunks.push(chunk)
  expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'protected' })
})

it('preserves a structured native RPC error instead of displaying object Object', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-rpc-error-'))
  directories.push(directory)
  const executable = join(directory, 'codex.js')
  await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(executable, `
    import { createInterface } from 'node:readline';
    createInterface({ input: process.stdin }).on('line', line => {
      const request = JSON.parse(line);
      if (request.method === 'config/read') console.log(JSON.stringify({ id: request.id, result: { config: {} } }));
      else if (request.method === 'thread/start') console.log(JSON.stringify({ id: request.id, error: { code: -32000, message: 'Native configuration was rejected' } }));
      else if (request.id !== undefined) console.log(JSON.stringify({ id: request.id, result: {} }));
    });
  `)
  vi.stubEnv('DSH_PERSONAL_CODEX_EXECUTABLE', executable)
  const request = async () => {
    for await (const _chunk of new CodexAdapter().stream({ provider: 'codex', model: 'gpt-6.1-sol',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Test failure visibility' }], source: { kind: 'test' } })] })) {}
  }
  await expect(request()).rejects.toThrow('Native configuration was rejected')
})
