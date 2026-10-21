# Personal Desktop 验证记录

## 1. 关键接入事实与 gpt-6.1-sol 真实调用验证

### 本机 Codex Runtime 与账号接入
- 本机官方可执行文件路径：`C:\Users\mouwe\AppData\Local\OpenAI\Codex\bin\de8a38d2100ae498\codex.exe`（官方版本 v0.159.2）。
- 登录态验证：调用 `app-server --stdio` 执行 `initialize`，确认当前使用 ChatGPT 官方账号授权（`authMode: "chatgpt", planType: "plus"`），未读取、未复制、未导出任何 Web Cookie 或明文凭据。
- 与历史 0.153.4 版本对比：
  - 旧版 0.153.4 服务端硬编码拒绝：“The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.”
  - 本机 0.159.2 原生识别并支持 `gpt-6.1-sol`，握手 `thread/start` 及 `turn/start` 均正常接受 `model: 'gpt-6.1-sol'` 与 `reasoningEffort: 'low'`。
- 真实调用结果与阻塞记录：
  - 真实调用 `gpt-6.1-sol` 时，OpenAI 服务端返回真实的 ChatGPT Plus 用量超额限制：
    `"You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 2:33 PM."` (`codexErrorInfo: "usageLimitExceeded"`)
  - 证实 `gpt-6.1-sol` 确已通过官方原生账号渠道连通并被服务端识别，当前受限于用户账号 Plus 额度重置周期（14:33 重置），不存在协议不通或客户端不支持问题。
  - 系统在检测到 `usageLimitExceeded` 时，准确映射为 `LlmError`（code: `QUOTA_EXCEEDED`, status: 429），前端如实呈现配额信息，绝不使用模拟数据伪造成功。

---

## 2. 架构实现与任务路由

### A. `@deepseek-ai/dsh-llm-codex` 主控模型适配器
- 目录：`packages/llm/llm-codex`
- 实现了 `CodexAdapter` 继承 `LlmAdapter`：
  - 模型目录支持：`gpt-6.1-sol`（默认）、`gpt-6-astra`、`gpt-6-sol`、`gpt-6-luna`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-5.5`。
  - 推理等级支持：6 档 `low`、`medium`、`high`、`xhigh`、`max`、`ultra`。
  - 流式协议映射：`reasoning-delta`、`text-delta`、`item/tool/call` 动态工具调用交互及 `finish`。
  - 生命周期管理：支持 `AbortSignal` 通过 `turn/interrupt` 优雅中断与子进程回收。

### B. 任务模型独立选择与配置
- **主模型**：`personal.patch.yml` 与 `personal-data` 统一配置 `agent-default-model` 为 `provider: codex`, `model: gpt-6.1-sol`, `reasoningEffort: low`。
- **网页搜索任务**：独立配置 `web-search-deepseek` 为 `model: deepseek-v4-flash`，不与主模型绑定，沿用平台账号/环境凭据。
- **会话标题任务**：独立配置 `session-title-llm` 为 `provider: deepseek-account`, `model: deepseek-flash`。
- **代码与委派任务（子代理）**：
  - `subagent_codex`：配置 `model: gpt-6.1-sol`, `reasoningEffort: low`, `agentOptions: true`, `modelSelectionSettings: true`，支持外部指定子任务模型。
  - `subagent`（连续型）：启用 `modelSelectionSettings: true`。
  - 子代理可选模型池（`subagent-model-selection-settings`）：
    - `codex/gpt-6.1-sol`
    - `codex/gpt-6-astra`
    - `codex/gpt-5.6-sol`
    - `deepseek-account/deepseek-flash`
    - `deepseek-account/deepseek-chat`
    - `deepseek-account/deepseek-reasoner`
  - 代理可通过 `list_subagent_models` 动态发现可用模型与推理等级，并在调用子代理时传入 `provider`、`model`、`reasoning_effort`。

### C. GPT 思考主控与子代理执行分工（已固化实施）
- **分工指导与 Prompt 约束**：在 `personal/INSTRUCTIONS.md`、`personal-data/home/AGENTS.md` 及 `personal.patch.yml` 中明确注入分工架构：
  - 主控（GPT-6.1-Sol / GPT-6 系列）负责顶层思考规划、架构拆解与全局协调；
  - 实际执行（写代码、工程调试排错、网络检索）由子代理承担，避免主控长上下文退化；
  - 主控根据任务属性动态指定子代理模型与思考强度（Reasoning Effort）。
- **多并发支持**：`subagent` 插件显式配置 `maxActiveSubagents: 8`，底层并发池支持最多 8 个子代理同时活跃运行。
- **Skill 技能继承与使用**：预设中挂载了 `@deepseek-ai/dsh-tool-skill` 与技能集，进程内子代理（`spawn`）完全继承并支持自主加载和执行技能。

---

## 3. 测试与构建验收结果

### 构建状态
1. `tsc -b tsconfig.host.json`：通过（0 errors）。
2. `tsc -b tsconfig.client.json`：通过（0 errors）。
3. `corepack pnpm run build`：通过。
4. `corepack pnpm run build:desktop`：通过。

### 自动化测试套件
1. **Desktop 核心测试**：
   - `corepack pnpm exec vitest run apps/desktop/tests/personal-product.spec.ts apps/desktop/tests/preload-welcome.spec.ts apps/desktop/tests/welcome-renderer.client.spec.tsx apps/desktop/tests/welcome-window.spec.ts apps/desktop/tests/main-startup.spec.ts`
   - **结果：5 个测试文件全部通过，共 170 项测试通过（170 passed）**。
2. **Subagent Codex 测试**：
   - `corepack pnpm exec vitest run packages/subagent/subagent-codex/tests`
   - **结果：3 个测试文件全部通过，共 73 项测试通过（73 passed）**（包含与真实 app-server 交互及进程隔离测试）。
3. **LLM Codex Provider 测试**：
   - `corepack pnpm exec vitest run packages/llm/llm-codex/tests/adapter.spec.ts`
   - **结果：1 个测试文件全部通过，共 7 项测试通过（7 passed）**。
4. **个人数据与配置引导测试**：
   - `node --test personal/bootstrap.test.mjs`
   - **结果：1 项测试通过（1 passed）**。
5. **真机实时流式调用测试**：
   - 运行针对本机 `codex.exe v0.159.2` 的 `test-live-codex.ts`。
   - **结果：连通成功，成功发起 `gpt-6.1-sol` 任务，真实截获并映射配额超额响应 `QUOTA_EXCEEDED`**。
6. **子代理模型选择与推理深度测试**：
   - `corepack pnpm exec vitest run packages/subagent/tool-subagent/tests/model-selection.spec.ts`
   - **结果：1 个测试文件全部通过，共 24 项测试通过（24 passed）**。
7. **子代理并发池（最多8个子代理）与生命周期测试**：
   - `corepack pnpm exec vitest run packages/subagent/subagent/tests/continuation.spec.ts`
   - **结果：1 个测试文件全部通过，共 149 项测试通过（149 passed）**。
8. **子代理默认模型服务测试**：
   - `corepack pnpm exec vitest run packages/subagent/subagent-default-model/tests/config.spec.ts`
   - **结果：1 个测试文件全部通过，共 2 项测试通过（2 passed）**。
9. **Google Gemini LLM 适配器测试**：
   - `corepack pnpm exec vitest run packages/llm/llm-gemini/tests/adapter.spec.ts`
   - **结果：1 个测试文件全部通过，共 4 项测试通过（4 passed）**（测试涵盖 provider 信息、模型列表、推理深度及缺失 Key 时的 UNAUTHORIZED 校验）。

---

## 4. 子代理独立设置与 Gemini 子代理实机验收

1. **真实 Electron 页面呈现验证**（通过 CDP `127.0.0.1:24572` 运行时实际获取）：
   - 主界面：预设准确显示 `我的电脑助手`，主模型为 `GPT-6.1-Sol`，推理等级为 `low`，工作区为 `默认工作区`。
   - 专属设置入口：“插件”->“子智能体”（`ui-settings-subagent`）。
   - 设置项内容实测验证：
     - **运行限制**：最大递归深度、子智能体并行数量上限（已覆盖为 8）。
     - **模型选择开关**：已开启“允许 Agent 为子智能体选择模型”。
     - **Agent 可选择的模型**：
       - `codex`：GPT-6.1-Sol、GPT-6-Astra、GPT-6-Sol、GPT-6-Luna、GPT-5.6-Sol、GPT-5.6-Terra、GPT-5.6-Luna、GPT-5.5。
       - `Google Gemini`：Gemini 2.5 Pro、Gemini 2.5 Flash、Gemini 2.0 Flash、Gemini 1.5 Pro。
       - `DeepSeek` / `DeepSeek Account`：DeepSeek-V41-Flash、DeepSeek-V4-Pro 等。
2. **自动使用子代理与分工架构机制**：
   - `tool-subagent` 在未显式指定模型时，自动从 `ctx.subagentDefaultModel` 获取默认配置（`gemini/gemini-2.5-flash`，推理等级 `low`，`autoDelegate: true`）。
   - System Prompt 及工作习惯（`personal/INSTRUCTIONS.md`、`home/AGENTS.md`）严格规定主控 GPT 负责架构思考与任务拆解，写代码、调试与网页搜索等执行工作自动派发给子代理。
3. **真实调用状态与剩余阻塞**：
   - `gpt-6.1-sol` 主控模型：原生连通官方 `codex.exe v0.159.2`，目前受限于用户 ChatGPT 账号 Plus 额度重置周期，服务端返回真实的 429 配额错误。
   - `gemini` 子代理模型：已接入官方 Generative Language API 架构，支持通过 `GEMINI_API_KEY` 环境变量进行实际调用；当未提供密钥时准确提示 `401 UNAUTHORIZED`，不伪造数据。

---

## 5. 推理等级协议与子代理模型隔离专项修复与实测验证

### A. Codex 推理等级字段协议修复（`effort` vs `reasoningEffort`）
- **现象与根因**：
  - 用户反馈向本机 Codex 请求 `high` 时，服务端实际返回仍为默认 `medium`。
  - 逆向与实机探测发现：OpenAI Codex app-server（v0.159.2）的 `thread/start` 并不处理 `reasoningEffort` 参数。服务端内部真正的 JSON-RPC 字段名为 **`effort`**（枚举值：`low`、`medium`、`high`、`xhigh`、`max`、`ultra`）。
  - 若仅在 `thread/start` 传递 `reasoningEffort`，app-server 会将其忽略并保持默认 `medium`，导致界面选择的六档推理等级无法真正下发给模型。
- **修复方案**：
  - 在 [`packages/llm/llm-codex/src/adapter.ts`](file:///D:/desktop/personal-desktop/packages/llm/llm-codex/src/adapter.ts) 中，当用户指定 `reasoningEffort` 时：
    1. 线程启动后立即向 app-server 发送 `thread/settings/update` 携带 `{ threadId, effort: options.reasoningEffort }`；
    2. 在后续 `turn/start` 请求中，显式传递 `effort: options.reasoningEffort`。
  - 在 [`packages/subagent/subagent-codex/src/wire.ts`](file:///D:/desktop/personal-desktop/packages/subagent/subagent-codex/src/wire.ts) 中，在 `turn/start` 请求体中同样传递 `effort: this.reasoningEffort`。
- **真机实测验证**：
  - 启动真实 `codex.exe`（v0.159.2），通过 JSON-RPC 发起带 `effort: 'high'` 的请求。
  - 服务端立即触发 `thread/settings/updated` 事件确认 `effort: 'high'`，后续调用 `thread/read` 检查该线程，返回的 `thread.reasoningEffort` 确认为 `'high'`。推理等级切换完全生效。

### B. 子代理默认模型配置隔离（Gemini 与 Codex/MiMo 彻底解耦）
- **现象与根因**：
  - 默认子代理模型配置（`subagentDefaultModel`，设为 Gemini）在 `packages/subagent/tool-subagent/src/index.ts` 中被无条件注入到了所有 `tool-subagent` 实例中。
  - 导致专用的 `subagent_codex`（`provider: 'codex'`）和 `subagent_mimo`（`provider: 'mimo'`）会被错误地强行套上 Gemini 的模型配置。
  - 此外，MiMo 依赖的 `AcpProvider` 其能力声明为 `capabilities.agentOptions: false`，强行传递 `agentOptions` 会破坏 ACP provider 契约并导致报错。
- **修复方案**：
  - 在 [`packages/subagent/tool-subagent/src/index.ts`](file:///D:/desktop/personal-desktop/packages/subagent/tool-subagent/src/index.ts) 中：
    1. 限制 `appliesSubagentDefault`：仅当 `subagentProvider.capabilities.agentOptions === true` 且 `(config.provider === 'spawn' || config.provider === subagentDefault.provider)` 时，才应用默认模型配置。专用的 `codex`、`mimo` 等独立 provider 彻底免受污染。
    2. 严格守护 `agentOptions` 传参：在 `subagents.start()` 时检查 `subagentProvider.capabilities.agentOptions === true` 才附加 `agentOptions`。
  - 在 [`packages/subagent/tool-subagent/src/model-selection.ts`](file:///D:/desktop/personal-desktop/packages/subagent/tool-subagent/src/model-selection.ts) 中，支持在未提供 provider 时推断预设 provider。
  - 在 [`packages/subagent/subagent-codex/src/index.ts`](file:///D:/desktop/personal-desktop/packages/subagent/subagent-codex/src/index.ts) 中，为 `CodexProvider` 增加 `agentRouteDefaults`（`provider: 'codex', model: config.model`）。
- **回归与自动化测试**：
  - 在 `packages/subagent/tool-subagent/tests/tool-subagent.spec.ts` 中增加两项针对性单元测试，覆盖专用 provider 隔离与 `agentOptions: false` 保护。
  - 运行 `packages/subagent/tool-subagent`、`packages/llm/llm-codex`、`packages/subagent/subagent-codex` 整体 11 个测试文件共 **239 项测试全部通过**（包含与真实 `codex.exe` 交互测试）。


## 2026-10-04：Gemini 登录复用与重启状态

- 根因：账号设置控制器只保留进程内状态，重启后回到 `idle`，把仍有保存凭据的账号显示为“尚未验证”。
- 修复：启动时只检查官方凭据文件是否存在且非空，恢复为 `saved`，不读取凭据内容，不宣称当前请求已经验证。每个账号仅保存真实成功请求的 `checkedAt` 到 `personal-verification.json`。
- 真实续期：两个账号昨日的访问凭据均已过期；官方 `agy 1.2.16` 复用各自保存的续期凭据，自动更新到期时间并返回结构化 `SUCCESS` / `OK`，全程无需浏览器再次授权。
- 桌面链路：两个账号通过原生设置接口的请求均返回 `verified`。重启后均恢复 `saved` 并保留各自验证时间；实际设置页显示两条“已保存登录”和两个“重新验证”按钮。
- 验证：账号控制器、账号隔离和设置组件共 23 项测试通过；相关类型检查、桌面构建、客户端 bundle、Web 前端构建、定向 lint 和界面多语言检查通过。
- 全仓库界面测试：9527 通过、7 失败、1 跳过。7 项失败均在原有 `ui-chat/chat-view.client.spec.tsx`，仍期待旧的“深度求索中”文案。浏览器全套回放出现文档预览、插件管理和聊天滚动等模块的失败后中止，未完成整套回放，不能据此宣称全仓库验收通过。
- 未验证：连续数周使用、Google 服务端撤销授权或改变登录政策后的行为。未修改 Google 签发凭据的有效期。

