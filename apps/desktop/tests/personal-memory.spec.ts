import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PersonalMemory } from '../src/personal-memory.ts'

describe('PersonalMemory', () => {
  const dirs: string[] = []

  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      await rm(d, { recursive: true, force: true })
    }
  })

  it('manages workspace-isolated requirement memory, searches tokens, and rejects credentials', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pw-memory-'))
    dirs.push(tmp)
    const mem = new PersonalMemory({ dataRoot: tmp })
    const ws = 'D:\\desktop\\personal-desktop'

    // 1. Ensure project store and templates
    const store = mem.ensureProjectStore(ws)
    expect(store).toContain(tmp)

    // 2. Add Entries
    const entry1 = mem.addEntry(ws, 'confirmed', '用户选定的主模型只负责理解与决策', 'user')
    expect(entry1.label).toBe('CONFIRMED')
    expect(entry1.kind).toBe('confirmed')

    const entry2 = mem.addEntry(ws, 'rejected', '禁止子代理递归派生新子代理', 'handoff')
    expect(entry2.label).toBe('REJECTED')
    expect(entry2.kind).toBe('rejected')

    // 3. Search Entries
    const searchResults = mem.search(ws, '主模型 决策')
    expect(searchResults.length).toBeGreaterThan(0)
    expect(searchResults[0]?.entry.text).toContain('主模型')

    // 4. Reject Sensitive API Keys
    expect(() => {
      mem.addEntry(ws, 'confirmed', '我的 key 是 sk-1234567890abcdef1234567890', 'chat')
    }).toThrow('Refusing to store sensitive credential-like text')

    // 5. Revoke Entry
    const revoked = mem.revokeEntry(ws, entry1.id)
    expect(revoked).toBe(true)
    const remaining = mem.loadEntries(ws)
    const target = remaining.find(e => e.text === entry1.text)
    expect(target?.revoked).toBe(true)

    // 6. Unknown / Non-existent ID returns false and does NOT revoke unrelated entries
    const invalidRevoke = mem.revokeEntry(ws, 'CANON.md:nonexistent')
    expect(invalidRevoke).toBe(false)
    const afterInvalid = mem.loadEntries(ws)
    const entry2Target = afterInvalid.find(e => e.text === entry2.text)
    expect(entry2Target?.revoked).toBe(false)

    // 7. Disallowed ledger filename returns false
    const disallowedRevoke = mem.revokeEntry(ws, '../../passwords.txt:1')
    expect(disallowedRevoke).toBe(false)

    // 8. Empty query search excludes revoked entries
    const emptyQueryResults = mem.search(ws, '')
    expect(emptyQueryResults.some(r => r.entry.text === entry1.text)).toBe(false)
    expect(emptyQueryResults.some(r => r.entry.text === entry2.text)).toBe(true)
  })
})
