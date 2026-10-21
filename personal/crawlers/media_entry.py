"""Run the upstream WebUI crawler under the same profile lock as agent searches."""
import argparse
import json
import os
from pathlib import Path
import runpy
import sys

SETTINGS = Path(os.environ.get('PERSONAL_CRAWLERS_CONFIG', 'D:/desktop/personal-data/crawlers/settings.json'))

if __name__ == '__main__':
    settings = json.loads(SETTINGS.read_text(encoding='utf-8-sig'))
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--platform', required=True)
    args, _ = parser.parse_known_args()
    sys.path.insert(0, str(Path(settings['worker']).parent))
    from platform_lock import platform_lock
    from crawler import browser_job
    job = browser_job()
    root = Path(settings['mediaCrawlerDirectory']).resolve()
    sys.path.insert(0, str(root))
    os.chdir(root)
    try:
        with platform_lock(settings['dataDirectory'], args.platform):
            runpy.run_path(str(root / 'main.py'), run_name='__main__')
    except TimeoutError:
        sys.exit('WEB_PLATFORM_BUSY: this platform is being used by an agent or another browser login. Retry when it finishes.')
