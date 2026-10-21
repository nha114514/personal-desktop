import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { AntigravityAdapter } from '../src/antigravity-adapter.ts'

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function executable(frames: object[], readInput = true) {
  const directory = await mkdtemp(join(tmpdir(), 'personal-agy-host-'))
  directories.push(directory)
  const account = join(directory, 'antigravity/account-1/.gemini/antigravity-cli')
  await mkdir(account, { recursive: true })
  await writeFile(join(account, 'settings.json'), '{}')
  const file = join(directory, 'agy.js')
  const output = frames.map(frame => `console.log(${JSON.stringify(JSON.stringify(frame))});`).join('\n')
  await writeFile(file, `const {writeFileSync} = require('node:fs'); writeFileSync(${JSON.stringify(join(directory, 'argv.json'))}, JSON.stringify(process.argv.slice(2))); ${readInput ? `let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', value => { input += value }); process.stdin.on('end', () => { writeFileSync(${JSON.stringify(join(directory, 'stdin.json'))}, input); ${output} });` : output}`)
  vi.stubEnv('DSH_PERSONAL_DATA_DIRECTORY', directory)
  vi.stubEnv('DSH_PERSONAL_ANTIGRAVITY_EXECUTABLE', file)
  return directory
}

const options = { provider: 'gemini-1', model: 'gemini-3.8-flash',
  messages: [createUserMessage({ content: [{ type: 'text', text: 'Search Python' }], source: { kind: 'test' } })],
  tools: [{ name: 'web_search', description: 'Search', parameters: { type: 'object' } }] }

describe('Antigravity host-owned tool stream', () => {
  it('delivers large tool and skill contexts through stdin instead of the Windows command line', async () => {
    const response = JSON.stringify({ text: 'OK', toolCalls: [] })
    const directory = await executable([{ event: 'result', result: { status: 'SUCCESS', response } }], true)
    const largeText = 'Harness skill context '.repeat(4000)
    const largeOptions = { ...options, messages: [createUserMessage({ source: { kind: 'test' }, content: [{ type: 'text', text: largeText }] })] }
    for await (const _chunk of new AntigravityAdapter('1', 'Gemini 1').stream(largeOptions)) {}
    const argv = JSON.parse(await readFile(join(directory, 'argv.json'), 'utf8'))
    expect(argv.join(' ').length).toBeLessThan(1000)
    expect(argv).toContain('--input-format')
    const input = JSON.parse(await readFile(join(directory, 'stdin.json'), 'utf8'))
    expect(input).toMatchObject({ event: 'user' })
    expect(input.message.content.includes(largeText.trim())).toBe(true)
    expect(input.message.content).toContain('[Host tool contract]')
  })

  it('requests Harness search without executing or replaying native CLI tools', async () => {
    const response = JSON.stringify({ text: 'Searching', toolCalls: [{ name: 'web_search', arguments: '{"queries":["Python"]}' }] })
    const directory = await executable([{ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: response } },
      { event: 'result', result: { status: 'SUCCESS', response } }])
    const chunks: StreamChunk[] = []
    for await (const chunk of new AntigravityAdapter('1', 'Gemini 1').stream(options)) chunks.push(chunk)
    expect(chunks).toContainEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
    expect(chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call' && chunk.block.name === 'web_search')).toBe(true)
    const argv = JSON.parse(await readFile(join(directory, 'argv.json'), 'utf8'))
    expect(argv).toContain('personal-harness-model')
    expect(argv).not.toContain('--dangerously-skip-permissions')
    const input = JSON.parse(await readFile(join(directory, 'stdin.json'), 'utf8'))
    expect(input.message.content).toContain('[Host tool contract]')
  })

  it('fails explicitly on an unexpected native tool instead of asking Harness to execute it again', async () => {
    await executable([{ event: 'step_update', step_update: { step_type: 'tool', tool_call: { tool_name: 'search_web', tool_args: {} } } }])
    const consume = async () => { for await (const _chunk of new AntigravityAdapter('1', 'Gemini 1').stream(options)) {} }
    await expect(consume()).rejects.toMatchObject({ code: 'NATIVE_TOOL_NOT_ALLOWED' })
  })
})
