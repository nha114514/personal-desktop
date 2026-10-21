# Personal Desktop 使用说明

这是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的个人 Windows 源码版桌面助手，保留上游 MIT 许可证和来源。桌面主体、文件操作、PowerShell、会话、插件、后台任务及权限机制直接复用上游实现。

## 启动与登录

Google 会员登录只保留原账号 2，继续使用原来的私有目录和已保存登录。重启后设置页显示“已保存登录”并保留上次成功验证时间；官方 Antigravity CLI 在需要时自动续期。“重新验证”检查实际连接，只有官方服务要求重新授权时才需要浏览器登录。Google 决定凭据有效期，应用不修改其到期时间。

桌面快捷方式通过 `wscript.exe` 执行 `Launch.vbs`，从进程创建时就隐藏 PowerShell，避免命令行启动器先占用一次任务栏。启动脚本会先等待已有实例确认并显示窗口；未确认时走正常启动流程，不会批量结束 Electron 进程。直接运行 `.cmd` 仍会使用命令行窗口。启动诊断见 `personal-data/logs/launcher-timings.jsonl`，本次修复与实测见 [启动验证记录](STARTUP-2026-10-21.md)。

个人配置中的 `ui-workspace.restoreLastSession: false` 让界面启动时在上次工作区创建一个空白新会话，不再恢复旧聊天或子代理页面。旧聊天和未发送草稿保留在原会话中，可从历史列表重新打开。应用已运行时重复点击快捷方式仅唤起当前窗口。

1. 双击本目录的 `Personal Desktop.cmd`。已编译的版本可直接启动；需要重建时运行 `Prepare.ps1`。
2. 默认主推理模型为 `codex/gpt-6.1-sol`（支持 6 档推理深度：`low`、`medium`、`high`、`xhigh`、`max`、`ultra`），通过自动探测的本机官方 Codex runtime 接入 ChatGPT 官方账号授权，无需手填 API Key，不抽取网页 Cookie。之后保留用户在配置及会话中选择的模型和推理等级。
3. 具体任务模型独立选择与路由：
   - 网页搜索任务：所有主模型和授权子代理共享 MediaCrawler / Better Crawler 检索后端，不再使用 `web-search-deepseek`。配置、全局命令与桌面入口见 [共享检索说明](CRAWLERS.md)。
   - 会话标题生成：使用独立的 `deepseek-account/deepseek-flash`。
   - 子代理委派：使用独立的子代理默认模型配置服务（`@deepseek-ai/dsh-subagent-default-model`）。个人模板采用 `gemini-2/gemini-3.8-flash/high`，已有配置继续保留用户选择的默认模型和自定义 API 模型。模型和推理等级不因主模型切换而重置。主模型负责决策、设计方向、任务拆解、验收判断及专属桌面控制；其他执行工作交给授权子代理。
   - 子代理专属设置页：在“插件”->“子智能体”设置中，可自由配置子代理模型白名单、开启/关闭模型选择、调整最大并行子代理数量（上限已设为 8）。
   - 主模型统一通过连续型 `subagent` 派发，采用你选择的默认子代理或白名单内已授权的模型和推理等级；外部 CLI 委派工具不向主模型开放，避免绕过模型选择。
4. 选择工作区和“我的电脑助手”预设后输入任务。主模型通过 `subagent` 委派执行，支持最多 8 个子代理并行；子代理不得再派生或委派。主模型依据子代理的检查与测试证据作出验收判断，子代理失败时不得接手执行。

每次用户请求最多新建 8 个子代理，优先用 `send_message` 复用已有的授权子代理；子代理完成或自动续跑不会重置新建数量。页头“累计”数量保留历史记录。授权名单变更立即约束后续派发和子代理模型请求，旧会话不会继续沿用已撤销的授权。默认子模型若不在当前名单中，请在子智能体设置中重新选择；应用拒绝该默认路由，不会自动补回授权或替换模型。
5. MiMo 先运行 `MiMo Login.cmd`，完成其官方浏览器授权，再使用 MiMo 委派。当前安装位置为工作区旁的 `tools/mimocode-0.1.14/mimo.exe`；启动器仅在这个文件存在时启用 MiMo 工具。

Gemini 会员账号路由 `gemini-2` 通过本机官方 Antigravity CLI 调用，沿用原账号 2 的登录，无需 `GEMINI_API_KEY`。`gemini-1` 不再注册。独立的 `gemini` provider 属于 API 路由，保留其模型及凭据配置；会员登录不自动填充 API 密钥。MiMo 官方引擎也保存自己的平台凭证。账号、额度和模型请求成功与否分别验证；失败时不自动切换付费渠道。

## 个人配置

`primary-delegation` 插件对主模型开放协调工具和专属 Windows-MCP 桌面工具；其他执行交给授权子代理。桌面控制统一使用 `windows-mcp`，子代理不能调用桌面工具，其余已授权 Skill 继续开放。Codex LLM 线程关闭原生执行、搜索、MCP、插件和独立智能体入口，任务使用 Harness 工具。既有数据可运行 `node personal/Configure-Primary-Delegation.mjs` 安装此策略并保留模型选择；更新后在空闲时重启桌面。

真实桌面调用、运行时限制和测试证据见 [主模型分工验收](PRIMARY-DELEGATION-VERIFICATION.md)。

新增 API 子代理模型：打开“设置 → 模型 → 添加模型提供商 → 自定义模型 API”，填写提供方 ID、显示名称、API 地址、协议、密钥和模型 ID。兼容 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 的接口均可接入，模型 ID 无需预写在代码中。保存后到“插件 → 子智能体”勾选授权模型，并可在“子智能体默认模型”里选择它及推理强度。保存配置后，新会话可按任务显式选择这些模型；未指定模型的进程内子代理任务使用独立默认模型。主模型配置保持独立，账号 CLI 工具仍使用自己的配置。调用费用由所配置的 API 提供方结算。

“设置 → 模型账号”提供原 Google 账号 2 与 GPT 官方账号的登录、验证和取消操作。账号 CLI 使用 Google OAuth，和 Gemini API provider 分开。单账号迁移及模型配置保全说明见 [2026-10-20 升级说明](UPGRADE-2026-10-20.md)；历史工具往返证据见 [共享检索验收](CRAWLERS-VERIFICATION.md)。

个人模板包含侧栏名称 Personal Desktop、首页欢迎文字“我的电脑助手”以及关闭鲸鱼图标和上游 DeepSeek 账号入口的配置。界面是否生效以实际运行包为准；后续界面改造由 [实施交接](MEDIA-AUTH-INTEGRATION-HANDOFF.md) 覆盖。代码继续复用现有 Settings 插槽、原子组件、主题变量和宿主桥接方式。既有数据目录可运行 `node personal/configure-interface.mjs D:\desktop\personal-data` 加入这些界面配置；该操作只追加缺失条目，保留已有文本与用户修改。

源码启动器的数据根目录是源码工作区旁的 `personal-data`：`home` 保存会话和配置，`electron` 保存桌面状态，`logs` 保存本机诊断。不要公开这些数据目录。它们不使用官方 Harness 的默认数据目录。

首次初始化把 [个人预设](personal.patch.yml) 写入 `home/profiles/desktop/cordis.patch.yml`，把 [工作习惯](INSTRUCTIONS.md) 写入 `home/AGENTS.md`。启动器只创建缺失的文件，之后保留你的修改。中文是初始语言；界面中的偏好可以继续修改。

Codex 优先使用本机 OpenAI Codex 官方可执行文件（自动探测 `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe`），沿用本机 Codex 正常登录状态。当用户账号遇到服务端配额限制（如 ChatGPT Plus 额度耗尽）时，系统会真实呈现服务端配额返回（429 QUOTA_EXCEEDED），不伪造成功响应。委派为单轮任务，可作为后台 Job 回收最终结果；当前不展示外部代理的完整中间过程，也不支持外部会话续聊。默认不接受无人值守的权限提升请求。

个人模式使用独立应用名称和协议，禁用上游自动更新及强制更新服务。当前交付通过源码启动器运行，没有交付签名安装包。可选的个人 Windows 未签名打包路径需要另做完整安装与升级验证。

## 开发检查

```powershell
node --test personal/bootstrap.test.mjs
corepack pnpm run build
corepack pnpm run build:desktop
corepack pnpm exec vitest run packages/llm/llm-codex/tests/adapter.spec.ts
corepack pnpm exec vitest run packages/subagent/subagent-codex/tests
corepack pnpm exec vitest run apps/desktop/tests/personal-product.spec.ts apps/desktop/tests/preload-welcome.spec.ts apps/desktop/tests/welcome-renderer.client.spec.tsx apps/desktop/tests/welcome-window.spec.ts apps/desktop/tests/main-startup.spec.ts
```

真实账号调用、配额事实、测试与构建验收记录详见 [验证记录](VERIFICATION.md)。MiMo 源码及使用限制以 [官方仓库](https://github.com/XiaomiMiMo/MiMo-Code) 为准。
