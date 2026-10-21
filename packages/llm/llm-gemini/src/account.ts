/**
 * Account directory isolation and verification for official Antigravity CLI.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, parse, resolve } from 'node:path'

export type PersonalAccountId = '1' | '2'

/**
 * Resolve the official Antigravity CLI executable.
 */
export function resolveAntigravityExecutable(): string | undefined {
  const envExe = process.env.DSH_PERSONAL_ANTIGRAVITY_EXECUTABLE
  if (envExe && existsSync(envExe)) {
    return envExe
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const candidate = join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe')
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

/**
 * Resolve the personal data root directory.
 */
export function resolvePersonalDataDirectory(): string {
  const envDir = process.env.DSH_PERSONAL_DATA_DIRECTORY
  if (envDir && isAbsolute(envDir) && existsSync(envDir)) {
    return envDir
  }
  return resolve('D:\\desktop\\personal-data')
}

/**
 * Check if the Antigravity account is verified / authenticated.
 */
export function isAntigravityAccountConfigured(dataDirectory: string, account: PersonalAccountId): boolean {
  const cwd = join(dataDirectory, 'antigravity', `account-${account}`)
  if (!existsSync(cwd)) return false
  const settingsPath = join(cwd, '.gemini', 'antigravity-cli', 'settings.json')
  return existsSync(settingsPath)
}

/**
 * Prepare an isolated private account home without leaking ambient tokens or keys.
 */
export function prepareAntigravityAccount(
  executable: string,
  dataDirectory: string,
  account: PersonalAccountId,
  environment: NodeJS.ProcessEnv,
): { cwd: string; env: NodeJS.ProcessEnv } {
  if (!isAbsolute(executable) || !existsSync(executable) || !isAbsolute(dataDirectory)) {
    throw new Error('Official Antigravity CLI or account data directory is unavailable')
  }
  const cwd = join(dataDirectory, 'antigravity', `account-${account}`)
  mkdirSync(cwd, { recursive: true, mode: 0o700 })
  if (lstatSync(cwd).isSymbolicLink()) {
    throw new Error('Antigravity account directory cannot be a symbolic link')
  }
  if (process.platform === 'win32') {
    const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
    try {
      const identity = execFileSync(join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
        encoding: 'utf8',
        windowsHide: true,
      })
      const sid = identity.match(/S-1-5-[\d-]+/)?.[0]
      if (sid) {
        execFileSync(
          join(system, 'icacls.exe'),
          [cwd, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'],
          { windowsHide: true, stdio: 'pipe' },
        )
      }
    } catch {
      // Permission tightening best-effort on Windows
    }
  } else {
    chmodSync(cwd, 0o700)
  }

  const settingsDirectory = join(cwd, '.gemini', 'antigravity-cli')
  mkdirSync(settingsDirectory, { recursive: true, mode: 0o700 })
  const settingsPath = join(settingsDirectory, 'settings.json')
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { modelProvider?: unknown }
      if (settings.modelProvider !== undefined) {
        throw new Error('Antigravity account authentication requires the default model provider; existing settings were preserved')
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('default model provider')) throw err
    }
  } else {
    writeFileSync(settingsPath, JSON.stringify({ enableTelemetry: false, toolPermission: 'strict' }) + '\n', {
      flag: 'wx',
      mode: 0o600,
    })
  }

  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !/KEY|TOKEN|SECRET|PASSWORD|AGY_ADC|GOOGLE_APPLICATION_CREDENTIALS/i.test(key),
    ),
  )

  env.HOME = cwd
  env.USERPROFILE = cwd
  env.HOMEDRIVE = parse(cwd).root.replace(/[\\/]$/, '')
  env.HOMEPATH = cwd.slice(env.HOMEDRIVE.length)
  env.APPDATA = join(cwd, 'AppData', 'Roaming')
  env.LOCALAPPDATA = join(cwd, 'AppData', 'Local')
  mkdirSync(env.APPDATA, { recursive: true, mode: 0o700 })
  mkdirSync(env.LOCALAPPDATA, { recursive: true, mode: 0o700 })

  // Match official SSH auth configuration for remote agent
  env.SSH_CONNECTION = '127.0.0.1 1234 127.0.0.1 22'
  env.SSH_CLIENT = '127.0.0.1 1234 22'

  return { cwd, env }
}
