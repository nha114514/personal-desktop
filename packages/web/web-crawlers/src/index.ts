/** MediaCrawler platform search and Scrapling web retrieval on the shared `ctx.web` seam. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CrawlerProvider } from './provider.ts'
import { readFileSync } from 'node:fs'
import type { CrawlerOptions } from './provider.ts'

export const name = 'web-crawlers'
export const inject = ['web']

export interface Config {
  settingsFile: Volatile<string>
}

export const Config = z.object({
  settingsFile: z.string().min(1).required().volatile(),
})

/** Both capabilities use the same route regardless of the calling agent's model. */
export function apply(ctx: Context, config: Config): void {
  const provider = new CrawlerProvider(() => {
    const settings: CrawlerOptions = JSON.parse(readFileSync(config.settingsFile.get(), 'utf8'))
    if (![settings.pythonExecutable, settings.mediaCrawlerDirectory, settings.dataDirectory].every(value => typeof value === 'string' && value.length > 0)
      || !['bing', 'duckduckgo'].includes(settings.searchEngine)) {
      throw new Error('Global crawler settings have invalid paths or search source')
    }
    if (!Number.isInteger(settings.timeoutMs) || settings.timeoutMs < 1000 || settings.timeoutMs > 120000
      || !Number.isInteger(settings.maxBodyChars) || settings.maxBodyChars < 1000 || settings.maxBodyChars > 200000) {
      throw new Error('Global crawler settings have invalid request limits')
    }
    return settings
  })
  ctx.web.registerSearchProvider(provider)
  ctx.web.registerFetchProvider(provider)
}
