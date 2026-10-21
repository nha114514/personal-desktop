"""Bind the installed upstream WebUI to the shared Python and data directories."""
import json
from pathlib import Path
import re
import sys

settings = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
root = Path(settings['mediaCrawlerDirectory'])
data = Path(settings['dataDirectory'])

def update(relative, transform):
    path = root / relative
    original = path.read_text(encoding='utf-8')
    changed = transform(original)
    if changed != original:
        path.write_text(changed, encoding='utf-8')

def python_command(text):
    if '\nimport sys\n' not in text:
        text = text.replace('\nimport os\n', '\nimport os\nimport sys\n', 1)
    return text.replace('["uv", "run", "python", "main.py"', '[sys.executable, "main.py"').replace('["uv", "run", "main.py"', '[sys.executable, "main.py"').replace('"uv", "run", "main.py"', 'sys.executable, "main.py"')

update('api/main.py', python_command)
update('api/services/crawler_manager.py', lambda text: python_command(text).replace(
    '[sys.executable, "main.py"]', '[sys.executable, ' + json.dumps(str(Path(settings['worker']).parent / 'media_entry.py').replace(chr(92), '/')) + ']'))
update('api/routers/data.py', lambda text: re.sub(r'^DATA_DIR = .+$', f'DATA_DIR = Path({json.dumps(str(data / "media").replace(chr(92), "/"))})', text, flags=re.M))
update('config/base_config.py', lambda text: re.sub(r'^(ENABLE_CDP_MODE|SAVE_DATA_PATH|USER_DATA_DIR) = .+$',
    lambda match: match[1] + ' = ' + {'ENABLE_CDP_MODE': 'False',
        'SAVE_DATA_PATH': json.dumps((data / 'media').as_posix()),
        'USER_DATA_DIR': json.dumps((data / 'browser-data/%s').as_posix())}[match[1]], text, flags=re.M))
print(json.dumps({'configured': str(root), 'data': str(data)}))
