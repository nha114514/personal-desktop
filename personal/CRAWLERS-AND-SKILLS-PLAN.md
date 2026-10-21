# Shared crawler routing and personal skills

Latest approved scope: replace Personal Desktop's search implementation with MediaCrawler and Better Crawler (Scrapling). Every configured main model and authorized child uses the same retrieval tools. Do not introduce Firecrawl. Separately migrate frequently used skills with their resources.

1. Install a dedicated Python environment and upstream MediaCrawler in the personal tools directory. Preserve browser/account data and other Python environments.
2. Register one search/fetch provider on `ctx.web`: supported platform queries use MediaCrawler, general web queries and page reading use Scrapling. Return bounded sources and real failures; do not invoke another LLM to do retrieval.
3. Connect the existing `web_search` / `web_fetch` tools and enforce the shared route in CLI adapters. Disable native search where possible, and explicitly report any CLI path that cannot be constrained.
4. Update the existing Plugins → Web search surface to describe and configure the active crawler route. Copy and adapt the selected skill bundles without replacing user edits.
5. Build affected packages and test real search, fetch, configuration, skill discovery, and primary/child tool routing. Preserve main/child model choices and leaf-only delegation.
