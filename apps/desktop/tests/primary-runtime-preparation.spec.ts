/** Desktop carriers keep a complete interpreter payload even when SDK carriers choose Python-only. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it, vi } from 'vitest'
import lock from '../../../scripts/primary-runtime/lock.json' with { type: 'json' }
import { primaryRuntimePayloadDigest } from '../../../scripts/primary-runtime/prepare.ts'
import { workspaceDependencyPaths, type PrimaryRuntimeManifest } from '../../../packages/skill/tool-workspace-dependencies/src/index.ts'
import { resolveDevelopmentProject, resolveElectronNodeVersion } from '../scripts/dev.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import {
  defaultPrimaryRuntimeVerificationFile,
  preparePrimaryRuntime,
  smokePrimaryRuntime,
} from '../scripts/prepare-primary-runtime.ts'

async function createFakeOfficeAssets(root: string, checkScript = 'print("ok")\n'): Promise<string> {
  const assets = join(root, 'office-assets')
  await mkdir(join(assets, 'scripts'), { recursive: true })
  await writeFile(join(assets, 'scripts', 'check_office.py'), checkScript)
  for (const skill of ['docx', 'pdf', 'pptx', 'xlsx'] as const) {
    await mkdir(join(assets, skill), { recursive: true })
    await writeFile(join(assets, skill, 'SKILL.md'), `# ${skill}\n`)
  }
  return assets
}

async function materializeFakeRuntime(params: {
  readonly runtimeRoot: string
  readonly version: string
  readonly pnpmVersion: string
  readonly checkScript?: string
  readonly payloadDigest?: string
}): Promise<void> {
  const target = 'win-x64' as const
  const payloadRoot = join(params.runtimeRoot, 'primary-runtime')
  const digest = params.payloadDigest ?? primaryRuntimePayloadDigest(target, lock, params.pnpmVersion)
  const manifest: PrimaryRuntimeManifest = {
    desktopVersion: params.version,
    platform: 'win32',
    arch: 'x64',
    payloadDigest: digest,
    python: lock.pythonVersion,
    node: lock.nodeVersion,
    pnpm: params.pnpmVersion,
    pythonPackages: lock.pythonPackages,
  }
  const entries = workspaceDependencyPaths(payloadRoot, manifest)
  await mkdir(dirname(entries.python), { recursive: true })
  await mkdir(dirname(entries.node!), { recursive: true })
  await mkdir(dirname(entries.pnpm!), { recursive: true })
  await mkdir(entries.pythonPackages, { recursive: true })
  await mkdir(entries.nodePackages!, { recursive: true })
  await writeFile(entries.python, 'python-binary')
  await writeFile(entries.node!, 'node-binary')
  await writeFile(entries.pnpm!, 'pnpm-script')
  await writeFile(join(payloadRoot, 'runtime.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)

  const officeRoot = join(params.runtimeRoot, 'office-skills')
  await mkdir(join(officeRoot, 'scripts'), { recursive: true })
  await writeFile(join(officeRoot, 'scripts', 'check_office.py'), params.checkScript ?? 'print("ok")\n')
  for (const skill of ['docx', 'pdf', 'pptx', 'xlsx'] as const) {
    await mkdir(join(officeRoot, skill), { recursive: true })
    await writeFile(join(officeRoot, skill, 'SKILL.md'), `# ${skill}\n`)
  }
}

it('rejects a Python-only native Desktop payload before executing interpreters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-python-only-'))
  try {
    await writeFile(join(root, 'runtime.json'), JSON.stringify({
      desktopVersion: '1.0.0', platform: process.platform, arch: process.arch,
      python: '3.12.14', pythonPackages: { numpy: '2.3.5', pandas: '3.0.1' },
    }))
    expect(() => { smokePrimaryRuntime(root) }).toThrow('Desktop payload must declare node and pnpm')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('reuses a verified primary runtime cache and invalidates on version, digest, file, or force changes', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'desktop-primary-cache-'))
  try {
    const runtimeRoot = join(tempRoot, 'runtime')
    const downloadsRoot = join(tempRoot, 'downloads')
    const officeAssetsSource = await createFakeOfficeAssets(tempRoot)
    const pnpmVersion = '11.7.0'
    const prepareImpl = vi.fn(async (options: { output: string; version: string }) => {
      await materializeFakeRuntime({
        runtimeRoot: options.output,
        version: options.version,
        pnpmVersion,
      })
    })
    const smokeImpl = vi.fn()

    expect(defaultPrimaryRuntimeVerificationFile(runtimeRoot)).toBe(join(tempRoot, 'primary-runtime-verified.json'))

    // 1. Cold run: prepares payload, runs smoke, writes verification stamp.
    const cold = await preparePrimaryRuntime({
      target: 'win-x64',
      runtimeRoot,
      downloadsRoot,
      version: '0.2.0-rc.2',
      pnpmVersion,
      officeAssetsSource,
      prepareImpl,
      smokeImpl,
    })
    expect(cold.reused).toBe(false)
    expect(cold.reusedPayload).toBe(false)
    expect(cold.reusedSmoke).toBe(false)
    expect(cold.reason).toBe('missing-runtime-manifest')
    expect(prepareImpl).toHaveBeenCalledTimes(1)
    expect(smokeImpl).toHaveBeenCalledTimes(1)

    // 2. Warm run: skips both preparePayload and smokePrimaryRuntime.
    const warm = await preparePrimaryRuntime({
      target: 'win-x64',
      runtimeRoot,
      downloadsRoot,
      version: '0.2.0-rc.2',
      pnpmVersion,
      officeAssetsSource,
      prepareImpl,
      smokeImpl,
    })
    expect(warm.reused).toBe(true)
    expect(warm.reusedPayload).toBe(true)
    expect(warm.reusedSmoke).toBe(true)
    expect(warm.reason).toBe('verified-cache-hit')
    expect(warm.prepareMs).toBe(0)
    expect(warm.smokeMs).toBe(0)
    expect(prepareImpl).toHaveBeenCalledTimes(1)
    expect(smokeImpl).toHaveBeenCalledTimes(1)

    // 3. Missing verification file but intact payload: skips preparePayload, runs only smoke.
    await rm(cold.verificationFile, { force: true })
    const smokeOnly = await preparePrimaryRuntime({
      target: 'win-x64',
      runtimeRoot,
      downloadsRoot,
      version: '0.2.0-rc.2',
      pnpmVersion,
      officeAssetsSource,
      prepareImpl,
      smokeImpl,
    })
    expect(smokeOnly.reused).toBe(false)
    expect(smokeOnly.reusedPayload).toBe(true)
    expect(smokeOnly.reusedSmoke).toBe(false)
    expect(smokeOnly.reason).toBe('smoke-verification-missing')
    expect(prepareImpl).toHaveBeenCalledTimes(1)
    expect(smokeImpl).toHaveBeenCalledTimes(2)

    // 4. Desktop version change invalidates both payload and smoke.
    const versionChanged = await preparePrimaryRuntime({
      target: 'win-x64',
      runtimeRoot,
      downloadsRoot,
      version: '0.2.0-rc.3',
      pnpmVersion,
      officeAssetsSource,
      prepareImpl,
      smokeImpl,
    })
    expect(versionChanged.reused).toBe(false)
    expect(versionChanged.reason).toBe('desktop-version-mismatch')
    expect(prepareImpl).toHaveBeenCalledTimes(2)
    expect(smokeImpl).toHaveBeenCalledTimes(3)

    // 5. Deleted interpreter binary invalidates cache.
    await rm(join(runtimeRoot, 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'), { force: true })
    const missingBinary = await preparePrimaryRuntime({
      target: 'win-x64',
      runtimeRoot,
      downloadsRoot,
      version: '0.2.0-rc.3',
      pnpmVersion,
      officeAssetsSource,
      prepareImpl,
      smokeImpl,
    })
    expect(missingBinary.reused).toBe(false)
    expect(missingBinary.reason).toBe('missing-dependency-entry')
    expect(prepareImpl).toHaveBeenCalledTimes(3)
    expect(smokeImpl).toHaveBeenCalledTimes(4)

    // 6. deferSmoke prepares payload without running smoke and clears verification marker.
    const deferred = await preparePrimaryRuntime({
      target: 'win-x64',
      runtimeRoot,
      downloadsRoot,
      version: '0.2.0-rc.3',
      pnpmVersion,
      officeAssetsSource,
      deferSmoke: true,
      prepareImpl,
      smokeImpl,
    })
    expect(deferred.reused).toBe(false)
    expect(deferred.reason).toBe('defer-smoke')
    expect(prepareImpl).toHaveBeenCalledTimes(4)
    expect(smokeImpl).toHaveBeenCalledTimes(4)

    // Next normal run after deferSmoke reuses payload and runs smoke once.
    const postDefer = await preparePrimaryRuntime({
      target: 'win-x64',
      runtimeRoot,
      downloadsRoot,
      version: '0.2.0-rc.3',
      pnpmVersion,
      officeAssetsSource,
      prepareImpl,
      smokeImpl,
    })
    expect(postDefer.reusedPayload).toBe(true)
    expect(postDefer.reusedSmoke).toBe(false)
    expect(postDefer.reason).toBe('smoke-verification-missing')
    expect(prepareImpl).toHaveBeenCalledTimes(4)
    expect(smokeImpl).toHaveBeenCalledTimes(5)

    // 7. force: true bypasses verified cache.
    const forced = await preparePrimaryRuntime({
      target: 'win-x64',
      runtimeRoot,
      downloadsRoot,
      version: '0.2.0-rc.3',
      pnpmVersion,
      officeAssetsSource,
      force: true,
      prepareImpl,
      smokeImpl,
    })
    expect(forced.reused).toBe(false)
    expect(forced.reason).toBe('forced')
    expect(prepareImpl).toHaveBeenCalledTimes(5)
    expect(smokeImpl).toHaveBeenCalledTimes(6)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

it('caches Electron nodeVersion probe results until executable metadata or version changes', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'desktop-node-probe-'))
  try {
    const fakeElectron = join(tempRoot, 'electron.exe')
    const cacheFile = join(tempRoot, 'electron-node-version.json')
    await writeFile(fakeElectron, 'binary-v1')
    const probeImpl = vi.fn(() => '22.20.0')

    const first = resolveElectronNodeVersion({
      electronPath: fakeElectron,
      electronVersion: '44.0.0',
      cacheFile,
      probeImpl,
    })
    expect(first.reused).toBe(false)
    expect(first.nodeVersion).toBe('22.20.0')
    expect(probeImpl).toHaveBeenCalledTimes(1)

    const second = resolveElectronNodeVersion({
      electronPath: fakeElectron,
      electronVersion: '44.0.0',
      cacheFile,
      probeImpl,
    })
    expect(second.reused).toBe(true)
    expect(second.nodeVersion).toBe('22.20.0')
    expect(probeImpl).toHaveBeenCalledTimes(1)

    await writeFile(fakeElectron, 'binary-v2-different-size')
    const afterBinaryChange = resolveElectronNodeVersion({
      electronPath: fakeElectron,
      electronVersion: '44.0.0',
      cacheFile,
      probeImpl,
    })
    expect(afterBinaryChange.reused).toBe(false)
    expect(probeImpl).toHaveBeenCalledTimes(2)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

it('reuses a verified development project junction tree and rebuilds when release or manifests change', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'desktop-dev-project-'))
  try {
    const projectDir = join(tempRoot, 'project')
    const cliDir = join(tempRoot, 'cli')
    const hostDir = join(tempRoot, 'host')
    const dependencyDir = join(tempRoot, 'deps')
    const cacheFile = join(tempRoot, 'development-project-verified.json')
    await mkdir(cliDir, { recursive: true })
    await mkdir(join(hostDir, 'lib'), { recursive: true })
    await mkdir(dependencyDir, { recursive: true })
    await writeFile(join(cliDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.2' }))
    await writeFile(join(hostDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop-host', version: '0.2.0-rc.2' }))
    await writeFile(join(hostDir, 'lib', 'index.js'), 'export {}\n')

    const release = {
      schemaVersion: 1 as const,
      version: '0.2.0-rc.2',
      hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      nodeVersion: '24.18.1',
      pnpmVersion: '11.7.0',
    }

    const prepareImpl = vi.fn((options: { projectDir: string; release: typeof release }) => {
      return options.projectDir
    })

    const materializeProject = async (currentRelease: typeof release): Promise<void> => {
      await mkdir(join(projectDir, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true })
      await mkdir(join(projectDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib'), { recursive: true })
      await writeFile(join(projectDir, 'package.json'), JSON.stringify({ private: true }))
      await writeFile(join(projectDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: currentRelease.version }))
      await writeFile(join(projectDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop-host', version: currentRelease.version }))
      await writeFile(join(projectDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js'), 'export {}\n')
      await writeFile(join(projectDir, 'desktop-runtime.json'), JSON.stringify({
        schemaVersion: 1,
        release: currentRelease,
        platform: 'win32',
        arch: 'x64',
        sharedPackages: [
          { name: '@deepseek-ai/dsh', version: currentRelease.version, path: 'node_modules/@deepseek-ai/dsh' },
          { name: '@deepseek-ai/dsh-desktop-host', version: currentRelease.version, path: 'node_modules/@deepseek-ai/dsh-desktop-host' },
        ],
        files: [],
      }))
    }

    await materializeProject(release)
    const first = resolveDevelopmentProject({
      projectDir,
      cliDir,
      hostDir,
      dependencyDir,
      release,
      target: 'win-x64',
      cacheFile,
      prepareImpl,
    })
    expect(first.reused).toBe(false)
    expect(first.reason).toBe('missing-cache-record')
    expect(prepareImpl).toHaveBeenCalledTimes(1)

    const second = resolveDevelopmentProject({
      projectDir,
      cliDir,
      hostDir,
      dependencyDir,
      release,
      target: 'win-x64',
      cacheFile,
      prepareImpl,
    })
    expect(second.reused).toBe(true)
    expect(second.reason).toBe('verified-cache-hit')
    expect(prepareImpl).toHaveBeenCalledTimes(1)

    await writeFile(join(cliDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.2', description: 'updated' }))
    const afterManifestChange = resolveDevelopmentProject({
      projectDir,
      cliDir,
      hostDir,
      dependencyDir,
      release,
      target: 'win-x64',
      cacheFile,
      prepareImpl,
    })
    expect(afterManifestChange.reused).toBe(false)
    expect(afterManifestChange.reason).toBe('input-digest-mismatch')
    expect(prepareImpl).toHaveBeenCalledTimes(2)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
