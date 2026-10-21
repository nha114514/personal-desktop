/** Desktop resource locations and signing-aware verification for the shared runtime builder. */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'
import lock from '../../../scripts/primary-runtime/lock.json' with { type: 'json' }
import {
  preparePrimaryRuntime as preparePayload,
  primaryRuntimePayloadDigest,
  smokePrimaryRuntime as smokePayload,
} from '../../../scripts/primary-runtime/prepare.ts'
import { parsePrimaryRuntime, workspaceDependencyPaths } from '../../../packages/skill/tool-workspace-dependencies/src/index.ts'
import { desktopTargetPlatform, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { scrubWindowsSigningEnvironment } from './windows-sign.mjs'

/** Supported Desktop build target (`win-x64` | `mac-arm64` | `mac-x64`). */
export type DesktopPrimaryRuntimeTarget = ReturnType<typeof resolveDesktopBuildTarget>

/** Verification record persisted after a native Desktop primary-runtime smoke check succeeds. */
export interface PrimaryRuntimeVerificationRecord {
  readonly schemaVersion: 1
  readonly desktopVersion: string
  readonly target: DesktopPrimaryRuntimeTarget
  readonly platform: string
  readonly arch: string
  readonly payloadDigest: string
  readonly checkOfficeSha256: string
  readonly verifiedAt: string
}

/** Options controlling Desktop primary-runtime preparation, cache reuse, and timing telemetry. */
export interface DesktopPrimaryRuntimeOptions {
  /** Signed Windows packaging defers execution until its supervised signing stage. */
  readonly deferSmoke?: boolean
  /** Force full payload re-preparation and smoke verification even when the cache matches. */
  readonly force?: boolean
  /** Override target for testing. */
  readonly target?: DesktopPrimaryRuntimeTarget
  /** Override runtime output directory (`.../runtime`) for testing. */
  readonly runtimeRoot?: string
  /** Override archive download cache directory for testing. */
  readonly downloadsRoot?: string
  /** Override Desktop package version for testing. */
  readonly version?: string
  /** Override bundled pnpm version for testing. */
  readonly pnpmVersion?: string
  /** Override Office skill assets source directory for testing. */
  readonly officeAssetsSource?: string
  /** Override verification stamp file path for testing. */
  readonly verificationFile?: string
  /** Dependency-injected payload builder for unit tests. */
  readonly prepareImpl?: typeof preparePayload
  /** Dependency-injected smoke runner for unit tests. */
  readonly smokeImpl?: (root: string) => void
}

/** Structured stage timings and cache-reuse telemetry from `preparePrimaryRuntime`. */
export interface PrimaryRuntimePreparationResult {
  readonly target: DesktopPrimaryRuntimeTarget
  readonly runtimeRoot: string
  readonly verificationFile: string
  readonly desktopVersion: string
  readonly payloadDigest: string
  readonly reused: boolean
  readonly reusedPayload: boolean
  readonly reusedSmoke: boolean
  readonly reason: string
  readonly inspectMs: number
  readonly prepareMs: number
  readonly smokeMs: number
  readonly totalMs: number
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function resolveBundledPnpmVersion(): string {
  const require = createRequire(import.meta.url)
  const pnpmManifest = require.resolve('pnpm')
  return (JSON.parse(readFileSync(pnpmManifest, 'utf8')) as { version: string }).version
}

function resolveOfficeAssetsSource(): string {
  const require = createRequire(import.meta.url)
  return join(dirname(require.resolve('@deepseek-ai/dsh-skill-office/package.json')), 'assets')
}

/**
 * Store the verification marker outside `runtime/` when `runtime/` is a standard build-target
 * subdirectory so electron-builder extraResources receives only the runtime payload directories.
 */
export function defaultPrimaryRuntimeVerificationFile(runtimeRoot: string): string {
  const resolved = resolve(runtimeRoot)
  return basename(resolved) === 'runtime'
    ? join(dirname(resolved), 'primary-runtime-verified.json')
    : join(resolved, '.primary-runtime-verified.json')
}

interface CacheInspection {
  readonly payloadValid: boolean
  readonly smokeVerified: boolean
  readonly reason: string
}

function inspectExistingPrimaryRuntime(params: {
  readonly runtimeRoot: string
  readonly verificationFile: string
  readonly target: DesktopPrimaryRuntimeTarget
  readonly version: string
  readonly pnpmVersion: string
  readonly expectedPayloadDigest: string
  readonly officeAssetsSource: string
  readonly expectedCheckOfficeSha256: string
}): CacheInspection {
  const {
    runtimeRoot,
    verificationFile,
    target,
    version,
    pnpmVersion,
    expectedPayloadDigest,
    officeAssetsSource,
    expectedCheckOfficeSha256,
  } = params
  const payloadRoot = join(runtimeRoot, 'primary-runtime')
  const manifestPath = join(payloadRoot, 'runtime.json')
  if (!isRegularFile(manifestPath)) {
    return { payloadValid: false, smokeVerified: false, reason: 'missing-runtime-manifest' }
  }
  let manifest: ReturnType<typeof parsePrimaryRuntime>
  try {
    manifest = parsePrimaryRuntime(JSON.parse(readFileSync(manifestPath, 'utf8')))
  } catch {
    return { payloadValid: false, smokeVerified: false, reason: 'invalid-runtime-manifest' }
  }
  const expectedPlatform = desktopTargetPlatform(target)
  if (manifest.desktopVersion !== version) {
    return { payloadValid: false, smokeVerified: false, reason: 'desktop-version-mismatch' }
  }
  if (manifest.platform !== expectedPlatform.platform || manifest.arch !== expectedPlatform.arch) {
    return { payloadValid: false, smokeVerified: false, reason: 'target-platform-mismatch' }
  }
  if (manifest.payloadDigest !== expectedPayloadDigest) {
    return { payloadValid: false, smokeVerified: false, reason: 'payload-digest-mismatch' }
  }
  if (manifest.python !== lock.pythonVersion || manifest.node !== lock.nodeVersion || manifest.pnpm !== pnpmVersion) {
    return { payloadValid: false, smokeVerified: false, reason: 'component-version-mismatch' }
  }
  if (Object.keys(manifest.pythonPackages).length === 0) {
    return { payloadValid: false, smokeVerified: false, reason: 'missing-python-packages' }
  }
  const entries = workspaceDependencyPaths(payloadRoot, manifest)
  if (
    entries.node === undefined
    || entries.pnpm === undefined
    || entries.nodePackages === undefined
    || !isRegularFile(entries.python)
    || !isRegularFile(entries.node)
    || !isRegularFile(entries.pnpm)
    || !isDirectory(entries.pythonPackages)
    || !isDirectory(entries.nodePackages)
  ) {
    return { payloadValid: false, smokeVerified: false, reason: 'missing-dependency-entry' }
  }
  const installedCheckOffice = join(runtimeRoot, 'office-skills', 'scripts', 'check_office.py')
  if (!isRegularFile(installedCheckOffice) || sha256File(installedCheckOffice) !== expectedCheckOfficeSha256) {
    return { payloadValid: false, smokeVerified: false, reason: 'office-skills-mismatch' }
  }
  for (const skill of ['docx', 'pdf', 'pptx', 'xlsx'] as const) {
    const sourceSkill = join(officeAssetsSource, skill, 'SKILL.md')
    const installedSkill = join(runtimeRoot, 'office-skills', skill, 'SKILL.md')
    if (isRegularFile(sourceSkill) && !isRegularFile(installedSkill)) {
      return { payloadValid: false, smokeVerified: false, reason: `missing-office-skill-${skill}` }
    }
  }
  if (!isRegularFile(verificationFile)) {
    return { payloadValid: true, smokeVerified: false, reason: 'smoke-verification-missing' }
  }
  try {
    const record = JSON.parse(readFileSync(verificationFile, 'utf8')) as Partial<PrimaryRuntimeVerificationRecord>
    if (
      record.schemaVersion === 1
      && record.desktopVersion === version
      && record.target === target
      && record.platform === expectedPlatform.platform
      && record.arch === expectedPlatform.arch
      && record.payloadDigest === expectedPayloadDigest
      && record.checkOfficeSha256 === expectedCheckOfficeSha256
    ) {
      return { payloadValid: true, smokeVerified: true, reason: 'verified-cache-hit' }
    }
  } catch {
    // Treat unreadable verification record as unverified.
  }
  return { payloadValid: true, smokeVerified: false, reason: 'smoke-verification-mismatch' }
}

function writeVerificationRecord(path: string, record: PrimaryRuntimeVerificationRecord): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(record, undefined, 2)}\n`)
}

/**
 * Prepare Desktop resources for its selected packaging target, reusing an already-verified
 * matching payload during development launches unless forced or deferring smoke for signing.
 * @param options - Signed Windows packaging defers execution until its supervised signing stage.
 * @returns Stage timing and cache reuse summary.
 */
export async function preparePrimaryRuntime(
  options: DesktopPrimaryRuntimeOptions = {},
): Promise<PrimaryRuntimePreparationResult> {
  const totalStart = performance.now()
  const inspectStart = performance.now()
  const target = options.target ?? resolveDesktopBuildTarget()
  const defaultPaths = resolveDesktopTargetBuildPaths()
  const runtimeRoot = resolve(options.runtimeRoot ?? defaultPaths.runtime)
  const downloadsRoot = resolve(options.downloadsRoot ?? defaultPaths.downloads)
  const version = options.version
    ?? (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
  const pnpmVersion = options.pnpmVersion ?? resolveBundledPnpmVersion()
  const officeAssetsSource = resolve(options.officeAssetsSource ?? resolveOfficeAssetsSource())
  const expectedCheckOfficeSha256 = sha256File(join(officeAssetsSource, 'scripts', 'check_office.py'))
  const expectedPayloadDigest = primaryRuntimePayloadDigest(target, lock, pnpmVersion)
  const verificationFile = resolve(options.verificationFile ?? defaultPrimaryRuntimeVerificationFile(runtimeRoot))
  const prepareImpl = options.prepareImpl ?? preparePayload
  const smokeImpl = options.smokeImpl ?? smokePrimaryRuntime
  const forced = options.force === true || process.env.DSH_FORCE_PRIMARY_RUNTIME_PREPARE === '1'

  let inspection: CacheInspection
  if (forced) {
    inspection = { payloadValid: false, smokeVerified: false, reason: 'forced' }
  } else if (options.deferSmoke) {
    inspection = { payloadValid: false, smokeVerified: false, reason: 'defer-smoke' }
  } else {
    inspection = inspectExistingPrimaryRuntime({
      runtimeRoot,
      verificationFile,
      target,
      version,
      pnpmVersion,
      expectedPayloadDigest,
      officeAssetsSource,
      expectedCheckOfficeSha256,
    })
  }
  const inspectMs = roundMs(performance.now() - inspectStart)

  const payloadRoot = join(runtimeRoot, 'primary-runtime')
  const expectedPlatform = desktopTargetPlatform(target)
  let prepareMs = 0
  let smokeMs = 0
  let reusedPayload = inspection.payloadValid
  let reusedSmoke = inspection.payloadValid && inspection.smokeVerified && !options.deferSmoke

  if (!inspection.payloadValid) {
    rmSync(verificationFile, { force: true })
    const prepareStart = performance.now()
    await prepareImpl({ target, output: runtimeRoot, cache: downloadsRoot, version })
    prepareMs = roundMs(performance.now() - prepareStart)
    reusedPayload = false
    reusedSmoke = false
  }

  if (!options.deferSmoke && !reusedSmoke) {
    const smokeStart = performance.now()
    smokeImpl(payloadRoot)
    smokeMs = roundMs(performance.now() - smokeStart)
    writeVerificationRecord(verificationFile, {
      schemaVersion: 1,
      desktopVersion: version,
      target,
      platform: expectedPlatform.platform,
      arch: expectedPlatform.arch,
      payloadDigest: expectedPayloadDigest,
      checkOfficeSha256: expectedCheckOfficeSha256,
      verifiedAt: new Date().toISOString(),
    })
  }

  const totalMs = roundMs(performance.now() - totalStart)
  return {
    target,
    runtimeRoot,
    verificationFile,
    desktopVersion: version,
    payloadDigest: expectedPayloadDigest,
    reused: reusedPayload && reusedSmoke,
    reusedPayload,
    reusedSmoke,
    reason: inspection.reason,
    inspectMs,
    prepareMs,
    smokeMs,
    totalMs,
  }
}

/**
 * Verify Desktop's complete payload after preparation or platform signing.
 * @param root - Final payload directory, including any platform signatures.
 */
export function smokePrimaryRuntime(root: string): void {
  const manifest = parsePrimaryRuntime(JSON.parse(readFileSync(join(root, 'runtime.json'), 'utf8')))
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) return
  if (Object.keys(manifest.pythonPackages).length === 0) throw new Error('primary runtime: missing Python distribution versions; prepare the payload before running its smoke checks.')
  const entries = workspaceDependencyPaths(root, manifest)
  if (entries.node === undefined || entries.pnpm === undefined) throw new Error('primary runtime: the Desktop payload must declare node and pnpm components.')
  smokePayload(root, scrubWindowsSigningEnvironment(process.env))
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      force: { type: 'boolean', default: false },
      'defer-smoke': { type: 'boolean', default: false },
    },
  })
  const summary = await preparePrimaryRuntime({
    force: values.force,
    deferSmoke: values['defer-smoke'],
  })
  console.log(
    `primary runtime: target=${summary.target} reused=${String(summary.reused)} `
    + `(payload=${String(summary.reusedPayload)}, smoke=${String(summary.reusedSmoke)}, reason=${summary.reason}) `
    + `inspect=${String(summary.inspectMs)}ms prepare=${String(summary.prepareMs)}ms `
    + `smoke=${String(summary.smokeMs)}ms total=${String(summary.totalMs)}ms`,
  )
}
