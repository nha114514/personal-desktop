import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Bundle freshness and exports regression check', () => {
  it('ensures llm-gemini lib/index.js is fresh and exports Antigravity member adapters', () => {
    const pkgDir = resolve(__dirname, '..')
    const srcIndex = resolve(pkgDir, 'src/index.ts')
    const libIndex = resolve(pkgDir, 'lib/index.js')

    expect(existsSync(libIndex)).toBe(true)
    const srcStat = statSync(srcIndex)
    const libStat = statSync(libIndex)
    expect(libStat.mtimeMs).toBeGreaterThanOrEqual(srcStat.mtimeMs)

    const content = readFileSync(libIndex, 'utf-8')
    expect(content).toContain('AntigravityAdapter')
    expect(content).not.toContain('registerAdapter(["gemini-1"]')
    expect(content).toContain('gemini-2')
    expect(content).not.toContain('Gemini 会员账号 1')
    expect(content).toContain('Gemini 会员账号 2')
    expect(content).toContain('Gemini API 密钥未配置')
  })

  it('ensures llm-codex lib/index.js is fresh and contains connection reuse', () => {
    const pkgDir = resolve(__dirname, '../../llm-codex')
    const srcIndex = resolve(pkgDir, 'src/index.ts')
    const libIndex = resolve(pkgDir, 'lib/index.js')

    expect(existsSync(libIndex)).toBe(true)
    const srcStat = statSync(srcIndex)
    const libStat = statSync(libIndex)
    expect(libStat.mtimeMs).toBeGreaterThanOrEqual(srcStat.mtimeMs)

    const content = readFileSync(libIndex, 'utf-8')
    expect(content).toContain('CodexConnection')
    expect(content).toContain('gpt-6.1-sol')
  })
})
