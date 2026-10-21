/** Typed preload operations exposed only by the Electron shell. */

import type { DesktopKeyboardApi, DesktopShortcutsApi } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type { IpcMainInvokeEvent } from 'electron'
import type { DesktopBrowserBridge } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import type { PersonalAccountsApi } from '@deepseek-ai/dsh-client-ui-personal-accounts/types'
import type { PersonalCrawlersSnapshot, CrawlerResultItem, CrawlerLogEntry } from './personal-crawlers.ts'
import type { ProjectTask, WorkflowTemplate, TaskAcceptanceEvidence } from './personal-workbench.ts'
import type { PersonalDesktopControlSnapshot, DesktopToolCallResult } from './personal-desktop-control.ts'
import type { DiagnosticsSnapshot, LiveStage } from './personal-diagnostics.ts'
import type { ProjectMemorySnapshot, MemoryEntry, MemorySearchResult, MemoryKind } from './personal-memory.ts'

export interface PersonalCrawlersApi {
  status(): Promise<PersonalCrawlersSnapshot | null>
  login(platform: string): Promise<PersonalCrawlersSnapshot>
  cancel(platform?: string): Promise<PersonalCrawlersSnapshot>
  crawl(platform: string, keyword: string, maxCount?: number): Promise<PersonalCrawlersSnapshot>
  getResults(platform?: string): Promise<CrawlerResultItem[]>
  subscribe(listener: (snapshot: PersonalCrawlersSnapshot) => void): () => void
  onLog?(listener: (log: CrawlerLogEntry) => void): () => void
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

export interface PersonalDesktopControlApi {
  status(): Promise<PersonalDesktopControlSnapshot | null>
  start(): Promise<PersonalDesktopControlSnapshot>
  executeTool(name: string, args: Record<string, any>): Promise<DesktopToolCallResult>
  stop(): Promise<PersonalDesktopControlSnapshot>
  resume(): Promise<PersonalDesktopControlSnapshot>
  subscribe(listener: (snapshot: PersonalDesktopControlSnapshot) => void): () => void
}

export interface PersonalDiagnosticsApi {
  status(): Promise<DiagnosticsSnapshot | null>
  export(): Promise<string>
  setLiveStage(stage: LiveStage, description?: string): Promise<void>
  subscribe(listener: (snapshot: DiagnosticsSnapshot) => void): () => void
}

export interface PersonalMemoryApi {
  snapshot(workspace?: string): Promise<ProjectMemorySnapshot | null>
  addEntry(workspace: string, kind: MemoryKind, text: string, source?: string): Promise<MemoryEntry>
  revokeEntry(workspace: string, entryId: string): Promise<boolean>
  search(workspace: string, query: string, limit?: number): Promise<MemorySearchResult[]>
  subscribe(listener: (snapshot: ProjectMemorySnapshot) => void): () => void
}

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  personalAccountsStatus: 'dsh-desktop:personal-accounts-status',
  personalAccountsLogin: 'dsh-desktop:personal-accounts-login',
  personalAccountsCancel: 'dsh-desktop:personal-accounts-cancel',
  personalAccountsSubmitCode: 'dsh-desktop:personal-accounts-submit-code',
  personalAccountsReopenAuthorization: 'dsh-desktop:personal-accounts-reopen-authorization',
  personalAccountsChanged: 'dsh-desktop:personal-accounts-changed',
  personalCrawlersStatus: 'dsh-desktop:personal-crawlers-status',
  personalCrawlersLogin: 'dsh-desktop:personal-crawlers-login',
  personalCrawlersCancel: 'dsh-desktop:personal-crawlers-cancel',
  personalCrawlersCrawl: 'dsh-desktop:personal-crawlers-crawl',
  personalCrawlersResults: 'dsh-desktop:personal-crawlers-results',
  personalCrawlersChanged: 'dsh-desktop:personal-crawlers-changed',
  personalCrawlersLog: 'dsh-desktop:personal-crawlers-log',
  personalWorkbenchTasks: 'dsh-desktop:personal-workbench-tasks',
  personalWorkbenchGetTask: 'dsh-desktop:personal-workbench-get-task',
  personalWorkbenchCreateTask: 'dsh-desktop:personal-workbench-create-task',
  personalWorkbenchUpdateTask: 'dsh-desktop:personal-workbench-update-task',
  personalWorkbenchGeneratePrompt: 'dsh-desktop:personal-workbench-generate-prompt',
  personalWorkbenchImportReport: 'dsh-desktop:personal-workbench-import-report',
  personalWorkbenchRecordEvidence: 'dsh-desktop:personal-workbench-record-evidence',
  personalWorkbenchTemplates: 'dsh-desktop:personal-workbench-templates',
  personalWorkbenchChanged: 'dsh-desktop:personal-workbench-changed',
  personalDesktopControlStatus: 'dsh-desktop:personal-desktop-control-status',
  personalDesktopControlStart: 'dsh-desktop:personal-desktop-control-start',
  personalDesktopControlExecute: 'dsh-desktop:personal-desktop-control-execute',
  personalDesktopControlStop: 'dsh-desktop:personal-desktop-control-stop',
  personalDesktopControlResume: 'dsh-desktop:personal-desktop-control-resume',
  personalDesktopControlChanged: 'dsh-desktop:personal-desktop-control-changed',
  personalDiagnosticsStatus: 'dsh-desktop:personal-diagnostics-status',
  personalDiagnosticsExport: 'dsh-desktop:personal-diagnostics-export',
  personalDiagnosticsStage: 'dsh-desktop:personal-diagnostics-stage',
  personalDiagnosticsChanged: 'dsh-desktop:personal-diagnostics-changed',
  personalMemorySnapshot: 'dsh-desktop:personal-memory-snapshot',
  personalMemoryAdd: 'dsh-desktop:personal-memory-add',
  personalMemoryRevoke: 'dsh-desktop:personal-memory-revoke',
  personalMemorySearch: 'dsh-desktop:personal-memory-search',
  personalMemoryChanged: 'dsh-desktop:personal-memory-changed',
  shortcutsInput: 'dsh-desktop:shortcuts-input',
  shortcutsCloseWindow: 'dsh-desktop:shortcuts-close-window',
  shortcutsGet: 'dsh-desktop:shortcuts-get',
  shortcutsEdit: 'dsh-desktop:shortcuts-edit',
  shortcutsChanged: 'dsh-desktop:shortcuts-changed',
  shortcutsRecording: 'dsh-desktop:shortcuts-recording',
  boot: 'dsh-desktop:boot',
  enterWorkspace: 'dsh-desktop:enter-workspace',
  onboardingActive: 'dsh-desktop:onboarding-active',
  onboardingApiKey: 'dsh-desktop:onboarding-api-key',
  bootFailed: 'dsh-desktop:boot-failed',
  browserAcquire: 'dsh-desktop:browser-acquire',
  browserRelease: 'dsh-desktop:browser-release',
  browserOpenRequested: 'dsh-desktop:browser-open-requested',
  directoryPick: 'dsh-desktop:directory-pick',
  deviceInfo: 'dsh-desktop:device-info',
  localeBootstrap: 'dsh-desktop:locale-bootstrap',
  localeChanged: 'dsh-desktop:locale-changed',
  updatesStatus: 'dsh-desktop:updates-status',
  updatesOpen: 'dsh-desktop:updates-open',
  updatesPresentation: 'dsh-desktop:updates-presentation',
  nativeThemeSet: 'dsh-desktop:native-theme-set',
  windowFullscreen: 'dsh-desktop:window-fullscreen',
  windowsAppearance: 'dsh-desktop:windows-appearance',
  windowsMenu: 'dsh-desktop:windows-menu',
} as const

/** Desktop release update state rendered by desktop-owned UI. */
export type DesktopUpdatePreparationFailureKind = 'stop-failed' | 'tasks-changed' | 'tasks-unavailable'

export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
  /** Main-owned diagnostics without subprocess output or credentials; hidden until expanded. */
  readonly technicalDetails?: string
  readonly percent?: number
  readonly failedOperation?: 'check' | 'download' | 'install'
  /** Main-owned preparation cause; UI wording is selected by the active locale. */
  readonly preparationFailure?: DesktopUpdatePreparationFailureKind
}

/** Classified failure copy selected by the Web locale without exposing raw updater diagnostics. */
export type DesktopUpdateFailureKind =
  | 'check'
  | 'check-network'
  | 'download'
  | 'download-network'
  | 'install'
  | 'install-network'
  | 'stop-failed'
  | 'tasks-changed'
  | 'tasks-unavailable'

/** Semantic status content; actions open main-process confirmation dialogs only. */
export interface DesktopUpdatePresentation {
  readonly phase: DesktopUpdateState['phase']
  readonly version?: string
  readonly percent?: number
  readonly failure?: DesktopUpdateFailureKind
}

/** Product documents cannot supply update versions, package URLs, or installation authorization. */
export interface DshDesktopProductApi {
  readonly personalAccounts: PersonalAccountsApi
  readonly personalCrawlers?: PersonalCrawlersApi
  readonly personalWorkbench?: PersonalWorkbenchApi
  readonly personalDesktopControl?: PersonalDesktopControlApi
  readonly personalDiagnostics?: PersonalDiagnosticsApi
  readonly personalMemory?: PersonalMemoryApi
  readonly protocolVersion: 1
  readonly browser: DesktopBrowserBridge
  readonly keyboard: DesktopKeyboardApi
  readonly shortcuts: DesktopShortcutsApi
  /**
   * Local machine description for the feedback questionnaire.
   * @returns `name=value` fields separated by `; `, with no hostname, user name, or serial number.
   */
  deviceInfo(): Promise<string>
  readonly updates: {
    status(): Promise<DesktopUpdatePresentation>
    open(): Promise<void>
    subscribe(listener: (state: DesktopUpdatePresentation) => void): () => void
  }
}

/** Scheme of Desktop-owned application documents. */
export const SCHEME = 'dsh-app'

/**
 * Reject IPC outside the allowed Desktop document origins.
 * @param event - IPC caller whose frame URL supplies the origin.
 * @param hostnames - Desktop document hosts allowed for this operation.
 */
export function assertDesktopSender(event: IpcMainInvokeEvent, hostnames: readonly string[]): void {
  const senderFrame = event.senderFrame
  if (senderFrame === null) throw new Error('dsh desktop: rejected IPC without a sender frame')
  const url = new URL(senderFrame.url)
  if (url.protocol !== `${SCHEME}:` || !hostnames.includes(url.hostname)) {
    throw new Error('dsh desktop: rejected IPC from an unowned renderer')
  }
}
