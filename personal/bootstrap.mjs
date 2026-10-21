import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('.', import.meta.url))

function createIfMissing(path, contents) {
  try {
    writeFileSync(path, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
}

/**
 * Create initial personal configuration without replacing user edits or credentials.
 * @param {string} home Absolute personal Harness home.
 * @returns {void}
 */
export function initializePersonalHome(home) {
  if (typeof home !== 'string' || !isAbsolute(home)) throw new Error('Personal home must be an absolute path')
  mkdirSync(home, { recursive: true })
  const profile = join(home, 'profiles', 'desktop')
  mkdirSync(profile, { recursive: true })
  createIfMissing(join(profile, 'cordis.patch.yml'), readFileSync(join(directory, 'personal.patch.yml'), 'utf8'))
  createIfMissing(join(home, 'AGENTS.md'), readFileSync(join(directory, 'INSTRUCTIONS.md'), 'utf8'))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  initializePersonalHome(process.argv[2])
}
