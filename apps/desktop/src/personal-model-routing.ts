/** Read non-secret model selections from the active profile without evaluating YAML expressions. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SCHEMA, Type, load } from 'js-yaml'

/** One explicit provider/model selection. */
export interface SelectedModelRoute {
  provider: string
  model: string
  reasoningEffort?: string
}

/** Safe projection of profile model settings; no credentials or endpoints. */
export interface PersonalModelRoutes {
  status: 'loaded' | 'missing' | 'invalid'
  primary?: SelectedModelRoute
  subagent?: SelectedModelRoute
  allowedModels: SelectedModelRoute[]
  apiProviders: string[]
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const expression = Object.freeze({ expression: true })
const schema = DEFAULT_SCHEMA.extend(new Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: () => expression,
}))

function route(value: unknown): SelectedModelRoute | undefined {
  if (!record(value) || typeof value.provider !== 'string' || !value.provider.trim()
    || typeof value.model !== 'string' || !value.model.trim()) return undefined
  return {
    provider: value.provider.trim(), model: value.model.trim(),
    ...(typeof value.reasoningEffort === 'string' ? { reasoningEffort: value.reasoningEffort } : {}),
  }
}

/**
 * Project explicit patch settings without loading base entries or other patch layers.
 * Config values replace earlier configs; targeted inserts require a previously indexed group.
 * Direct id patches assume a base target exists. This is not the full mounted configuration.
 * Preset-local plugin declarations are outside the global selection scope.
 * @param source - Active profile YAML; expressions are treated as unresolved values.
 * @returns Only explicit model selections and API provider identities, or an invalid status.
 */
export function parsePersonalModelRoutes(source: string): PersonalModelRoutes {
  const empty: PersonalModelRoutes = { status: 'invalid', allowedModels: [], apiProviders: [] }
  let document: unknown
  try { document = load(source, { schema }) }
  catch (_error) { return empty } // YAML errors include the complete source; never export them.
  if (!Array.isArray(document)) return empty
  const entries = new Map<string, Record<string, unknown>>()
  const index = (rows: unknown[]): void => {
    for (const row of rows) {
      if (!record(row)) continue
      if (typeof row.id === 'string') entries.set(row.id, { ...row })
      if (row.group === true && Array.isArray(row.config)) index(row.config)
    }
  }
  for (const row of document) {
    if (!record(row)) continue
    if (Array.isArray(row.insert)) {
      if (row.id) {
        const target = typeof row.id === 'string' ? entries.get(row.id) : undefined
        if (target?.group !== true) continue
      }
      index(row.insert)
      continue
    }
    if (typeof row.id !== 'string') continue
    const previous = entries.get(row.id)
    if (previous && row.name && row.name !== previous.name) continue
    const { id, name, ...overrides } = row
    entries.set(id, { ...previous, ...overrides })
  }
  const config = (id: string): Record<string, unknown> | undefined => {
    const entry = entries.get(id)
    return entry && (entry.disabled === undefined || entry.disabled === false) && record(entry.config)
      ? entry.config : undefined
  }
  const primary = route(config('agent-default-model'))
  const subagent = route(config('subagent-default-model'))
  const allowed = config('subagent-model-selection-settings')?.allowedModels
  const providers = config('llm-pi-ai')?.providers
  return {
    status: 'loaded', ...(primary ? { primary } : {}), ...(subagent ? { subagent } : {}),
    allowedModels: Array.isArray(allowed) ? allowed.map(route).filter((value): value is SelectedModelRoute => value !== undefined) : [],
    apiProviders: record(providers) ? Object.keys(providers) : [],
  }
}

/**
 * Read the data profile, or the workspace profile when no data profile exists.
 * @param dataDirectory - Personal Desktop data directory.
 * @param workspaceRoot - Optional development workspace.
 * @returns Safe settings projection; absence and read/parse failures remain explicit.
 */
export function readPersonalModelRoutes(dataDirectory: string, workspaceRoot?: string): PersonalModelRoutes {
  const candidates = [join(dataDirectory, 'home', 'profiles', 'desktop', 'cordis.patch.yml'),
    ...(workspaceRoot ? [join(workspaceRoot, 'home', 'profiles', 'desktop', 'cordis.patch.yml')] : [])]
  const path = candidates.find(candidate => existsSync(candidate))
  if (!path) return { status: 'missing', allowedModels: [], apiProviders: [] }
  try { return parsePersonalModelRoutes(readFileSync(path, 'utf8')) }
  catch (_error) { return { status: 'invalid', allowedModels: [], apiProviders: [] } }
}

/**
 * Select only a Codex model already chosen for the primary or default subagent.
 * @param routes - Safe effective profile projection.
 * @returns The chosen Codex model, never an allowed-only or invented fallback.
 */
export function selectedCodexModel(routes: PersonalModelRoutes): string | undefined {
  return selectedCodexRoute(routes)?.model
}

/**
 * Retain the reasoning selection together with its Codex model.
 * @param routes - Safe effective profile projection.
 * @returns The selected Codex route, if one exists.
 */
export function selectedCodexRoute(routes: PersonalModelRoutes): SelectedModelRoute | undefined {
  return [routes.primary, routes.subagent].find(selection => selection?.provider === 'codex')
}
