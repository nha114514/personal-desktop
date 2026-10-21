import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const expression = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: value => typeof value === 'string',
  construct: value => ({ __jsExpr: value }),
  predicate: value => value !== null && typeof value === 'object' && typeof value.__jsExpr === 'string',
  represent: value => value.__jsExpr,
})
const schema = yaml.JSON_SCHEMA.extend(expression)

/** Parse the profile dialect without evaluating any !!js expression. */
export function parsePersonalPatch(text) {
  const rows = yaml.load(text, { schema })
  if (!Array.isArray(rows)) throw new Error('Personal preset must be a YAML entry list')
  return rows
}

/** Add the retained Gemini account route without rewriting existing configuration. */
export function addGeminiAccountRoutes(currentText, templateText) {
  const rows = parsePersonalPatch(currentText)
  const template = parsePersonalPatch(templateText)
  const entries = rows.flatMap(row => row.insert ?? [])
  const sourceEntries = template.flatMap(row => row.insert ?? [])
  const preset = entries.find(row => row.id === 'preset-personal')
  const sourcePreset = sourceEntries.find(row => row.id === 'preset-personal')
  const delegation = preset?.config?.plugins?.find(row => row.id === 'delegation')
  const sourceDelegation = sourcePreset?.config?.plugins?.find(row => row.id === 'delegation')
  if (!Array.isArray(delegation?.config) || !Array.isArray(sourceDelegation?.config)) {
    throw new Error('Personal preset delegation group was not found; existing profile was not changed')
  }
  const toolIds = ['tool-subagent-gemini-2']
  const tools = toolIds
    .filter(id => !delegation.config.some(row => row.id === id))
    .map(id => sourceDelegation.config.find(row => row.id === id))
  if (tools.some(row => row === undefined)) {
    throw new Error('Gemini account routes are missing from the personal template')
  }
  let next = currentText
  if (tools.length > 0) {
    const anchors = [...currentText.matchAll(/^([ \t]*)- id: tool-subagent-codex[ \t]*\r?$/gm)]
    if (anchors.length !== 1) {
      throw new Error('Personal preset tool insertion point is missing or ambiguous; existing profile was not changed')
    }
    const anchor = anchors[0]
    const indent = anchor[1]
    const serialized = yaml.dump(tools, { schema, lineWidth: -1, noRefs: true })
      .trimEnd().split('\n').map(line => `${indent}${line}`).join('\n') + '\n'
    next = currentText.slice(0, anchor.index) + serialized + currentText.slice(anchor.index)
  }
  parsePersonalPatch(next)
  return next
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDirectory = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'personal-data'))
  const profile = join(dataDirectory, 'home', 'profiles', 'desktop', 'cordis.patch.yml')
  const current = readFileSync(profile, 'utf8')
  const template = readFileSync(new URL('./personal.patch.yml', import.meta.url), 'utf8')
  const next = addGeminiAccountRoutes(current, template)
  if (next !== current) writeFileSync(profile, next, { encoding: 'utf8', mode: 0o600 })
  console.log('Gemini account routes configured; existing settings preserved.')
}
