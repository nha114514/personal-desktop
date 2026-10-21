/** Run the installed official Antigravity CLI in one personal account home. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareAntigravityAccount } from '../apps/desktop/lib/types/personal-antigravity.js'

try {
  let account
  let probe = false
  let args = []
  const argv = process.argv.slice(2)
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--') { args = argv.slice(index + 1); break }
    if (argv[index] === '--account') account = argv[++index]
    else if (argv[index] === '--probe') probe = true
    else throw new Error('Usage: AntigravityCli.mjs --account 1|2 [--probe] -- [official CLI arguments]')
  }
  if (account !== '1' && account !== '2') throw new Error('Personal account must be 1 or 2')
  const dataDirectory = resolve(process.env.DSH_PERSONAL_DATA_DIRECTORY || fileURLToPath(new URL('../../personal-data', import.meta.url)))
  const executable = process.env.DSH_PERSONAL_ANTIGRAVITY_EXECUTABLE || join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe')
  if (!existsSync(executable)) throw new Error('Official Antigravity CLI is unavailable. Install agy before using this entry.')
  const spec = prepareAntigravityAccount(executable, dataDirectory, account, process.env)
  if (probe) {
    console.log(JSON.stringify({ executable, accountHome: spec.cwd, credentialMode: 'official-remote-oauth' }))
  } else {
    const child = spawn(executable, args, { ...spec, stdio: 'inherit', windowsHide: true })
    child.on('error', () => { console.error('Official Antigravity CLI could not start.'); process.exitCode = 1 })
    child.on('close', code => { process.exitCode = code ?? 1 })
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Antigravity account launch failed.')
  process.exitCode = 1
}
