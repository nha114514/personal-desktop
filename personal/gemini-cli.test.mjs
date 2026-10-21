import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const launcher = fileURLToPath(new URL('./GeminiCli.mjs', import.meta.url))

async function load() {
  try {
    return await import('./gemini-cli.mjs')
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') assert.fail('Gemini account launcher is missing')
    throw error
  }
}

function fixture(t) {
  const temporaryBase = resolve(tmpdir())
  const directory = mkdtempSync(join(temporaryBase, 'personal gemini cli '))
  t.after(() => {
    assert.ok(resolve(directory).startsWith(temporaryBase + sep))
    rmSync(directory, { recursive: true, force: true })
  })
  return directory
}

function fakeEntry(directory) {
  const entry = join(directory, 'official cli with spaces.mjs')
  writeFileSync(entry, 'const { main } = await import("./gemini-test-main.mjs"); await main()\n')
  writeFileSync(join(directory, 'test-settings.mjs'), `
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
export function loadSettings() {
  const merged = JSON.parse(readFileSync(join(process.env.GEMINI_CLI_HOME, '.gemini', 'settings.json'), 'utf8'))
  return { merged }
}
`)
  writeFileSync(join(directory, 'gemini-test-main.mjs'), `
import { loadSettings } from './test-settings.mjs'
const home = process.env.GEMINI_CLI_HOME
export function main() {
const settings = loadSettings().merged
console.log(JSON.stringify({ argv: process.argv.slice(2), home,
  apiKeyPresent: 'GEMINI_API_KEY' in process.env,
  auth: settings.security.auth,
  storage: process.env.GEMINI_FORCE_FILE_STORAGE,
  encryptedStorage: process.env.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE,
  noRelaunch: process.env.GEMINI_CLI_NO_RELAUNCH }))
}
`)
  return entry
}

test('account homes are isolated and only the two configured account numbers are accepted', async t => {
  const { geminiAccountHome } = await load()
  const directory = fixture(t)
  assert.equal(geminiAccountHome(directory, '1'), join(directory, 'gemini', 'account-1'))
  assert.equal(geminiAccountHome(directory, '2'), join(directory, 'gemini', 'account-2'))
  for (const account of [undefined, '0', '3', '../1', 1]) {
    assert.throws(() => geminiAccountHome(directory, account), /account.*1.*2/i)
  }
})

test('initialization selects official account OAuth and preserves all existing settings', async t => {
  const { initializeGeminiAccounts, geminiAccountHome } = await load()
  const directory = fixture(t)
  initializeGeminiAccounts(directory)
  const settingsPath = join(geminiAccountHome(directory, '1'), '.gemini', 'settings.json')
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, 'utf8')), {
    security: { auth: { selectedType: 'oauth-personal', enforcedType: 'oauth-personal' } },
    advanced: { ignoreLocalEnv: true },
  })
  const edited = '{\n  "custom": "keep my edit", "security": { "auth": { "selectedType": "oauth-personal" } }\n}\n'
  writeFileSync(settingsPath, edited)
  initializeGeminiAccounts(directory)
  assert.equal(readFileSync(settingsPath, 'utf8'), edited)
  assert.equal(JSON.parse(readFileSync(join(geminiAccountHome(directory, '2'), '.gemini', 'settings.json'), 'utf8')).security.auth.selectedType, 'oauth-personal')
  assert.equal(existsSync(join(geminiAccountHome(directory, '1'), '.gemini', 'account-policy.json')), false)
})

test('CLI discovery honors an explicit entry and resolves the installed official package bin', async t => {
  const { resolveGeminiCliEntry } = await load()
  const directory = fixture(t)
  const entry = fakeEntry(directory)
  assert.equal(resolveGeminiCliEntry({ DSH_PERSONAL_GEMINI_CLI_ENTRY: entry }), entry)
  const packageDirectory = join(directory, 'npm', 'node_modules', '@google', 'gemini-cli')
  mkdirSync(join(packageDirectory, 'bundle'), { recursive: true })
  writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({ bin: { gemini: 'bundle/gemini.js' } }))
  const installedEntry = join(packageDirectory, 'bundle', 'gemini.js')
  writeFileSync(installedEntry, '')
  assert.equal(resolveGeminiCliEntry({ APPDATA: directory }), installedEntry)
})

test('missing explicit or installed CLI paths report a configuration error', async t => {
  const { resolveGeminiCliEntry } = await load()
  const directory = fixture(t)
  assert.throws(() => resolveGeminiCliEntry({ DSH_PERSONAL_GEMINI_CLI_ENTRY: join(directory, 'missing.mjs') }), /Gemini CLI.*not found/i)
  assert.throws(() => resolveGeminiCliEntry({ APPDATA: directory }), /Gemini CLI.*not found/i)
})

test('the account process removes API and extra Google authentication while retaining proxy and normal environment', async t => {
  const { buildGeminiCliSpec } = await load()
  const directory = fixture(t)
  const entry = fakeEntry(directory)
  const unsafe = {
    GEMINI_API_KEY: 'test-key', GOOGLE_API_KEY: 'test-key', GOOGLE_APPLICATION_CREDENTIALS: 'test-file',
    GOOGLE_CLOUD_ACCESS_TOKEN: 'test-token', GOOGLE_GENAI_USE_VERTEXAI: 'true', GOOGLE_GENAI_USE_GCA: 'true',
    GEMINI_DEFAULT_AUTH_TYPE: 'gemini-api-key', GOOGLE_GEMINI_BASE_URL: 'https://test.invalid',
    GEMINI_API_BASE_URL: 'https://test.invalid', GOOGLE_EXTERNAL_ACCOUNT_TOKEN_TYPE: 'test',
    CLOUD_SHELL: 'true', DEVSHELL_CLIENT_PORT: '12345',
    PSModulePath: 'PowerShell 7 module path incompatible with Windows PowerShell',
  }
  const env = { ...unsafe, HTTPS_PROXY: 'http://127.0.0.1:8000', PATH: 'keep-path', GEMINI_CLI_HOME: 'old-home' }
  const spec = buildGeminiCliSpec({ account: '2', dataDirectory: directory, entryPath: entry, args: ['--model', 'my model', '--help'], env })
  for (const key of Object.keys(unsafe)) assert.equal(key in spec.env, false, key)
  assert.deepEqual(spec.argv, [entry, '--model', 'my model', '--help'])
  assert.equal(spec.env.HTTPS_PROXY, env.HTTPS_PROXY)
  assert.equal(spec.env.PATH, env.PATH)
  assert.equal(spec.env.GEMINI_CLI_HOME, join(directory, 'gemini', 'account-2'))
  assert.equal(spec.env.GEMINI_FORCE_FILE_STORAGE, 'true')
  assert.equal(spec.env.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE, 'true')
  assert.equal(spec.env.GEMINI_CLI_NO_RELAUNCH, '1')
  assert.equal('GEMINI_CLI_SYSTEM_SETTINGS_PATH' in spec.env, false)
  assert.equal(env.GEMINI_API_KEY, 'test-key')
  assert.equal(env.GEMINI_CLI_HOME, 'old-home')
})

test('launcher runs the selected account and forwards official CLI arguments through paths with spaces', t => {
  const directory = fixture(t)
  const entry = fakeEntry(directory)
  const result = spawnSync(process.execPath, [launcher, '--account', '2', '--', '--help', 'two words'], {
    cwd: directory,
    env: { ...process.env, DSH_PERSONAL_DATA_DIRECTORY: directory, DSH_PERSONAL_GEMINI_CLI_ENTRY: entry, GEMINI_API_KEY: 'test-key' },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    argv: ['--help', 'two words'], home: join(directory, 'gemini', 'account-2'), apiKeyPresent: false,
    auth: { selectedType: 'oauth-personal', enforcedType: 'oauth-personal' },
    storage: 'true', encryptedStorage: 'true', noRelaunch: '1',
  })
})

test('probe reports only non-secret launch facts and does not execute the CLI', t => {
  const directory = fixture(t)
  const entry = join(directory, 'never execute.mjs')
  writeFileSync(entry, 'throw new Error("Probe executed the CLI")')
  const result = spawnSync(process.execPath, [launcher, '--account', '1', '--probe'], {
    cwd: directory,
    env: { ...process.env, DSH_PERSONAL_DATA_DIRECTORY: directory, DSH_PERSONAL_GEMINI_CLI_ENTRY: entry, GEMINI_API_KEY: 'test-key' },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    entryPath: entry, accountHome: join(directory, 'gemini', 'account-1'), credentialMode: 'official-account-oauth',
  })
  assert.equal(result.stdout.includes('test-key'), false)
  assert.equal(existsSync(join(directory, 'gemini')), false)
})

test('CLI arguments cannot disable environment isolation or place its flag after a delimiter', async t => {
  const { buildGeminiCliSpec } = await load()
  const directory = fixture(t)
  const entryPath = fakeEntry(directory)
  for (const args of [['--ignore-env=false'], ['--no-ignore-env'], ['--ignore-env', 'false']]) {
    assert.throws(() => buildGeminiCliSpec({ account: '1', dataDirectory: directory, entryPath, args }), /ignore-env.*enforced/i)
  }
  const spec = buildGeminiCliSpec({ account: '1', dataDirectory: directory, entryPath, args: ['--', 'a prompt'] })
  assert.deepEqual(spec.argv, [entryPath, '--', 'a prompt'])
})

test('launcher rejects an invalid account before executing the CLI', t => {
  const directory = fixture(t)
  const result = spawnSync(process.execPath, [launcher, '--account', '3', '--', '--help'], {
    env: { ...process.env, DSH_PERSONAL_DATA_DIRECTORY: directory, DSH_PERSONAL_GEMINI_CLI_ENTRY: fakeEntry(directory) }, encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /account.*1.*2/i)
})

test('launcher rejects existing non-account authentication without overwriting settings', async t => {
  const { initializeGeminiAccounts, geminiAccountHome } = await load()
  const directory = fixture(t)
  initializeGeminiAccounts(directory)
  const settingsPath = join(geminiAccountHome(directory, '1'), '.gemini', 'settings.json')
  const previous = JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } } })
  writeFileSync(settingsPath, previous)
  const result = spawnSync(process.execPath, [launcher, '--account', '1', '--', '--help'], {
    env: { ...process.env, DSH_PERSONAL_DATA_DIRECTORY: directory, DSH_PERSONAL_GEMINI_CLI_ENTRY: fakeEntry(directory) }, encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /oauth-personal/i)
  assert.equal(readFileSync(settingsPath, 'utf8'), previous)
})

test('a damaged account remains probeable and does not prevent the other account from starting', async t => {
  const { initializeGeminiAccounts, geminiAccountHome } = await load()
  const directory = fixture(t)
  initializeGeminiAccounts(directory)
  const settingsPath = join(geminiAccountHome(directory, '1'), '.gemini', 'settings.json')
  writeFileSync(settingsPath, '{ broken settings')
  const env = { ...process.env, DSH_PERSONAL_DATA_DIRECTORY: directory, DSH_PERSONAL_GEMINI_CLI_ENTRY: fakeEntry(directory) }
  const probe = spawnSync(process.execPath, [launcher, '--account', '1', '--probe'], { env, encoding: 'utf8' })
  assert.equal(probe.status, 0, probe.stderr)
  const broken = spawnSync(process.execPath, [launcher, '--account', '1', '--', '--help'], { env, encoding: 'utf8' })
  assert.notEqual(broken.status, 0)
  const working = spawnSync(process.execPath, [launcher, '--account', '2', '--', '--help'], { env, encoding: 'utf8' })
  assert.equal(working.status, 0, working.stderr)
  assert.equal(JSON.parse(working.stdout).home, geminiAccountHome(directory, '2'))
})

test('a missing official settings loader is rejected before entry execution', t => {
  const directory = fixture(t)
  const entry = join(directory, 'unrecognized-entry.mjs')
  writeFileSync(entry, 'console.log("This must not run")')
  const env = { ...process.env, DSH_PERSONAL_DATA_DIRECTORY: directory, DSH_PERSONAL_GEMINI_CLI_ENTRY: entry }
  const result = spawnSync(process.execPath, [launcher, '--account', '1', '--', '--help'], { env, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /official.*settings loader/i)
  assert.equal(result.stdout.includes('This must not run'), false)
})

test('external authentication in the official merged settings is rejected', async t => {
  const { initializeGeminiAccounts, geminiAccountHome } = await load()
  const directory = fixture(t)
  initializeGeminiAccounts(directory)
  const settingsPath = join(geminiAccountHome(directory, '1'), '.gemini', 'settings.json')
  const previous = JSON.stringify({ security: { auth: { selectedType: 'oauth-personal', enforcedType: 'oauth-personal', useExternal: true } } })
  writeFileSync(settingsPath, previous)
  const env = { ...process.env, DSH_PERSONAL_DATA_DIRECTORY: directory, DSH_PERSONAL_GEMINI_CLI_ENTRY: fakeEntry(directory) }
  const result = spawnSync(process.execPath, [launcher, '--account', '1', '--', '--help'], { env, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /official.*oauth-personal/i)
  assert.equal(readFileSync(settingsPath, 'utf8'), previous)
})

test('account settings that enable project dotenv are rejected without exposing invalid configuration', async t => {
  const { initializeGeminiAccounts, geminiAccountHome } = await load()
  const directory = fixture(t)
  initializeGeminiAccounts(directory)
  const settingsPath = join(geminiAccountHome(directory, '1'), '.gemini', 'settings.json')
  const env = { ...process.env, DSH_PERSONAL_DATA_DIRECTORY: directory, DSH_PERSONAL_GEMINI_CLI_ENTRY: fakeEntry(directory) }
  const previous = JSON.stringify({ security: { auth: { selectedType: 'oauth-personal', enforcedType: 'oauth-personal' } }, advanced: { ignoreLocalEnv: false } })
  writeFileSync(settingsPath, previous)
  const conflict = spawnSync(process.execPath, [launcher, '--account', '1', '--', '--help'], { cwd: directory, env, encoding: 'utf8' })
  assert.notEqual(conflict.status, 0)
  assert.match(conflict.stderr, /ignoreLocalEnv/i)
  assert.equal(readFileSync(settingsPath, 'utf8'), previous)
  writeFileSync(settingsPath, '{ test-settings-secret invalid-json }')
  const invalid = spawnSync(process.execPath, [launcher, '--account', '1', '--', '--help'], { cwd: directory, env, encoding: 'utf8' })
  assert.notEqual(invalid.status, 0)
  assert.equal(invalid.stderr.includes('test-settings-secret'), false)
})

test('workspace and ancestor Gemini environment files are rejected without being read or edited', async t => {
  const { initializeGeminiAccounts } = await load()
  for (const isAncestor of [false, true]) {
    const directory = fixture(t)
    initializeGeminiAccounts(directory)
    const cwd = isAncestor ? join(directory, 'child', 'workspace') : directory
    mkdirSync(cwd, { recursive: true })
    const envDirectory = join(directory, '.gemini')
    mkdirSync(envDirectory)
    const conflictPath = join(envDirectory, '.env')
    const original = 'GEMINI_API_KEY=test-conflicting-workspace-key\n'
    writeFileSync(conflictPath, original)
    const env = { ...process.env, DSH_PERSONAL_DATA_DIRECTORY: directory, DSH_PERSONAL_GEMINI_CLI_ENTRY: fakeEntry(directory) }
    const result = spawnSync(process.execPath, [launcher, '--account', '1', '--', '--help'], { cwd, env, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.equal(result.stderr.includes(conflictPath), true)
    assert.equal(result.stderr.includes('test-conflicting-workspace-key'), false)
    assert.equal(readFileSync(conflictPath, 'utf8'), original)
    const probe = spawnSync(process.execPath, [launcher, '--account', '1', '--probe'], { cwd, env, encoding: 'utf8' })
    assert.equal(probe.status, 0, probe.stderr)
  }
})

test('account home dotenv files are rejected while install probes remain independent', async t => {
  const { initializeGeminiAccounts, geminiAccountHome } = await load()
  for (const isGeminiDirectory of [false, true]) {
    const directory = fixture(t)
    initializeGeminiAccounts(directory)
    const accountHome = geminiAccountHome(directory, '1')
    const conflictPath = join(accountHome, ...(isGeminiDirectory ? ['.gemini', '.env'] : ['.env']))
    const original = 'GEMINI_API_KEY=test-conflicting-home-key\n'
    writeFileSync(conflictPath, original)
    const env = { ...process.env, DSH_PERSONAL_DATA_DIRECTORY: directory, DSH_PERSONAL_GEMINI_CLI_ENTRY: fakeEntry(directory) }
    const result = spawnSync(process.execPath, [launcher, '--account', '1', '--', '--help'], { cwd: directory, env, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.equal(result.stderr.includes(conflictPath), true)
    assert.equal(result.stderr.includes('test-conflicting-home-key'), false)
    assert.equal(readFileSync(conflictPath, 'utf8'), original)
    const probe = spawnSync(process.execPath, [launcher, '--account', '1', '--probe'], { cwd: directory, env, encoding: 'utf8' })
    assert.equal(probe.status, 0, probe.stderr)
  }
})

test('the installed official settings loader ignores project dotenv and rejects conflicting workspace authentication', async t => {
  const { initializeGeminiAccounts, geminiAccountHome, resolveGeminiCliEntry } = await load()
  let officialEntry
  try {
    officialEntry = resolveGeminiCliEntry()
  } catch (error) {
    if (!/not found/i.test(error.message)) throw error
    t.skip('Official Gemini CLI is not installed')
    return
  }
  const directory = fixture(t)
  initializeGeminiAccounts(directory)
  const settingsPath = join(geminiAccountHome(directory, '1'), '.gemini', 'settings.json')
  writeFileSync(settingsPath, JSON.stringify({ security: { auth: { selectedType: 'oauth-personal', enforcedType: 'oauth-personal' }, folderTrust: { enabled: false } }, advanced: { ignoreLocalEnv: true } }))
  mkdirSync(join(directory, '.gemini'))
  const workspaceSettingsPath = join(directory, '.gemini', 'settings.json')
  writeFileSync(workspaceSettingsPath, JSON.stringify({ advanced: { ignoreLocalEnv: true } }))
  writeFileSync(join(directory, '.env'), 'GEMINI_API_KEY=test-project-env-key\n')
  const env = { ...process.env, DSH_PERSONAL_DATA_DIRECTORY: directory, DSH_PERSONAL_GEMINI_CLI_ENTRY: officialEntry }
  const clean = spawnSync(process.execPath, [launcher, '--account', '1', '--', '--version'], {
    cwd: directory,
    env, encoding: 'utf8',
  })
  assert.equal(clean.status, 0, clean.stderr)
  assert.match(clean.stdout, /^\d+\.\d+\.\d+/)
  const conflicting = JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key', enforcedType: 'gemini-api-key', apiKey: 'test-settings-secret' } } })
  writeFileSync(workspaceSettingsPath, conflicting)
  const result = spawnSync(process.execPath, [launcher, '--account', '1', '--', '--version'], { cwd: directory, env, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /official.*oauth-personal/i)
  assert.equal(result.stderr.includes('test-settings-secret'), false)
  assert.equal(result.stderr.includes('test-project-env-key'), false)
  assert.equal(readFileSync(workspaceSettingsPath, 'utf8'), conflicting)
  writeFileSync(workspaceSettingsPath, JSON.stringify({ advanced: { ignoreLocalEnv: false } }))
  const envConflict = spawnSync(process.execPath, [launcher, '--account', '1', '--', '--version'], { cwd: directory, env, encoding: 'utf8' })
  assert.notEqual(envConflict.status, 0)
  assert.match(envConflict.stderr, /ignoreLocalEnv/i)
  assert.equal(envConflict.stderr.includes('test-project-env-key'), false)
})

test('the installed official CLI parses a native command without requiring account login', async t => {
  const { initializeGeminiAccounts, resolveGeminiCliEntry } = await load()
  let officialEntry
  try {
    officialEntry = resolveGeminiCliEntry()
  } catch (error) {
    if (!/not found/i.test(error.message)) throw error
    t.skip('Official Gemini CLI is not installed')
    return
  }
  const directory = fixture(t)
  initializeGeminiAccounts(directory)
  const result = spawnSync(process.execPath, [launcher, '--account', '1', '--', 'mcp', 'list'], {
    cwd: directory,
    env: { ...process.env, DSH_PERSONAL_DATA_DIRECTORY: directory, DSH_PERSONAL_GEMINI_CLI_ENTRY: officialEntry },
    encoding: 'utf8', windowsHide: true, timeout: 15000,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(/Unknown arguments:.*ignore-env/.test(result.stderr), false)
})

test('both Windows account entrances restart when the official CLI requests a relaunch', async t => {
  if (process.platform !== 'win32') {
    t.skip('Windows account entrances require cmd.exe')
    return
  }
  for (const account of ['1', '2']) {
    const directory = fixture(t)
    const entry = fakeEntry(directory)
    const mainPath = join(directory, 'gemini-test-main.mjs')
    const mainSource = readFileSync(mainPath, 'utf8')
    const restartingSource = "import { existsSync, writeFileSync } from 'node:fs'\n" + mainSource.replace('console.log(', `
const restartMarker = new URL('./restarted.flag', import.meta.url)
if (!existsSync(restartMarker)) {
  writeFileSync(restartMarker, 'relaunch requested')
  process.exit(199)
}
console.log(`)
    writeFileSync(mainPath, restartingSource)
    const cmdPath = fileURLToPath(new URL(`./Gemini Account ${account}.cmd`, import.meta.url))
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${cmdPath}" --help"`], {
      cwd: directory,
      env: { ...process.env, DSH_PERSONAL_DATA_DIRECTORY: directory, DSH_PERSONAL_GEMINI_CLI_ENTRY: entry },
      input: '\n', encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, timeout: 5000,
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, `Account ${account}: ${result.stderr}`)
    assert.equal(JSON.parse(result.stdout).home, join(directory, 'gemini', `account-${account}`))
    assert.equal(result.stdout.includes('Press any key'), false)
  }
})
