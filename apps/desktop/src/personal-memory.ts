/**
 * Project Memory & Rules service for Personal Desktop.
 * Native integration and display for requirement-memory (CANON, DECISIONS, CURRENT-STATE, TRACEABILITY)
 * and AGENTS.md project rules. Isolated by workspace root path.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

export type MemoryKind = 'confirmed' | 'decision' | 'rejected' | 'state' | 'trace'

export interface MemoryEntry {
  id: string
  kind: MemoryKind
  label: string
  timestamp: string
  text: string
  source: string
  file: string
  revoked?: boolean
}

export interface ProjectMemorySnapshot {
  workspace: string
  storePath: string
  entries: MemoryEntry[]
  agentsRules?: string | undefined
  lastLoadedAt: string
}

export interface MemorySearchResult {
  entry: MemoryEntry
  score: number
}

export interface PersonalMemoryOptions {
  dataRoot?: string
}

export class PersonalMemory {
  private readonly dataRoot: string
  private readonly listeners = new Set<(snapshot: ProjectMemorySnapshot) => void>()
  private currentWorkspace: string = 'D:\\desktop\\personal-desktop'

  constructor(options: PersonalMemoryOptions = {}) {
    this.dataRoot = options.dataRoot
      ?? join(homedir(), '.codex', 'requirement-memory', 'projects')
  }

  private normalizeWorkspace(workspace: string): string {
    return resolve(workspace).replace(/[\\/]+$/, '')
  }

  getProjectStorePath(workspace: string): string {
    const normalized = this.normalizeWorkspace(workspace)
    const hash = createHash('sha256')
      .update(normalized.toLowerCase())
      .digest('hex')
      .slice(0, 12)
    const leaf = basename(normalized) || 'workspace'
    const slug = leaf.toLowerCase().replace(/[^a-z0-9\p{L}\p{Nd}-]+/gu, '-').replace(/^-+|-+$/g, '') || 'workspace'
    return join(this.dataRoot, `${slug}-${hash}`)
  }

  ensureProjectStore(workspace: string): string {
    const store = this.getProjectStorePath(workspace)
    mkdirSync(store, { recursive: true })

    const templates: Record<string, string> = {
      'CANON.md': '# Project Canon\n\nOnly explicit, currently active requirements belong here.\n\n## Confirmed requirements\n\n',
      'DECISIONS.md': '# Decisions\n\nActive decisions and rejected or superseded directions are kept separate.\n\n## Active decisions\n\n## Rejected or superseded\n\n',
      'CURRENT-STATE.md': '# Current State\n\nRecord only observed and verified implementation state.\n\n## State log\n\n',
      'TRACEABILITY.md': '# Traceability\n\nConnect requirements to implementation evidence, tests, or remaining work.\n\n## Trace log\n\n',
    }

    for (const [file, content] of Object.entries(templates)) {
      const p = join(store, file)
      if (!existsSync(p)) {
        writeFileSync(p, content, 'utf8')
      }
    }

    const metaPath = join(store, 'meta.json')
    if (!existsSync(metaPath)) {
      writeFileSync(metaPath, JSON.stringify({
        schemaVersion: 1,
        workspace: this.normalizeWorkspace(workspace),
        createdAt: new Date().toISOString(),
      }, null, 2), 'utf8')
    }

    return store
  }

  testSensitiveText(value: string): boolean {
    if (/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)) return true
    if (/(?:[a-z0-9_-]*)(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|token)\s*[:=]\s*\S+/i.test(value)) return true
    if (/\bsk-[A-Za-z0-9_-]{16,}\b/.test(value)) return true
    return false
  }

  loadEntries(workspace: string): MemoryEntry[] {
    const store = this.ensureProjectStore(workspace)
    const entries: MemoryEntry[] = []

    const files: Array<{ name: string; kind: MemoryKind; label: string }> = [
      { name: 'CANON.md', kind: 'confirmed', label: 'CONFIRMED' },
      { name: 'DECISIONS.md', kind: 'decision', label: 'DECISION' },
      { name: 'CURRENT-STATE.md', kind: 'state', label: 'STATE' },
      { name: 'TRACEABILITY.md', kind: 'trace', label: 'TRACE' },
    ]

    for (const f of files) {
      const p = join(store, f.name)
      if (!existsSync(p)) continue
      const lines = readFileSync(p, 'utf8').split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim()
        if (!line || !line.startsWith('- [')) continue

        // Pattern: - [LABEL] [TIMESTAMP] TEXT (source: SOURCE)
        // or - [REVOKED:LABEL] ...
        const match = line.match(/^- \[([A-Z:]+)\] \[([^\]]+)\] (.+?)(?: \(source: ([^)]+)\))?$/)
        if (match) {
          const rawLabel = match[1] ?? f.label
          const isRevoked = rawLabel.startsWith('REVOKED:')
          const actualLabel = isRevoked ? rawLabel.slice('REVOKED:'.length) : rawLabel
          const kind = actualLabel === 'REJECTED' ? 'rejected' : f.kind
          entries.push({
            id: `${f.name}:${i}`,
            kind,
            label: actualLabel,
            timestamp: match[2] ?? '',
            text: match[3] ?? '',
            source: match[4] ?? 'unspecified',
            file: f.name,
            revoked: isRevoked,
          })
        }
      }
    }

    return entries
  }

  loadAgentsRules(workspace: string): string | undefined {
    const agentsPath = join(this.normalizeWorkspace(workspace), 'AGENTS.md')
    if (existsSync(agentsPath)) {
      try {
        return readFileSync(agentsPath, 'utf8')
      } catch {}
    }
    return undefined
  }

  addEntry(workspace: string, kind: MemoryKind, text: string, source = 'user'): MemoryEntry {
    if (!text.trim()) throw new Error('Memory text cannot be empty')
    if (this.testSensitiveText(text) || this.testSensitiveText(source)) {
      throw new Error('Refusing to store sensitive credential-like text in project memory')
    }

    const store = this.ensureProjectStore(workspace)
    const file = kind === 'confirmed'
      ? 'CANON.md'
      : (kind === 'decision' || kind === 'rejected')
        ? 'DECISIONS.md'
        : (kind === 'state' ? 'CURRENT-STATE.md' : 'TRACEABILITY.md')

    const label = kind === 'confirmed' ? 'CONFIRMED' : kind === 'rejected' ? 'REJECTED' : kind === 'decision' ? 'DECISION' : kind === 'state' ? 'STATE' : 'TRACE'
    const cleanText = text.replace(/[\r\n]+/g, ' ').trim()
    const cleanSource = source.replace(/[\r\n]+/g, ' ').trim()
    const timestamp = new Date().toISOString()
    const line = `- [${label}] [${timestamp}] ${cleanText} (source: ${cleanSource})\n`

    const p = join(store, file)
    const content = existsSync(p) ? readFileSync(p, 'utf8') : ''
    const linesBefore = content.split('\n')
    const lineIndex = linesBefore.length > 0 && linesBefore[linesBefore.length - 1] === ''
      ? linesBefore.length - 1
      : linesBefore.length
    writeFileSync(p, content + line, 'utf8')

    const entry: MemoryEntry = {
      id: `${file}:${lineIndex}`,
      kind,
      label,
      timestamp,
      text: cleanText,
      source: cleanSource,
      file,
      revoked: false,
    }

    this.publish(workspace)
    return entry
  }

  revokeEntry(workspace: string, entryId: string): boolean {
    const parts = entryId.split(':')
    const fileName = parts[0]
    const idxOrId = parts[1]
    if (!fileName || !idxOrId) return false

    const allowedFiles = new Set(['CANON.md', 'DECISIONS.md', 'CURRENT-STATE.md', 'TRACEABILITY.md'])
    if (!allowedFiles.has(fileName)) return false

    const store = this.ensureProjectStore(workspace)
    const p = join(store, fileName)
    if (!existsSync(p)) return false

    const lines = readFileSync(p, 'utf8').split('\n')
    const lineIndex = parseInt(idxOrId, 10)

    if (isNaN(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) {
      return false
    }

    const targetLine = lines[lineIndex]
    if (targetLine && targetLine.startsWith('- [') && !targetLine.startsWith('- [REVOKED:')) {
      lines[lineIndex] = targetLine.replace(/^- \[/, '- [REVOKED:')
      writeFileSync(p, lines.join('\n'), 'utf8')
      this.publish(workspace)
      return true
    }

    return false
  }

  search(workspace: string, query: string, limit = 10): MemorySearchResult[] {
    const entries = this.loadEntries(workspace)
    const activeEntries = entries.filter(e => !e.revoked)
    if (!query.trim()) {
      return activeEntries.slice(0, limit).map(entry => ({ entry, score: 1 }))
    }

    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    const scored: MemorySearchResult[] = []

    for (const entry of activeEntries) {
      let score = 0
      const content = `${entry.text} ${entry.label} ${entry.source}`.toLowerCase()
      for (const token of tokens) {
        if (content.includes(token)) score += 1
      }
      if (score > 0) {
        scored.push({ entry, score })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit)
  }

  snapshot(workspace?: string): ProjectMemorySnapshot {
    const ws = workspace ?? this.currentWorkspace
    return {
      workspace: ws,
      storePath: this.getProjectStorePath(ws),
      entries: this.loadEntries(ws),
      agentsRules: this.loadAgentsRules(ws),
      lastLoadedAt: new Date().toISOString(),
    }
  }

  subscribe(listener: (snapshot: ProjectMemorySnapshot) => void, workspace?: string): () => void {
    if (workspace) this.currentWorkspace = workspace
    this.listeners.add(listener)
    listener(this.snapshot(this.currentWorkspace))
    return () => { this.listeners.delete(listener) }
  }

  private publish(workspace: string): void {
    const snap = this.snapshot(workspace)
    for (const listener of this.listeners) {
      try { listener(snap) } catch {}
    }
  }
}
