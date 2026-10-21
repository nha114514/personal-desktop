# 共享检索验收（2026-10-04）

## 已配置和安装

- 独立 Python 3.12.14 环境：`D:/desktop/tools/crawler-runtime`。安装 Scrapling 0.4.15、Playwright / Patchright Chromium、MediaCrawler 依赖及 MCP 2.3.0；`pip check` 和实际启动 Chromium 的 `desktop-crawlers doctor` 通过。
- 共享配置：`D:/desktop/personal-data/crawlers/settings.json`。Personal Desktop 将 searchProvider、fetchProvider 均选为 `personal-crawlers`；旧 DeepSeek 搜索入口停用。
- Codex 和 Antigravity 的 `mcp list` 均显示 `personal-crawlers` enabled；stdio 服务暴露 `web_search`、`web_fetch`。Codex 原生搜索关闭，全局路由指令已写入客户端指令文件，未修改所选模型。
- 桌面入口 `C:/Users/mouwe/Desktop/MediaCrawler.exe` 是本项目构建的启动器，调用已安装的上游 WebUI，并与代理共用运行库、数据目录、平台浏览器状态及互斥锁。
- 10 个迁移 Skill 接入个人预设的 filesystem provider；保留上游原文并适配 Harness 工具、Windows 路径、主子模型约束和共享检索。原机 Skill 保留。

## 真实验证通过

- 全局 MCP 完成 initialize、tools/list 和真实搜索、页面读取。搜索返回官方 Scrapling GitHub 来源，`https://example.com` 返回 200 及正文。
- 实际运行的 Personal Desktop 宿主 Context 返回真实页面内容；个人预设 scope 中 10 个 Skill 均加载自迁移目录，具有适配后的正文。
- 实际 Electron 页面“插件 → 网页搜索”显示 MediaCrawler / Better Crawler，配置路径正确，无旧 API Key 输入框。截图：`.artifacts/personal-crawler-settings.png`。
- 桌面 EXE 实际启动 WebUI，健康接口、运行环境检查和首页通过；页面截图 `.artifacts/mediacrawler-webui.png` 显示上游使用条款与抓取界面。未替用户接受条款或登录平台。
- Gemini 账号 1、2 均通过真实会员 CLI + Harness 工具往返：模型先请求 `web_search`，宿主调用共享搜索，再把实际来源回传模型，最终得到官方仓库 URL。证据：`.artifacts/harness-crawlers-real.json`。选用 `gemini-3.8-flash/high`，未配置 API Key 或换模型。
- 完整桌面验收通过：`codex/gpt-6.1-sol/ultra` 派发 `gemini-1/gemini-3.8-flash/high`，子代理加载 Skill 并完成搜索，主模型收回并返回官方仓库链接。整轮约 2 分 22 秒；主会话和子会话均正常关闭当前轮次。证据：`.artifacts/desktop-crawler-delegation.json`、`.artifacts/desktop-crawler-delegation.png`、`.artifacts/live-delegation-state.json`。
- 收尾时读取上述两条测试会话的完整持久化日志，确认子代理实际执行 `skill(agent-reach)`、`web_search`、`web_fetch` 和向父代理 `send_message`，搜索结果含官方仓库来源；没有执行进一步委派。主模型最终回复和双方轮次关闭状态与界面一致。证据：`.artifacts/desktop-crawler-transcript.json`。
- 未登录的 Bilibili 查询返回 `WEB_LOGIN_REQUIRED`，没有伪造检索结果。

## 修复与回归

- 同一 MediaCrawler 平台的进程共享浏览器互斥锁，覆盖代理与 WebUI；不同平台不互相阻塞。跨进程锁测试验证同平台拒绝重入、不同平台可并发、退出后可重用。
- 全局登录命令解析 worker 的结构化错误，失败时不会报告“登录完成”。桌面 API 启动超时会回收它自己创建的进程。
- Gemini 同一轮多个工具结果全部传回，保留调用名称。真实桌面委派曾因完整上下文超过 Windows 命令行限制报 `spawn ENAMETOOLONG`；已改用官方 NDJSON 标准输入，长提示词回归通过。
- 最新 Gemini 测试 6 文件、18 项通过；共享检索与 settings 相关测试通过；Python worker / 入口测试通过；个人 bootstrap 保留配置测试通过。最新 Gemini TypeScript 编译与目标包构建通过。
- Codex 工具结果按真实 callId 匹配，保留失败标记，续接时传递所有新到达的子代理消息；个人配置停用冲突的团队控制工具。Codex 4 文件、13 项测试通过，个人配置 6 项测试通过；定向 TypeScript 检查与运行包构建通过，真实宿主确认使用 `send_message(agent_id, message)`。
- 全量 Host / Client 类型检查此前通过。根 `build:lib` 仍有已有的 `dsh-root` 缺少 `lib/types/index.js` 等入口问题；本次目标包分别构建，不宣称根全量库构建通过。

## 尚未验证及限制

- 7 个媒体平台的实际授权后搜索尚未全部验收，仍依赖用户登录及平台验证。
- 文档 / PDF Skill 的目录与正文可加载，未逐个完成文档渲染流程验收。
- Antigravity 工具响应采用模型 JSON 请求协议，含工具的响应会等 CLI 结果完成后输出；native tool 事件会被拒绝，但这不构成第三方 CLI 从未执行任何原生动作的保证。
- 新 Codex 聊天或重启后加载全局 MCP；配置不能强制改造任意第三方 AI 软件。

## 后续实施分工

本次收尾完成共享搜索 provider、运行库、全局命令 / MCP、个人预设 Skill 迁移和桌面入口。将 MediaCrawler 的原生交互整合到应用，以及完善 Gemini / GPT 浏览器账号授权，是另一个 AI 的实施范围；交接文件为 [MEDIA-AUTH-INTEGRATION-HANDOFF.md](MEDIA-AUTH-INTEGRATION-HANDOFF.md)。现有桌面入口打开的是上游本机 WebUI，不将其描述为已经完成原生界面整合。
