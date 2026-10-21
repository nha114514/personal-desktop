# Personal Desktop 优化复核与 Gemini 讨论

日期：2026-10-20。状态：**分析与建议已完成，以下修复尚未实施。**

通过 Windows-MCP 向用户已选的 Antigravity **Gemini 4 Argon High** 发送技术摘要，并追加一次针对性复核。会话标题为 `Personal Desktop Next Round Review`。模型名称取自实际界面；对方基于脱敏摘要提出建议，没有自行检查仓库或执行测试，不能将这次讨论算作独立代码验收。

## 保持的范围

- 保留用户选定的主模型、默认子模型、推理等级、自定义模型、凭据和工作区已有修改。
- Google 仅保留原账号 2 的入口；本轮不恢复账号 1，也不删除 Gemini API 通道。
- 不创建子代理，不增加子代理模块。既有授权子代理规则保持不变，禁止递归委派。
- 桌面控制继续使用 Windows-MCP，仅主模型可以调用。
- 检索保持 MediaCrawler、Better Crawler、yt-dlp、OpenCLI 的统一路由。
- 本轮没有修改产品源码、模型配置或登录数据。新增内容仅为本说明及隔离复现脚本。

## 应先修复的四项问题

### 1. Codex 账号核验可能选错模型

证据：`apps/desktop/src/main.ts:757` 的 `resolveCodexDefaultModel()` 使用正则读取 `agent-default-model` 的 `model`，不检查 `provider`。现有主模型是 `qwen / deepseek-v4.1-flash-1017`，已有默认子模型是 `codex / gpt-5.6-sol`。因此当前取法可能将 DeepSeek 模型名传入 Codex 核验，不能据此判断 Codex 登录失效。

最小修改方向：通过现有配置解析能力读取**生效的配置**，限定 Codex 提供方并绑定用户明确选择的 Codex 模型；没有选择时显示“未验证／需要选择模型”，不悄悄换模型。核验结果绑定提供方、模型、凭据目录和时间。

验收：混合提供方配置、多条补丁覆盖、自定义模型均能正确保留；本地协议测试确认请求实际携带所选 Codex 模型；远端鉴权与额度另行分类验证。

### 2. 桌面急停后的跨端恢复存在锁存问题

证据：`packages/computer-use/computer-use-windows-mcp/src/index.ts:96` 在检测到 `stop.signal` 后将实例内部 `paused` 设为 `true`；另一个实例的 `resume()` 删除文件，不能清除此实例的内存状态。模块级单例也不等于 Electron Main 与 Host 跨进程共用一个 FIFO。

本地复现命令：

```powershell
node .artifacts/optimization-isolated-probe.mjs
```

本次结果：`hostSawStop: true`、`uiResumed: true`、`hostRemainsPaused: true`、`productionStateTouched: false`，退出码 0。这是对当前源码类的**两个隔离实例**复现，不是完整双进程 Electron 验收，也不代表问题已修复。

讨论后收敛：优先由现有 Main 进程拥有唯一执行队列，UI 与 Host 通过现有通信机制提交、取消和读取状态，不额外增加独立 Broker 进程。具体 Host→Main 桥接接口仍需实现前核对。

急停契约：拒绝排队任务，撤销活动任务，推进任务代际标识；恢复只接收新的任务，旧动作和旧结果不得复活。单个原生动作若无法中途撤销，应明确其完成边界，不能把发出 AbortSignal 当作动作已经停止。

验收：真实双进程下 UI 与 Host 的操作串行；急停清空旧队列；恢复后新任务可运行；旧结果被拒绝；任一进程退出不会留下挂起请求。主模型专属权限继续受检。

### 3. 路由诊断可能在没有观测时显示正常

证据：`apps/desktop/src/personal-diagnostics.ts:181` 的 `recordActualRoute()` 在当前检索范围只有定义与测试调用；`checkModelRoutes():480` 默认将 `configuredMatchesActual` 置为 `true`，并在 `:501` 固定返回 `channelType: 'membership-cli'`。当前主模型实际配置为 API 提供方，该固定值不足以描述真实通道。

最小修改方向：将“已配置”“本次请求实际使用”“未知／尚未观测”分开。真实适配器请求事件通过 `requestId/sessionId` 关联主模型、子模型、账号通道、推理等级和失败类别；观察到请求发出不等于推理成功。

验收：未发请求时显示未知；API 不被显示为会员 CLI；主请求和子请求分别记录；模型切换、并发、失败与取消不会串用上一轮记录。

### 4. 个人模式仍请求未注册的升级 IPC

证据：`apps/desktop/src/main.ts:1552` 在个人模式不创建 mandatory policy/UI；`apps/desktop/src/preload-app.ts:154` 在 Windows 仍安装升级 overlay；`preload-mandatory-overlay.ts:70` 请求状态。handler 仅在 `mandatory-update-window.ts:75` 的构造阶段注册。现有 stderr 中确有 `No handler registered for 'dsh-desktop:mandatory-status'`。

最小修改方向：让预加载层和主进程共享功能启用状态；个人模式不安装不适用的 overlay。不能只吞异常，也不能为消除报错而放宽其他模式的升级策略。

验收：个人模式启动无该报错；正常界面不受影响；具有升级策略的模式仍保留原有检查与阻断行为。

## 性能优化：先测量启动路径

`apps/desktop/scripts/dev.ts:123` 在启动 Electron 前无条件调用 `preparePrimaryRuntime()`；其实现默认准备 payload 并运行 smoke 检查。`scripts/primary-runtime/prepare.ts:183` 起执行 Python 导入、Office 相关检查、`pip check`、Node 与 pnpm 检查。

这证明启动前存在检查路径，**尚未证明它占用多少总耗时，也没有实测提速百分比**。本轮没有为了计时反复关闭用户窗口或重启应用。

建议先记录启动入口、准备环境、smoke、Electron 首窗、Host 就绪各阶段耗时，再决定是否复用未变化且已验证的 runtime。缓存应有版本／目标平台／依赖清单等失效依据，保留缺失修复和显式检查入口；避免每次为判断缓存有效又执行一遍全部重检查。

运行期另行记录：发送至请求发出、队列等待、进程初始化、鉴权、首事件、首个可见文本、工具往返、取消完成。界面可及时显示真实阶段，但不能用加载动画冒充流式回复或把服务端等待算作客户端优化收益。

## 建议实施顺序与验收边界

1. 先做较小的个人模式 IPC 修复、核验模型解析修复。
2. 接通真实请求路由与阶段计时，消除“默认正常”和固定通道描述。
3. 收敛桌面执行所有权，验证急停、取消、恢复与过期结果处理。
4. 根据启动分段测量决定缓存改法，再比较修改前后的同条件启动结果。
5. 使用原模型做少量真实桌面代表性验收：一轮主模型对话、一轮授权子任务及结果回收、一轮工具往返和取消、一次重启后凭据复用。额度或地区阻塞应如实记录，不能换模型凑通过。

已有 `.artifacts/single-google-account-tests.json` 的 57/57 与此前 9 项 Node 配置检查、相关构建结果可作为既有证据，本轮没有重跑全套。它们不能替代上述真实远端验收。Antigravity 中的本次讨论也不能证明 Personal Desktop 的远端推理链路已经可用。

第二轮再考虑提示词体积、按需工具上下文、流式渲染与长会话管理；需以实际 token、缓存命中、渲染耗时和会话样本为依据，不先增加新功能或替换模型。
