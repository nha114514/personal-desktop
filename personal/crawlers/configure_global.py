"""Apply the shared retrieval policy without changing model or credential settings."""
import json
from pathlib import Path
import re
import shutil
import tomllib

USER = Path('C:/Users/mouwe')
POLICY = '''
<!-- PERSONAL_CRAWLERS_START -->
## Shared internet retrieval

Use the personal-crawlers MCP server's web_search and web_fetch for internet retrieval in every project.
MediaCrawler handles supported platform queries (bili:, xhs:, dy:, ks:, wb:, tieba:, zhihu:).
Better Crawler (Scrapling) handles general search and webpage extraction. The fallback command is
D:/desktop/tools/personal-crawlers/desktop-crawlers.cmd search "query" or fetch "https://example.com".
This user-selected routing supersedes legacy retrieval examples in skills. Do not use Firecrawl,
Exa, Jina or a model provider's native search instead. Preserve the user's selected models and delegation limits.
Report actual login or verification requirements. Do not fabricate results or substitute another backend silently.
<!-- PERSONAL_CRAWLERS_END -->
'''


def main():
    config_file = USER / '.codex/config.toml'
    original = config_file.read_text(encoding='utf-8')
    before = tomllib.loads(original)
    if not (config_file.parent / 'config.before-personal-crawlers.toml').exists():
        shutil.copy2(config_file, config_file.parent / 'config.before-personal-crawlers.toml')
    changed, count = re.subn(r'^web_search\s*=\s*.*$', 'web_search = "disabled"', original, count=1, flags=re.M)
    if not count:
        changed = 'web_search = "disabled"\n' + original
    after = tomllib.loads(changed)
    assert {key: value for key, value in before.items() if key != 'web_search'} == {key: value for key, value in after.items() if key != 'web_search'}
    config_file.write_text(changed, encoding='utf-8')
    for path in [USER / '.codex/AGENTS.md', USER / '.gemini/GEMINI.md']:
        path.parent.mkdir(parents=True, exist_ok=True)
        content = path.read_text(encoding='utf-8') if path.exists() else ''
        if 'PERSONAL_CRAWLERS_START' in content:
            content = re.sub(r'<!-- PERSONAL_CRAWLERS_START -->.*?<!-- PERSONAL_CRAWLERS_END -->', POLICY.strip(), content, flags=re.S)
        else:
            content = content.rstrip() + '\n' + POLICY
        path.write_text(content, encoding='utf-8')
    print(json.dumps({'codexNativeSearch': after['web_search'], 'codexMcp': 'personal-crawlers' in after.get('mcp_servers', {}), 'policyFilesUpdated': 2}))


if __name__ == '__main__':
    main()
