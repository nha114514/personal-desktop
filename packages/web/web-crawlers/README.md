# Shared crawler provider

Registers `personal-crawlers` for both search and fetch on `ctx.web`. All main and child agents calling `web_search` / `web_fetch` use the same configured route. No LLM is used to perform retrieval.

General web searches retrieve Bing or DuckDuckGo result pages through Scrapling (Better Crawler); page reads return Markdown, real HTTP status, and bounded content. Platform prefixes (`xhs:`, `bili:`, `zhihu:`, or their Chinese names) and supported `site:` filters use upstream [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler). Platform authentication remains in its separate browser profile. A required login returns `WEB_LOGIN_REQUIRED` instead of opening a browser during a tool call.

Deployment must supply absolute `pythonExecutable`, `mediaCrawlerDirectory`, and `dataDirectory`. Python requires Scrapling fetchers, markdownify, and upstream MediaCrawler's requirements. Run `personal/Setup-Crawlers.ps1` for installation and runtime checks, or `personal/Login-MediaCrawler.ps1 -Platform xhs` to authorize a platform. Native CLI search requires separate adapter containment; changing this provider alone does not constrain a CLI's built-in tools.

Lifecycle is request-owned: cancellation and timeout stop the Python process. No invariant companion is needed because registration and request settlement have no independently cached observations.

MediaCrawler requests acquire a process-shared lock for their platform's browser profile. The desktop WebUI uses the same lock through `personal/crawlers/media_entry.py`. Different platforms and ordinary web retrieval remain independent. A profile still occupied after 30 seconds returns `WEB_PLATFORM_BUSY`, instead of starting another Chromium instance against its login state.

## Model Experience

The existing `web_search` and `web_fetch` tool names and schemas remain unchanged. Retrieval returns actual source URLs and status codes; platform login requirements produce explicit errors. Windows workers own a job object so cancellation also closes their browser processes. The provider registry removes both registrations when the plugin is disposed or reloaded.

### KV Cache effect

Provider selection changes execution, not the tool schemas. Tool result text contributes to the ordinary conversation history.

## Known limitations

Platform searches require an authorized MediaCrawler browser profile. The global MCP server exposes the same worker to other clients, but clients must load it and follow its routing policy. It cannot reconfigure arbitrary third-party AI applications. Dynamic webpage extraction and platform-specific remote failures still depend on the upstream software.
