import { afterEach, describe, expect, it, vi } from 'vitest'
import { CrawlerProvider, mediaQuery } from '../src/provider.ts'

const exec = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile: exec }))
afterEach(() => vi.clearAllMocks())

const options = () => ({ pythonExecutable: process.execPath, mediaCrawlerDirectory: 'D:/desktop/tools/MediaCrawler',
  dataDirectory: 'D:/desktop/personal-data/crawlers', searchEngine: 'bing', timeoutMs: 1000, maxBodyChars: 10 })

describe('shared crawler routing', () => {
  it('routes platform prefixes and site operators without treating arbitrary text as a platform', () => {
    expect(mediaQuery('site:bilibili.com Python')).toEqual({ platform: 'bili', query: 'Python' })
    expect(mediaQuery('小红书: 通勤穿搭')).toEqual({ platform: 'xhs', query: '通勤穿搭' })
    expect(mediaQuery('youtube: OpenAI Sora')).toEqual({ platform: 'youtube', query: 'OpenAI Sora' })
    expect(mediaQuery('yt: Sora demo')).toEqual({ platform: 'youtube', query: 'Sora demo' })
    expect(mediaQuery('site:youtube.com Sora')).toEqual({ platform: 'youtube', query: 'Sora' })
    expect(mediaQuery('x: AI news')).toEqual({ platform: 'x', query: 'AI news' })
    expect(mediaQuery('twitter: DeepSeek')).toEqual({ platform: 'x', query: 'DeepSeek' })
    expect(mediaQuery('site:x.com OpenAI')).toEqual({ platform: 'x', query: 'OpenAI' })
    expect(mediaQuery('how to write a crawler')).toBeUndefined()
  })

  it('routes YouTube and X fetch requests with platform tag to backend', async () => {
    let capturedInput = ''
    exec.mockImplementation((_file, _args, _options, callback) => {
      callback(null, JSON.stringify({ url: 'https://www.youtube.com/watch?v=123', statusCode: 200, body: { kind: 'text', content: 'Video Content' }, truncated: false }), '')
      return {
        stdin: {
          end: (data: string) => { capturedInput = data }
        }
      }
    })
    const provider = new CrawlerProvider(options)
    await provider.fetch({ url: 'https://www.youtube.com/watch?v=123' })
    expect(capturedInput).toContain('"platform":"youtube"')
  })

  it('uses the same executable for search across model routes and bounds result count', async () => {
    exec.mockImplementation((_file, _args, _options, callback) => {
      callback(null, JSON.stringify({ sources: [{ url: 'https://example.com', title: 'Example' }], truncated: false }), '')
      return { stdin: { end: vi.fn() } }
    })
    const provider = new CrawlerProvider(options)
    await expect(provider.search({ query: 'hello', maxResults: 2 })).resolves.toMatchObject({ sources: [{ url: 'https://example.com' }] })
    expect(exec).toHaveBeenCalledOnce()
    expect(exec.mock.calls[0]?.[2]).toMatchObject({ windowsHide: true, timeout: 1000 })
  })

  it('preserves structured authentication failures instead of falling back to a cloud search model', async () => {
    exec.mockImplementation((_file, _args, _options, callback) => {
      callback(null, JSON.stringify({ error: { code: 'WEB_LOGIN_REQUIRED', message: 'Platform login required' } }), '')
      return { stdin: { end: vi.fn() } }
    })
    await expect(new CrawlerProvider(options).search({ query: 'xhs: test' })).rejects.toMatchObject({ code: 'WEB_LOGIN_REQUIRED' })
    expect(exec).toHaveBeenCalledOnce()
  })

  it('preserves structured extension connection failures for X', async () => {
    exec.mockImplementation((_file, _args, _options, callback) => {
      callback(null, JSON.stringify({ error: { code: 'WEB_EXTENSION_NOT_CONNECTED', message: 'Bridge extension not connected' } }), '')
      return { stdin: { end: vi.fn() } }
    })
    await expect(new CrawlerProvider(options).search({ query: 'x: test' })).rejects.toMatchObject({ code: 'WEB_EXTENSION_NOT_CONNECTED' })
    expect(exec).toHaveBeenCalledOnce()
  })

  it('returns a real status, truncates content, and rejects invalid URLs before launch', async () => {
    exec.mockImplementation((_file, _args, _options, callback) => {
      callback(null, JSON.stringify({ url: 'https://example.com/', statusCode: 200, body: { kind: 'text', content: 'abcdefghijklmnop' }, truncated: false }), '')
      return { stdin: { end: vi.fn() } }
    })
    const provider = new CrawlerProvider(options)
    await expect(provider.fetch({ url: 'https://example.com' })).resolves.toMatchObject({ statusCode: 200, body: { content: 'abcdefghij' }, truncated: true })
    for (const url of ['file:///D:/private', 'http://user:pass@example.com', 'http://127.0.0.1']) {
      await expect(provider.fetch({ url })).rejects.toMatchObject({ code: 'WEB_INVALID_URL' })
    }
    expect(exec).toHaveBeenCalledOnce()
  })
})
