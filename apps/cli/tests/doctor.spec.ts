import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runDoctor } from '../src/doctor.ts'

const previousHome = process.env.DSH_HOME
let home: string | undefined

/** One composed profile patch: a provider row plus the default-model pair under test. */
function patchFor(defaultProvider: string, defaultModel: string): string {
  return `- insert:
    - id: llm-gemini
      name: '@deepseek-ai/dsh-llm-gemini'
      config:
        providerName: gemini-2
    - id: subagent-model-selection-settings
      name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
      config:
        enabled: true
        allowedModels:
          - provider: gemini-2
            model: gemini-3.8-flash
    - id: subagent-default-model
      name: '@deepseek-ai/dsh-subagent-default-model'
      config:
        provider: ${defaultProvider}
        model: ${defaultModel}
`
}

/** Materialize a DSH home with one profile and return it, selecting it for this test. */
function makeHome(profile: string, patch: string): string {
  home = mkdtempSync(join(tmpdir(), 'dsh-doctor-'))
  const dir = join(home, 'profiles', profile)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: `profile-${profile}`,
    version: '1.0.0',
    dsh: { profile: { bundles: [] } },
  }))
  writeFileSync(join(dir, 'cordis.patch.yml'), patch)
  process.env.DSH_HOME = home
  return home
}

/** Capture everything the doctor writes to stdout. */
function captureStdout(): () => string {
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  return () => write.mock.calls.map(([chunk]) => String(chunk)).join('')
}

afterEach(() => {
  vi.restoreAllMocks()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (home !== undefined) {
    rmSync(home, { recursive: true, force: true })
    home = undefined
  }
})

describe('runDoctor', () => {
  it('fails when the subagent default route is outside the authorized list', () => {
    makeHome('desktop', patchFor('codex', 'gpt-5.6-sol'))
    const output = captureStdout()
    const code = runDoctor({})
    const text = output()
    expect(code).toBe(1)
    expect(text).toContain('FAIL 2. subagent default model')
    expect(text).toContain('codex/gpt-5.6-sol')
    expect(text).toContain('gemini-2/gemini-3.8-flash')
  })

  it('passes when the default route is authorized', () => {
    makeHome('desktop', patchFor('gemini-2', 'gemini-3.8-flash'))
    const output = captureStdout()
    const code = runDoctor({})
    const text = output()
    expect(code).toBe(0)
    expect(text).toContain('PASS 2. subagent default model')
  })

  it('reports a missing explicitly named profile as a failure instead of booting', () => {
    makeHome('desktop', patchFor('gemini-2', 'gemini-3.8-flash'))
    const output = captureStdout()
    const code = runDoctor({ profile: 'missing' })
    const text = output()
    expect(code).toBe(1)
    expect(text).toContain('FAIL 1. configuration & compatibility')
    expect(text).toContain('missing')
  })
})
