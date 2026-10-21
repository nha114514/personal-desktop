# Personal Desktop 自修复任务

后续需求覆盖：用户已要求移除自定义 API 思考强度接口，见 `personal/REMOVE-API-REASONING-2026-10-20.md`。下文 R4 的恢复手动等级编辑方向已取消，不得重新加入该控件或替用户恢复 qwen 等级映射。其他修复项继续适用。

## 用户授权与目标

用户本轮明确授权：让 Personal Desktop 接收本次验收问题并修改自己的代码。你是该应用内接收任务的主模型；这里的评审者准备问题和复现证据，最终由其独立复核。请实际修复、运行测试并提交可审查的改动，不停留在复述计划，也不要自行宣布最终验收通过。

工作区：`D:\desktop\personal-desktop`

活动个人配置：`D:\desktop\personal-data\home\profiles\desktop\cordis.patch.yml`

首先完整阅读本文件、工作区适用的 AGENTS.md，以及 `personal/FINAL-ACCEPTANCE-2026-10-20.md`。使用需求记忆 preflight 核对最新明确要求。原始证据目录为 `.artifacts/final-acceptance-20261020/`。旧交付自评不能覆盖重新复现的事实。

## 不可更改的范围

- 保留所有现有未提交改动，不运行 reset、clean 或覆盖式 checkout。先记录当前工作树，再做最小必要修改，遵循 Cordis 插件、原语组件、locales 和原有代码风格。
- 不删改用户新添加的 12 个 qwen 自定义模型，不静默切换主模型、子模型、推理等级、提供方、接口地址或凭据。只保留 Google 账号槽位 2 的现有选择，不恢复槽位 1，也不删除其历史目录或凭据。
- 主模型负责决策、拆解、设计和验收判断；只有当前已经授权、用户选定的叶子子代理可以执行代码和测试，禁止额外开未授权模型，禁止子代理再派生，遵守现有最大 8 个并发限制。桌面控制是例外：仅主模型可用，统一 windows-mcp，子代理不得通过脚本、MCP 或其他入口绕过。
- 检索继续使用 personal-crawlers：MediaCrawler、Better Crawler、yt-dlp、OpenCLI；不换 Firecrawl、Exa、Jina 或模型原生搜索。
- 不输出、转存或向报告写入密钥、Cookie、Token、完整授权 URL、原始私密配置或会话。解析 YAML 的异常也不能打印整个源文本。
- 不改写原始验收证据、削弱失败断言、删除测试、虚报远端调用或把 fixture 当作实机验收。新证据存到单独目录。

## 先做预检与复现

1. 核对实际工作区、活动配置、运行产物和模型路由。确认当前请求使用用户所选模型，禁止为通过验收而偷换。
2. 运行归档的复现脚本，再修复：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .artifacts\final-acceptance-20261020\Run-ReviewProbes.ps1 -Mode Regression
```

上一轮结果为 3 个文件、7 个断言失败、Exit 1。用户后来要求移除了手动推理等级控件，因此原 `probes/reasoning.client.spec.tsx` 已不适用于当前需求，完整归档脚本会尝试导入现已删除的旧组件。当前修复应重放 `protocol.spec.ts` 与 `resume.client.spec.tsx` 的六个仍有效断言，推理控件则使用当前的 `model-reasoning-removal.client.spec.tsx` 与 `model-select.client.spec.tsx` 回归。保留原始归档脚本和证据，不为重放而恢复已取消的组件。

3. 在仓库根目录用指定 pnpm 跑测试，不在子包裸跑：

```powershell
$repairPnpm = 'D:\desktop\personal-desktop\apps\desktop\node_modules\pnpm\bin\pnpm.mjs'
node $repairPnpm --dir 'D:\desktop\personal-desktop' exec vitest run <测试路径> --maxWorkers=1
```

## 修复顺序和明确验收条件

### R1 / P1：压缩必须实际重建远端会话

涉及 `packages/compaction/compaction-basic/src/index.ts`、`src/summarizer.ts`、`packages/llm/llm-codex/src/adapter.ts`、`packages/llm/llm-gemini/src/antigravity-adapter.ts`。

- 当前本地历史替换为摘要后，Codex 仍沿用旧 thread；Gemini 恢复旧 conversation 并仅发末条用户输入，丢失替换摘要。
- 摘要请求的 `purpose: compaction` 使用父会话 sessionId，而 CLI 缓存未按 purpose 隔离，可能污染正常会话。
- 用已有请求历史替换/代际机制判定远端会话是否失效，不仅按 session/model 复用；摘要辅助调用隔离。重建时真实传入摘要、必要系统约束和保留的消息/工具结果，普通增量续聊仍复用。
- 验收：独立协议探针转绿；增加摘要隔离、连续压缩、溢出后恢复、工具结果完整性和正常续聊不退化的回归。不能仅改本地 token 计数或重新标记 success。

### R2 / P1：急停后必须可从界面恢复

涉及 `PersonalWorkbenchPage.tsx`、`personal-desktop-control.ts`、Main/IPC/preload、Windows-MCP execution/parent bridge。

- 当前 Resume IPC 已有，界面只有 Stop，用户无法恢复。
- 使用原有 Button/locales 增加可用的 Resume 入口，显示真实 paused/generation。恢复后 UI 和 Host 都可提交新动作；急停前队列与过期结果必须继续拒绝，不重播旧动作。
- 同时检查关停路径 await stop/dispose 的静态风险，确认不会误伤其他应用，不把尚未复现的孤儿进程当已发生。
- 验收：独立 Resume UI 探针、execution/personal-control-ipc/personal-desktop-control 回归通过；仅主模型实机验证 Snapshot → Stop → 拒绝旧动作 → Resume → 新 Snapshot，并留下精简证据。正常结束时保持可用状态。

### R3 / P1：路由诊断与真实 Loader 使用同一 patch 语义

涉及 `apps/desktop/src/personal-model-routing.ts`、`personal-diagnostics.ts`、`vendor/include/src/index.ts`。

- 真实 `applyEntryPatches` 的新 config 整体替换旧 config，当前解析器却逐字段合并。
- 真实 Loader 跳过目标不存在的 insert，当前解析器仍递归读取它。
- 复用或严格遵循原生组合逻辑，保留安全解析（不执行 !!js）、未选预设不干扰全局路由、混合提供方和不泄露凭据的边界。
- 验收：以真实 Loader 作 oracle 的两项探针转绿。现有“partial patch 合并”测试固定了错误预期，应按真实契约纠正；不得反改 Loader 来迁就错误解析。

### R4：按用户后续要求移除自定义 API 思考强度

- 手动等级编辑器及其样式、文案已移除；活动 qwen 12 个模型明确为 `reasoningEfforts: false`，该路由主模型强度默认值已删除。其他原生提供方能力保留。
- `.artifacts/remove-api-reasoning-20261020/wire.json` 已用真实 SDK 与 loopback HTTP 验证 12 个模型无 reasoning/thinking 请求字段，不代表远端推理成功。
- 原推理开关功能测试由需求变更后的控件移除测试替代；旧会话重新选中同一个模型可清除旧 effort。不得为了旧验收断言重建已取消的接口。

### R5 / P2：输出上限履约和真实上下文容量

- Gemini API 的 generationConfig 未消费 options.maxTokens，应正确映射 maxOutputTokens 并测试。CLI 适配器若官方协议支持请求输出 cap，应真实传递；不支持则明确能力边界，不能假装已生效。
- 核实 Codex/Gemini/qwen 的 contextWindow/defaultMaxTokens 与上游实际能力。GPT-5.5 目前目录仍 400000/32768；Gemini 2.0 Flash、1.5 Pro 的输出仍 32768。不能为满足表格盲目改为 1M/65536；准确记录例外与未知。
- 验收：输出 cap 协议探针转绿；适配器测试检查实际请求参数。1M–2M 只能在有上游能力证据时标已确认，目录数字不是服务端扩容。

### R6 / P2：动态状态文案与原生风格

- 工作台硬编码“1M 自动压缩”“已启用 85%/20%”，应由实际模型容量和激活压缩服务配置生成，缺失显示未知，不能固定绿色通过。
- 普通 UI 文案进入原有 locales，使用 ui-primitives 与 --dsw-alias-* 主题令牌，遵循现有 JSDoc 和 `.input.selectInput`。仓库扫描的 79 条 i18n 候选需人工分类，技术单位等不要盲改。
- 保留已通过的暗黑主题与个人模式启动行为，复跑相应契约测试。

## 当前外部阻塞必须如实处理

上一轮真实主界面与生产 `/responses` 请求，当前所选 `qwen / xiaomi/mimo-v2.6-pro-ultraspeed / max` 返回 HTTP 400：`Unsupported model: xiaomi/mimo-v2.6-pro-ultraspeed.` 同模型同凭据的隔离 Chat Completions 探针返回 `The product is not activated...`。GET /models 的 178 条列表包含该 ID，不能代替产品激活或成功推理证据。

这些事实以 `.artifacts/final-acceptance-20261020/reasoning-live*.json`、`live-primary.png` 为证。上游状态可能已改变，请依当前真实请求判断。遇到相同外部拒绝，保持用户模型不变，记录阻塞，不无限重试、不自动切协议/账号，也不承诺代码修改能开通云端产品。任何必要模型选择由用户决定。

## 测试、构建与最终交付

- 按影响范围运行指定维度回归、各适配器/compaction/客户端测试和类型检查；六个仍有效的独立断言应通过，并保留新的推理接口移除回归。保留测试命令、退出码、通过/失败/跳过数量。
- 记录构建前后源码与产物新鲜度。不要在正在处理本任务的宿主运行中途覆盖其执行 bundle 或突然杀掉自己；先保存代码、完成离线验证，记录清晰重启检查点，再由主模型执行受控重启或交给外部评审者恢复。不得停止无关 Codex、浏览器或 Antigravity。
- 报告分别列出已修改、已本地验证、真实桌面通过、真实远端通过、尚未验证/外部阻塞。最初 383+54 个测试通过不能替代独立边界验收。
- 新报告保存为 `personal/SELF-REPAIR-RESULT-2026-10-20.md`，证据另存 `.artifacts/self-repair-20261020/`。逐条对应 R1–R6，列文件行号、测试和残余风险；未解决项目保留未通过。最终状态为“待外部复核”，由这里的评审者作最终验收。

收到任务后先确认读取到的仓库、当前主/子模型路由和首个实际复现结果，再开始修复。不要只回复“已完成”。
