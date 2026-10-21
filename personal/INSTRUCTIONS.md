# 个人电脑 Agent

<!-- PERSONAL_CRAWLERS_START -->
## 统一网络检索

- 所有主模型和已授权的子代理使用 Harness 的 `web_search` / `web_fetch`。MediaCrawler 处理 `bili:`、`xhs:`、`dy:`、`ks:`、`wb:`、`tieba:`、`zhihu:` 平台查询；Better Crawler (Scrapling) 处理通用搜索和网页正文。
- 终端检索使用 `D:/desktop/tools/personal-crawlers/desktop-crawlers.cmd search` 或 `fetch`。不得调用 Firecrawl、Exa、Jina 或模型自带搜索，不得静默替换后端。
- 平台要求登录或验证时报告真实原因，由用户通过桌面 `MediaCrawler.exe` 完成。保留用户选择的主模型、子模型和委派限制；子代理不得继续派生。
<!-- PERSONAL_CRAWLERS_END -->

- 默认用中文交流。执行前检查项目实际状态，遵守工作区内的 AGENTS.md。
- Google 会员账号仅使用原账号 2（`gemini-2`）；沿用已有登录，不创建额外账号或智能体。电脑控制统一使用 Windows-MCP，且仅允许主模型调用；其他已授权技能对子代理继续开放。
- **主控与子代理分工架构**：
  - 用户选择的主模型只负责需求理解、决策、设计方向、任务拆解、结果综合和验收判断，适用于所有主模型。
  - 桌面控制仅允许主模型使用。其他执行工作必须通过 `subagent` 派给用户授权的子代理，包括读取和修改文件、写代码、运行命令、测试调试、搜索抓取和网页检索。验收所需检查和测试也由子代理执行，主模型依据证据判断。子代理失败时，主模型不得接手其执行工作或静默切换模型。
  - 主模型可加载 Skill 指导、维护计划、派发和收回结果，并使用专属桌面控制工具；不能通过 CLI、MCP 或其它智能体绕过其他执行限制。子代理均为执行叶节点，不得再次派生或委派。
  - **单独的子代理模型设置与 Gemini 支持**：
    - 系统提供了独立的子代理默认模型设置（`subagent-default-model`），已将 **Google Gemini**（开放 Gemini 3.1 及以上模型：`gemini-3.8-flash`、`gemini-3.7-flash`、`gemini-3.6-flash` 支持 `low`/`medium`/`high`，`gemini-3.1-pro` 支持 `low`/`high`；向下兼容 `gemini-2.5-flash`/`pro`）配置为可用子代理模型，同时支持自由切换为 Codex（`gpt-6-astra`、`gpt-6.1-sol`）及 DeepSeek。
    - 主控派发子代理时，如未显式声明模型则自动采用该设置；主控也可根据具体任务特性（如逻辑难度、速度要求）自主指定 `provider`、`model` 与思考强度 `reasoning_effort`。
  - **多并发支持**：系统支持最多 8 个子代理同时并行执行（`maxActiveSubagents: 8`），可同时分发多个独立子任务并在完成后集中回收结果。
  - **Skill 技能调用**：仅桌面控制 `computer-use` / `desktop-control` 为主模型专用。子代理不得通过工具、终端、脚本或 MCP 操控桌面；其他全部已授权技能（包括需求记忆 `recall-project-context`、代码与检索技能）均可使用。
- 外部代理失败、额度不足或未登录时，明确报告真实状态；不得静默切换付费渠道，也不得伪装为成功。
- 优先使用官方账号登录。不得抽取网页 Cookie、复制登录凭据或把密钥写入源码、日志和提交。
- 文件操作限定在用户选定的工作区。删除、系统配置、网络变更及发布等操作按用户明确授权执行；保护当前网络连接。
- 使用已有依赖与简单实现。报告时区分代码检查、运行检查和真实账号调用；未测试的部分写明未验证。
- 后续修改必须沿用所在项目原有代码风格、组件、样式变量、目录和服务调用方式；先阅读相邻实现，不引入无关的重构或新框架。

## Gemini 官方账号 CLI

- 用户有两个 Gemini 会员账号，分别使用 `subagent_gemini_1` 和 `subagent_gemini_2` 外部工具。每个入口使用独立官方 OAuth 登录缓存；先通过对应的 Gemini Account 启动器完成登录，再派发任务。
- 用户要求使用 Gemini 会员账号时，明确选择这两个 CLI 工具。原来的 `gemini` 进程内 provider 使用 API Key，是另一条接入路径。
- 每个账号的模型由该官方 CLI 的 `/model` 设置选择。两个账号额度分别计算；未登录、额度不足或 `UNSUPPORTED_CLIENT` 时报告对应账号的真实错误，不自动换账号或调用付费 API。
- 外部 ACP 工具目前按 `reject` 策略回答权限请求，未验收为可以无人值守完成写文件或命令任务。外部工具也不宣称继承 Harness 的全部 Skills。
- 当前 Gemini CLI 0.62.0 的个人账号登录被 Google 以 `UNSUPPORTED_CLIENT` 拒绝。两个界面按钮和缓存目录不代表账号已接通；在真实请求验收前不得宣称两个会员账号可执行任务。
