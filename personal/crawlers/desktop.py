"""Windows desktop entry point for the installed MediaCrawler WebUI."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import urlopen
import webbrowser

SETTINGS = Path(os.environ.get("PERSONAL_CRAWLERS_CONFIG", "D:/desktop/personal-data/crawlers/settings.json"))
PORT = 24580
URL = f"http://127.0.0.1:{PORT}"


def ready():
    try:
        with urlopen(URL + "/openapi.json", timeout=1) as response:
            return json.load(response).get("info", {}).get("title") == "MediaCrawler WebUI API"
    except (OSError, ValueError):
        return False


def launch():
    # Serialize repeated clicks until the API is ready.
    kernel = ctypes.windll.kernel32
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    kernel.CreateMutexW.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.ReleaseMutex.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    mutex = kernel.CreateMutexW(None, False, "Local\\PersonalMediaCrawlerLauncher")
    if not mutex or kernel.WaitForSingleObject(mutex, 35000) not in (0, 0x80):
        raise RuntimeError("另一个 MediaCrawler 启动操作尚未结束，请稍后重试。")
    try:
        if not ready():
            with socket.socket() as probe:
                if probe.connect_ex(("127.0.0.1", PORT)) == 0:
                    raise RuntimeError(f"端口 {PORT} 被其他程序占用。请关闭占用程序后重试。")
            settings = json.loads(SETTINGS.read_text(encoding="utf-8"))
            directory = Path(settings["dataDirectory"])
            directory.mkdir(parents=True, exist_ok=True)
            log_path = directory / "mediacrawler-webui.log"
            env = {key: value for key, value in os.environ.items()
                   if not any(word in key.upper() for word in ("TOKEN", "SECRET", "PASSWORD", "API_KEY"))}
            env["PYTHONUTF8"] = "1"
            env["PYTHONUNBUFFERED"] = "1"
            env.pop("PYTHONHOME", None)
            env.pop("PYTHONPATH", None)
            # PyInstaller's DLL directory must not leak into the separate Python runtime.
            ctypes.windll.kernel32.SetDllDirectoryW(None)
            with log_path.open("ab") as log:
                process = subprocess.Popen([settings["pythonExecutable"], "-m", "uvicorn", "api.main:app",
                                            "--host", "127.0.0.1", "--port", str(PORT)],
                                           cwd=settings["mediaCrawlerDirectory"], env=env, stdin=subprocess.DEVNULL,
                                           stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            deadline = time.monotonic() + 30
            while not ready():
                if process.poll() is not None or time.monotonic() >= deadline:
                    if process.poll() is None:
                        process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                    raise RuntimeError(f"MediaCrawler 启动失败。日志：{log_path}")
                time.sleep(0.25)
        webbrowser.open(URL)
    finally:
        ctypes.windll.kernel32.ReleaseMutex(mutex)
        ctypes.windll.kernel32.CloseHandle(mutex)


if __name__ == "__main__":
    try:
        launch()
    except Exception as error:
        ctypes.windll.user32.MessageBoxW(None, str(error), "MediaCrawler", 0x10)
