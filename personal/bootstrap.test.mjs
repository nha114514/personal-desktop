import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { initializePersonalHome } from './bootstrap.mjs'

test('initialization uses the account route and preserves later local changes', () => {
  const home = mkdtempSync(join(tmpdir(), 'personal-desktop-home-'))
  try {
    initializePersonalHome(home)
    const profilePatch = join(home, 'profiles', 'desktop', 'cordis.patch.yml')
    const patch = readFileSync(profilePatch, 'utf8')
    assert.match(patch, /provider: codex/)
    assert.match(patch, /model: gpt-6\.1-sol/)
    assert.match(patch, /provider: deepseek-account/)
    assert.match(patch, /toolName: subagent_codex/)
    assert.match(patch, /preference: zh/)
    assert.doesNotMatch(patch, /API_KEY|TOKEN|PASSWORD/)
    assert.equal(existsSync(join(home, 'cordis.patch.yml')), false)
    writeFileSync(profilePatch, '# my settings\n')
    writeFileSync(join(home, 'cordis.patch.yml'), '# my global settings\n')
    writeFileSync(join(home, 'AGENTS.md'), 'my own instructions\n')
    initializePersonalHome(home)
    assert.equal(readFileSync(profilePatch, 'utf8'), '# my settings\n')
    assert.equal(readFileSync(join(home, 'cordis.patch.yml'), 'utf8'), '# my global settings\n')
    assert.equal(readFileSync(join(home, 'AGENTS.md'), 'utf8'), 'my own instructions\n')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
