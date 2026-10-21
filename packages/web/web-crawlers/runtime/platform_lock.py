"""Serialize processes that use the same MediaCrawler browser profile."""
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import time


@contextmanager
def platform_lock(data_directory, platform, timeout=30):
    identity = os.path.normcase(str(Path(data_directory).resolve())) + ':' + platform
    digest = hashlib.sha256(identity.encode('utf-8')).hexdigest()
    if os.name == 'nt':
        import win32api
        import win32event
        mutex = win32event.CreateMutex(None, False, 'Local\\PersonalMediaCrawler-' + digest)
        acquired = False
        try:
            result = win32event.WaitForSingleObject(mutex, int(timeout * 1000))
            acquired = result in (win32event.WAIT_OBJECT_0, win32event.WAIT_ABANDONED)
            if not acquired:
                raise TimeoutError('This platform browser profile is already in use')
            yield
        finally:
            if acquired:
                win32event.ReleaseMutex(mutex)
            win32api.CloseHandle(mutex)
    else:
        import fcntl
        directory = Path(data_directory) / 'locks'
        directory.mkdir(parents=True, exist_ok=True)
        with (directory / (digest + '.lock')).open('a') as handle:
            deadline = time.monotonic() + timeout
            while True:
                try:
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise TimeoutError('This platform browser profile is already in use')
                    time.sleep(0.1)
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)
