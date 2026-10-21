/** Origin-scoped boot, native directory selection, host paths of picked files, and update presentation with native confirmation actions. */

import type { DesktopShortcutInput, ShortcutConfigSnapshot, ShortcutSaveResult } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { DESKTOP_IPC, SCHEME, type DshDesktopProductApi, type DesktopUpdatePresentation } from './ipc.ts'
import { PLATFORM_IPC } from './platform-ipc.ts'
import { markDocumentPlatform, syncWindowFullscreen } from './preload-platform.ts'
import { syncNativeTheme } from './preload-theme.ts'
import { syncWindowsAppearance } from './preload-windows.ts'
import { installMandatoryUpdateOverlay } from './preload-mandatory-overlay.ts'
import { createDesktopBrowserBridge } from './preload-browser.ts'
import { isPersonalDesktop } from './personal-product.ts'
import type { PersonalAccountsSnapshot } from '@deepseek-ai/dsh-client-ui-personal-accounts/types'
import type { PersonalCrawlersSnapshot, CrawlerResultItem, CrawlerLogEntry } from './personal-crawlers.ts'

function shouldInstallMandatoryUpdateOverlay(): boolean {
  if (process.platform !== 'win32') return false
  const argv = Array.isArray(process.argv) ? process.argv : []
  if (
    argv.includes('--dsh-mandatory-update=0')
    || argv.includes('--dsh-personal-desktop=1')
    || argv.includes('--dsh-welcome-personal=1')
  ) {
    return false
  }
  if (
    argv.includes('--dsh-mandatory-update=1')
    || argv.includes('--dsh-personal-desktop=0')
    || argv.includes('--dsh-welcome-personal=0')
  ) {
    return true
  }
  try {
    return !(typeof process.env === 'object' && process.env !== null && isPersonalDesktop(process.env))
  } catch {
    return true
  }
}

function createProductApi(): DshDesktopProductApi {
  return {
    protocolVersion: 1,
    personalAccounts: {
      status: () => ipcRenderer.invoke(DESKTOP_IPC.personalAccountsStatus) as Promise<PersonalAccountsSnapshot | null>,
      login: account => ipcRenderer.invoke(DESKTOP_IPC.personalAccountsLogin, account) as Promise<PersonalAccountsSnapshot>,
      cancel: account => ipcRenderer.invoke(DESKTOP_IPC.personalAccountsCancel, account) as Promise<PersonalAccountsSnapshot>,
      submitCode: (account, code) => ipcRenderer.invoke(DESKTOP_IPC.personalAccountsSubmitCode, account, code) as Promise<PersonalAccountsSnapshot>,
      reopenAuthorization: account => ipcRenderer.invoke(DESKTOP_IPC.personalAccountsReopenAuthorization, account) as Promise<PersonalAccountsSnapshot>,
      subscribe(listener) {
        const handle = (_event: Electron.IpcRendererEvent, state: PersonalAccountsSnapshot): void => { listener(state) }
        ipcRenderer.on(DESKTOP_IPC.personalAccountsChanged, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.personalAccountsChanged, handle) }
      },
    },
    personalCrawlers: {
      status: () => ipcRenderer.invoke(DESKTOP_IPC.personalCrawlersStatus) as Promise<PersonalCrawlersSnapshot | null>,
      login: platform => ipcRenderer.invoke(DESKTOP_IPC.personalCrawlersLogin, platform) as Promise<PersonalCrawlersSnapshot>,
      cancel: platform => ipcRenderer.invoke(DESKTOP_IPC.personalCrawlersCancel, platform) as Promise<PersonalCrawlersSnapshot>,
      crawl: (platform, keyword, maxCount) => ipcRenderer.invoke(DESKTOP_IPC.personalCrawlersCrawl, platform, keyword, maxCount) as Promise<PersonalCrawlersSnapshot>,
      getResults: platform => ipcRenderer.invoke(DESKTOP_IPC.personalCrawlersResults, platform) as Promise<CrawlerResultItem[]>,
      subscribe(listener) {
        const handle = (_event: Electron.IpcRendererEvent, state: PersonalCrawlersSnapshot): void => { listener(state) }
        ipcRenderer.on(DESKTOP_IPC.personalCrawlersChanged, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.personalCrawlersChanged, handle) }
      },
      onLog(listener) {
        const handle = (_event: Electron.IpcRendererEvent, log: CrawlerLogEntry): void => { listener(log) }
        ipcRenderer.on(DESKTOP_IPC.personalCrawlersLog, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.personalCrawlersLog, handle) }
      },
    },
    personalWorkbench: {
      listTasks: (projectId?: string) => ipcRenderer.invoke(DESKTOP_IPC.personalWorkbenchTasks, projectId),
      getTask: (id: string) => ipcRenderer.invoke(DESKTOP_IPC.personalWorkbenchGetTask, id),
      createTask: (data: any) => ipcRenderer.invoke(DESKTOP_IPC.personalWorkbenchCreateTask, data),
      updateTask: (id: string, updates: any) => ipcRenderer.invoke(DESKTOP_IPC.personalWorkbenchUpdateTask, id, updates),
      generateHandoffPrompt: (id: string) => ipcRenderer.invoke(DESKTOP_IPC.personalWorkbenchGeneratePrompt, id),
      importReport: (taskId: string, report: any) => ipcRenderer.invoke(DESKTOP_IPC.personalWorkbenchImportReport, taskId, report),
      recordEvidence: (taskId: string, evidence: any) => ipcRenderer.invoke(DESKTOP_IPC.personalWorkbenchRecordEvidence, taskId, evidence),
      listTemplates: () => ipcRenderer.invoke(DESKTOP_IPC.personalWorkbenchTemplates),
      subscribe(listener) {
        const handle = (_event: Electron.IpcRendererEvent, tasks: any): void => { listener(tasks) }
        ipcRenderer.on(DESKTOP_IPC.personalWorkbenchChanged, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.personalWorkbenchChanged, handle) }
      },
    },
    personalDesktopControl: {
      status: () => ipcRenderer.invoke(DESKTOP_IPC.personalDesktopControlStatus),
      start: () => ipcRenderer.invoke(DESKTOP_IPC.personalDesktopControlStart),
      executeTool: (name: string, args: any) => ipcRenderer.invoke(DESKTOP_IPC.personalDesktopControlExecute, name, args),
      stop: () => ipcRenderer.invoke(DESKTOP_IPC.personalDesktopControlStop),
      resume: () => ipcRenderer.invoke(DESKTOP_IPC.personalDesktopControlResume),
      subscribe(listener) {
        const handle = (_event: Electron.IpcRendererEvent, snapshot: any): void => { listener(snapshot) }
        ipcRenderer.on(DESKTOP_IPC.personalDesktopControlChanged, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.personalDesktopControlChanged, handle) }
      },
    },
    personalDiagnostics: {
      status: () => ipcRenderer.invoke(DESKTOP_IPC.personalDiagnosticsStatus),
      export: () => ipcRenderer.invoke(DESKTOP_IPC.personalDiagnosticsExport),
      setLiveStage: (stage: any, desc?: string) => ipcRenderer.invoke(DESKTOP_IPC.personalDiagnosticsStage, stage, desc),
      subscribe(listener) {
        const handle = (_event: Electron.IpcRendererEvent, snapshot: any): void => { listener(snapshot) }
        ipcRenderer.on(DESKTOP_IPC.personalDiagnosticsChanged, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.personalDiagnosticsChanged, handle) }
      },
    },
    personalMemory: {
      snapshot: (workspace?: string) => ipcRenderer.invoke(DESKTOP_IPC.personalMemorySnapshot, workspace),
      addEntry: (workspace: string, kind: any, text: string, source?: string) => ipcRenderer.invoke(DESKTOP_IPC.personalMemoryAdd, workspace, kind, text, source),
      revokeEntry: (workspace: string, entryId: string) => ipcRenderer.invoke(DESKTOP_IPC.personalMemoryRevoke, workspace, entryId),
      search: (workspace: string, query: string, limit?: number) => ipcRenderer.invoke(DESKTOP_IPC.personalMemorySearch, workspace, query, limit),
      subscribe(listener) {
        const handle = (_event: Electron.IpcRendererEvent, snapshot: any): void => { listener(snapshot) }
        ipcRenderer.on(DESKTOP_IPC.personalMemoryChanged, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.personalMemoryChanged, handle) }
      },
    },
    browser: createDesktopBrowserBridge(),
    deviceInfo: () => ipcRenderer.invoke(DESKTOP_IPC.deviceInfo) as Promise<string>,
    keyboard: {
      closeWindow: revision => ipcRenderer.invoke(DESKTOP_IPC.shortcutsCloseWindow, revision) as Promise<void>,
      subscribe: (listener) => {
        const handle = (_event: Electron.IpcRendererEvent, input: DesktopShortcutInput): void => {
          if (input.kind === 'iframe') {
            const element = document.activeElement
            if (!(element instanceof HTMLIFrameElement) || !element.isConnected
              || !element.matches('iframe[data-sidebar-browser-frame], iframe[data-html-preview]')) return
            if (input.frameName === '' || element.name !== input.frameName) return
          }
          if (input.kind === 'webview') {
            const element = document.activeElement
            if (element?.matches('webview[data-sidebar-browser-frame]') !== true || !element.isConnected
              || input.frameName === '' || element.getAttribute('name') !== input.frameName) return
          }
          listener(input)
        }
        ipcRenderer.on(DESKTOP_IPC.shortcutsInput, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.shortcutsInput, handle) }
      },
    },
    shortcuts: {
      get: definitions => ipcRenderer.invoke(DESKTOP_IPC.shortcutsGet, definitions) as Promise<ShortcutConfigSnapshot>,
      edit: (edit, revision) => ipcRenderer.invoke(DESKTOP_IPC.shortcutsEdit, edit, revision) as Promise<ShortcutSaveResult>,
      recording: active => ipcRenderer.invoke(DESKTOP_IPC.shortcutsRecording, active) as Promise<void>,
      subscribe(listener) {
        const handle = (_event: Electron.IpcRendererEvent, snapshot: ShortcutConfigSnapshot): void => { listener(snapshot) }
        ipcRenderer.on(DESKTOP_IPC.shortcutsChanged, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.shortcutsChanged, handle) }
      },
    },
    updates: {
      status: () => ipcRenderer.invoke(DESKTOP_IPC.updatesStatus) as Promise<DesktopUpdatePresentation>,
      open: () => ipcRenderer.invoke(DESKTOP_IPC.updatesOpen) as Promise<void>,
      subscribe(listener) {
        const handle = (_event: Electron.IpcRendererEvent, state: DesktopUpdatePresentation): void => { listener(state) }
        ipcRenderer.on(DESKTOP_IPC.updatesPresentation, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.updatesPresentation, handle) }
      },
    },
  }
}

if (location.protocol === `${SCHEME}:` && location.hostname === 'app') {
  contextBridge.exposeInMainWorld('dshOnboarding', {
    hasApiKey: () => ipcRenderer.invoke(DESKTOP_IPC.onboardingApiKey) as Promise<boolean>,
    setActive: (active: boolean) => { ipcRenderer.send(DESKTOP_IPC.onboardingActive, active) },
  })
  ipcRenderer.on(DESKTOP_IPC.enterWorkspace, () => {
    const body = document.body
    const previous = body.getAttribute('tabindex')
    body.tabIndex = -1
    body.focus({ preventScroll: true })
    if (previous === null) body.removeAttribute('tabindex')
    else body.setAttribute('tabindex', previous)
  })
  syncWindowsAppearance()
  if (shouldInstallMandatoryUpdateOverlay()) installMandatoryUpdateOverlay()
  contextBridge.exposeInMainWorld('__DSH_DIRECTORY_PICKER__', {
    pick: () => ipcRenderer.invoke(DESKTOP_IPC.directoryPick) as Promise<string | null>,
  })
  // The composer cites dropped, picked, and pasted files and folders that
  // have a real path as `@path` references instead of uploading them; a
  // File without one (pasted bytes) answers '' and uploads as before.
  contextBridge.exposeInMainWorld('__DSH_HOST_PATHS__', {
    pathFor: (file: File) => webUtils.getPathForFile(file),
  })
  contextBridge.exposeInMainWorld('dshDesktopBoot', {
    ready: () => ipcRenderer.invoke(DESKTOP_IPC.boot) as Promise<unknown>,
    failed: (message: string) => ipcRenderer.invoke(DESKTOP_IPC.bootFailed, message) as Promise<void>,
  })
  contextBridge.exposeInMainWorld('dshPlatform', {
    open: (page: 'usage' | 'top-up', bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke(PLATFORM_IPC.open, page, bounds),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke(PLATFORM_IPC.bounds, bounds),
    close: () => ipcRenderer.invoke(PLATFORM_IPC.close),
  })
}

markDocumentPlatform()
syncWindowFullscreen()
syncNativeTheme()
// Main-process IPC also verifies the owning window and top frame.
contextBridge.exposeInMainWorld('dshDesktop', location.protocol === `${SCHEME}:` && location.hostname === 'app' && process.isMainFrame ? createProductApi() : { protocolVersion: 1 })

if (location.protocol === `${SCHEME}:` && location.hostname === 'app') {
  contextBridge.exposeInMainWorld('__DSH_LOCALE__', {
    read: () => ipcRenderer.invoke(DESKTOP_IPC.localeBootstrap),
    onChange: (locale: string) => { ipcRenderer.send(DESKTOP_IPC.localeChanged, locale) },
  })
}
