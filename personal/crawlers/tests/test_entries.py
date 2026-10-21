import importlib.util
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch, MagicMock

ROOT = Path(__file__).parents[1]
def load(name):
    spec = importlib.util.spec_from_file_location('personal_' + name, ROOT / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class EntryTests(unittest.TestCase):
    def test_login_does_not_call_an_error_authenticated(self):
        cli = load('cli')
        with patch.object(cli, 'settings', return_value={'pythonExecutable':'python', 'worker':'worker', 'timeoutMs':1000}), patch.object(cli.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0, stdout='{"error":{"code":"WEB_LOGIN_REQUIRED","message":"Login failed"}}')):
            with self.assertRaisesRegex(RuntimeError, 'WEB_LOGIN_REQUIRED'):
                cli.invoke({'operation':'login'}, login=True)

    def test_failed_server_start_closes_only_the_owned_process(self):
        desktop = load('desktop')
        child = MagicMock()
        child.poll.return_value = None
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'settings.json'
            config.write_text('{"dataDirectory":' + repr(directory).replace("'", '"').replace('\\', '\\\\') + ',"pythonExecutable":"python","mediaCrawlerDirectory":"."}')
            socket = MagicMock()
            socket.__enter__.return_value.connect_ex.return_value = 1
            with patch.object(desktop, 'SETTINGS', config), patch.object(desktop, 'ready', return_value=False), patch.object(desktop.socket, 'socket', return_value=socket), patch.object(desktop.subprocess, 'Popen', return_value=child), patch.object(desktop.time, 'monotonic', side_effect=[0,31]):
                with self.assertRaisesRegex(RuntimeError, '启动失败'):
                    desktop.launch()
            child.terminate.assert_called_once()
            child.wait.assert_called()

if __name__ == '__main__': unittest.main()
