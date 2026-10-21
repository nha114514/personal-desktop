# 共享检索与桌面平台采集

Personal Desktop 的主模型和已授权子代理通过同一套 `web_search` / `web_fetch` 工具检索。通用搜索和网页正文使用 Better Crawler（Scrapling）；国内媒体平台关键词使用 MediaCrawler；YouTube 视频搜索与字幕提取使用 yt-dlp；X / Twitter 搜索与帖子/串帖/长文读取使用 OpenCLI。当前通用搜索源是 DuckDuckGo Lite；不会静默替换后端。

## 自己使用

双击桌面的 `MediaCrawler.exe`，打开本机 WebUI，选择平台、关键词和登录方式后启动抓取。浏览器地址为 `http://127.0.0.1:24580`。该 EXE 是为已安装的上游 WebUI 制作的启动入口，需要保留 `D:/desktop/tools` 下的程序和运行库。上游采用 NON-COMMERCIAL LEARNING LICENSE 1.1，界面中有使用条款。

全局命令已加入用户 PATH，新开的终端可直接运行：

```powershell
desktop-crawlers search "Scrapling Python"
desktop-crawlers search "bili: Python 教程"
desktop-crawlers search "youtube: OpenAI Sora"
desktop-crawlers search "x: AI"
desktop-crawlers fetch "https://example.com"
desktop-crawlers fetch "https://www.youtube.com/watch?v=tPx6bCDa5GE"
desktop-crawlers doctor
```

当前终端尚未刷新 PATH 时，使用完整路径 `D:/desktop/tools/personal-crawlers/desktop-crawlers.cmd`。

平台前缀为：
- MediaCrawler: `bili:`、`xhs:`、`dy:`、`ks:`、`wb:`、`tieba:`、`zhihu:`。
- YouTube: `youtube:`、`yt:`。直接 fetch YouTube 视频链接时提取带有精确时间戳的人工/自动字幕。
- X / Twitter: `x:`、`twitter:`。基于受控 Chrome 浏览器的 OpenCLI 桥接扩展完成会话复用，支持帖子、串帖及文章。

未登录或扩展未连接时返回 `WEB_LOGIN_REQUIRED` 或 `WEB_EXTENSION_NOT_CONNECTED`。验证码、账号准入与平台限制会原样报告。同一平台的界面抓取和代理抓取串行使用登录状态；繁忙时返回 `WEB_PLATFORM_BUSY`。

## 配置与重装

桌面“插件 → 网页搜索”指向 `D:/desktop/personal-data/crawlers/settings.json`。修改这份文件后，桌面工具和全局命令使用相同的运行库、搜索源与数据目录。模型选择和子代理授权保持独立。

```powershell
.\personal\Setup-Crawlers.ps1 -BuildDesktopEntry
```

这个安装脚本下载 MediaCrawler，安装独立 Python 环境和浏览器，构建上游 WebUI、创建桌面入口，并注册 Codex / Antigravity 的 `personal-crawlers` MCP。它不会覆盖已有共享设置或已迁移的 Skill。也可分别运行 `Register-Crawlers.ps1`、`node personal/Configure-Crawlers.mjs` 重新应用路由，保留所选模型及委派设置。

Codex 原生搜索已关闭，Antigravity 有全局路由指令；新的 Codex 聊天或重启后加载 MCP。其他 AI 客户端需接入相同 stdio 服务：

```text
command: D:/desktop/tools/crawler-runtime/Scripts/python.exe
args: D:/desktop/tools/personal-crawlers/cli.py server
```

第三方客户端必须支持 MCP 并遵守路由设置，配置不能强制重写任意软件的内部搜索行为。

## 迁移的 Skill

迁移目录为 `D:/desktop/tools/personal-crawlers/skills`，已接入“我的电脑助手”预设。包含 coding-standards、agent-reach、verification-before-completion、systematic-debugging、brainstorming、test-driven-development、better-crawler、recall-project-context、documents、pdf。仅桌面控制 `computer-use` / `desktop-control` 为主模型专用；需求记忆和其他全部已授权技能继续由子代理使用。已调整 Harness 工具名称、Windows 路径、共享检索规则和子代理限制；原始文件保存在各目录的 `UPSTREAM-SKILL.md`。

验收证据与限制见 [CRAWLERS-VERIFICATION.md](CRAWLERS-VERIFICATION.md)。
