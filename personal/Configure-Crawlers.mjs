import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseDocument, isSeq, isMap } from '../packages/skill/skill-filesystem/node_modules/yaml/dist/index.js'

const path = process.argv[2] ?? 'D:/desktop/personal-data/home/profiles/desktop/cordis.patch.yml'
const original = readFileSync(path, 'utf8')
const document = parseDocument(original)
if (document.errors.length || !isSeq(document.contents)) throw new Error('Invalid personal profile')
const entries = document.contents
const entry = id => entries.items.find(node => isMap(node) && node.get('id') === id)
const selected = ['agent-default-model', 'subagent-model-selection-settings', 'subagent', 'subagent-default-model']
const before = selected.map(id => JSON.stringify(entry(id)?.toJSON()))
if (!existsSync(path + '.before-crawlers')) copyFileSync(path, path + '.before-crawlers')
let web = entry('web')
if (!web) { web = document.createNode({ id: 'web' }); entries.add(web) }
web.set('config', { searchProvider: 'personal-crawlers', fetchProvider: 'personal-crawlers' })
entry('web-search-deepseek')?.set('disabled', true)
let teamTools = entry('tool-agent-team')
if (!teamTools) { teamTools = document.createNode({ id: 'tool-agent-team' }); entries.add(teamTools) }
teamTools.set('disabled', true)

const skillDirectory = 'D:/desktop/tools/personal-crawlers/skills'
let presetSkillProviders = 0
function configureSkills(node) {
  if (isSeq(node)) { node.items.forEach(configureSkills); return }
  if (!isMap(node)) return
  if (node.get('id') === 'skill-filesystem') {
    const existing = node.get('config')?.toJSON()?.customSkillDirs ?? []
    node.setIn(['config', 'customSkillDirs'], [...new Set([...existing, skillDirectory])])
    if (node.get('name') === '@deepseek-ai/dsh-skill-filesystem') presetSkillProviders++
  }
  for (const pair of node.items) configureSkills(pair.value)
}
configureSkills(entries)
if (!presetSkillProviders) throw new Error('No preset skill provider found')
const insert = entries.items.find(node => isMap(node) && isSeq(node.get('insert')))?.get('insert')
if (!insert) throw new Error('Personal plugin insertion point is missing')
if (!insert.items.some(node => isMap(node) && node.get('id') === 'web-crawlers')) {
  insert.add({ id: 'web-crawlers', name: '@deepseek-ai/dsh-web-crawlers', config: { settingsFile: 'D:/desktop/personal-data/crawlers/settings.json' } })
}
if (JSON.stringify(before) !== JSON.stringify(selected.map(id => JSON.stringify(entry(id)?.toJSON())))) {
  throw new Error('Selected models or delegation settings changed')
}
writeFileSync(path, document.toString())
const instructionsPath = 'D:/desktop/personal-data/home/AGENTS.md'
const retrievalPolicy = `<!-- PERSONAL_CRAWLERS_START -->
## 统一网络检索

- 所有主模型和已授权的子代理使用 Harness 的 web_search / web_fetch。MediaCrawler 处理 bili:、xhs:、dy:、ks:、wb:、tieba:、zhihu: 平台查询；Better Crawler (Scrapling) 处理通用搜索和网页正文。
- 终端检索使用 D:/desktop/tools/personal-crawlers/desktop-crawlers.cmd search 或 fetch。不得调用 Firecrawl、Exa、Jina 或模型自带搜索，不得静默替换后端。
- 平台要求登录或验证时报告真实原因，由用户通过桌面 MediaCrawler.exe 完成。保留用户选择的主模型、子模型和委派限制；子代理不得继续派生。
<!-- PERSONAL_CRAWLERS_END -->`
const instructions = existsSync(instructionsPath) ? readFileSync(instructionsPath, 'utf8') : ''
writeFileSync(instructionsPath, instructions.includes('<!-- PERSONAL_CRAWLERS_START -->')
  ? instructions.replace(/<!-- PERSONAL_CRAWLERS_START -->[\s\S]*?<!-- PERSONAL_CRAWLERS_END -->/, retrievalPolicy)
  : instructions.trimEnd() + '\n\n' + retrievalPolicy + '\n')
console.log(JSON.stringify({ configured: 'personal-crawlers', selectedModelsPreserved: true, presetSkillProviders }))
