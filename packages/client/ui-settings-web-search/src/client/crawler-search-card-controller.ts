/** Staged form and native workbench controller for the shared crawler settings and MediaCrawler. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SettingsFormModel, settingsTextField, type SettingsFieldState, type SettingsFormActions,
  type SettingsFormScope, type SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'

export const CRAWLER_SEARCH_NS = 'web-crawlers'
export interface CrawlerSearchSettings { settingsFile?: string }
export interface CrawlerSearchCardState extends SettingsFormShell { settingsFile: SettingsFieldState }

export interface MediaPlatformInfo {
  id: string
  name: string
  status: 'saved' | 'idle' | 'logging-in' | 'crawling' | 'verified' | 'expired'
  busy: boolean
}

export interface CrawlerLogEntry {
  id: number
  timestamp: string
  level: 'info' | 'warning' | 'error' | 'success'
  message: string
}

export interface CrawlerResultItem {
  id: string
  platform: string
  title: string
  url: string
  snippet: string
  crawledAt: string
}

export interface PersonalCrawlersSnapshot {
  platforms: MediaPlatformInfo[]
  activePlatform?: string | undefined
  activeOperation?: 'login' | 'crawl' | undefined
  logs: CrawlerLogEntry[]
  results: CrawlerResultItem[]
}

export interface PersonalCrawlersApi {
  status(): Promise<PersonalCrawlersSnapshot | null>
  login(platform: string): Promise<PersonalCrawlersSnapshot>
  cancel(platform?: string): Promise<PersonalCrawlersSnapshot>
  crawl(platform: string, keyword: string, maxCount?: number): Promise<PersonalCrawlersSnapshot>
  getResults(platform?: string): Promise<CrawlerResultItem[]>
  subscribe(listener: (snapshot: PersonalCrawlersSnapshot) => void): () => void
  onLog?(listener: (log: CrawlerLogEntry) => void): () => void
}

export interface CrawlersCardInjected {
  snapshot?: PersonalCrawlersSnapshot | undefined
  available: boolean
}

export interface CrawlerSearchCardFace extends SettingsFormActions {
  hooks: {
    crawlerSearchCard: SnapshotStore<CrawlerSearchCardState>
    crawlers: SnapshotStore<CrawlersCardInjected>
  }
  login?(platform: string): Promise<void>
  cancel?(platform?: string): Promise<void>
  crawl?(platform: string, keyword: string, maxCount?: number): Promise<void>
  getResults?(platform?: string): Promise<CrawlerResultItem[]>
}

export class CrawlerSearchCardController {
  private readonly form: SettingsFormModel<CrawlerSearchSettings>
  private readonly store: SnapshotStore<CrawlerSearchCardState>
  private readonly crawlersStore: SnapshotStore<CrawlersCardInjected>
  private unsubscribe?: (() => void) | undefined

  constructor(scope: SettingsFormScope<CrawlerSearchSettings>) {
    this.form = new SettingsFormModel(scope, [settingsTextField('settingsFile')])
    this.store = this.form.bind(() => ({ ...this.form.shell(), settingsFile: this.form.field('settingsFile') }))

    const api = (globalThis as typeof globalThis & { dshDesktop?: { personalCrawlers?: PersonalCrawlersApi } }).dshDesktop?.personalCrawlers
    this.crawlersStore = createSnapshotStore<CrawlersCardInjected>({
      available: api !== undefined,
    })

    if (api) {
      const unsubSnap = api.subscribe((snapshot) => {
        this.crawlersStore.set({ snapshot, available: true })
      })
      let unsubLog: (() => void) | undefined
      if (api.onLog) {
        unsubLog = api.onLog((log) => {
          const current = this.crawlersStore.getSnapshot()
          if (current.snapshot) {
            const nextLogs = [...current.snapshot.logs, log].slice(-200)
            this.crawlersStore.set({
              ...current,
              snapshot: {
                ...current.snapshot,
                logs: nextLogs,
              },
            })
          }
        })
      }
      this.unsubscribe = () => {
        unsubSnap()
        unsubLog?.()
      }
      void api.status().then((snap) => {
        if (snap) this.crawlersStore.set({ snapshot: snap, available: true })
      }).catch(() => {})
    }
  }

  inject(): CrawlerSearchCardFace {
    const api = (globalThis as typeof globalThis & { dshDesktop?: { personalCrawlers?: PersonalCrawlersApi } }).dshDesktop?.personalCrawlers
    return {
      hooks: {
        crawlerSearchCard: this.store,
        crawlers: this.crawlersStore,
      },
      login: async (platform: string) => {
        if (api) await api.login(platform)
      },
      cancel: async (platform?: string) => {
        if (api) await api.cancel(platform)
      },
      crawl: async (platform: string, keyword: string, maxCount?: number) => {
        if (api) await api.crawl(platform, keyword, maxCount)
      },
      getResults: async (platform?: string) => {
        if (api) return await api.getResults(platform)
        return []
      },
      ...this.form.actions(),
    }
  }

  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = undefined
    }
    this.form.dispose()
  }
}
