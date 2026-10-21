"""Bounded JSON bridge to Scrapling, installed MediaCrawler, yt-dlp, and OpenCLI."""
from __future__ import annotations

import asyncio
import contextlib
import importlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import parse_qs, unquote, urlparse, urljoin
import socket
import urllib.error
import urllib.request


class CrawlerFailure(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


class SubtitleResult(tuple):
    def __new__(cls, lang, sub_type, lines, status="ok", error=None):
        return super().__new__(cls, (lang, sub_type, lines))

    def __init__(self, lang, sub_type, lines, status="ok", error=None):
        self.lang = lang
        self.sub_type = sub_type
        self.lines = lines
        self.status = status
        self.error = error


def public_url(url):
    parsed = urlparse(url)
    if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password:
        raise CrawlerFailure("WEB_INVALID_URL", "Only public HTTP(S) URLs without credentials are allowed")
    host = parsed.hostname.lower()
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        raise CrawlerFailure("WEB_BLOCKED_URL", "Local and private pages cannot be fetched")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        raise CrawlerFailure("WEB_BLOCKED_URL", "Local and private pages cannot be fetched")
    return url


def is_youtube_url(url):
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        return host in ("youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be")
    except Exception:
        return False


def is_x_url(url):
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        return host in ("x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com")
    except Exception:
        return False


def get_page(url):
    from scrapling.fetchers import Fetcher
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or os.environ.get("ALL_PROXY")
    options = {"timeout": 20, "retries": 0, "follow_redirects": "safe", "max_redirects": 4}
    if proxy:
        options["proxy"] = proxy
    return Fetcher.get(public_url(url), **options)


def text_of(element):
    return re.sub(r"\s+", " ", element.get_all_text(separator=" ", strip=True)).strip()


def web_search(request):
    from urllib.parse import urlencode
    query = request["query"]
    engine = request.get("searchEngine", "duckduckgo")
    url = "https://www.bing.com/search?" + urlencode({"q": query, "count": request["maxResults"]}) if engine == "bing" else "https://lite.duckduckgo.com/lite/?" + urlencode({"q": query})
    page = get_page(url)
    if page.status != 200:
        raise CrawlerFailure("WEB_SEARCH_BLOCKED", "Search source refused the request; use another search source or finish verification in a browser")
    sources = []
    nodes = page.css("li.b_algo") if engine == "bing" else page.css("a.result-link")
    for node in nodes:
        link = node.css("h2 a") if engine == "bing" else [node]
        if not link:
            continue
        link = link[0]
        target = link.attrib.get("href", "")
        if engine == "duckduckgo":
            target = parse_qs(urlparse(target).query).get("uddg", [target])[0]
        elif "/ck/a?" in target:
            import base64
            encoded = parse_qs(urlparse(target).query).get("u", [""])[0]
            if encoded.startswith("a1"):
                target = base64.urlsafe_b64decode(encoded[2:] + "=" * (-len(encoded[2:]) % 4)).decode("utf-8")
        target = urljoin(url, target)
        if not target.startswith(("http://", "https://")):
            continue
        snippet = node.css(".b_caption p") if engine == "bing" else node.xpath("ancestor::tr[1]/following-sibling::tr[1]//td[contains(@class, 'result-snippet')]")
        sources.append({"url": target, "title": text_of(link), "snippet": text_of(snippet[0])[:1500] if snippet else ""})
    if not sources:
        raise CrawlerFailure("WEB_SEARCH_BLOCKED", "No readable search results; the page may require verification or the source layout has changed")
    limit = request["maxResults"]
    return {"sources": sources[:limit], "truncated": len(sources) > limit}


def web_fetch(request):
    from bs4 import BeautifulSoup
    from markdownify import markdownify
    page = get_page(request["url"])
    public_url(str(page.url))
    main = page.css("article, main")
    soup = BeautifulSoup(str(main[0].html_content) if main else str(page.html_content), "html.parser")
    for element in soup.select("script, style, nav, noscript"):
        element.decompose()
    content = markdownify(str(soup)).strip()
    limit = request["maxBodyChars"]
    return {"url": str(page.url), "statusCode": page.status, "body": {"kind": "text", "content": content[:limit]}, "truncated": len(content) > limit}


# ── YouTube via yt-dlp ────────────────────────────────────────────────────────

def extract_youtube_subtitles(res, priority_langs=("zh-Hans", "zh-CN", "zh", "zh-Hant", "zh-TW", "en", "en-US", "en-GB", "ja", "ko")):
    subtitles = res.get("subtitles") or {}
    auto_captions = res.get("automatic_captions") or {}
    selected_lang = None
    sub_type = None
    format_list = None

    # Priority 1: Human uploaded subtitles
    for lang in priority_langs:
        if lang in subtitles:
            selected_lang = lang
            sub_type = "human"
            format_list = subtitles[lang]
            break
    if not selected_lang and subtitles:
        selected_lang = next(iter(subtitles))
        sub_type = "human"
        format_list = subtitles[selected_lang]

    # Priority 2: Automatic captions if no human subtitles
    if not selected_lang:
        for lang in priority_langs:
            if lang in auto_captions:
                selected_lang = lang
                sub_type = "auto"
                format_list = auto_captions[lang]
                break
        if not selected_lang and auto_captions:
            selected_lang = next(iter(auto_captions))
            sub_type = "auto"
            format_list = auto_captions[selected_lang]

    if not selected_lang or not format_list:
        return SubtitleResult(None, None, [], status="missing", error=None)

    # Select best format: prefer json3, then vtt, srt
    fmt = next((f for f in format_list if f.get("ext") == "json3"), None)
    if not fmt:
        fmt = next((f for f in format_list if f.get("ext") in ("vtt", "srt")), format_list[0])

    raw_url = fmt.get("url")
    if not raw_url:
        return SubtitleResult(selected_lang, sub_type, [], status="missing_url", error="No URL in subtitle format")

    lines = []
    try:
        req = urllib.request.Request(raw_url, headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req, timeout=15).read()
        if fmt.get("ext") == "json3":
            parsed = json.loads(data)
            for ev in parsed.get("events", []):
                t_start = ev.get("tStartMs", 0)
                segs = ev.get("segs", [])
                text = "".join(s.get("utf8", "") for s in segs).strip()
                if not text:
                    continue
                text = " ".join(text.split())
                seconds = t_start // 1000
                hh = seconds // 3600
                mm = (seconds % 3600) // 60
                ss = seconds % 60
                ts = f"{hh:02d}:{mm:02d}:{ss:02d}" if hh > 0 else f"{mm:02d}:{ss:02d}"
                if lines and lines[-1]["text"] == text:
                    continue
                lines.append({"time": ts, "text": text})
        else:
            text_content = data.decode("utf-8", errors="replace")
            cue_pattern = re.compile(r"(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{3})?)\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{3})?\s*\n(.*?)(?=\n\n|\Z)", re.S)
            for m in cue_pattern.finditer(text_content):
                ts_raw, body = m.group(1), m.group(2)
                clean_body = re.sub(r"<[^>]+>", "", body).strip()
                clean_body = " ".join(clean_body.split())
                if clean_body:
                    ts = ts_raw.split(".")[0]
                    if lines and lines[-1]["text"] == clean_body:
                        continue
                    lines.append({"time": ts, "text": clean_body})
        return SubtitleResult(selected_lang, sub_type, lines, status="ok", error=None)
    except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
        return SubtitleResult(selected_lang, sub_type, [], status="timeout", error=f"Subtitle download timed out: {e}")
    except urllib.error.HTTPError as e:
        return SubtitleResult(selected_lang, sub_type, [], status="restricted", error=f"HTTP {e.code}: {e.reason}")
    except json.JSONDecodeError as e:
        return SubtitleResult(selected_lang, sub_type, [], status="parse_error", error=f"JSON decode failed: {e}")
    except Exception as e:
        return SubtitleResult(selected_lang, sub_type, [], status="download_failed", error=f"Subtitle fetch error: {e}")


def youtube_search(request):
    import yt_dlp
    query = request["query"]
    limit = min(20, max(1, request.get("maxResults", 8)))
    ydl_opts = {
        'quiet': True,
        'skip_download': True,
        'no_warnings': True,
        'extract_flat': 'in_playlist',
        'js_runtimes': {'node': {}},
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            res = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
            entries = res.get("entries") or []
    except Exception as e:
        raise CrawlerFailure("WEB_PROVIDER_FAILURE", f"YouTube 搜索执行失败: {e}")

    sources = []
    for item in entries:
        vid = item.get("id")
        title = item.get("title")
        if not vid or not title:
            continue
        canonical_url = f"https://www.youtube.com/watch?v={vid}"
        channel = item.get("channel") or item.get("uploader") or ""
        desc = item.get("description") or ""
        duration = item.get("duration_string") or (f"{int(item['duration'])}s" if item.get("duration") else "")
        views = item.get("view_count") or 0
        snippet = f"Channel: {channel} | Duration: {duration} | Views: {views}\n{desc}".strip()
        sources.append({"url": canonical_url, "title": str(title)[:500], "snippet": snippet[:1500]})

    if not sources:
        raise CrawlerFailure("WEB_SEARCH_BLOCKED", f"未找到关于 '{query}' 的 YouTube 视频结果")

    # Save to dataDirectory results
    data_dir = request.get("dataDirectory")
    if data_dir and sources:
        try:
            results_dir = Path(data_dir).resolve() / "results" / "youtube"
            results_dir.mkdir(parents=True, exist_ok=True)
            timestamp = time.strftime("%Y%m%d-%H%M%S")
            saved_file = results_dir / f"crawl-{timestamp}.jsonl"
            with saved_file.open("w", encoding="utf-8") as f:
                for s in sources:
                    record = {**s, "platform": "youtube", "crawledAt": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
                    f.write(json.dumps(record, ensure_ascii=False) + "\n")
        except Exception:
            pass

    return {"sources": sources[:limit], "truncated": len(sources) > limit}


def youtube_fetch(request):
    import yt_dlp
    url = public_url(request["url"])
    limit = request.get("maxBodyChars", 50000)
    ydl_opts = {
        'quiet': True,
        'skip_download': True,
        'no_warnings': True,
        'js_runtimes': {'node': {}},
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        err_msg = str(e)
        if any(k in err_msg.lower() for k in ("sign in", "private video", "members-only", "age-restricted", "login")):
            raise CrawlerFailure("WEB_LOGIN_REQUIRED", f"YouTube 视频需要登录或受限: {err_msg}")
        if any(k in err_msg.lower() for k in ("unavailable", "not available", "does not exist")):
            raise CrawlerFailure("WEB_NOT_FOUND", f"YouTube 视频不存在或已删除: {err_msg}")
        raise CrawlerFailure("WEB_PROVIDER_FAILURE", f"YouTube 请求失败: {err_msg}")
    except Exception as e:
        raise CrawlerFailure("WEB_PROVIDER_FAILURE", f"YouTube 请求失败: {e}")

    title = info.get("title") or "YouTube Video"
    channel = info.get("channel") or info.get("uploader") or "Unknown"
    upload_date = info.get("upload_date") or ""
    if len(upload_date) == 8:
        upload_date = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}"
    duration = info.get("duration_string") or (f"{int(info['duration'])}s" if info.get("duration") else "Unknown")
    views = info.get("view_count") or 0
    desc = (info.get("description") or "").strip()

    sub_res = extract_youtube_subtitles(info)
    lang, sub_type, sub_lines = sub_res
    sub_status, sub_error = sub_res.status, sub_res.error
    if sub_status == "ok" and sub_lines:
        sub_text = f"## Subtitles (Language: {lang}, Source: {sub_type})\n\n" + "\n".join(f"[{item['time']}] {item['text']}" for item in sub_lines)
    elif sub_status == "missing":
        sub_text = "## Subtitles\n\n[Notice: No subtitles or captions are available for this video.]"
    else:
        sub_text = f"## Subtitles (Language: {lang or 'unknown'}, Source: {sub_type or 'unknown'})\n\n[Error: Subtitle retrieval failed ({sub_status}): {sub_error}]"

    md = f"""# {title}
**Channel**: {channel} | **Published**: {upload_date} | **Duration**: {duration} | **Views**: {views} | **URL**: {url}

## Description
{desc}

{sub_text}""".strip()

    return {"url": url, "statusCode": 200, "body": {"kind": "text", "content": md[:limit]}, "truncated": len(md) > limit}


# ── X / Twitter via OpenCLI ───────────────────────────────────────────────────

def resolve_opencli_runner():
    """Resolve executable and base arguments to run OpenCLI without Windows shell."""
    if os.environ.get("DSH_PERSONAL_OPENCLI_ENTRY"):
        entry = Path(os.environ["DSH_PERSONAL_OPENCLI_ENTRY"])
        if entry.exists():
            node = shutil.which("node") or "node"
            return [node, str(entry)]

    # Check opencli / opencli.cmd in PATH first
    cmd_name = shutil.which("opencli.cmd") or shutil.which("opencli")
    if cmd_name:
        p = Path(cmd_name)
        adjacent = p.parent / "node_modules" / "@jackwener" / "opencli" / "dist" / "src" / "main.js"
        if adjacent.exists():
            node = shutil.which("node") or "node"
            return [node, str(adjacent)]
        try:
            content = p.read_text(encoding="utf-8", errors="ignore")
            m = re.search(r'["\']([^"\']+\.js)["\']', content)
            if m:
                raw_target = m.group(1).replace("%dp0%", str(p.parent)).replace("%~dp0%", str(p.parent))
                js_file = Path(raw_target)
                if js_file.exists():
                    node = shutil.which("node") or "node"
                    return [node, str(js_file)]
        except Exception:
            pass
        return [str(p)]

    # Search in npm global directory as fallback
    appdata = os.environ.get("APPDATA", "")
    candidates = []
    if appdata:
        candidates.append(Path(appdata) / "npm" / "node_modules" / "@jackwener" / "opencli" / "dist" / "src" / "main.js")
    candidates.append(Path("C:/Users/mouwe/AppData/Roaming/npm/node_modules/@jackwener/opencli/dist/src/main.js"))
    for cand in candidates:
        if cand.exists():
            node = shutil.which("node") or "node"
            return [node, str(cand)]

    return ["opencli"]


def run_opencli_command(args, timeout_s=30):
    """Run an OpenCLI command safely with shell=False and argv isolation."""
    runner = resolve_opencli_runner()
    is_batch = any(str(r).lower().endswith((".cmd", ".bat")) for r in runner)
    safe_args = []
    for a in args:
        s = str(a)
        if is_batch and any(ch in s for ch in ("&", "|", ">", "<", "^")):
            if not (s.startswith('"') and s.endswith('"')):
                s = f'"{s}"'
        safe_args.append(s)

    full_cmd = list(runner) + safe_args
    return subprocess.run(
        full_cmd,
        shell=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=timeout_s,
    )


def check_opencli_bridge():
    """Check OpenCLI daemon and browser bridge extension status."""
    try:
        req = urllib.request.Request("http://127.0.0.1:19825/status", headers={"X-OpenCLI": "1"})
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("ok"):
                connected = bool(data.get("extensionConnected"))
                return connected, data
    except Exception:
        try:
            run_opencli_command(["daemon", "restart"], timeout_s=5)
            req = urllib.request.Request("http://127.0.0.1:19825/status", headers={"X-OpenCLI": "1"})
            with urllib.request.urlopen(req, timeout=2) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("ok"):
                    return bool(data.get("extensionConnected")), data
        except Exception:
            pass
    return False, None


def ensure_opencli_ready():
    connected, status = check_opencli_bridge()
    if not connected:
        raise CrawlerFailure(
            "WEB_EXTENSION_NOT_CONNECTED",
            "OpenCLI 浏览器桥接扩展未连接。请确保已在受控 Chrome (chrome://extensions) 启用开发者模式并加载 'C:\\Users\\mouwe\\.opencli\\extension'，随后打开 x.com 登录。可在终端运行 'opencli doctor' 检查桥接状态。"
        )
    return status


def x_search(request):
    from platform_lock import platform_lock
    data_dir = request.get("dataDirectory", "D:/desktop/personal-data/crawlers")
    try:
        with platform_lock(data_dir, "x", timeout=30):
            return x_search_locked(request)
    except TimeoutError:
        raise CrawlerFailure("WEB_PLATFORM_BUSY", "X/Twitter 浏览器会话当前正在被其他任务使用，请稍后重试。")


def x_search_locked(request):
    ensure_opencli_ready()
    query = request["query"]
    limit = min(20, max(1, request.get("maxResults", 8)))
    timeout_s = request.get("timeoutMs", 30000) / 1000
    proc = run_opencli_command(["twitter", "search", query, "--limit", str(limit), "-f", "json"], timeout_s=timeout_s)
    if proc.returncode != 0:
        err_out = (proc.stderr or "") + (proc.stdout or "")
        if any(k in err_out.lower() for k in ("not logged in", "auth", "ct0", "auth_token")):
            raise CrawlerFailure("WEB_LOGIN_REQUIRED", "X/Twitter 需要登录。请在受控 Chrome 浏览器中访问 https://x.com 完成登录后重试。")
        if "rate limit" in err_out.lower():
            raise CrawlerFailure("WEB_SEARCH_BLOCKED", "X/Twitter 触发访问频次限制，请稍后重试。")
        raise CrawlerFailure("WEB_PROVIDER_FAILURE", f"OpenCLI Twitter 检索失败: {err_out.strip()}")
    try:
        raw_items = json.loads(proc.stdout)
    except Exception as e:
        raise CrawlerFailure("WEB_PROVIDER_INVALID_RESPONSE", f"OpenCLI 返回无效 JSON: {e}")
    if not isinstance(raw_items, list):
        raise CrawlerFailure("WEB_PROVIDER_INVALID_RESPONSE", "OpenCLI 返回数据格式错误")

    sources = []
    for item in raw_items:
        tid = item.get("id")
        author = item.get("author") or "unknown"
        text = item.get("text") or ""
        url = item.get("url") or f"https://x.com/{author}/status/{tid}"
        created = item.get("created_at") or ""
        likes = item.get("likes") or 0
        views = item.get("views") or 0
        title = f"@{author}: {text[:80]}..." if len(text) > 80 else f"@{author}: {text}"
        snippet = f"{text}\nAuthor: @{author} | Likes: {likes} | Views: {views} | Created: {created}".strip()
        sources.append({"url": url, "title": title, "snippet": snippet[:1500]})

    if not sources:
        raise CrawlerFailure("WEB_SEARCH_BLOCKED", f"未找到关于 '{query}' 的 X/Twitter 结果")

    data_dir = request.get("dataDirectory")
    if data_dir and sources:
        try:
            results_dir = Path(data_dir).resolve() / "results" / "x"
            results_dir.mkdir(parents=True, exist_ok=True)
            timestamp = time.strftime("%Y%m%d-%H%M%S")
            saved_file = results_dir / f"crawl-{timestamp}.jsonl"
            with saved_file.open("w", encoding="utf-8") as f:
                for s in sources:
                    record = {**s, "platform": "x", "crawledAt": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
                    f.write(json.dumps(record, ensure_ascii=False) + "\n")
        except Exception:
            pass

    return {"sources": sources[:limit], "truncated": len(sources) > limit}


def x_fetch(request):
    from platform_lock import platform_lock
    data_dir = request.get("dataDirectory", "D:/desktop/personal-data/crawlers")
    try:
        with platform_lock(data_dir, "x", timeout=30):
            return x_fetch_locked(request)
    except TimeoutError:
        raise CrawlerFailure("WEB_PLATFORM_BUSY", "X/Twitter 浏览器会话当前正在被其他任务使用，请稍后重试。")


def x_fetch_locked(request):
    ensure_opencli_ready()
    url = public_url(request["url"])
    limit = request.get("maxBodyChars", 50000)
    timeout_s = request.get("timeoutMs", 30000) / 1000

    m_article = re.search(r'/article/(\d+)', url)
    if m_article:
        article_id = m_article.group(1)
        proc = run_opencli_command(["twitter", "article", article_id, "-f", "json"], timeout_s=timeout_s)
        if proc.returncode != 0:
            err = (proc.stderr or "") + (proc.stdout or "")
            if any(k in err.lower() for k in ("auth", "ct0", "not logged in")):
                raise CrawlerFailure("WEB_LOGIN_REQUIRED", "X/Twitter 长文读取需要登录。请在受控 Chrome 中登录 x.com。")
            raise CrawlerFailure("WEB_PROVIDER_FAILURE", f"读取 X 文章失败: {err.strip()}")
        data = json.loads(proc.stdout)
        title = data.get("title") or "Twitter Article"
        author = data.get("author") or "unknown"
        content = data.get("content") or ""
        md = f"# {title}\n**Author**: @{author} | **URL**: {url}\n\n{content}".strip()
        return {"url": url, "statusCode": 200, "body": {"kind": "text", "content": md[:limit]}, "truncated": len(md) > limit}

    m_status = re.search(r'/(?:status|statuses)/(\d+)', url)
    if not m_status:
        raise CrawlerFailure("WEB_INVALID_URL", "无法识别的 X/Twitter 链接格式，支持 status 与 article 链接")
    tweet_id = m_status.group(1)
    proc = run_opencli_command(["twitter", "thread", tweet_id, "--limit", "20", "-f", "json"], timeout_s=timeout_s)
    if proc.returncode != 0:
        err = (proc.stderr or "") + (proc.stdout or "")
        if any(k in err.lower() for k in ("auth", "ct0", "not logged in")):
            raise CrawlerFailure("WEB_LOGIN_REQUIRED", "X/Twitter 帖子读取需要登录。请在受控 Chrome 中登录 x.com。")
        raise CrawlerFailure("WEB_PROVIDER_FAILURE", f"读取 X 帖子失败: {err.strip()}")
    tweets = json.loads(proc.stdout)
    if not isinstance(tweets, list) or len(tweets) == 0:
        raise CrawlerFailure("WEB_NOT_FOUND", "未能读取到 X 帖子内容")

    main_tweet = tweets[0]
    author = main_tweet.get("author") or "unknown"
    created = main_tweet.get("created_at") or ""
    likes = main_tweet.get("likes") or 0
    retweets = main_tweet.get("retweets") or 0
    text = main_tweet.get("text") or ""

    replies_md = ""
    if len(tweets) > 1:
        replies_md = f"\n\n## Thread / Replies ({len(tweets) - 1})\n\n"
        for rep in tweets[1:]:
            r_author = rep.get("author") or "unknown"
            r_text = rep.get("text") or ""
            r_created = rep.get("created_at") or ""
            r_likes = rep.get("likes") or 0
            replies_md += f"- **@{r_author}** ({r_created}, {r_likes} likes): {r_text}\n"

    md = f"# Tweet by @{author}\n**Date**: {created} | **Likes**: {likes} | **Retweets**: {retweets} | **URL**: {url}\n\n{text}{replies_md}".strip()
    return {"url": url, "statusCode": 200, "body": {"kind": "text", "content": md[:limit]}, "truncated": len(md) > limit}


def x_login(request):
    import webbrowser
    connected, _ = check_opencli_bridge()
    if connected:
        run_opencli_command(["twitter", "login"], timeout_s=60)
        return {"status": "ok", "message": "已完成 X/Twitter 登录检查"}
    else:
        webbrowser.open("https://x.com/i/flow/login")
        return {"status": "browser-opened", "message": "已在浏览器中打开 X 登录页面。登录完成后请确保 Chrome 扩展连接。"}


# ── MediaCrawler ─────────────────────────────────────────────────────────────

def configure_media(request, output_directory):
    root = Path(request["mediaCrawlerDirectory"]).resolve()
    sys.path.insert(0, str(root))
    os.chdir(root)
    import config
    config.ENABLE_CDP_MODE = False
    config.ENABLE_GET_COMMENTS = False
    config.ENABLE_GET_SUB_COMMENTS = False
    config.ENABLE_GET_MEDIA = False
    config.ENABLE_GET_WORDCLOUD = False
    config.MAX_CONCURRENCY_NUM = 1
    config.HEADLESS = True
    config.SAVE_LOGIN_STATE = True
    config.USER_DATA_DIR = str(Path(request["dataDirectory"]).resolve() / "browser-data" / "%s")
    config.SAVE_DATA_PATH = str(output_directory)
    return config


async def media_search(request, login=False):
    from platform_lock import platform_lock
    try:
        with platform_lock(request['dataDirectory'], request['platform']):
            return await media_search_locked(request, login)
    except TimeoutError:
        raise CrawlerFailure('WEB_PLATFORM_BUSY', 'This media platform is already in use. Retry after the current search or browser login finishes.')


async def media_search_locked(request, login=False):
    platform = request["platform"]
    modules = {"xhs": ("xhs", "XiaoHongShuLogin"), "dy": ("douyin", "DouYinLogin"), "ks": ("kuaishou", "KuaishouLogin"),
               "bili": ("bilibili", "BilibiliLogin"), "wb": ("weibo", "WeiboLogin"), "tieba": ("tieba", "BaiduTieBaLogin"), "zhihu": ("zhihu", "ZhiHuLogin")}
    if platform not in modules:
        raise CrawlerFailure("WEB_INVALID_QUERY", "Unsupported media platform")
    data = Path(request["dataDirectory"]).resolve()
    data.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="search-", dir=data) as output:
        config = configure_media(request, output)
        if not login:
            module_name, class_name = modules[platform]
            cls = getattr(importlib.import_module(f"media_platform.{module_name}.login"), class_name)
            async def no_interactive_login(self):
                raise CrawlerFailure("WEB_LOGIN_REQUIRED", f"MediaCrawler {platform} needs login. Run personal/Login-MediaCrawler.ps1 -Platform {platform}; search again after authorizing in its browser.")
            cls.begin = no_interactive_login
        else:
            config.HEADLESS = False
        import main as upstream
        sys.argv = [str(Path(request["mediaCrawlerDirectory"]) / "main.py"), "--platform", platform, "--lt", "qrcode",
                    "--type", "search", "--keywords", request["query"], "--save_data_option", "jsonl",
                    "--get_comment", "false", "--get_sub_comment", "false", "--get_media", "false",
                    "--headless", "false" if login else "true", "--crawler_max_notes_count", str(request["maxResults"]),
                    "--max_concurrency_num", "1", "--save_data_path", output]
        try:
            await upstream.main()
        finally:
            await upstream.async_cleanup()
        sources = []
        for path in Path(output).rglob("*contents*.jsonl"):
            for line in path.read_text(encoding="utf-8").splitlines():
                item = json.loads(line)
                url = next((item[key] for key in ("note_url", "video_url", "aweme_url", "url", "content_url", "detail_url") if item.get(key)), "")
                if url.startswith(("https://", "http://")):
                    sources.append({"url": url, "title": str(item.get("title") or item.get("desc") or "")[:500], "snippet": str(item.get("desc") or item.get("content") or "")[:1500]})
        if sources:
            try:
                results_dir = data / "results" / platform
                results_dir.mkdir(parents=True, exist_ok=True)
                timestamp = time.strftime("%Y%m%d-%H%M%S")
                saved_file = results_dir / f"crawl-{timestamp}.jsonl"
                with saved_file.open("w", encoding="utf-8") as f:
                    for s in sources:
                        record = {**s, "platform": platform, "crawledAt": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
                        f.write(json.dumps(record, ensure_ascii=False) + "\n")
            except Exception:
                pass
        return {"sources": sources[:request["maxResults"]], "truncated": len(sources) > request["maxResults"]}


# ── Status and Saved Results ─────────────────────────────────────────────────

def platforms_status(data_directory):
    data = Path(data_directory).resolve()
    platforms_info = [
        {"id": "bili", "name": "B站"},
        {"id": "xhs", "name": "小红书"},
        {"id": "dy", "name": "抖音"},
        {"id": "ks", "name": "快手"},
        {"id": "wb", "name": "微博"},
        {"id": "tieba", "name": "百度贴吧"},
        {"id": "zhihu", "name": "知乎"},
        {"id": "youtube", "name": "YouTube"},
        {"id": "x", "name": "X / Twitter"},
    ]
    result = []
    for p in platforms_info:
        pid = p["id"]
        if pid == "youtube":
            try:
                import yt_dlp
                status = "saved"
            except Exception:
                status = "idle"
            result.append({"id": pid, "name": p["name"], "status": status, "busy": False})
            continue

        if pid == "x":
            connected, _ = check_opencli_bridge()
            result.append({"id": pid, "name": p["name"], "status": "saved" if connected else "idle", "busy": False})
            continue

        cookie_file = data / "browser-data" / pid / "Default" / "Network" / "Cookies"
        legacy_cookie = data / "browser-data" / pid / "Default" / "Cookies"
        has_login = False
        try:
            if (cookie_file.exists() and cookie_file.stat().st_size > 0) or (legacy_cookie.exists() and legacy_cookie.stat().st_size > 0):
                has_login = True
        except Exception:
            pass
        result.append({
            "id": pid,
            "name": p["name"],
            "status": "saved" if has_login else "idle",
            "busy": False,
        })
    return {"platforms": result}


def get_saved_results(data_directory, platform=None, limit=50):
    data = Path(data_directory).resolve() / "results"
    if not data.exists():
        return {"results": []}
    items = []
    dirs = [data / platform] if platform and (data / platform).exists() else [d for d in data.iterdir() if d.is_dir()]
    for d in dirs:
        for file in sorted(d.glob("*.jsonl"), reverse=True):
            try:
                for line in file.read_text(encoding="utf-8").splitlines():
                    if line.strip():
                        item = json.loads(line)
                        items.append(item)
                        if len(items) >= limit:
                            break
            except Exception:
                pass
            if len(items) >= limit:
                break
    return {"results": items[:limit]}


def browser_job():
    job = None
    if os.name == "nt":
        import win32api
        import win32job
        job = win32job.CreateJobObject(None, "")
        limits = win32job.QueryInformationJobObject(job, win32job.JobObjectExtendedLimitInformation)
        limits["BasicLimitInformation"]["LimitFlags"] |= win32job.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        win32job.SetInformationJobObject(job, win32job.JobObjectExtendedLimitInformation, limits)
        win32job.AssignProcessToJobObject(job, win32api.GetCurrentProcess())
    return job


def main():
    job = browser_job()
    line = sys.stdin.readline()
    if line.startswith('\ufeff'):
        line = line[1:]
    request = json.loads(line)
    try:
        with contextlib.redirect_stdout(sys.stderr):
            op = request.get("operation")
            if op == "status":
                result = platforms_status(request["dataDirectory"])
            elif op == "results":
                result = get_saved_results(request["dataDirectory"], request.get("platform"))
            elif op == "fetch":
                url = request.get("url", "")
                platform = request.get("platform")
                if platform == "youtube" or is_youtube_url(url):
                    result = youtube_fetch(request)
                elif platform == "x" or is_x_url(url):
                    result = x_fetch(request)
                else:
                    result = web_fetch(request)
            elif request.get("platform"):
                platform = request["platform"]
                if platform == "youtube":
                    result = youtube_search(request)
                elif platform == "x":
                    if op == "login":
                        result = x_login(request)
                    else:
                        result = x_search(request)
                else:
                    result = asyncio.run(media_search(request, op == "login"))
            else:
                result = web_search(request)
    except CrawlerFailure as error:
        result = {"error": {"code": error.code, "message": error.message}}
    except Exception as error:
        print(type(error).__name__, file=sys.stderr)
        result = {"error": {"code": "WEB_PROVIDER_FAILURE", "message": f"Crawler failed ({type(error).__name__}): check runtime health, platform availability, and login state"}}
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
