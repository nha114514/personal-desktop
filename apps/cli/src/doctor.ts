/**
 * Boot-free health check for one profile and its host state.
 *
 * Everything here reads configuration and on-disk state without mounting a
 * profile: the checks must still answer when the app cannot start at all. A
 * check that cannot obtain its evidence reports WARN with the reason instead of
 * booting the tree or guessing.
 * @module @deepseek-ai/dsh/doctor
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  composeEntries,
  loadOptionalPatches,
  loadProfileDirectory,
  prepareProfileEntries,
  PROFILE_PATCH_FILENAME,
  type Profile,
  type ProfileContext,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { load as parseYaml } from 'js-yaml'

const NAME = 'dsh'

/** Absolute path of this dsh installation's package.json (src/ and lib/ sit one level under apps/cli). */
const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/** One check's verdict. */
type DoctorStatus = 'PASS' | 'WARN' | 'FAIL'

/** Options selecting the profile whose configuration the checks inspect. */
export interface DoctorOptions {
  /** Profile named on the command line; otherwise the default resolution runs. */
  readonly profile?: string | undefined
}

/** One reported check: a verdict plus the single line of evidence for it. */
interface DoctorCheck {
  readonly number: number
  readonly title: string
  readonly status: DoctorStatus
  readonly evidence: string
  /** Optional indented evidence rows, used for inventories. */
  readonly details?: readonly string[]
}

/** A profile's composed patch layers and effective entry list. */
interface Composition {
  readonly profile: Profile
  readonly entries: EntryOptions[]
  readonly warnings: readonly string[]
}

/** A resolved profile directory, existing or explicitly named. */
interface SelectedProfile {
  readonly name: string
  readonly dir: string
}

/** The credentials document's structure; values are never read into evidence. */
interface CredentialKeys {
  /** Reference names present in the credential store or the launch environment. */
  readonly references: ReadonlySet<string>
}

/** A configured LLM provider row and the availability facts derivable offline. */
interface ProviderRow {
  readonly id: string
  readonly plugin: string
  readonly providerName?: string
  readonly apiKeyEnv?: string
  readonly disabled: boolean
}

/**
 * Run every check, print the report, and return the process exit code.
 *
 * A FAIL anywhere yields `1`; WARNs do not fail the command because running
 * without a desktop process or a credential is a normal state.
 * @param options - profile selection from the command line.
 * @returns the exit code the CLI applies.
 */
export function runDoctor(options: DoctorOptions): number {
  const home = resolveDshHome()
  const selected = selectProfile(options.profile, home)
  const checks: DoctorCheck[] = []
  let composition: Composition | undefined
  let compositionError: string | undefined
  if (selected === undefined) {
    compositionError = 'no profile selected and no usable default profile directory exists'
  } else {
    try {
      composition = composeProfile(selected)
    } catch (error: unknown) {
      compositionError = `cannot compose profile "${selected.name}": ${errorText(error)}`
    }
  }

  checks.push(checkConfiguration(selected, composition, compositionError))
  checks.push(checkSubagentDefaultModel(composition, compositionError))
  checks.push(checkProviders(composition, home, compositionError))
  checks.push(checkRequirementMemory(process.cwd()))
  checks.push(checkDesktopRuntime(home))
  checks.push(checkStartupLogs(home))

  const header = selected === undefined
    ? `dsh doctor — no profile selected; DSH_HOME ${home}`
    : `dsh doctor — profile "${selected.name}" (${selected.dir}); DSH_HOME ${home}`
  process.stdout.write(`${header}\n\n`)
  for (const check of checks) {
    process.stdout.write(`${check.status.padEnd(4)} ${check.number}. ${check.title} — ${check.evidence}\n`)
    for (const detail of check.details ?? []) process.stdout.write(`     · ${detail}\n`)
  }
  const failures = checks.filter(check => check.status === 'FAIL')
  process.stdout.write(failures.length === 0
    ? '\nNo failures.\n'
    : `\n${failures.length} failure(s); exit code 1.\n`)
  return failures.length === 0 ? 0 : 1
}

/** Resolve the profile to inspect: explicit, then environment, then known profile directories. */
function selectProfile(explicit: string | undefined, home: string): SelectedProfile | undefined {
  if (explicit !== undefined) return { name: explicit, dir: join(home, 'profiles', explicit) }
  const fromEnvironment = process.env.DSH_PROFILE
  const candidates = [
    ...fromEnvironment === undefined || fromEnvironment === '' ? [] : [fromEnvironment],
    'desktop',
    'web',
  ]
  for (const name of candidates) {
    const dir = join(home, 'profiles', name)
    if (existsSync(join(dir, 'package.json'))) return { name, dir }
  }
  return undefined
}

/** Load bundle and user layers and compose the effective row list over the empty root. */
function composeProfile(selected: SelectedProfile): Composition {
  // `loadProfileDirectory` never initializes a missing profile, so a check
  // cannot create state the user did not ask for.
  const profile = loadProfileDirectory(NAME, selected.dir, INSTALL_ANCHOR, { userLayer: true })
  const homePatches = loadOptionalPatches(NAME, join(resolveDshHome(), PROFILE_PATCH_FILENAME)) ?? []
  const warnings: string[] = []
  const entries = composeEntries([
    ...profile.layers.map(layer => layer.patches),
    profile.patches,
    homePatches,
  ], message => warnings.push(message))
  return { profile, entries, warnings }
}

/** Check 1: parse every layer and run the same peer-compatibility preflight the boot uses. */
function checkConfiguration(
  selected: SelectedProfile | undefined,
  composition: Composition | undefined,
  compositionError: string | undefined,
): DoctorCheck {
  const base = { number: 1, title: 'configuration & compatibility' }
  if (selected === undefined) {
    return { ...base, status: 'WARN', evidence: compositionError ?? 'no profile to inspect' }
  }
  if (composition === undefined) {
    return { ...base, status: 'FAIL', evidence: compositionError ?? 'profile composition unavailable' }
  }
  const { profile } = composition
  let preflight: { denied: string[] } | undefined
  let preflightError: string | undefined
  try {
    preflight = compatibilityPreflight(profile, composition.entries)
  } catch (error: unknown) {
    preflightError = errorText(error)
  }
  if (preflight === undefined) {
    return { ...base, status: 'FAIL', evidence: `compatibility preflight failed: ${preflightError ?? 'unknown error'}` }
  }
  const { denied } = preflight
  const details = [
    ...composition.warnings.map(warning => `patch: ${warning}`),
    ...denied.map(row => `incompatible row disabled: ${row}`),
  ]
  if (denied.length > 0 || profile.skippedBundles.length > 0) {
    for (const skipped of profile.skippedBundles) details.push(`skipped bundle ${skipped.packageName}: ${skipped.reason}`)
    return {
      ...base,
      status: 'FAIL',
      evidence: `${composition.entries.length} rows from ${profile.layers.length} layers; `
        + `${denied.length} incompatible row(s), ${profile.skippedBundles.length} skipped bundle(s)`,
      details,
    }
  }
  if (composition.warnings.length > 0) {
    return {
      ...base,
      status: 'WARN',
      evidence: `${composition.entries.length} rows from ${profile.layers.length} layers; `
        + `${composition.warnings.length} patch warning(s) — see details`,
      details,
    }
  }
  return {
    ...base,
    status: 'PASS',
    evidence: `${composition.entries.length} rows from ${profile.layers.length} layers; `
      + 'no patch warnings or incompatible rows',
  }
}

/** Run the boot's own admission walk without mounting anything. */
function compatibilityPreflight(
  profile: Profile,
  entries: readonly EntryOptions[],
): { denied: string[] } {
  const ctx = new Context()
  const profileContext: ProfileContext = {
    name: profile.name,
    dir: profile.dir,
    patchPath: profile.patchPath,
    installAnchor: INSTALL_ANCHOR,
    startedBundles: profile.layers.map(layer => layer.packageName),
    cwd: process.cwd(),
    home: resolveDshHome(),
    overlays: [],
    telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED,
  }
  ctx.provide('profileContext', profileContext)
  const before = new Set(entries.filter(row => row.disabled === true).map(rowKey))
  const rootUrl = pathToFileURL(join(profile.dir, 'cordis.yml')).href
  const prepared = prepareProfileEntries(ctx, entries, rootUrl, 'dsh doctor')
  const denied = prepared
    .filter(row => row.disabled === true && !before.has(rowKey(row)))
    .map(row => row.id)
  return { denied }
}

/** Stable identity for one composed row across the preflight clone. */
function rowKey(row: EntryOptions): string {
  return row.id
}

/** Read a row's config object without trusting a malformed value. */
function configOf(row: EntryOptions): Record<string, unknown> | undefined {
  const config: unknown = row.config
  return typeof config === 'object' && config !== null && !Array.isArray(config)
    ? config as Record<string, unknown>
    : undefined
}

/** Read one effective row by id; the last occurrence wins because patches apply in order. */
function effectiveRow(entries: readonly EntryOptions[], id: string): EntryOptions | undefined {
  return entries.findLast(row => row.id === id)
}

/** Check 2: the configured subagent default must be one of the authorized routes. */
function checkSubagentDefaultModel(
  composition: Composition | undefined,
  compositionError: string | undefined,
): DoctorCheck {
  const base = { number: 2, title: 'subagent default model' }
  if (composition === undefined) {
    return { ...base, status: 'WARN', evidence: `skipped: ${compositionError ?? 'profile composition unavailable'}` }
  }
  const settingsRow = effectiveRow(composition.entries, 'subagent-model-selection-settings')
  const defaultRow = effectiveRow(composition.entries, 'subagent-default-model')
  if (defaultRow === undefined) {
    return { ...base, status: 'PASS', evidence: 'no subagent-default-model row; children inherit the parent route' }
  }
  const defaultConfig = configOf(defaultRow)
  const provider = defaultConfig?.['provider']
  const model = defaultConfig?.['model']
  if (typeof provider !== 'string' || typeof model !== 'string' || provider === '' || model === '') {
    return {
      ...base,
      status: 'WARN',
      evidence: 'subagent-default-model provider/model is not a static string; cannot verify before boot',
    }
  }
  const route = `${provider}/${model}`
  const routes = allowedRoutes(settingsRow)
  if (routes === undefined) {
    return { ...base, status: 'WARN', evidence: `route ${route}: allowed-model list is not statically readable` }
  }
  if (routes.length === 0) {
    return { ...base, status: 'PASS', evidence: `route ${route}; no authorized child routes are configured` }
  }
  const matched = routes.some(candidate => candidate.provider === provider && candidate.model === model)
  if (matched) {
    return {
      ...base,
      status: 'PASS',
      evidence: `route ${route} is authorized by ${routes.length} configured route(s)`,
    }
  }
  return {
    ...base,
    status: 'FAIL',
    evidence: `route ${route} is not among ${routes.length} authorized route(s): ${routes.map(describeRoute).join(', ')}`,
  }
}

/** Read `allowedModels` from the settings row, or undefined when it is not a readable array. */
function allowedRoutes(row: EntryOptions | undefined): { provider: string; model: string }[] | undefined {
  if (row === undefined) return []
  const config = configOf(row)
  if (config === undefined) return undefined
  const value = config['allowedModels']
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const routes: { provider: string; model: string }[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined
    const record = item as Record<string, unknown>
    const provider = record['provider']
    const model = record['model']
    if (typeof provider !== 'string' || typeof model !== 'string') return undefined
    routes.push({ provider, model })
  }
  return routes
}

/** Render one authorized route. */
function describeRoute(route: { provider: string; model: string }): string {
  return `${route.provider}/${route.model}`
}

/** Check 3: inventory configured LLM providers and mark what offline state can prove unavailable. */
function checkProviders(
  composition: Composition | undefined,
  home: string,
  compositionError: string | undefined,
): DoctorCheck {
  const base = { number: 3, title: 'LLM providers' }
  if (composition === undefined) {
    return { ...base, status: 'WARN', evidence: `skipped: ${compositionError ?? 'profile composition unavailable'}` }
  }
  // A later patch may insert its own copy of a provider row; report the
  // effective row once, matching the last-definition-wins composition rule.
  const providers = [...new Map(
    composition.entries
      .filter(row => isProviderPlugin(row.name))
      .map((row): [string, EntryOptions] => [row.id, row]),
  ).values()].map(row => providerOf(row))
  if (providers.length === 0) {
    return { ...base, status: 'FAIL', evidence: 'no LLM provider row is composed' }
  }
  const credentials = credentialKeys(home)
  const details = providers.map(provider => describeProvider(provider, credentials))
  const references = [...credentials.references].sort()
  details.push(`credential store: ${references.length === 0 ? '(empty)' : bound(references.join(', '))}`)
  const unavailable = details.filter(detail => detail.includes('[unavailable]')).length
  const unverified = details.filter(detail => detail.includes('[unverified]')).length
  const available = providers.length - unavailable - unverified
  return {
    ...base,
    status: unavailable > 0 || (available === 0 && unverified > 0) ? 'WARN' : 'PASS',
    evidence: `${providers.length} configured provider(s): `
      + `${available} available, ${unavailable} unavailable, ${unverified} not verifiable offline`,
    details,
  }
}

/** Whether a composed row is an LLM provider implementation rather than the runtime or its retry wrapper. */
function isProviderPlugin(plugin: string): boolean {
  return plugin.includes('dsh-llm-') && !plugin.endsWith('dsh-llm') && !plugin.endsWith('dsh-llm-retry')
}

/** Project one provider row's reportable fields. */
function providerOf(row: EntryOptions): ProviderRow {
  const config = configOf(row)
  const providerName = config?.['providerName']
  const apiKeyEnv = config?.['apiKeyEnv']
  return {
    id: row.id,
    plugin: row.name,
    ...typeof providerName === 'string' ? { providerName } : {},
    ...typeof apiKeyEnv === 'string' ? { apiKeyEnv } : {},
    disabled: row.disabled === true,
  }
}

/** One indented evidence line for a provider. */
function describeProvider(provider: ProviderRow, credentials: CredentialKeys): string {
  const route = provider.providerName === undefined ? provider.id : `${provider.id} (${provider.providerName})`
  if (provider.disabled) return `${route}  ${provider.plugin}  [unavailable] row is disabled`
  if (provider.apiKeyEnv !== undefined) {
    const present = credentials.references.has(provider.apiKeyEnv)
    return `${route}  ${provider.plugin}  ${present
      ? `[available] credential ${provider.apiKeyEnv} present`
      : `[unavailable] credential ${provider.apiKeyEnv} missing`}`
  }
  return `${route}  ${provider.plugin}  [unverified] no credential requirement is declared in the profile`
}

/** Read credential reference names only; values never enter the report. */
function credentialKeys(home: string): CredentialKeys {
  const references = new Set<string>()
  let document: unknown
  try {
    document = parseYaml(readFileSync(join(home, '.credentials.yaml'), 'utf8'))
  } catch {
    // A missing or malformed store is an empty store for availability purposes;
    // the provider line then reports its credential as missing.
    return { references }
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return { references }
  const record = document as Record<string, unknown>
  const refs = record['refs']
  if (typeof refs === 'object' && refs !== null && !Array.isArray(refs)) {
    for (const key of Object.keys(refs)) references.add(key)
  }
  const records = record['records']
  if (typeof records === 'object' && records !== null && !Array.isArray(records)) {
    for (const key of Object.keys(records)) references.add(key)
  }
  // The pre-layout document maps references directly at the root.
  for (const key of Object.keys(record)) {
    if (key !== 'version' && key !== 'refs' && key !== 'records') references.add(key)
  }
  return { references }
}

/** Check 4: every requirement-memory ledger's four documents must be readable. */
function checkRequirementMemory(cwd: string): DoctorCheck {
  const base = { number: 4, title: 'requirement memory' }
  const root = findUp(cwd, join('.agents', 'requirement-memory'))
  if (root === undefined) {
    return { ...base, status: 'WARN', evidence: `no .agents/requirement-memory under ${cwd}` }
  }
  const ledgers = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(root, entry.name, 'meta.json')))
    .map(entry => entry.name)
  if (ledgers.length === 0) {
    return { ...base, status: 'WARN', evidence: `no ledger with meta.json under ${root}` }
  }
  const expected = ['CANON.md', 'CURRENT-STATE.md', 'DECISIONS.md', 'TRACEABILITY.md']
  const unreadable: string[] = []
  let readable = 0
  for (const ledger of ledgers) {
    for (const file of expected) {
      try {
        readFileSync(join(root, ledger, file), 'utf8')
        readable += 1
      } catch (error: unknown) {
        unreadable.push(`${ledger}/${file}: ${errorText(error)}`)
      }
    }
  }
  return {
    ...base,
    status: unreadable.length === 0 ? 'PASS' : 'FAIL',
    evidence: `${readable}/${ledgers.length * expected.length} ledger document(s) readable under ${root}`,
    ...unreadable.length === 0 ? {} : { details: unreadable },
  }
}

/** Check 5: desktop process presence and the primary runtime directory. */
function checkDesktopRuntime(home: string): DoctorCheck {
  const base = { number: 5, title: 'desktop runtime' }
  const runtimeDir = join(home, 'dsh-runtimes', 'dsh-primary-runtime')
  const runtime = existsSync(runtimeDir)
    ? `runtime directory ${runtimeDir} present`
    : `runtime directory ${runtimeDir} missing (normal for installed profiles)`
  let processes: number | undefined
  let processError: string | undefined
  try {
    processes = countProcesses()
  } catch (error: unknown) {
    processError = errorText(error)
  }
  if (processError !== undefined) {
    return { ...base, status: 'WARN', evidence: `process probe failed: ${processError}; ${runtime}` }
  }
  if (processes === undefined) {
    return { ...base, status: 'WARN', evidence: `process probe unsupported on ${process.platform}; ${runtime}` }
  }
  return {
    ...base,
    status: processes > 0 ? 'PASS' : 'WARN',
    evidence: `electron process(es): ${processes}; ${runtime}`,
  }
}

/** Count running Electron processes, or return undefined on an unsupported platform. */
function countProcesses(): number | undefined {
  if (process.platform === 'win32') {
    const output = execFileSync(
      'tasklist',
      ['/FI', 'IMAGENAME eq electron.exe', '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', windowsHide: true },
    )
    return output.split(/\r?\n/).filter(line => line.toLowerCase().includes('electron.exe')).length
  }
  if (process.platform === 'linux' || process.platform === 'darwin') {
    const output = execFileSync('ps', ['-A', '-o', 'comm='], { encoding: 'utf8' })
    return output.split(/\r?\n/).filter(line => /(^|[/\\])electron$/i.test(line.trim())).length
  }
  return undefined
}

/** Check 6: summarize the newest startup-failure log, if one exists. */
function checkStartupLogs(home: string): DoctorCheck {
  const base = { number: 6, title: 'startup logs' }
  const logs = join(home, 'logs')
  if (!existsSync(logs)) {
    return { ...base, status: 'PASS', evidence: `no logs directory at ${logs} (no startup failures recorded)` }
  }
  const files = readdirSync(logs)
    .filter(name => name.startsWith('startup-') && name.endsWith('.log'))
    .map(name => ({ name, path: join(logs, name), mtime: statSync(join(logs, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime)
  const latest = files[0]
  if (latest === undefined) {
    return { ...base, status: 'PASS', evidence: `no startup-*.log under ${logs}` }
  }
  let head: string
  try {
    head = readFileSync(latest.path, 'utf8').split(/\r?\n/).slice(0, 8).join(' | ')
  } catch (error: unknown) {
    return { ...base, status: 'WARN', evidence: `cannot read ${latest.path}: ${errorText(error)}` }
  }
  return {
    ...base,
    status: 'PASS',
    evidence: `latest ${latest.name} (${new Date(latest.mtime).toISOString()}): ${bound(head)}`,
  }
}

/** Walk up from `start` at most six levels looking for a relative directory. */
function findUp(start: string, relative: string): string | undefined {
  let current = start
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(current, relative)
    if (existsSync(candidate)) return candidate
    const parent = join(current, '..')
    if (parent === current) break
    current = parent
  }
  return undefined
}

/** Render one line of an unknown failure. */
function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/** Bound one evidence line so a log head cannot flood the report. */
function bound(text: string): string {
  const single = text.replace(/\s+/g, ' ').trim()
  return single.length <= 240 ? single : `${single.slice(0, 239)}…`
}
