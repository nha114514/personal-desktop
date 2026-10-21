/** One retrieval route shared by main and child agents, with no auxiliary LLM. */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { WebError, type WebFetchProvider, type WebFetchRequest, type WebFetchResult,
  type WebSearchProvider, type WebSearchRequest, type WebSearchResult } from '@deepseek-ai/dsh-web'

export interface CrawlerOptions {
  pythonExecutable: string
  mediaCrawlerDirectory: string
  dataDirectory: string
  searchEngine: string
  timeoutMs: number
  maxBodyChars: number
}

const PLATFORM_DOMAINS: Record<string, string> = {
  'xiaohongshu.com': 'xhs', 'rednote.com': 'xhs', 'douyin.com': 'dy', 'kuaishou.com': 'ks',
  'bilibili.com': 'bili', 'weibo.com': 'wb', 'tieba.baidu.com': 'tieba', 'zhihu.com': 'zhihu',
  'youtube.com': 'youtube', 'youtu.be': 'youtube', 'x.com': 'x', 'twitter.com': 'x',
}
const PLATFORM_NAMES: Record<string, string> = {
  xhs: 'xhs', 小红书: 'xhs', dy: 'dy', 抖音: 'dy', ks: 'ks', 快手: 'ks',
  bili: 'bili', B站: 'bili', b站: 'bili', bilibili: 'bili', wb: 'wb', 微博: 'wb', tieba: 'tieba', 贴吧: 'tieba', zhihu: 'zhihu', 知乎: 'zhihu',
  youtube: 'youtube', yt: 'youtube', YouTube: 'youtube', YT: 'youtube',
  x: 'x', twitter: 'x', Twitter: 'x', X: 'x',
}

/** Explicit platform prefixes and site filters select MediaCrawler, yt-dlp, or OpenCLI. */
export function mediaQuery(query: string): { platform: string; query: string } | undefined {
  const prefix = /^([^\s:：]+)[:：]\s*(.+)$/s.exec(query.trim())
  const platform = prefix?.[1] === undefined ? undefined : PLATFORM_NAMES[prefix[1]]
  if (platform && prefix?.[2]) return { platform, query: prefix[2] }
  const site = /\bsite:(?:www\.)?([a-z0-9.-]+)\b/i.exec(query)
  const domainPlatform = site?.[1] === undefined ? undefined : PLATFORM_DOMAINS[site[1].toLowerCase()]
  if (domainPlatform) return { platform: domainPlatform, query: query.replace(site![0], '').trim() }
  return undefined
}

/** A Python subprocess owns each bounded crawler request and all its browser children. */
export class CrawlerProvider implements WebSearchProvider, WebFetchProvider {
  readonly id = 'personal-crawlers'
  constructor(private readonly options: () => CrawlerOptions) {}

  available(): boolean { return existsSync(this.options().pythonExecutable) }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const platformQuery = mediaQuery(request.query)
    const result = await this.run({ operation: 'search', query: request.query,
      maxResults: Math.min(20, Math.max(1, request.maxResults ?? 8)), ...platformQuery }, signal)
    if (!Array.isArray(result.sources)) throw new WebError('Crawler returned no source list', 'WEB_PROVIDER_INVALID_RESPONSE')
    const sources = result.sources.filter((source): source is { url: string; title?: string; snippet?: string } =>
      isRecord(source) && typeof source.url === 'string' && /^https?:\/\//.test(source.url))
    return { sources, truncated: result.truncated === true }
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    let url: URL
    try { url = new URL(request.url) } catch (error) { throw new WebError('Invalid page URL', 'WEB_INVALID_URL', { cause: error }) }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
      || /^(localhost|127\.|0\.|\[?::1\]?)/i.test(url.hostname)) {
      throw new WebError('Only public HTTP(S) URLs without credentials are allowed', 'WEB_INVALID_URL')
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const platform = PLATFORM_DOMAINS[host] ?? (host.endsWith('youtube.com') || host.endsWith('youtu.be') ? 'youtube' : host.endsWith('x.com') || host.endsWith('twitter.com') ? 'x' : undefined)
    const result = await this.run({ operation: 'fetch', url: url.href, ...(platform ? { platform } : {}) }, signal)
    if (typeof result.url !== 'string' || typeof result.statusCode !== 'number' || !isRecord(result.body)
      || result.body.kind !== 'text' || typeof result.body.content !== 'string') {
      throw new WebError('Crawler returned an invalid page response', 'WEB_PROVIDER_INVALID_RESPONSE')
    }
    const limit = this.options().maxBodyChars
    return { url: result.url, statusCode: result.statusCode, body: { kind: 'text', content: result.body.content.slice(0, limit) },
      truncated: result.truncated === true || result.body.content.length > limit }
  }

  private async run(request: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (signal?.aborted) throw new WebError('Search canceled', 'WEB_ABORTED')
    const options = this.options()
    const runner = fileURLToPath(new URL('../runtime/crawler.py', import.meta.url))
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|TOKEN|SECRET|PASSWORD/i.test(key)))
    let output: string
    try {
      output = await new Promise<string>((resolve, reject) => {
        const child = execFile(options.pythonExecutable, [runner], {
          env: { ...env, PYTHONUTF8: '1' }, windowsHide: true, timeout: options.timeoutMs,
          maxBuffer: 1_000_000, encoding: 'utf8', ...(signal ? { signal } : {}),
        }, (error, stdout) => { if (error) reject(error); else resolve(stdout) })
        child.stdin?.end(JSON.stringify({ ...options, ...request }) + '\n')
      })
    } catch (error) {
      const code = signal?.aborted ? 'WEB_ABORTED' : 'WEB_PROVIDER_FAILURE'
      throw new WebError(code === 'WEB_ABORTED' ? 'Search canceled' : 'Crawler request failed or timed out; check the local crawler runtime', code, { cause: error })
    }
    let result: unknown
    try { result = JSON.parse(output) } catch (error) {
      throw new WebError('Crawler returned invalid JSON', 'WEB_PROVIDER_INVALID_RESPONSE', { cause: error })
    }
    if (!isRecord(result)) throw new WebError('Crawler returned an invalid response', 'WEB_PROVIDER_INVALID_RESPONSE')
    if (isRecord(result.error)) {
      throw new WebError(typeof result.error.message === 'string' ? result.error.message : 'Crawler request failed',
        typeof result.error.code === 'string' ? result.error.code : 'WEB_PROVIDER_FAILURE')
    }
    return result
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
