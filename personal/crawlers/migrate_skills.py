"""Copy frequently read skills and adapt Codex-specific entry points for Harness."""
import json
from pathlib import Path
import re
import shutil

BASE = Path('C:/Users/mouwe/.codex')
TARGET = Path('D:/desktop/tools/personal-crawlers/skills')

# Code workflow, standards, debugging, review, stack-specific, and parallel skills
SKILL_NAMES = [
    # Workflows & Planning
    'vibecoding-better-coding', 'brainstorming', 'writing-plans',
    # Standards & Simplification
    'coding-standards', 'karpathy-guidelines', 'ponytail',
    'ponytail-audit', 'ponytail-debt', 'ponytail-gain', 'ponytail-help', 'ponytail-review',
    # Debugging & Verification
    'systematic-debugging', 'test-driven-development', 'verification-before-completion',
    # Review
    'requesting-code-review', 'receiving-code-review', 'multi-agent-review',
    # Stack-specific
    'node', 'vercel-react-best-practices', 'webapp-testing', 'playwright', 'frontend-skill', 'gsap',
    # Worktree / Parallel
    'using-git-worktrees', 'dispatching-parallel-agents', 'subagent-driven-development',
    # Crawlers & General
    'agent-reach', 'better-crawler'
]

SOURCES = {name: BASE / 'skills' / name for name in SKILL_NAMES}
SOURCES['recall-project-context'] = BASE / 'plugins/cache/personal/requirement-memory/0.1.0/skills/recall-project-context'
SOURCES['documents'] = BASE / 'plugins/cache/openai-primary-runtime/documents/26.904.11930/skills/documents'
SOURCES['pdf'] = BASE / 'plugins/cache/openai-primary-runtime/pdf/26.904.11930/skills/pdf'

COMPATIBILITY = '''
## Personal Desktop runtime

These are the governing adaptations for this migrated copy. The user request takes precedence over this skill.
Use the Harness `skill` tool to load skills and the actual available file/terminal tools to execute scripts.
All web retrieval uses Harness `web_search` and `web_fetch`, or the global `desktop-crawlers` command.
Use `bili:`, `xhs:`, `dy:`, `ks:`, `wb:`, `tieba:`, or `zhihu:` prefixes for MediaCrawler platform searches.
Do not use legacy Firecrawl, Exa, Jina, or provider-native search commands from preserved references.
Keep the selected main model and authorized subagent models.
Only the primary model can create or schedule authorized subagents (up to 8 parallel).
Subagents are strictly leaf execution nodes and must never spawn, delegate, or derive further subagents.
When reviews or cross-checks are required, report the need to the primary model for dispatch.
Do not substitute unavailable tools or retrieval backends.
The installed Python is `D:/desktop/tools/crawler-runtime/Scripts/python.exe`.
Use absolute workspace paths on Windows; replace illustrative `/mnt/data` or `/tmp` paths with a task directory.
Use ordinary Markdown links to deliver local files. Codex-only artifact logging, template pickers, citation directives,
computer-use helpers and dependency-loader tools are not part of Harness. Do not attempt to call them.
Render document/PDF outputs locally and inspect every page using the available image-reading tool.

'''


def main():
    TARGET.mkdir(parents=True, exist_ok=True)
    manifest = []
    for name, source in SOURCES.items():
        if not source.exists():
            print(f"Skipping non-existent source: {source}")
            continue
        destination = TARGET / name
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(source, destination, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', 'node_modules', '.git', '.venv', 'venv'))
        skill_md_path = destination / 'SKILL.md'
        if not skill_md_path.exists():
            continue
        original = skill_md_path.read_text(encoding='utf-8')
        (destination / 'UPSTREAM-SKILL.md').write_text(original, encoding='utf-8')
        
        if name == 'agent-reach':
            metadata = original.split('---', 2)[1]
            metadata = re.sub(r'description:.*?(?=\nmetadata:)', 'description: >\n  用于互联网搜索、网页读取和平台调研。统一使用 Personal Desktop 的 web_search / web_fetch，\n  媒体平台由 MediaCrawler 处理，通用网页由 Better Crawler 处理。\n', metadata, flags=re.S)
            adapted = f'---{metadata}---\n# Agent Reach\n' + COMPATIBILITY + '''
Before research, call `web_search` with one to four focused queries. Read relevant returned URLs with `web_fetch`.
For platform research use the supported prefix. If login or verification is required, report it and let the user authorize
through MediaCrawler.exe. Cite actual returned source URLs and distinguish claims from your inferences.
Use Better Crawler for pages outside MediaCrawler platforms. Do not silently substitute another retrieval backend.
'''
        else:
            adapted = original
            if name == 'better-crawler':
                adapted = adapted.replace('"$HOME\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe"', '"D:/desktop/tools/crawler-runtime/Scripts/python.exe"')
            if name in ('documents', 'pdf'):
                adapted = re.sub(r'Immediately before the first create/edit.*?```.*?```', '', adapted, flags=re.S)
                adapted = re.sub(r'## Artifact Template Selection.*?(?=\n## )', '', adapted, flags=re.S)
                adapted = re.sub(r'- Use Codex workspace dependencies.*?\n', '- Use the installed local Python environment and bundled helper scripts.\n', adapted)
                adapted = re.sub(r'If you need to use LibreOffice,.*?\n', 'Use the available local LibreOffice executable with an isolated temporary profile.\n', adapted)
                adapted = re.sub(r'Place :?codex-file-citation.*', 'Deliver each final file with an absolute-path Markdown link.', adapted)
                adapted = '\n'.join(line for line in adapted.splitlines() if ':codex-file-citation{' not in line)
            
            # Adapt subagent / delegation references across skills
            adapted = re.sub(r'(\b(?:spawn|fork|delegate to|start)\b[^\n]*\b(?:subagent|sub-agent|worker|reviewer)\b)', r'\1 (requested via primary model; subagents cannot spawn subagents)', adapted, flags=re.I)
            
            split = adapted.split('---', 2)
            if len(split) >= 3:
                adapted = '---' + split[1] + '---\n' + COMPATIBILITY + split[2]
            else:
                adapted = COMPATIBILITY + adapted
                
        if name == 'recall-project-context':
            adapted = adapted.replace('../../scripts/requirement_memory.ps1', 'scripts/requirement_memory.ps1')
            (destination / 'scripts').mkdir(exist_ok=True)
            script_src = Path('C:/Users/mouwe/plugins/requirement-memory/scripts/requirement_memory.ps1')
            if script_src.exists():
                shutil.copy2(script_src, destination / 'scripts/requirement_memory.ps1')
                
        skill_md_path.write_text(adapted, encoding='utf-8')
        manifest.append(dict(name=name, source=str(source), destination=str(destination), adapted=True))
        
    (TARGET.parent / 'skills-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'installed': [item['name'] for item in manifest], 'root': str(TARGET)}, indent=2))


if __name__ == '__main__':
    main()
