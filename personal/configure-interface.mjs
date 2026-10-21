/** Add the personal interface rows without rewriting existing profile text. */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { parsePersonalPatch } from './configure-gemini.mjs'

/** Existing custom interface rows are never overwritten by a repeat installation. */
export function addPersonalInterface(currentText, templateText) {
  const current = parsePersonalPatch(currentText)
  const template = parsePersonalPatch(templateText)
  const ids = ['ui-sidebar', 'ui-conversation', 'ui-brand-official', 'ui-settings-account']
  const missing = ids.filter(id => !current.some(row => row.id === id)).map(id => template.find(row => row.id === id))
  const existingPlugins = current.flatMap(row => row.insert ?? [])
  if (!existingPlugins.some(row => row.id === 'ui-personal-accounts')) {
    const plugin = template.flatMap(row => row.insert ?? []).find(row => row.id === 'ui-personal-accounts')
    if (plugin === undefined) throw new Error('Personal account interface is missing from the template')
    missing.push({ insert: [plugin] })
  }
  if (missing.some(row => row === undefined)) throw new Error('Personal interface settings are missing from the template')
  if (missing.length === 0) return currentText
  return currentText + (currentText.endsWith('\n') ? '\n' : '\n\n')
    + '# Personal interface and official account login settings.\n' + yaml.dump(missing, { lineWidth: -1, noRefs: true })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDirectory = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'personal-data'))
  const profile = join(dataDirectory, 'home', 'profiles', 'desktop', 'cordis.patch.yml')
  const current = readFileSync(profile, 'utf8')
  const next = addPersonalInterface(current, readFileSync(new URL('./personal.patch.yml', import.meta.url), 'utf8'))
  parsePersonalPatch(next)
  if (next !== current) writeFileSync(profile, next, { encoding: 'utf8', mode: 0o600 })
  console.log('Personal interface configured; existing profile text preserved.')
}
