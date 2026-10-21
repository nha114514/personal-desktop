/** Official Gemini CLI discovery and separate OAuth account homes. */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

function requireEntry(path) {
  const entry = resolve(path)
  try {
    if (statSync(entry).isFile()) return entry
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
  }
  throw new Error(`Official Gemini CLI entry not found: ${entry}`)
}

/**
 * Find the official npm entry without copying its installation or credentials.
 * @param {NodeJS.ProcessEnv} env Environment used for explicit or npm discovery.
 * @returns {string} Absolute JavaScript CLI entry.
 */
export function resolveGeminiCliEntry(env = process.env) {
  if (env.DSH_PERSONAL_GEMINI_CLI_ENTRY) return requireEntry(env.DSH_PERSONAL_GEMINI_CLI_ENTRY)
  if (!env.APPDATA) throw new Error('Official Gemini CLI entry not found: APPDATA is unavailable')
  const packageDirectory = join(env.APPDATA, 'npm', 'node_modules', '@google', 'gemini-cli')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw new Error(`Official Gemini CLI package not found: ${packageDirectory}`)
    }
    throw error
  }
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.gemini
  if (typeof entry !== 'string' || entry.length === 0) throw new Error('Official Gemini CLI package has no gemini entry')
  return requireEntry(resolve(packageDirectory, entry))
}

/**
 * Resolve one of the two isolated Gemini account homes.
 * @param {string} dataDirectory Absolute personal data directory.
 * @param {'1'|'2'} account Account slot; numeric values are not accepted.
 * @returns {string} Gemini CLI home, containing its own .gemini directory.
 */
export function geminiAccountHome(dataDirectory, account) {
  if (account !== '1' && account !== '2') throw new Error('Gemini account must be 1 or 2')
  if (typeof dataDirectory !== 'string' || !isAbsolute(dataDirectory)) throw new Error('Personal data directory must be an absolute path')
  return join(dataDirectory, 'gemini', `account-${account}`)
}

function createIfMissing(path, settings) {
  try {
    writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
}

/**
 * Create missing official OAuth settings, preserving existing files.
 * @param {string} dataDirectory Absolute personal data directory.
 * @returns {void}
 */
export function initializeGeminiAccounts(dataDirectory) {
  for (const account of ['1', '2']) {
    const settingsDirectory = join(geminiAccountHome(dataDirectory, account), '.gemini')
    mkdirSync(settingsDirectory, { recursive: true })
    const settings = {
      security: { auth: { selectedType: 'oauth-personal', enforcedType: 'oauth-personal' } },
      advanced: { ignoreLocalEnv: true },
    }
    createIfMissing(join(settingsDirectory, 'settings.json'), settings)
  }
}

const extraGoogleAuthentication = /^(?:(?:GEMINI|GOOGLE)_(?:.*(?:API|AUTH|CREDENTIAL|ACCESS_TOKEN|BASE_URL|ENDPOINT).*|GENAI_USE_.*|EXTERNAL_ACCOUNT.*|CLOUD_PROJECT|CLOUD_LOCATION|CLOUD_QUOTA_PROJECT))$/i

/**
 * Prepare account-only CLI arguments and environment without changing the caller.
 * @param {{account:'1'|'2',dataDirectory:string,args?:string[],env?:NodeJS.ProcessEnv,entryPath?:string}} options Account and installed entry settings.
 * @returns {{entryPath:string,argv:string[],env:NodeJS.ProcessEnv,accountHome:string}} Executable arguments and isolated child environment.
 */
export function buildGeminiCliSpec({ account, dataDirectory, args = [], env = process.env, entryPath }) {
  const accountHome = geminiAccountHome(dataDirectory, account)
  if (args.some(arg => /^--(?:no-)?ignore-env(?:=|$)/i.test(arg))) throw new Error('--ignore-env is enforced for account-only Gemini CLI')
  const resolvedEntry = entryPath ? requireEntry(entryPath) : resolveGeminiCliEntry(env)
  // The official Windows ACL probe uses Windows PowerShell's own module paths.
  const removedEnvironmentKeys = ['CLOUD_SHELL', 'DEVSHELL_CLIENT_PORT', 'PSMODULEPATH']
  const accountEnvironment = Object.fromEntries(Object.entries(env).filter(([key]) => !extraGoogleAuthentication.test(key) && !removedEnvironmentKeys.includes(key.toUpperCase())))
  accountEnvironment.GEMINI_CLI_HOME = accountHome
  accountEnvironment.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE = 'true'
  accountEnvironment.GEMINI_FORCE_FILE_STORAGE = 'true'
  accountEnvironment.GEMINI_CLI_NO_RELAUNCH = '1'
  return { entryPath: resolvedEntry, argv: [resolvedEntry, ...args], env: accountEnvironment, accountHome }
}
