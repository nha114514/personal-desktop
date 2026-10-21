"""Tests for YouTube (yt-dlp) and X/Twitter (OpenCLI) integration in crawler worker."""
import json
from pathlib import Path
import pytest
import subprocess
import sys

WORKER = Path(__file__).resolve().parent.parent / "runtime" / "crawler.py"
PYTHON = sys.executable


def run_worker(request: dict) -> dict:
    proc = subprocess.run(
        [PYTHON, str(WORKER)],
        input=json.dumps(request) + "\n",
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
    )
    assert proc.returncode == 0, f"Worker process failed: {proc.stderr}"
    return json.loads(proc.stdout)


def test_youtube_search_success():
    req = {
        "operation": "search",
        "platform": "youtube",
        "query": "OpenAI Sora",
        "maxResults": 2,
    }
    res = run_worker(req)
    assert "sources" in res, f"Expected sources, got {res}"
    assert len(res["sources"]) >= 1
    first = res["sources"][0]
    assert first["url"].startswith("https://www.youtube.com/watch?v=")
    assert "title" in first and len(first["title"]) > 0
    assert "snippet" in first and len(first["snippet"]) > 0


def test_youtube_fetch_with_subtitles():
    # Video with subtitles: tPx6bCDa5GE
    req = {
        "operation": "fetch",
        "platform": "youtube",
        "url": "https://www.youtube.com/watch?v=tPx6bCDa5GE",
        "maxBodyChars": 20000,
    }
    res = run_worker(req)
    assert res.get("statusCode") == 200
    assert "body" in res and res["body"]["kind"] == "text"
    content = res["body"]["content"]
    assert "How to Use Sora 2" in content
    assert "## Subtitles (Language:" in content
    # Ensure timestamps are preserved
    assert "[" in content and "]" in content


def test_youtube_fetch_without_subtitles():
    # Video without subtitles: HK6y8DAPN_0
    req = {
        "operation": "fetch",
        "platform": "youtube",
        "url": "https://www.youtube.com/watch?v=HK6y8DAPN_0",
        "maxBodyChars": 20000,
    }
    res = run_worker(req)
    assert res.get("statusCode") == 200
    assert "body" in res and res["body"]["kind"] == "text"
    content = res["body"]["content"]
    assert "Introducing Sora" in content
    assert "[Notice: No subtitles or captions are available for this video.]" in content


def test_youtube_fetch_invalid_video_reports_error():
    req = {
        "operation": "fetch",
        "platform": "youtube",
        "url": "https://www.youtube.com/watch?v=00000000000",
    }
    res = run_worker(req)
    assert "error" in res
    assert res["error"]["code"] in ("WEB_NOT_FOUND", "WEB_PROVIDER_FAILURE")


def test_x_search_without_bridge_reports_extension_not_connected():
    req = {
        "operation": "search",
        "platform": "x",
        "query": "OpenAI",
        "maxResults": 2,
    }
    res = run_worker(req)
    assert "error" in res
    # Either bridge extension not connected or login required
    assert res["error"]["code"] in ("WEB_EXTENSION_NOT_CONNECTED", "WEB_LOGIN_REQUIRED")
    assert "OpenCLI" in res["error"]["message"] or "X/Twitter" in res["error"]["message"]


def test_x_fetch_without_bridge_reports_extension_not_connected():
    req = {
        "operation": "fetch",
        "platform": "x",
        "url": "https://x.com/OpenAI/status/1758192957386342777",
    }
    res = run_worker(req)
    assert "error" in res
    assert res["error"]["code"] in ("WEB_EXTENSION_NOT_CONNECTED", "WEB_LOGIN_REQUIRED")
