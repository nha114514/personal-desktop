// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { CrawlerSearchCard, type CrawlerSearchCardProps } from '../src/client/CrawlerSearchCard.tsx'
import type { CrawlerSearchCardState, CrawlersCardInjected } from '../src/client/crawler-search-card-controller.ts'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)

it('shows the shared route, stages its path and offers no API key input', () => {
  const store = createSnapshotStore<CrawlerSearchCardState>({ available: true, writable: true, dirty: false,
    invalid: false, saving: false, failed: false, settingsFile: { text: 'D:/crawlers/settings.json', overridden: false, invalid: false } })
  const edit = vi.fn()
  const crawlersStore = createSnapshotStore<CrawlersCardInjected>({ available: true })
  const props = { view: 'page', t: (key: keyof typeof en) => en[key],
    useCrawlerSearchCard: bindSnapshotSelector(store),
    useCrawlers: bindSnapshotSelector(crawlersStore),
    edit, resetField: vi.fn(), save: vi.fn(), discard: vi.fn() } as CrawlerSearchCardProps
  render(<CrawlerSearchCard {...props} />)
  expect(screen.getByText(en.crawlerDescription)).toBeTruthy()
  expect(screen.queryByLabelText(en.apiKey)).toBeNull()
  fireEvent.change(screen.getByLabelText(en.settingsFile), { target: { value: 'D:/other/settings.json' } })
  expect(edit).toHaveBeenCalledWith('settingsFile', 'D:/other/settings.json')
})

it('renders MediaCrawler workbench with license notice, platforms, and login trigger', () => {
  const formStore = createSnapshotStore<CrawlerSearchCardState>({ available: true, writable: true, dirty: false,
    invalid: false, saving: false, failed: false, settingsFile: { text: 'D:/crawlers/settings.json', overridden: false, invalid: false } })
  const crawlersStore = createSnapshotStore<CrawlersCardInjected>({
    available: true,
    snapshot: {
      platforms: [
        { id: 'bili', name: 'B站', status: 'saved', busy: false },
        { id: 'xhs', name: '小红书', status: 'idle', busy: false },
      ],
      logs: [
        { id: 1, timestamp: '12:00:00', level: 'info', message: 'Test crawler log line' },
      ],
      results: [
        { id: '1', platform: 'bili', title: 'Vue Tutorial Video', url: 'https://bilibili.com/video/1', snippet: 'Great tutorial', crawledAt: '2026-10-04T12:00:00Z' },
      ],
    },
  })

  const login = vi.fn()
  const crawl = vi.fn()
  const props = {
    view: 'page',
    t: (key: keyof typeof en) => en[key],
    useCrawlerSearchCard: bindSnapshotSelector(formStore),
    useCrawlers: bindSnapshotSelector(crawlersStore),
    login,
    crawl,
    edit: vi.fn(),
    resetField: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
  } as CrawlerSearchCardProps

  render(<CrawlerSearchCard {...props} />)

  // Verify license notice is displayed
  expect(screen.getByText(en.licenseNotice)).toBeTruthy()
  expect(screen.getByText(en.workbenchTitle)).toBeTruthy()

  // Verify platforms rendered
  expect(screen.getByText('B站')).toBeTruthy()
  expect(screen.getByText(en.statusSaved)).toBeTruthy()
  expect(screen.getByText('小红书')).toBeTruthy()

  // Verify logs rendered
  expect(screen.getByText('Test crawler log line')).toBeTruthy()

  // Verify result rendered
  expect(screen.getByText('Vue Tutorial Video')).toBeTruthy()

  // Test login button click
  const loginBtn = screen.getByText(en.loginBrowser)
  fireEvent.click(loginBtn)
  expect(login).toHaveBeenCalledWith('bili')

  // Test crawl form submission
  const input = screen.getByPlaceholderText(en.keywordPlaceholder)
  fireEvent.change(input, { target: { value: 'React 19' } })
  const startBtn = screen.getByText(en.startCrawl)
  fireEvent.click(startBtn)
  expect(crawl).toHaveBeenCalledWith('bili', 'React 19', 5)
})
