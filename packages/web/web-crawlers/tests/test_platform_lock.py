import subprocess
import sys
import tempfile
from pathlib import Path
import unittest

RUNTIME = Path(__file__).parents[1] / 'runtime'
sys.path.insert(0, str(RUNTIME))


class PlatformLockTests(unittest.TestCase):
    def test_processes_share_platform_locks_and_release_them(self):
        from platform_lock import platform_lock
        with tempfile.TemporaryDirectory() as directory:
            program = ('from platform_lock import platform_lock; '
                       'import sys; '
                       'lock = platform_lock(sys.argv[1], "bili", timeout=0); '
                       'lock.__enter__(); print("locked", flush=True); sys.stdin.readline(); lock.__exit__(None,None,None)')
            child = subprocess.Popen([sys.executable, '-c', program, directory], cwd=RUNTIME,
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(), 'locked')
                with self.assertRaises(TimeoutError):
                    with platform_lock(directory, 'bili', timeout=0):
                        self.fail('A second process acquired the same browser profile')
                with platform_lock(directory, 'xhs', timeout=0):
                    pass
                child.communicate('\n', timeout=5)
                self.assertEqual(child.returncode, 0)
                with platform_lock(directory, 'bili', timeout=0):
                    pass
            finally:
                if child.poll() is None:
                    child.kill()
                    child.communicate(timeout=5)


if __name__ == '__main__':
    unittest.main()
