import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PersonalAccounts } from '../src/personal-accounts.ts'

const directories: string[] = []
const controllers: PersonalAccounts[] = []

afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.dispose()
  for (const directory of directories.splice(0)) {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    } catch {}
  }
})

async function setup(source: string, timeoutMs = 5000, openAuthorization?: (url: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'personal-account-login-'))
  directories.push(directory)
  const launcher = join(directory, 'login.mjs')
  await writeFile(launcher, source)
  const controller = new PersonalAccounts({
    node: process.execPath, launcher, entry: launcher, dataDirectory: directory, timeoutMs, openAuthorization,
  })
  controllers.push(controller)
  return controller
}

const poll = <T>(fn: () => T) => expect.poll(fn, { timeout: 8000, interval: 50 })

it('keeps only Google account 2 and Codex while rejecting the retired Google account', () => {
  const controller = new PersonalAccounts({})
  controllers.push(controller)
  expect(controller.snapshot().accounts.map(account => account.id)).toEqual(['2', 'codex'])
  expect(() => controller.login('1')).toThrow(/account must be 2 or codex/)
  expect(() => controller.cancel('1')).toThrow(/account must be 2 or codex/)
  expect(() => controller.reopenAuthorization('1')).toThrow(/account must be 2 or codex/)
  expect(() => controller.submitCode('1', 'unused-code')).toThrow(/account must be 2 or codex/)
})

it('recognizes saved account credentials after restart without claiming current verification', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'personal-account-restart-'))
  directories.push(directory)
  for (const id of ['1', '2']) {
    const home = join(directory, 'antigravity', `account-${id}`)
    await mkdir(join(home, '.gemini', 'antigravity-cli'), { recursive: true })
    await writeFile(join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'), id === '2' ? 'private-test-credential' : '')
    await writeFile(join(home, 'personal-verification.json'), JSON.stringify({ checkedAt: '2026-10-03T02:00:00.000Z' }))
  }
  const controller = new PersonalAccounts({ dataDirectory: directory })
  controllers.push(controller)
  expect(controller.snapshot().accounts.slice(0, 2)).toEqual([
    { id: '2', phase: 'saved', checkedAt: '2026-10-03T02:00:00.000Z' },
    { id: 'codex', phase: 'idle' },
  ])
  expect(controller.snapshot().accounts.find(a => a.id === 'codex')).toBeDefined()
  expect(JSON.stringify(controller.snapshot())).not.toContain('private-test-credential')
})

it('keeps saved login available when its verification record is missing or malformed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'personal-account-record-'))
  directories.push(directory)
  for (const id of ['1', '2']) {
    const home = join(directory, 'antigravity', `account-${id}`)
    await mkdir(join(home, '.gemini', 'antigravity-cli'), { recursive: true })
    await writeFile(join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'), 'private-test-credential')
    if (id === '2') await writeFile(join(home, 'personal-verification.json'), '{interrupted write')
  }
  const controller = new PersonalAccounts({ dataDirectory: directory })
  controllers.push(controller)
  expect(controller.snapshot().accounts.slice(0, 2)).toEqual([{ id: '2', phase: 'saved' }, { id: 'codex', phase: 'idle' }])
  expect(controller.snapshot().accounts.find(a => a.id === 'codex')).toBeDefined()
})

it('retains the last successful verification across restarts without changing CLI credentials', async () => {
  const controller = await setup(`
    console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'OK' } }));
  `)
  const directory = directories.at(-1)!
  const home = join(directory, 'antigravity', 'account-2', '.gemini', 'antigravity-cli')
  await mkdir(home, { recursive: true })
  const credential = join(home, 'antigravity-oauth-token')
  await writeFile(credential, 'private-test-credential')
  controller.login('2')
  await poll(() => controller.snapshot().accounts[0]?.phase).toBe('verified')
  const restarted = new PersonalAccounts({ dataDirectory: directory })
  controllers.push(restarted)
  expect(restarted.snapshot().accounts[0]).toEqual({ id: '2', phase: 'saved', checkedAt: controller.snapshot().accounts[0]?.checkedAt })
  expect(restarted.snapshot().accounts[1]?.id).toBe('codex')
  expect(await readFile(credential, 'utf8')).toBe('private-test-credential')
})

it('verifies each account only after a successful native response', async () => {
  const controller = await setup(`
    console.log(JSON.stringify({ type: 'message', role: 'assistant', content: 'OK' }));
    console.log(JSON.stringify({ type: 'result', status: 'success' }));
  `)
  controller.login('2')
  await poll(() => controller.snapshot().accounts[0]?.phase).toBe('verified')
  expect(controller.snapshot().accounts[1]?.phase).toBe('idle')
  expect(controller.snapshot().accounts[0]?.checkedAt).toEqual(expect.any(String))
})

it('opens only the official authorization URL and sends a code to its selected process', async () => {
  const openAuthorization = vi.fn(async () => {})
  const controller = await setup(`
    import readline from 'node:readline';
    const input = readline.createInterface({ input: process.stdin });
    input.once('line', code => {
      if (code !== 'sample-code') process.exit(1);
      console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'OK' } }));
      input.close();
    });
    console.log('Authentication required. Please visit the URL to log in:');
    console.log('  https://accounts.google.com/o/oauth2/v2/auth?state=private-state');
    process.stdout.write('Or, paste the authorization code here and press Enter:');
  `, 5000, openAuthorization)
  controller.login('2')
  await poll(() => controller.snapshot().accounts[0]?.phase).toBe('awaiting-code')
  expect(openAuthorization).toHaveBeenCalledExactlyOnceWith('https://accounts.google.com/o/oauth2/v2/auth?state=private-state')
  expect(JSON.stringify(controller.snapshot())).not.toContain('private-state')
  expect(() => controller.submitCode('codex', 'sample-code')).toThrow('not waiting')
  expect(() => controller.submitCode('2', 'sample-code\nother-line')).toThrow('authorization code')
  controller.submitCode('2', 'sample-code')
  expect(controller.snapshot().accounts[0]?.phase).toBe('verifying')
  await poll(() => controller.snapshot().accounts[0]?.phase).toBe('verified')
  expect(controller.snapshot().accounts[1]?.phase).toBe('idle')
  expect(JSON.stringify(controller.snapshot())).not.toContain('sample-code')
})

it('delivers authorization code to controlling terminal reader (CONIN$ on Windows)', async () => {
  const openAuthorization = vi.fn(async () => {})
  const controller = await setup(`
    import fs from 'node:fs';
    import readline from 'node:readline';
    let input;
    if (process.platform === 'win32') {
      try {
        input = readline.createInterface({ input: fs.createReadStream('\\\\\\\\.\\\\CONIN$') });
      } catch {
        input = readline.createInterface({ input: process.stdin });
      }
    } else {
      input = readline.createInterface({ input: process.stdin });
    }
    input.once('line', code => {
      if (code.trim() !== 'conin-sample-code') process.exit(1);
      console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'OK' } }));
      input.close();
      process.exit(0);
    });
    console.log('Authentication required. Please visit the URL to log in:');
    console.log('  https://accounts.google.com/o/oauth2/v2/auth?state=conin-state');
    process.stdout.write('Or, paste the authorization code here and press Enter:');
  `, 10000, openAuthorization)
  controller.login('2')
  await poll(() => controller.snapshot().accounts[0]?.phase).toBe('awaiting-code')
  controller.submitCode('2', 'conin-sample-code')
  expect(controller.snapshot().accounts[0]?.phase).toBe('verifying')
  await poll(() => controller.snapshot().accounts[0]?.phase).toBe('verified')
}, 15000)

it('reopens authorization URL during active awaiting-code phase and rejects when inactive', async () => {
  const openAuthorization = vi.fn(async () => {})
  const controller = await setup(`
    import readline from 'node:readline';
    const input = readline.createInterface({ input: process.stdin });
    console.log('Authentication required. Please visit the URL to log in:');
    console.log('  https://accounts.google.com/o/oauth2/v2/auth?state=reopen-state');
    process.stdout.write('Or, paste the authorization code here and press Enter:');
    setInterval(() => {}, 1000);
  `, 5000, openAuthorization)
  controller.login('2')
  while (controller.snapshot().accounts[0]?.phase !== 'awaiting-code') {
    await new Promise(r => setTimeout(r, 50))
  }
  expect(openAuthorization).toHaveBeenCalledTimes(1)
  controller.reopenAuthorization('2')
  expect(openAuthorization).toHaveBeenCalledTimes(2)
  expect(openAuthorization).toHaveBeenLastCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=reopen-state')
  expect(() => controller.reopenAuthorization('codex')).toThrow('no active authorization page')
  controller.cancel('2')
  await poll(() => controller.snapshot().accounts[0]?.phase).toBe('idle')
  expect(() => controller.reopenAuthorization('2')).toThrow('no active authorization page')
})

it('does not open unrelated URLs printed by a CLI process', async () => {
  const openAuthorization = vi.fn(async () => {})
  const controller = await setup(`
    console.log('https://example.com/o/oauth2/v2/auth?code=private-code');
    console.log('https://accounts.google.com.evil.test/o/oauth2/v2/auth');
    console.log('https://accounts.google.com/unrelated');
  `, 5000, openAuthorization)
  controller.login('2')
  await poll(() => controller.snapshot().accounts[0]?.phase).toBe('error')
  expect(openAuthorization).not.toHaveBeenCalled()
})

it('verifies accounts using Antigravity CLI stream-json result events', async () => {
  const controller = await setup(`
    console.log(JSON.stringify({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: 'OK' } }));
    console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'OK\\n' } }));
  `)
  controller.login('2')
  await poll(() => controller.snapshot().accounts[0]?.phase).toBe('verified')
  expect(controller.snapshot().accounts[1]?.phase).toBe('idle')
  expect(controller.snapshot().accounts[0]?.checkedAt).toEqual(expect.any(String))
})

it('confirms only the official browser-opening prompt for the selected login', async () => {
  const controller = await setup(`
    import readline from 'node:readline';
    const input = readline.createInterface({ input: process.stdin });
    input.once('line', answer => {
      if (answer !== 'y') process.exit(1);
      process.stdout.write('\\n');
      console.log(JSON.stringify({ type: 'message', role: 'assistant', content: 'OK' }));
      console.log(JSON.stringify({ type: 'result', status: 'success' }));
      input.close();
    });
    process.stdout.write('Opening authentication page in your browser. ');
    setTimeout(() => process.stdout.write('Do you want to continue? [Y/n]: '), 20);
  `)
  controller.login('2')
  await poll(() => controller.snapshot().accounts[0]?.phase).toBe('verified')
  expect(controller.snapshot().accounts[1]?.phase).toBe('idle')
}, 15000)

it('does not approve a folder trust or other confirmation prompt', async () => {
  const controller = await setup(`
    process.stdout.write('Do you trust this folder? Do you want to continue? [Y/n]: ');
    process.stdin.once('data', () => {
      console.log(JSON.stringify({ type: 'message', role: 'assistant', content: 'OK' }));
      console.log(JSON.stringify({ type: 'result', status: 'success' }));
      process.exit(0);
    });
    setInterval(() => {}, 1000);
  `, 500)
  controller.login('2')
  await poll(() => controller.snapshot().accounts[0]?.phase).toBe('error')
  expect(controller.snapshot().accounts[0]?.failure).toBe('timeout')
})

it('keeps an unsupported client separate from a network failure and hides process output', async () => {
  const controller = await setup(`
    console.error('This client is no longer supported for Gemini Code Assist for individuals. secret-example');
    process.exitCode = 1;
  `)
  controller.login('2')
  await poll(() => controller.snapshot().accounts[0]?.failure).toBe('unsupported-client')
  expect(JSON.stringify(controller.snapshot())).not.toContain('secret-example')
  expect(controller.snapshot().accounts[0]?.phase).toBe('error')
})

it('does not call an exit-zero process authenticated without a model response', async () => {
  const controller = await setup('console.log("http://127.0.0.1/?code=secret-example")')
  controller.login('2')
  await poll(() => controller.snapshot().accounts[0]?.phase).toBe('error')
  expect(controller.snapshot().accounts[0]?.failure).toBe('request-failed')
  expect(JSON.stringify(controller.snapshot())).not.toContain('code=')
})

it('cancels the retained Google login without changing Codex and prevents duplicate processes', async () => {
  const controller = await setup('setInterval(() => {}, 1000)')
  const codex = controller.snapshot().accounts.find(account => account.id === 'codex')
  controller.login('2')
  expect(controller.login('2').accounts.filter(account => account.phase === 'signing-in')).toHaveLength(1)
  controller.cancel('2')
  await poll(() => controller.snapshot().accounts[0]?.failure).toBe('canceled')
  expect(controller.snapshot().accounts.find(account => account.id === 'codex')).toEqual(codex)
})

it('bounds a login attempt and never accepts renderer supplied account ids', async () => {
  const controller = await setup('setInterval(() => {}, 1000)', 100)
  expect(() => controller.login('1 & arbitrary command')).toThrow('account must be 2 or codex')
  controller.login('2')
  await poll(() => controller.snapshot().accounts[0]?.failure).toBe('timeout')
})

it('reports missing installation without spawning or changing global authentication', () => {
  const controller = new PersonalAccounts({})
  controllers.push(controller)
  expect(controller.login('2').accounts[0]).toMatchObject({ phase: 'error', failure: 'cli-unavailable' })
})

it('handles official Codex ChatGPT browser login and verification flow', async () => {
  const openAuthorization = vi.fn(async () => {})
  const directory = await mkdtemp(join(tmpdir(), 'personal-codex-login-'))
  directories.push(directory)
  const codexServer = join(directory, 'codex-mock.mjs')
  await writeFile(codexServer, `
    import readline from 'node:readline';
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', line => {
      try {
        const msg = JSON.parse(line.trim());
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { userAgent: 'test/0.1' } }) + '\\n');
        } else if (msg.method === 'account/login/start') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { type: 'chatgpt', loginId: 'mock-login-id', authUrl: 'https://auth.openai.com/oauth/authorize?state=test-state' } }) + '\\n');
          setTimeout(() => {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'account/login/completed', params: { loginId: 'mock-login-id', success: true, error: null } }) + '\\n');
          }, 1000);
        } else if (msg.method === 'account/read') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { account: { type: 'chatgpt', email: 'test@example.com', planType: 'plus' }, requiresOpenaiAuth: true } }) + '\\n');
        } else if (msg.method === 'account/rateLimits/read') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ordinaryUsageAllowed: true, rateLimits: { primary: { usedPercent: 10 } } } }) + '\\n');
        } else if (msg.method === 'thread/start') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { thread: { id: 'mock-thread', ephemeral: true } } }) + '\\n');
        } else if (msg.method === 'turn/start') {
          process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'item/agentMessage/delta',params:{delta:'OK'}})+'\\n');
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { turn: { id: 'mock-turn', status: 'completed' } } }) + '\\n');
        }
      } catch {}
    });
  `)
  const controller = new PersonalAccounts({
    codexExecutable: codexServer,
    codexModel: 'gpt-6.1-sol',
    codexHome: join(directory, 'codex-empty'),
    dataDirectory: directory,
    openAuthorization,
  })
  controllers.push(controller)
  controller.login('codex')
  await poll(() => openAuthorization.mock.calls.length).toBeGreaterThan(0)
  expect(openAuthorization).toHaveBeenCalledWith('https://auth.openai.com/oauth/authorize?state=test-state')
  await poll(() => controller.snapshot().accounts.find(a => a.id === 'codex')?.phase).toBe('verified')
  expect(controller.snapshot().accounts.find(a => a.id === 'codex')?.checkedAt).toBeDefined()
}, 15000)

it('distinguishes quota-exceeded from not logged in for codex account', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'personal-codex-quota-'))
  directories.push(directory)
  const codexHome = join(directory, 'codex')
  await mkdir(codexHome, { recursive: true })
  await writeFile(join(codexHome, 'auth.json'), JSON.stringify({ token: 'mock' }))
  const codexServer = join(directory, 'codex-quota-mock.mjs')
  await writeFile(codexServer, `
    import readline from 'node:readline';
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', line => {
      try {
        const msg = JSON.parse(line.trim());
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\\n');
        } else if (msg.method === 'account/read') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { account: { type: 'chatgpt', email: 'test@example.com', planType: 'plus' } } }) + '\\n');
        } else if (msg.method === 'account/rateLimits/read') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ordinaryUsageAllowed: false, rateLimits: { rateLimitReachedType: 'codex' } } }) + '\\n');
        }
      } catch {}
    });
  `)
  const controller = new PersonalAccounts({
    codexExecutable: codexServer,
    codexModel: 'gpt-6.1-sol',
    codexHome,
    dataDirectory: directory,
  })
  controllers.push(controller)
  expect(controller.snapshot().accounts.find(a => a.id === 'codex')?.phase).toBe('saved')
  controller.login('codex')
  await poll(() => controller.snapshot().accounts.find(a => a.id === 'codex')?.failure).toBe('quota-exceeded')
  expect(controller.snapshot().accounts.find(a => a.id === 'codex')?.phase).toBe('saved')
})

