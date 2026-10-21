/** Account-specific launch settings for the official Antigravity remote OAuth flow. */
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, parse } from 'node:path'
import type { PersonalAccountId } from '@deepseek-ai/dsh-client-ui-personal-accounts/types'

/**
 * Prepare a private account home without reading or copying any saved token.
 * @param executable Official CLI executable.
 * @param dataDirectory Personal Desktop data root.
 * @param account Validated account selector.
 * @param environment Parent process environment, left unchanged.
 * @returns The working directory and credential-scrubbed child environment.
 */
export function prepareAntigravityAccount(
  executable: string, dataDirectory: string, account: PersonalAccountId, environment: NodeJS.ProcessEnv,
): { cwd: string; env: NodeJS.ProcessEnv } {
  if (!isAbsolute(executable) || !existsSync(executable) || !isAbsolute(dataDirectory)) {
    throw new Error('Official Antigravity CLI or account data directory is unavailable')
  }
  const cwd = join(dataDirectory, 'antigravity', `account-${account}`)
  mkdirSync(cwd, { recursive: true, mode: 0o700 })
  if (lstatSync(cwd).isSymbolicLink()) throw new Error('Antigravity account directory cannot be a link')
  if (process.platform === 'win32') {
    const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
    const identity = execFileSync(join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true })
    const sid = identity.match(/S-1-5-[\d-]+/)?.[0]
    if (sid === undefined) throw new Error('Could not protect the Antigravity account directory')
    execFileSync(join(system, 'icacls.exe'), [cwd, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true, stdio: 'pipe' })
  } else {
    chmodSync(cwd, 0o700)
  }
  const settingsDirectory = join(cwd, '.gemini', 'antigravity-cli')
  mkdirSync(settingsDirectory, { recursive: true, mode: 0o700 })
  const settingsPath = join(settingsDirectory, 'settings.json')
  if (existsSync(settingsPath)) {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { modelProvider?: unknown }
    if (settings.modelProvider !== undefined) throw new Error('Antigravity account authentication requires the default model provider; existing settings were preserved')
  } else {
    writeFileSync(settingsPath, JSON.stringify({ enableTelemetry: false, toolPermission: 'strict' }) + '\n', { flag: 'wx', mode: 0o600 })
  }
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(environment)
    .filter(([key]) => !/KEY|TOKEN|SECRET|PASSWORD|AGY_ADC|GOOGLE_APPLICATION_CREDENTIALS/i.test(key)))
  env.HOME = cwd
  env.USERPROFILE = cwd
  env.HOMEDRIVE = parse(cwd).root.replace(/[\\/]$/, '')
  env.HOMEPATH = cwd.slice(env.HOMEDRIVE.length)
  env.APPDATA = join(cwd, 'AppData', 'Roaming')
  env.LOCALAPPDATA = join(cwd, 'AppData', 'Local')
  mkdirSync(env.APPDATA, { recursive: true, mode: 0o700 })
  mkdirSync(env.LOCALAPPDATA, { recursive: true, mode: 0o700 })
  // Official SSH auth uses the account home's file store instead of the shared OS keyring.
  env.SSH_CONNECTION = '127.0.0.1 1234 127.0.0.1 22'
  env.SSH_CLIENT = '127.0.0.1 1234 22'
  return { cwd, env }
}
