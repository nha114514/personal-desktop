import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument, isSeq, isMap } from '../packages/skill/skill-filesystem/node_modules/yaml/dist/index.js'
import { parsePersonalPatch } from './configure-gemini.mjs'

/** Add or refresh the coordinator policy without changing model or child settings. */
export function configurePrimaryDelegation(original, template) {
  const document = parseDocument(original)
  if (document.errors.length || !isSeq(document.contents)) throw new Error('Invalid personal profile')
  const source = parsePersonalPatch(template).flatMap(row => row.insert ?? [])
    .find(row => row.id === 'primary-delegation')
  if (!source) throw new Error('Primary delegation policy is missing from the template')
  const matches = []
  for (const row of document.contents.items) {
    if (!isMap(row)) continue
    if (row.get('id') === source.id) matches.push(row)
    const inserted = row.get('insert')
    if (isSeq(inserted)) {
      for (const entry of inserted.items) {
        if (isMap(entry) && entry.get('id') === source.id) matches.push(entry)
      }
    }
  }
  if (matches.length > 1) throw new Error('Duplicate primary delegation policies; profile was not changed')
  const existing = matches[0]
  if (existing) {
    if (existing.get('name') === source.name && existing.get('disabled') !== true
      && JSON.stringify(existing.get('config')?.toJSON()) === JSON.stringify(source.config)) return original
    existing.set('name', source.name)
    existing.set('disabled', false)
    existing.set('config', source.config)
  } else {
    document.contents.add(document.createNode({ insert: [source] }))
  }
  return document.toString()
}

const policy = `<!-- PRIMARY_DELEGATION_START -->
## 主模型与子代理分工

- 用户选择的主模型负责需求理解、决策、设计方向、任务拆解、结果综合与验收判断。
- 桌面控制仅允许主模型使用。其他执行工作必须通过 subagent 委派给用户授权的子代理，包括读取和修改文件、写代码、运行命令、测试调试、搜索抓取和网页检索。验收所需的检查和测试也由子代理执行，主模型依据返回证据作出判断。
- 主模型可以加载 Skill 指导、管理计划、派发和收回子任务，并使用专属桌面控制工具；不能通过 CLI、脚本、MCP 或其它智能体绕过其他执行限制。子代理不得通过任何入口操控桌面，其他全部已授权技能（包括需求记忆）继续开放。
- 保留用户选择的主模型、子模型及推理等级。未指定子模型时使用已保存的子代理默认设置；仅允许授权模型，最多并行 8 个。子代理为执行叶节点，不得再次派生或委派。
- 子代理失败、额度耗尽或未授权时如实报告，可以重试已授权子代理；主模型不得接手其执行工作或静默换模型。
<!-- PRIMARY_DELEGATION_END -->`

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] ?? 'D:/desktop/personal-data/home/profiles/desktop/cordis.patch.yml'
  const original = readFileSync(path, 'utf8')
  const template = readFileSync(new URL('./personal.patch.yml', import.meta.url), 'utf8')
  const next = configurePrimaryDelegation(original, template)
  const withoutPolicy = text => parsePersonalPatch(text).flatMap(row => row.insert ?? [row])
    .filter(row => row.id !== 'primary-delegation')
  if (JSON.stringify(withoutPolicy(original)) !== JSON.stringify(withoutPolicy(next))) {
    throw new Error('Unrelated settings changed; profile was not written')
  }
  if (!existsSync(path + '.before-primary-delegation')) copyFileSync(path, path + '.before-primary-delegation')
  if (next !== original) writeFileSync(path, next)
  const instructionsPath = resolve(path, '../../../AGENTS.md')
  const instructions = existsSync(instructionsPath) ? readFileSync(instructionsPath, 'utf8') : ''
  writeFileSync(instructionsPath, instructions.includes('<!-- PRIMARY_DELEGATION_START -->')
    ? instructions.replace(/<!-- PRIMARY_DELEGATION_START -->[\s\S]*?<!-- PRIMARY_DELEGATION_END -->/, policy)
    : instructions.trimEnd() + '\n\n' + policy + '\n')
  console.log(JSON.stringify({ primary: 'decision-and-design', desktopControl: 'primary-model', otherExecution: 'authorized-subagents', selectedModelsPreserved: true }))
}
