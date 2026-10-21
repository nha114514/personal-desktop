import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

export function resolveCodexExecutable(): string | undefined {
  const envExe = process.env.DSH_PERSONAL_CODEX_EXECUTABLE
  if (envExe && existsSync(envExe)) {
    return envExe
  }

  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const baseDir = join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
    if (existsSync(baseDir)) {
      try {
        const dirs = readdirSync(baseDir)
        // Reverse sort to prefer newer hashes / versions
        for (const dir of dirs.reverse()) {
          const candidate = join(baseDir, dir, 'codex.exe')
          if (existsSync(candidate)) {
            return candidate
          }
        }
      } catch {
        // readdir failure falls through
      }
    }
  }

  try {
    const require = createRequire(import.meta.url)
    const pkgPath = require.resolve('@openai/codex/package.json')
    const manifest = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin?: { codex?: string } }
    if (manifest.bin?.codex) {
      return resolve(dirname(pkgPath), manifest.bin.codex)
    }
  } catch {
    // resolution failure falls through
  }

  return undefined
}

export function getCodexAppServerArgv(): string[] {
  const exe = resolveCodexExecutable()
  if (!exe) {
    throw new Error('Codex executable not found. Please install Codex Desktop or configure DSH_PERSONAL_CODEX_EXECUTABLE.')
  }
  if (exe.endsWith('.js')) {
    return [process.execPath, exe, 'app-server', '--stdio']
  }
  return [exe, 'app-server', '--stdio']
}
