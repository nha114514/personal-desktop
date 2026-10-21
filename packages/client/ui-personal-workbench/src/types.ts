export type TaskPhase =
  | 'pending'
  | 'in-progress'
  | 'waiting-user'
  | 'pending-acceptance'
  | 'failed-acceptance'
  | 'accepted'
  | 'canceled'

export interface TaskAcceptanceEvidence {
  command?: string
  exitCode?: number | null
  fileVersions?: Record<string, string>
  screenshots?: string[]
  failedItems?: string[]
  unverifiedItems?: string[]
  verifiedItems?: string[]
  leafInspector?: string
  secondaryLeafReviewer?: string
  judgment?: 'passed' | 'partially-passed' | 'failed'
  notes?: string
}

export interface TaskMaterialItem {
  id: string
  name: string
  type: 'attachment' | 'screenshot' | 'log' | 'webpage' | 'transcript' | 'diff' | 'document'
  source: string
  capturedAt: string
  completeness: 'full' | 'partial' | 'metadata-only'
  filePath?: string
  content?: string
}

export interface ExternalReportImport {
  id: string
  source: string
  importedAt: string
  summary: string
  verified: boolean
  rawReport: string
  claims: string[]
}

export interface ProjectTask {
  id: string
  projectId: string
  title: string
  target: string
  confirmedRequirements: string[]
  designChoices: string[]
  prohibitedProposals: string[]
  routing: {
    primaryModel: string
    subagentModel: string
    reasoningEffort: string
    accountNumber?: string
  }
  phase: TaskPhase
  currentBlockers?: string
  nextSteps?: string
  acceptanceEvidence?: TaskAcceptanceEvidence
  materials: TaskMaterialItem[]
  importedReports: ExternalReportImport[]
  createdAt: string
  updatedAt: string
}

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  category: 'development' | 'debugging' | 'experiment' | 'research'
  steps: string[]
}

export interface PersonalWorkbenchApi {
  listTasks(projectId?: string): Promise<ProjectTask[]>
  getTask(id: string): Promise<ProjectTask | null>
  createTask(data: Partial<ProjectTask> & { projectId: string; title: string; target: string }): Promise<ProjectTask>
  updateTask(id: string, updates: Partial<ProjectTask>): Promise<ProjectTask | null>
  generateHandoffPrompt(id: string): Promise<string>
  importReport(taskId: string, report: { source: string; summary: string; rawReport: string; claims?: string[] }): Promise<ProjectTask | null>
  recordEvidence(taskId: string, evidence: TaskAcceptanceEvidence): Promise<ProjectTask | null>
  listTemplates(): Promise<WorkflowTemplate[]>
  subscribe(listener: (tasks: ProjectTask[]) => void): () => void
}

export interface PersonalDesktopControlSnapshot {
  connected: boolean
  serverVersion?: string
  toolCount: number
  tools: string[]
  activeTargetWindow?: string
  busy: boolean
  locked: boolean
  paused?: boolean
  lastScreenshotPath?: string
  lastScreenshotBase64?: string
  lastAction?: string
  lastError?: string
}

export interface DesktopToolCallResult {
  tool: string
  isError: boolean
  output: string
  imagePath?: string
  imageBase64?: string
  timestamp: string
}

export interface PersonalDesktopControlApi {
  status(): Promise<PersonalDesktopControlSnapshot | null>
  start(): Promise<PersonalDesktopControlSnapshot>
  executeTool(name: string, args: Record<string, any>): Promise<DesktopToolCallResult>
  stop(): Promise<PersonalDesktopControlSnapshot>
  resume(): Promise<PersonalDesktopControlSnapshot>
  subscribe(listener: (snapshot: PersonalDesktopControlSnapshot) => void): () => void
}

export type LiveStage =
  | 'idle'
  | 'cli-launching'
  | 'protocol-connecting'
  | 'waiting-first-token'
  | 'executing-tools'
  | 'subagent-working'
  | 'canceling'
  | 'streaming'

/** Non-secret observations of the exact adapter request, never a prompt or credential. */
export interface ModelRequestObservation {
  requestId: string
  sessionId?: string
  parentSessionId?: string
  role: 'primary' | 'subagent' | 'auxiliary'
  provider: string
  model: string
  reasoningEffort?: string
  phase: 'started' | 'first-event' | 'first-text' | 'finished' | 'tools-started' | 'tools-finished'
  channelType?: 'membership-cli' | 'api-direct' | 'unknown'
  elapsedMs: number
  outcome?: 'success' | 'tool-calls' | 'error' | 'aborted' | 'incomplete'
  failureCode?: string
  toolName?: string
}

/** One bounded request trace; successful transport is distinct from successful inference. */
export interface ModelRequestTrace {
  requestId: string
  sessionId?: string
  parentSessionId?: string
  role: ModelRequestObservation['role']
  provider: string
  model: string
  reasoningEffort?: string
  startedAt: string
  channelType: 'membership-cli' | 'api-direct' | 'unknown'
  elapsedMs: number
  firstEventMs?: number
  firstTextMs?: number
  finishedMs?: number
  outcome?: ModelRequestObservation['outcome']
  failureCode?: string
  toolName?: string
}

export interface DiagnosticsSnapshot {
  modelRoutes: {
    primaryModel: {
      provider: string
      model: string
      reasoningEffort: string
      accountNumber?: string
    }
    subagentModels: {
      provider: string
      model: string
    }[]
    configuredMatchesActual: boolean | null
    channelType: 'membership-cli' | 'api-direct' | 'unknown'
    actualPrimary?: ModelRequestTrace
  }
  modelRequests: ModelRequestTrace[]
  accounts: {
    id: string
    name: string
    status: 'saved' | 'verified' | 'unverified' | 'authentication-required' | 'quota-exceeded' | 'network-error' | 'cli-unavailable'
    checkedAt?: string
    guidanceRequired: boolean
    message?: string
  }[]
  liveStage: {
    stage: LiveStage
    stageStartedAt: string
    elapsedMs: number
    lastActivityAt: string
    description?: string
  }
  dependencies: {
    name: string
    path?: string
    version?: string
    status: 'available' | 'missing' | 'error'
    detail?: string
  }[]
  staleness: {
    isStale: boolean
    latestSrcMtime?: string
    bundleMtime?: string
    warning?: string
  }
  timestamp: string
}

export interface PersonalDiagnosticsApi {
  status(): Promise<DiagnosticsSnapshot | null>
  export(): Promise<string>
  setLiveStage(stage: LiveStage, description?: string): Promise<void>
  subscribe(listener: (snapshot: DiagnosticsSnapshot) => void): () => void
}

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
  agentsRules?: string
  lastLoadedAt: string
}

export interface MemorySearchResult {
  entry: MemoryEntry
  score: number
}

export interface PersonalMemoryApi {
  snapshot(workspace?: string): Promise<ProjectMemorySnapshot | null>
  addEntry(workspace: string, kind: MemoryKind, text: string, source?: string): Promise<MemoryEntry>
  revokeEntry(workspace: string, entryId: string): Promise<boolean>
  search(workspace: string, query: string, limit?: number): Promise<MemorySearchResult[]>
  subscribe(listener: (snapshot: ProjectMemorySnapshot) => void): () => void
}
