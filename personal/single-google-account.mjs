import { isMap, isSeq, parseDocument } from '../packages/skill/skill-filesystem/node_modules/yaml/dist/index.js'

/** Retire account 1 routes while preserving account 2 and unrelated model settings. */
export function retainGoogleAccountTwo(source) {
  const document = parseDocument(source)
  if (document.errors.length || !isSeq(document.contents)) throw new Error('Invalid personal profile; settings were not changed')
  let changed = false
  function models(list) {
    if (!isSeq(list)) return
    const retained = new Set(list.items.filter(isMap).filter(row => row.get('provider') === 'gemini-2').map(row => row.get('model')))
    list.items = list.items.filter(row => {
      if (!isMap(row) || row.get('provider') !== 'gemini-1') return true
      changed = true
      if (retained.has(row.get('model'))) return false
      row.set('provider', 'gemini-2')
      retained.add(row.get('model'))
      return true
    })
  }
  function visit(entries) {
    if (!isSeq(entries)) return
    entries.items = entries.items.filter(row => {
      if (!isMap(row)) return true
      const config = row.get('config')
      const options = isMap(config) ? config.get('agentOptions') : undefined
      if (row.get('id') === 'tool-subagent-gemini-1' && isMap(options) && options.get('provider') === 'gemini-1') {
        changed = true
        return false
      }
      visit(row.get('insert'))
      if (isMap(config)) {
        if (['agent-default-model', 'subagent-default-model'].includes(row.get('id')) && config.get('provider') === 'gemini-1') {
          config.set('provider', 'gemini-2')
          changed = true
        }
        if (isMap(options) && options.get('provider') === 'gemini-1') {
          options.set('provider', 'gemini-2')
          changed = true
        }
        if (row.get('id') === 'subagent-model-selection-settings') models(config.get('allowedModels'))
        models(config.get('modelReasoningEfforts'))
        visit(config.get('plugins'))
      } else visit(config)
      return true
    })
  }
  visit(document.contents)
  return changed ? document.toString({ lineWidth: 0 }) : source
}
