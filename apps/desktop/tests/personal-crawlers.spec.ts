import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const poll = <T>(fn: () => T) => expect.poll(fn, { timeout: 8000, interval: 50 })
import { PersonalCrawlers } from '../src/personal-crawlers.ts'

const directories: string[] = []
const crawlers: PersonalCrawlers[] = []

afterEach(async () => {
  for (const c of crawlers) {
    await c.dispose()
  }
  crawlers.length = 0
  for (const dir of directories) {
    await rm(dir, { recursive: true, force: true })
  }
  directories.length = 0
})

describe('PersonalCrawlers', () => {
  it('initializes default platforms and recognizes saved cookies', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crawlers-test-'))
    directories.push(dir)

    // Create mock saved cookie for bili
    const biliCookies = join(dir, 'browser-data', 'bili', 'Default', 'Network')
    await mkdir(biliCookies, { recursive: true })
    await writeFile(join(biliCookies, 'Cookies'), 'mock-cookie-data')

    const service = new PersonalCrawlers({
      dataDirectory: dir,
    })
    crawlers.push(service)

    const snap = service.snapshot()
    expect(snap.platforms.length).toBe(9)
    const bili = snap.platforms.find(p => p.id === 'bili')
    expect(bili?.status).toBe('saved')
    const xhs = snap.platforms.find(p => p.id === 'xhs')
    expect(xhs?.status).toBe('idle')
    const yt = snap.platforms.find(p => p.id === 'youtube')
    expect(yt?.status).toBe('saved')
    const x = snap.platforms.find(p => p.id === 'x')
    expect(x?.status).toBe('idle')
  })

  it('runs crawl command, streams logs, and collects results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crawlers-crawl-'))
    directories.push(dir)

    const mockWorker = join(dir, 'mock-worker.mjs')
    await writeFile(mockWorker, `
      import readline from 'node:readline';
      const rl = readline.createInterface({ input: process.stdin });
      rl.once('line', line => {
        const req = JSON.parse(line.trim());
        process.stderr.write('[MediaCrawler] Starting crawl on ' + req.platform + '\\n');
        process.stderr.write('[MediaCrawler] Found 2 items\\n');
        const res = {
          sources: [
            { title: 'Result 1', url: 'https://www.bilibili.com/video/BV1', snippet: 'Desc 1' },
            { title: 'Result 2', url: 'https://www.bilibili.com/video/BV2', snippet: 'Desc 2' }
          ]
        };
        process.stdout.write(JSON.stringify(res) + '\\n');
        rl.close();
        process.exit(0);
      });
    `)

    const service = new PersonalCrawlers({
      pythonExecutable: process.execPath,
      worker: mockWorker,
      dataDirectory: dir,
    })
    crawlers.push(service)

    const logs: string[] = []
    service.onLog(l => logs.push(l.message))

    const result = await service.crawl('bili', 'Vue 3', 2)
    expect(result.results.length).toBe(2)
    expect(result.results[0]?.title).toBe('Result 1')
    expect(logs.some(l => l.includes('Starting crawl on bili'))).toBe(true)
  }, 15000)

  it('handles login flow and logs progress', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crawlers-login-'))
    directories.push(dir)

    const mockWorker = join(dir, 'mock-login.mjs')
    await writeFile(mockWorker, `
      import readline from 'node:readline';
      const rl = readline.createInterface({ input: process.stdin });
      rl.once('line', line => {
        const req = JSON.parse(line.trim());
        process.stderr.write('[MediaCrawler] Opening browser for ' + req.platform + ' login\\n');
        setTimeout(() => {
          process.stderr.write('[MediaCrawler] Login successful\\n');
          process.stdout.write(JSON.stringify({ status: 'ok' }) + '\\n');
          rl.close();
          process.exit(0);
        }, 50);
      });
    `)

    const service = new PersonalCrawlers({
      pythonExecutable: process.execPath,
      worker: mockWorker,
      dataDirectory: dir,
    })
    crawlers.push(service)

    const loginPromise = service.login('xhs')
    await poll(() => service.snapshot().activePlatform).toBe('xhs')
    expect(service.snapshot().activeOperation).toBe('login')

    const finished = await loginPromise
    expect(finished.activePlatform).toBeUndefined()
  }, 15000)

  it('cancels active operation on request', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crawlers-cancel-'))
    directories.push(dir)

    const mockWorker = join(dir, 'mock-hang.mjs')
    await writeFile(mockWorker, `
      setInterval(() => {}, 1000);
    `)

    const service = new PersonalCrawlers({
      pythonExecutable: process.execPath,
      worker: mockWorker,
      dataDirectory: dir,
    })
    crawlers.push(service)

    const crawlPromise = service.crawl('bili', 'test', 1).catch(e => e)
    await poll(() => service.snapshot().activePlatform).toBe('bili')

    await service.cancel('bili')
    expect(service.snapshot().activePlatform).toBeUndefined()
    const error = await crawlPromise
    expect(error).toBeDefined()
  })
})
