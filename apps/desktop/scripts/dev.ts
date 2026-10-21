/** Build and launch the unpackaged Electron shell against the current workspace. */

import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import type { DesktopRelease } from '../src/release.ts'
import { DESKTOP_RUNTIME_FILE, type DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'
import { desktopTargetPlatform, developmentRuntimeDirectory, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'
import { prepareDevelopmentProject, type DevelopmentProjectOptions } from './development-project.ts'
import { prepareDevelopmentApp } from './development-app.ts'
import { preparePrimaryRuntime, type PrimaryRuntimePreparationResult } from './prepare-primary-runtime.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const BUILD_ROOT = join(APP_ROOT, '.desktop-build')
const DEVELOPMENT_ROOT = join(BUILD_ROOT, 'development')
const ELECTRON_NODE_CACHE_FILE = join(DEVELOPMENT_ROOT, 'electron-node-version.json')
const DEVELOPMENT_PROJECT_CACHE_FILE = join(DEVELOPMENT_ROOT, 'development-project-verified.json')

interface PackageManifest {
  readonly version?: string
}

interface ElectronNodeVersionCacheRecord {
  readonly schemaVersion: 1
  readonly electronPath: string
  readonly electronVersion: string
  readonly size: number
  readonly mtimeMs: number
  readonly nodeVersion: string
}

/** Result of probing or reusing the target Electron binary's embedded Node.js version. */
export interface ElectronNodeVersionProbeResult {
  readonly nodeVersion: string
  readonly reused: boolean
  readonly durationMs: number
}

/** Result of preparing or reusing the unpackaged development project junction tree. */
export interface DevelopmentProjectPreparationResult {
  readonly projectDir: string
  readonly reused: boolean
  readonly reason: string
  readonly durationMs: number
}

/** Structured stage timings for the unpackaged Desktop development launcher before spawning Electron. */
export interface DesktopDevPrelaunchTimings {
  readonly skipBuild: boolean
  readonly forceRuntime: boolean
  readonly buildMs: number
  readonly verifyArtifactsMs: number
  readonly electronNodeProbe: ElectronNodeVersionProbeResult
  readonly prepareDevelopmentProject: DevelopmentProjectPreparationResult
  readonly prepareDevelopmentProjectMs: number
  readonly preparePrimaryRuntime: Pick<
    PrimaryRuntimePreparationResult,
    'reused' | 'reusedPayload' | 'reusedSmoke' | 'reason' | 'inspectMs' | 'prepareMs' | 'smokeMs' | 'totalMs'
  >
  readonly preLaunchTotalMs: number
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Probe Electron's embedded `process.versions.node` or reuse a verified cache entry when the
 * Electron package version and executable metadata (`size`, `mtimeMs`) are unchanged.
 */
export function resolveElectronNodeVersion(options: {
  readonly electronPath?: string
  readonly electronVersion?: string
  readonly cacheFile?: string
  readonly force?: boolean
  readonly probeImpl?: (electronPath: string) => string
} = {}): ElectronNodeVersionProbeResult {
  const start = performance.now()
  const require = createRequire(import.meta.url)
  const electronPath = resolve(options.electronPath ?? (require('electron') as string))
  const electronVersion = options.electronVersion
    ?? packageVersion(require.resolve('electron/package.json'), 'electron package')
  const cacheFile = resolve(options.cacheFile ?? ELECTRON_NODE_CACHE_FILE)
  const stat = statSync(electronPath)
  if (!options.force && existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as Partial<ElectronNodeVersionCacheRecord>
      if (
        cached.schemaVersion === 1
        && cached.electronPath === electronPath
        && cached.electronVersion === electronVersion
        && cached.size === stat.size
        && cached.mtimeMs === stat.mtimeMs
        && typeof cached.nodeVersion === 'string'
        && cached.nodeVersion.length > 0
      ) {
        return {
          nodeVersion: cached.nodeVersion,
          reused: true,
          durationMs: roundMs(performance.now() - start),
        }
      }
    } catch {
      // Fall through to fresh probe on unreadable cache.
    }
  }
  const probe = options.probeImpl ?? ((binary: string) => execFileSync(
    binary,
    ['-p', 'process.versions.node'],
    { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
  ).trim())
  const nodeVersion = probe(electronPath)
  mkdirSync(dirname(cacheFile), { recursive: true })
  const record: ElectronNodeVersionCacheRecord = {
    schemaVersion: 1,
    electronPath,
    electronVersion,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    nodeVersion,
  }
  writeFileSync(cacheFile, `${JSON.stringify(record, undefined, 2)}\n`)
  return {
    nodeVersion,
    reused: false,
    durationMs: roundMs(performance.now() - start),
  }
}

interface DevelopmentProjectCacheRecord {
  readonly schemaVersion: 1
  readonly inputDigest: string
}

/**
 * Prepare or reuse the unpackaged development project directory junctions when the release identity,
 * workspace manifests, virtual-hoist directory metadata, and linked package targets are intact.
 */
export function resolveDevelopmentProject(
  options: DevelopmentProjectOptions & {
    readonly cacheFile?: string
    readonly force?: boolean
    readonly prepareImpl?: (options: DevelopmentProjectOptions) => string
  },
): DevelopmentProjectPreparationResult {
  const start = performance.now()
  const cacheFile = resolve(options.cacheFile ?? DEVELOPMENT_PROJECT_CACHE_FILE)
  const prepareImpl = options.prepareImpl ?? prepareDevelopmentProject
  const cliManifestPath = join(options.cliDir, 'package.json')
  const hostManifestPath = join(options.hostDir, 'package.json')
  const hostEntryPath = join(options.hostDir, 'lib', 'index.js')
  if (!existsSync(cliManifestPath) || !existsSync(hostManifestPath) || !existsSync(options.dependencyDir) || !existsSync(hostEntryPath)) {
    const projectDir = prepareImpl(options)
    return { projectDir, reused: false, reason: 'missing-source-inputs', durationMs: roundMs(performance.now() - start) }
  }
  const inputDigest = createHash('sha256').update(JSON.stringify({
    schemaVersion: 1,
    release: options.release,
    target: options.target,
    cliManifest: readFileSync(cliManifestPath, 'utf8'),
    hostManifest: readFileSync(hostManifestPath, 'utf8'),
    dependencyDirMtimeMs: statSync(options.dependencyDir).mtimeMs,
  })).digest('hex')

  let reason = options.force ? 'forced' : 'missing-cache-record'
  if (!options.force && existsSync(cacheFile)) {
    try {
      const record = JSON.parse(readFileSync(cacheFile, 'utf8')) as Partial<DevelopmentProjectCacheRecord>
      const runtimePath = join(options.projectDir, DESKTOP_RUNTIME_FILE)
      const projectManifestPath = join(options.projectDir, 'package.json')
      if (record.schemaVersion !== 1 || record.inputDigest !== inputDigest) {
        reason = 'input-digest-mismatch'
      } else if (!existsSync(runtimePath) || !existsSync(projectManifestPath)) {
        reason = 'missing-project-metadata'
      } else {
        const descriptor = JSON.parse(readFileSync(runtimePath, 'utf8')) as Partial<DesktopRuntimeDescriptor>
        const expectedPlatform = desktopTargetPlatform(options.target)
        const sharedPackages = Array.isArray(descriptor.sharedPackages) ? descriptor.sharedPackages : []
        const entriesIntact = sharedPackages.length > 0 && sharedPackages.every(
          entry => typeof entry.path === 'string' && existsSync(join(options.projectDir, entry.path, 'package.json')),
        ) && existsSync(join(options.projectDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js'))
        if (
          descriptor.schemaVersion === 1
          && JSON.stringify(descriptor.release) === JSON.stringify(options.release)
          && descriptor.platform === expectedPlatform.platform
          && descriptor.arch === expectedPlatform.arch
          && entriesIntact
        ) {
          return {
            projectDir: options.projectDir,
            reused: true,
            reason: 'verified-cache-hit',
            durationMs: roundMs(performance.now() - start),
          }
        }
        reason = 'project-entries-mismatch'
      }
    } catch {
      reason = 'invalid-cache-record'
    }
  }

  const projectDir = prepareImpl(options)
  mkdirSync(dirname(cacheFile), { recursive: true })
  const record: DevelopmentProjectCacheRecord = { schemaVersion: 1, inputDigest }
  writeFileSync(cacheFile, `${JSON.stringify(record, undefined, 2)}\n`)
  return {
    projectDir,
    reused: false,
    reason,
    durationMs: roundMs(performance.now() - start),
  }
}

function packageVersion(path: string, subject: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
  if (typeof manifest.version !== 'string') throw new Error(`desktop development: ${subject} has no version`)
  return manifest.version
}

function debugPort(name: string, fallback: number): number {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`desktop development: ${name} must be an integer from 1 through 65535`)
  }
  return port
}

async function run(command: string, args: readonly string[], cwd: string, environment = process.env): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop development: ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

async function runPackageScript(script: string, cwd: string): Promise<void> {
  const packageManager = process.env.npm_execpath
  if (packageManager === undefined || packageManager === '') {
    throw new Error('desktop development: invoke this launcher through pnpm run dev:desktop or start:desktop')
  }
  await run(process.execPath, [packageManager, 'run', script], cwd)
}

async function launchElectron(): Promise<void> {
  const require = createRequire(import.meta.url)
  const electron: unknown = require('electron')
  if (typeof electron !== 'string') throw new Error('desktop development: electron executable is unavailable')
  const mainPort = debugPort('DSH_DESKTOP_MAIN_INSPECT_PORT', 9229)
  const rendererPort = debugPort('DSH_DESKTOP_RENDERER_DEBUG_PORT', 9222)
  const hostPort = debugPort('DSH_DESKTOP_HOST_INSPECT_PORT', 9230)
  const home = resolve(process.env.DSH_HOME ?? join(DEVELOPMENT_ROOT, 'home'))
  const userData = resolve(process.env.DSH_DESKTOP_USER_DATA_DIR ?? join(DEVELOPMENT_ROOT, 'electron-user-data'))
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_DESKTOP_PRIMARY_RUNTIME_DIR: process.env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR ?? developmentRuntimeDirectory(),
    DSH_DESKTOP_HOST_INSPECT_PORT: String(hostPort),
    DSH_DESKTOP_OPEN_DEVTOOLS: process.env.DSH_DESKTOP_OPEN_DEVTOOLS ?? '1',
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? '1',
  }
  console.log(`desktop development: DSH_HOME=${home}`)
  console.log(`desktop development: userData=${userData}`)
  console.log(`desktop development: inspectors main=${String(mainPort)}, renderer=${String(rendererPort)}, host=${String(hostPort)}`)
  if (process.platform === 'darwin') {
    const executable = prepareDevelopmentApp({ electron, appRoot: APP_ROOT, directory: DEVELOPMENT_ROOT, home, userData,
      mainPort, rendererPort, hostPort, openDevtools: environment.DSH_DESKTOP_OPEN_DEVTOOLS! })
    await run(executable, [], APP_ROOT, environment)
    return
  }
  await run(electron, [
    `--inspect=127.0.0.1:${String(mainPort)}`,
    `--remote-debugging-port=${String(rendererPort)}`,
    `--user-data-dir=${userData}`,
    APP_ROOT,
  ], APP_ROOT, environment)
}

export async function runDevelopmentPrelaunch(options: {
  readonly skipBuild?: boolean
  readonly forceRuntime?: boolean
} = {}): Promise<DesktopDevPrelaunchTimings> {
  const preLaunchStart = performance.now()
  const skipBuild = options.skipBuild === true
  const forceRuntime = options.forceRuntime === true || process.env.DSH_FORCE_PRIMARY_RUNTIME_PREPARE === '1'

  let buildMs = 0
  if (!skipBuild) {
    const buildStart = performance.now()
    await runPackageScript('build', REPOSITORY_ROOT)
    await runPackageScript('build', APP_ROOT)
    buildMs = roundMs(performance.now() - buildStart)
  }

  const verifyStart = performance.now()
  for (const path of [
    join(APP_ROOT, 'lib', 'main.js'),
    join(REPOSITORY_ROOT, 'apps', 'desktop-host', 'lib', 'index.js'),
  ]) {
    if (!existsSync(path)) throw new Error(`desktop development: missing built artifact ${path}`)
  }
  const verifyArtifactsMs = roundMs(performance.now() - verifyStart)

  const version = packageVersion(join(APP_ROOT, 'package.json'), 'desktop package')
  const pnpmVersion = packageVersion(join(APP_ROOT, 'node_modules', 'pnpm', 'package.json'), 'pnpm package')
  const electronNodeProbe = resolveElectronNodeVersion({ force: forceRuntime })
  const release: DesktopRelease = {
    schemaVersion: 1,
    version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: electronNodeProbe.nodeVersion,
    pnpmVersion,
  }

  const prepareDevelopmentProjectSummary = resolveDevelopmentProject({
    projectDir: join(DEVELOPMENT_ROOT, 'project'),
    cliDir: join(REPOSITORY_ROOT, 'apps', 'cli'),
    hostDir: join(REPOSITORY_ROOT, 'apps', 'desktop-host'),
    dependencyDir: join(REPOSITORY_ROOT, 'node_modules', '.pnpm', 'node_modules'),
    release,
    target: resolveDesktopBuildTarget(),
    force: forceRuntime,
  })
  const prepareDevelopmentProjectMs = prepareDevelopmentProjectSummary.durationMs

  const primaryRuntimeSummary = await preparePrimaryRuntime({ force: forceRuntime })
  const preLaunchTotalMs = roundMs(performance.now() - preLaunchStart)
  const timings: DesktopDevPrelaunchTimings = {
    skipBuild,
    forceRuntime,
    buildMs,
    verifyArtifactsMs,
    electronNodeProbe,
    prepareDevelopmentProject: prepareDevelopmentProjectSummary,
    prepareDevelopmentProjectMs,
    preparePrimaryRuntime: {
      reused: primaryRuntimeSummary.reused,
      reusedPayload: primaryRuntimeSummary.reusedPayload,
      reusedSmoke: primaryRuntimeSummary.reusedSmoke,
      reason: primaryRuntimeSummary.reason,
      inspectMs: primaryRuntimeSummary.inspectMs,
      prepareMs: primaryRuntimeSummary.prepareMs,
      smokeMs: primaryRuntimeSummary.smokeMs,
      totalMs: primaryRuntimeSummary.totalMs,
    },
    preLaunchTotalMs,
  }
  console.log(`desktop development: startup-timings ${JSON.stringify(timings)}`)
  return timings
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'skip-build': { type: 'boolean', default: false },
      'force-runtime': { type: 'boolean', default: false },
      'no-launch': { type: 'boolean', default: false },
    },
  })
  await runDevelopmentPrelaunch({
    skipBuild: values['skip-build'],
    forceRuntime: values['force-runtime'],
  })
  if (!values['no-launch']) {
    await launchElectron()
  }
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
