/** Launch the installed official Gemini CLI with one isolated personal account. */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildGeminiCliSpec, initializeGeminiAccounts } from './gemini-cli.mjs'

function parseArguments(argv) {
  let account
  let probe = false
  let args = []
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--') {
      args = argv.slice(index + 1)
      break
    }
    if (argv[index] === '--account') account = argv[++index]
    else if (argv[index] === '--probe') probe = true
    else throw new Error('Usage: GeminiCli.mjs --account 1|2 [--probe] -- [official Gemini CLI arguments]')
  }
  return { account, probe, args }
}

function assertNoEnvironmentFile(accountHome) {
  const environmentPaths = new Set([join(accountHome, '.env'), join(accountHome, '.gemini', '.env')])
  let currentDirectory = resolve(process.cwd())
  while (true) {
    environmentPaths.add(join(currentDirectory, '.gemini', '.env'))
    const parentDirectory = dirname(currentDirectory)
    if (parentDirectory === currentDirectory) break
    currentDirectory = parentDirectory
  }
  for (const environmentPath of environmentPaths) {
    if (existsSync(environmentPath)) throw new Error(`Account-only Gemini CLI cannot load this environment file: ${environmentPath}`)
  }
}

async function assertOfficialAccountSettings(entryPath) {
  const entrySource = readFileSync(entryPath, 'utf8')
  const mainImport = entrySource.match(/import\(\s*(['"])(\.\/gemini-[^'"]+\.m?js)\1\s*\)/)
  if (!mainImport) throw new Error('Official Gemini CLI settings loader was not found in the installed entry')
  const mainPath = resolve(dirname(entryPath), mainImport[2])
  const mainSource = readFileSync(mainPath, 'utf8')
  const settingsImport = mainSource.match(/import\s*\{[^}]*\bloadSettings\b[^}]*\}\s*from\s*(['"])(\.\/[^'"]+)\1/s)
  if (!settingsImport) throw new Error('Official Gemini CLI settings loader was not found in the installed main module')
  const settingsPath = resolve(dirname(mainPath), settingsImport[2])
  const settingsModule = await import(pathToFileURL(settingsPath).href)
  if (typeof settingsModule.loadSettings !== 'function') throw new Error('Official Gemini CLI settings loader does not export loadSettings')
  let settings
  try {
    settings = settingsModule.loadSettings(process.cwd())
  } catch {
    throw new Error('Official Gemini CLI settings could not be loaded. Existing files were preserved.')
  }
  const auth = settings?.merged?.security?.auth
  if (auth?.selectedType !== 'oauth-personal' || auth.enforcedType !== 'oauth-personal' || (auth.useExternal !== undefined && auth.useExternal !== false)) {
    throw new Error('Official merged Gemini CLI settings must enforce oauth-personal account authentication without external authentication. Existing configuration was preserved.')
  }
  if (settings.merged.advanced?.ignoreLocalEnv !== true) {
    throw new Error('Official merged Gemini CLI settings must set advanced.ignoreLocalEnv to true. Existing configuration was preserved.')
  }
}

async function main() {
  const { account, probe, args } = parseArguments(process.argv.slice(2))
  const dataDirectory = resolve(process.env.DSH_PERSONAL_DATA_DIRECTORY || fileURLToPath(new URL('../../personal-data', import.meta.url)))
  const spec = buildGeminiCliSpec({ account, dataDirectory, args })
  if (probe) {
    console.log(JSON.stringify({ entryPath: spec.entryPath, accountHome: spec.accountHome, credentialMode: 'official-account-oauth' }))
    return
  }
  assertNoEnvironmentFile(spec.accountHome)
  initializeGeminiAccounts(dataDirectory)
  process.env = spec.env
  // The settings loader recognizes this flag, but v0.62.0's argument parser
  // rejects it. Use it only while loading and validating settings, then rely
  // on the verified official ignoreLocalEnv setting for the CLI itself.
  process.argv = [process.execPath, spec.entryPath, '--ignore-env', ...args]
  await assertOfficialAccountSettings(spec.entryPath)
  process.argv = [process.execPath, ...spec.argv]
  await import(pathToFileURL(spec.entryPath).href)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
