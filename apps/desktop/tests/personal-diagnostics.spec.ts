import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PersonalDiagnostics } from '../src/personal-diagnostics.ts'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    expect(resolve(directory).startsWith(join(resolve(tmpdir()), 'personal-diagnostics-'))).toBe(true)
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

function diagnostics(): PersonalDiagnostics {
  const directory = mkdtempSync(join(tmpdir(), 'personal-diagnostics-'))
  directories.push(directory)
  const account = join(directory, 'antigravity', 'account-2', '.gemini', 'antigravity-cli')
  mkdirSync(account, { recursive: true })
  writeFileSync(join(account, 'antigravity-oauth-token'), 'private-test-credential')
  const profile = join(directory, 'home', 'profiles', 'desktop')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: agent-default-model\n  config: { provider: codex, model: gpt-6.1-sol, reasoningEffort: ultra }\n')
  return new PersonalDiagnostics({ workspaceRoot: directory, dataDirectory: directory, codexHome: join(directory, 'codex') })
}

describe('PersonalDiagnostics', () => {
  it('correctly tracks live stages, dependencies, and redacts credentials in export', () => {
    const diag = diagnostics()
    const snap = diag.snapshot()

    // 1. Model routes
    expect(snap.modelRoutes.primaryModel.provider).toBe('codex')
    expect(snap.modelRoutes.primaryModel.model).toBe('gpt-6.1-sol')
    expect(snap.modelRoutes.configuredMatchesActual).toBeNull()
    expect(snap.modelRoutes.channelType).toBe('unknown')

    // 2. Live stage progress tracking
    diag.setLiveStage('waiting-first-token', '等待首个模型事件')
    const stageSnap = diag.snapshot()
    expect(stageSnap.liveStage.stage).toBe('waiting-first-token')
    expect(stageSnap.liveStage.description).toBe('等待首个模型事件')

    // 3. Dependencies check
    expect(stageSnap.dependencies.some(d => d.name.includes('Windows-MCP'))).toBe(true)
    expect(stageSnap.dependencies.some(d => d.name.includes('Node.js'))).toBe(true)

    // 4. Export redaction
    const exported = diag.exportDiagnostics()
    expect(exported).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/)
    expect(JSON.parse(exported)).toBeTruthy()
  })

  it('detects model route divergences between configured and actual execution routes', () => {
    const diag = diagnostics()
    // Configured effort is ultra
    const initialSnap = diag.snapshot()
    expect(initialSnap.modelRoutes.primaryModel.reasoningEffort).toBe('ultra')

    // Actual execution route differs in reasoningEffort (e.g. low vs ultra)
    diag.recordActualRoute({
      provider: 'codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'low',
    })
    const divergedSnap = diag.snapshot()
    expect(divergedSnap.modelRoutes.configuredMatchesActual).toBe(false)

    // Matching actual execution route restores configuredMatchesActual = true
    diag.recordActualRoute({
      provider: 'codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'ultra',
    })
    const matchedSnap = diag.snapshot()
    expect(matchedSnap.modelRoutes.configuredMatchesActual).toBe(true)
  })

  it('records real request identities and timing without allowing child or late results to replace the primary route', () => {
    const diag = diagnostics()
    const primary = { requestId: 'root-1', sessionId: 'primary-session', role: 'primary', provider: 'codex', model: 'gpt-6.1-sol', reasoningEffort: 'ultra', channelType: 'membership-cli' }
    diag.recordObservation({ ...primary, phase: 'started', elapsedMs: 0, prompt: 'private-prompt', apiKey: 'private-credential' })
    diag.recordObservation({ ...primary, phase: 'first-event', elapsedMs: 12 })
    diag.recordObservation({ ...primary, phase: 'first-text', elapsedMs: 18 })
    const child = { requestId: 'child-1', sessionId: 'child-session', parentSessionId: 'primary-session', role: 'subagent', provider: 'custom-api', model: 'chosen-child', channelType: 'api-direct' }
    diag.recordObservation({ ...child, phase: 'started', elapsedMs: 0 })
    diag.recordObservation({ ...child, phase: 'finished', elapsedMs: 20, outcome: 'success' })
    const newer = { ...primary, requestId: 'root-2', model: 'new-choice' }
    diag.recordObservation({ ...newer, phase: 'started', elapsedMs: 0 })
    diag.recordObservation({ ...primary, phase: 'finished', elapsedMs: 80, outcome: 'success' })
    const snap = diag.snapshot()
    expect(snap.modelRoutes.actualPrimary?.requestId).toBe('root-2')
    expect(snap.modelRoutes.actualPrimary?.model).toBe('new-choice')
    expect(snap.modelRoutes.configuredMatchesActual).toBe(false)
    expect(snap.modelRequests.find(request => request.requestId === 'root-1')).toMatchObject({ firstEventMs: 12, firstTextMs: 18, finishedMs: 80 })
    expect(snap.modelRequests.find(request => request.requestId === 'child-1')?.role).toBe('subagent')
    expect(diag.exportDiagnostics()).not.toContain('private-prompt')
    expect(diag.exportDiagnostics()).not.toContain('private-credential')
  })

  it('keeps uncorrelated or malformed observations unknown and bounds request history', () => {
    const diag = diagnostics()
    diag.recordObservation({ requestId: 'orphan', phase: 'finished', provider: 'codex', model: 'x', role: 'primary', elapsedMs: 1 })
    diag.recordObservation({ requestId: 'invalid', phase: 'started', provider: 'codex', model: 'x', role: 'primary', elapsedMs: NaN })
    expect(diag.snapshot().modelRoutes.configuredMatchesActual).toBeNull()
    for (let index = 0; index < 45; index++) diag.recordObservation({ requestId: `aux-${index}`, provider: 'custom-api', model: 'x', role: 'auxiliary', phase: 'started', elapsedMs: 0 })
    expect(diag.snapshot().modelRequests.length).toBe(32)
    expect(diag.snapshot().modelRoutes.actualPrimary).toBeUndefined()
  })

  it('reports an observed API request as API and records failure without claiming success', () => {
    const diag = diagnostics()
    const request = { requestId: 'api-1', role: 'primary', provider: 'custom-api', model: 'chosen-api', channelType: 'api-direct' }
    diag.recordObservation({ ...request, phase: 'started', elapsedMs: 0 })
    diag.recordObservation({ ...request, phase: 'finished', elapsedMs: 40, outcome: 'error', failureCode: 'QUOTA_EXCEEDED', message: 'private-upstream-error' })
    expect(diag.snapshot().modelRoutes.channelType).toBe('api-direct')
    expect(diag.snapshot().modelRoutes.actualPrimary).toMatchObject({ outcome: 'error', failureCode: 'QUOTA_EXCEEDED' })
    expect(diag.exportDiagnostics()).not.toContain('private-upstream-error')
  })

  it('decouples Windows-MCP package version from FastMCP server protocol', () => {
    const diag = diagnostics()
    const snap = diag.snapshot()
    const winMcp = snap.dependencies.find(d => d.name.includes('Windows-MCP'))
    expect(winMcp).toBeDefined()
    if (winMcp && winMcp.status === 'available') {
      // Must report package version (e.g. 0.8.7) and FastMCP protocol (4.0.10/4.0.11), NOT hardcoded "4.0.11 (Python 3.14)"
      expect(winMcp.version).toMatch(/0\.8\.\d+/)
      expect(winMcp.version).toContain('FastMCP')
      expect(winMcp.version).not.toBe('4.0.11 (Python 3.14)')
    }
  })

  it('separates saved credentials from live verified and reports quota-exceeded without requiring re-login', () => {
    const diag = diagnostics()
    const snap = diag.snapshot()

    expect(snap.accounts.map(account => account.id)).toEqual(['2', 'codex'])
    // Google account 2 & Codex have credentials on disk in test environment: status must be 'saved', NOT falsely 'verified'
    const acc1 = snap.accounts.find(a => a.id === '2')
    expect(acc1).toBeDefined()
    expect(acc1!.status).toBe('saved')
    expect(acc1!.guidanceRequired).toBe(false)

    // Report quota-exceeded event: status becomes quota-exceeded, guidanceRequired remains false
    diag.recordAccountEvent('2', {
      type: 'quota-exceeded',
      message: 'Rate limit 429: Resource Exhausted',
    })
    const quotaSnap = diag.snapshot()
    const quotaAcc1 = quotaSnap.accounts.find(a => a.id === '2')
    expect(quotaAcc1!.status).toBe('quota-exceeded')
    expect(quotaAcc1!.guidanceRequired).toBe(false)
    expect(quotaAcc1!.message).toContain('429')

    // Live verification sets status to verified
    diag.recordAccountEvent('2', { type: 'verified' })
    const verifiedSnap = diag.snapshot()
    const verifiedAcc1 = verifiedSnap.accounts.find(a => a.id === '2')
    expect(verifiedAcc1!.status).toBe('verified')
    expect(verifiedAcc1!.guidanceRequired).toBe(false)
  })
})
