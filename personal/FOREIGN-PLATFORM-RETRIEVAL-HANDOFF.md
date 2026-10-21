# YouTube / X 原生检索接入：交给执行 AI 的提示词

你负责在本机实际实现并验收以下已经确认的方案。请直接检查、修改、安装必要依赖、构建和测试；不要停留在建议或只添加 Skill 文件。

## 一、项目与约束

- Personal Desktop 仓库：`D:\desktop\personal-desktop`。
- 运行数据：`D:\desktop\personal-data`。
- 全局共享检索：`D:\desktop\tools\personal-crawlers`，现有入口 `desktop-crawlers.cmd`、`cli.py` 和 personal-crawlers MCP。
- 先遵循当前 AGENTS.md 和 requirement-memory preflight，核对最新已确认要求；有 `.codegraph` 才使用 CodeGraph。修改 packages 前读仓库架构文档，沿用现有 Cordis 插件、进程管理、配置、类型、日志、国际化和测试风格。
- 保存全部未提交修改，不重置工作区、不做无关重构、不卸载现有工具。
- 主模型只负责决策、规划、设计方向及验收；实际搜索、抓取、代码执行由用户授权的子代理完成。保留实际选定的 provider、model、reasoning effort，不为了测试成功换模型或换账号；最多 8 个子代理，子代理不能派生或间接委派。

## 二、已确认的技术方案与源码

1. Agent Reach：参考其平台识别、搜索与读取顺序、失败分类和有限重试逻辑，不复制整套默认搜索配置。
   - 仓库：https://github.com/Panniantong/Agent-Reach
   - Skill：https://github.com/Panniantong/Agent-Reach/blob/main/agent_reach/skill/SKILL.md
   - 视频规则：https://github.com/Panniantong/Agent-Reach/blob/main/agent_reach/skill/references/video.md
   - 社交规则：https://github.com/Panniantong/Agent-Reach/blob/main/agent_reach/skill/references/social.md
2. OpenCLI：作为 X 搜索、帖子、串帖和长文读取的执行后端，复用受控 Chrome 浏览器登录会话。
   - 仓库：https://github.com/jackwener/OpenCLI
   - Skill：https://github.com/jackwener/OpenCLI/blob/main/skills/opencli-usage/SKILL.md
   - X 搜索源码：https://github.com/jackwener/OpenCLI/blob/main/clis/twitter/search.js
3. yt-dlp：作为 YouTube 搜索、视频信息及字幕提取的执行后端。
   - https://github.com/yt-dlp/yt-dlp
4. agent-browser：仅作为需要时评估的动态页面读取备用，优先复用已有浏览器能力，不默认另装一套浏览器框架。
   - https://github.com/vercel-labs/agent-browser
   - Skill：https://github.com/vercel-labs/agent-browser/blob/main/skills/agent-browser/SKILL.md

这些项目有公开源码，不需要反编译二进制。Skill 是说明层，真正要接入的是执行逻辑、平台适配器与底层路由。优先使用维护中的 CLI/依赖，避免复制容易变化的 X 内部接口标识；确需复制源码时保留原许可证及声明。Agent Reach 为 MIT，OpenCLI 为 Apache-2.0，仍须核对实际采用版本的 LICENSE。

## 三、实现要求

### 1. 统一底层路由

- 扩展现有 `web_search` / `web_fetch`，接入 Harness `ctx.web` 和全局 personal-crawlers CLI/MCP；确保桌面、用户手动命令及使用该共享服务的其他 AI 客户端使用相同路由。
- `youtube:` / `yt:`、YouTube 域名与视频链接进入 YouTube 后端；`x:` / `twitter:`、X/Twitter 域名与帖子链接进入 X 后端。沿用现有参数风格，支持明确的平台选择，不能只靠模型提示词猜测。
- 七个现有国内媒体平台继续使用 MediaCrawler；普通网页搜索和正文读取继续使用 Better Crawler/Scrapling。
- 不启用 Firecrawl、Exa、Jina 或模型提供商原生搜索；不要把 Agent Reach 的默认检索源一并带进来。
- OpenCLI 只暴露本需求所需的读取命令，不把任意 CLI、发帖、私信、删除或调用其他 AI 的能力开放给模型。

### 2. YouTube

- 搜索结果返回相关的视频标题、作者/频道、规范链接、视频 ID、可获取的发布时间、简介等；过滤明显偏题结果，不把标题或搜索摘要当成实际视频内容。
- 读取视频时优先获取人工字幕，其次自动字幕；保留语言、来源和时间戳，处理重复片段，输出长度有界且能定位原视频。
- 元数据、字幕、字幕不存在、登录要求、网络失败和平台拦截分开表示。缺少字幕时不能伪造转录；ASR 不属于本次默认能力，如需增加付费服务须另外说明。
- 使用安装版本真实支持的 yt-dlp 参数，处理它实际要求的 JS runtime 等依赖；默认无需下载视频或音频。

### 3. X

- 在本机实际命令注册表与版本支持范围内，实现关键词搜索和结果读取，支持帖子正文、串帖、长文；返回作者、发布时间、规范链接及可获取字段，分页与结果数有界。
- 安装并配置官方 OpenCLI 浏览器桥接组件（如果确实缺失），明确选择可复用的浏览器 profile，保留用户现有会话。Gemini/Google 授权不代表 X 已登录。
- 需要登录或扩展人工操作时，准备好入口与明确的操作说明，再由用户在浏览器完成；不要求在聊天粘贴 Cookie、Token 或授权码，不批量导出浏览器凭据。
- 公开页只能读取部分内容时标明不完整，不能用其他站点的摘要冒充原帖；登录后必须再做真实读取验证。

### 4. 全局配置、结果与运行管理

- Desktop 设置、AI 调用和全局命令复用同一套后端配置、浏览器 profile、相关平台状态与实际所需的数据目录；避免 UI 显示登录而 AI 调用另一目录。
- 保留现有工具返回契约；新增字段通过现有扩展机制实现，必要时同时更新消费者。结果包含平台、实际后端、查询/原链接、内容与获取时间；搜索发现和正文/字幕读取分别记录。
- 遵循现有取消、超时、输出限制与并发机制；对同一浏览器会话按真实能力限制并发，不能因 8 个子代理同时工作而串页、串结果。
- 如引入缓存，区分平台、查询、链接、浏览器 profile 和访问上下文，采用有限有效期，不混用不同登录状态结果。
- 有界重试；`WEB_SEARCH_BLOCKED`、需要登录、扩展未连接、字幕缺失等分别报告。缺少结果不能当作成功；不能无限等待或静默换检索源。
- 搜索/读取进度在桌面有实际事件支持；日志不得包含凭据、授权 URL 中的敏感参数或完整浏览器会话数据。
- 缺失运行库实际安装并验证，不把“缺少依赖”当作交付完成。版本、路径与状态以本次检查为准。

## 四、现有线索与待核实项

此前只读检查显示 yt-dlp 2026.06.09、OpenCLI 1.8.6 已安装，OpenCLI Chrome 桥接扩展未就绪；这些是线索，不是本次验收结果，请重新核对。曾成功读取一条公开 X 正文，但通用搜索随后出现 `WEB_SEARCH_BLOCKED`，没有完成 X 登录检索或 YouTube 字幕验收。

还应先检查 `personal/MEDIA-AUTH-INTEGRATION-REVIEW.md` 中与共享目录、取消/超时和构建产物有关的问题。只修复本功能需要的路径；其他既有问题单独报告，不能把旧测试通过的报告当成本次证据。

## 五、验收标准

1. 针对真实行为新增回归测试：平台路由、字幕解析、串帖结果、认证/桥接失败、超时取消、并发隔离和现有国内/通用路由保持可用。运行相关类型检查、构建及仓库要求的相应检查；已有基线错误与本次引入错误分开记录。
2. 全局 CLI/MCP 做真实 `initialize`、`tools/list` 和检索调用；返回网页正文或字幕正文，不能只验证进程启动。
3. YouTube：执行一个明确主题搜索，实际读取其中一个相关视频的字幕并保留时间戳；验证一个无字幕或失败案例，记录真实状态。
4. X：桥接和用户登录完成后实际搜索关键词，读取命中帖子和一个串帖或长文，展示可核对的原始链接、正文及字段。不可用项如实记录原因。
5. Personal Desktop：构建并启动最新产物，通过真实桌面发送链路验证用户选定主模型实际委派授权子代理，子代理调用统一检索入口获取 YouTube/X 内容，主模型收回并引用来源；子代理未再次派生。独立 CLI 的成功不能代替此项。
6. 重启后验证配置和正常登录会话复用。若受主模型额度、用户尚未登录或远端限制阻塞，只标对应验收未完成，不能擅自更换模型、宣称全链路通过。

## 六、交付

完成后提供修改文件、源码出处与许可证处理、实际依赖版本和路径、真实执行的测试/构建命令及结果、全局用法、桌面用法、可核对的结果链接和剩余问题。

最终明确区分：已修改、已安装/配置、已构建、真实桌面验证通过、尚未验证。保存验收记录，检查运行进程实际加载的是本次新产物。用户以实际桌面可用为完成标准。
