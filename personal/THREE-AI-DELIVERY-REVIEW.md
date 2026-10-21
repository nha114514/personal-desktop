# 三份 AI 交付：独立整合复核

日期：2026-10-05。结论：**partial，不能按三份报告直接标为整体已验收**。账号/爬虫基础返工有所改善，YouTube 共享检索真实可用，Windows-MCP 宿主也可用；工作台、模型侧桌面控制、诊断和真实 AI 验收还有明确缺陷。

有效需求和交付范围先整合于 `personal/PERSONAL-DESKTOP-INTEGRATED-CONTEXT.md`，并记录到 requirement-memory。此次未改产品源码、用户模型选择或凭据，保留所有原有修改。新增的是复核文档与独立检查脚本；启动了现有桌面。

## 本次实际通过的检查

| 检查 | 本次结果 | 能说明的范围 |
| --- | --- | --- |
| 原联合回归再加新工作台/桌面/记忆/诊断/检索测试 | 129/129 passed，0 failed，0 pending；命令真实 Exit 0 | 本地测试通过，之前联合测试异常退出本次未复现 |
| desktop host、ui-personal-workbench、web-crawlers、computer-use-windows-mcp 四项 `tsc -p --noEmit` | 全部 Exit 0 | 四个编译面的类型检查；不表述为本次全仓库构建通过 |
| 保存 Cookie + 空输出 Exit 0 登录 worker | saved → saved | 此具体假验证问题已改善，不能沿用旧的误标 verified 结论 |
| 外部报告导入 | verified: false，pending-acceptance | 导入入口没有直接把外部声明验收通过 |
| 新建连接运行现有 personal-crawlers MCP | initialize、tools/list、真实 tools/call 成功 | 同一共享服务端可运行；当前聊天原连接出现 Transport closed，不能据此推断整个服务端坏了 |
| YouTube 搜索 | 返回两条真实视频链接 | 共享 web_search 的实际检索 |
| YouTube 有字幕读取 | HTTP 200，6398 字符，保留时间戳 | [tPx6bCDa5GE](https://www.youtube.com/watch?v=tPx6bCDa5GE) 的真实字幕正文 |
| YouTube 无字幕读取 | HTTP 200，明确 No subtitles or captions 提示 | [HK6y8DAPN_0](https://www.youtube.com/watch?v=HK6y8DAPN_0) 的真实无字幕案例 |
| Windows-MCP 独立只读探针 | 握手、20 个工具、Snapshot 返回 3510 字符，非错误 | 公共宿主工具真实可用；没有执行鼠标键盘操作，也不代表模型侧输入互斥已完成 |
| 安装版本核对 | windows-mcp 包 0.8.7，FastMCP/握手 serverInfo 4.0.10 | 4.0.10 是 MCP 框架/服务报告版本；不能把硬编码的 4.0.11 当作实际 Windows-MCP 软件版本 |
| 实际桌面只读状态 | Personal Desktop 已加载；主会话显示 GPT-6.1-Sol ultra；9 平台入口存在 | 实际页面状态；保留用户当前选定档位 |

复跑命令及结果：`.artifacts/three-ai-review-tests.json`；真实检索：`three-ai-review-retrieval.json`；Windows：`three-ai-review-windows.json`；实际页面：`three-ai-review-live.json`。

## 必须返工的发现

### R1 / P1：X 搜索词被 Windows shell 当作命令

`packages/web/web-crawlers/runtime/crawler.py:358` 附近将模型提供的 query 放入参数列表，再以 `subprocess.run(..., shell=True)` 调用 opencli.cmd。Windows 下列表参数仍会被转换为 shell 命令；查询中的 `&`、重定向等可成为控制符。

独立探针把 OpenCLI 替换为临时目录中的无害假命令，不连接 X。仅输入带控制符的查询即在该临时目录生成预期标记文件，结果 `queryInterpretedAsCommand: true`。证明这是真实参数处理缺陷，不是推测。仓库与全局 worker 的 SHA256 相同，两处都涉及。

修复要求：使用 Node 执行已安装 OpenCLI 的真实 JS 入口或其他明确不经过 shell 的入口，以独立 argv 传参。不要仅靠黑名单删除几个符号。保留读取命令白名单和原配置。证据：`.artifacts/three-ai-review-x-shell.py` / `.json`。

### R2 / P1：AI 桌面工具没有接入界面的输入队列和停止按钮

`packages/computer-use/computer-use-windows-mcp/src/index.ts:127` 的 guard 对输入工具只返回 undefined。`runExclusive()` 没有被调用；ToolGuard 的类型仅支持同步拒绝或放行，不能因此排队。

该插件直接创建另一个 McpClient 进程。`apps/desktop/src/main.ts:897` 另外创建 UI 用的 PersonalDesktopControl；其 stop() 仅终止自身进程与队列。两者没有共享控制器。因此模型通过 `mcp__windows-mcp__*` 调用的输入既不受此 UI 队列控制，也不会因用户点击该停止按钮而停下。

修复要求：复用同一个宿主执行入口、队列和停止/恢复状态，通过仓库现有 around-dispatch 等支持异步的扩展落实。覆盖会改变焦点或全局输入的实际动作；停止须拒绝待执行任务并阻止新动作。用假 MCP 实际并发调用验证，而不是只测插件名称和 Config。

### R3 / P1：CLI 适配器丢弃截图，Electron 自身截图又替代了桌面失败

Gemini 会员 CLI 与 Codex 的 prompt formatter 都只保留 text。Gemini 最后提交 `message.content: promptText`；Codex `turn/start` 只提交 text input。即便模型目录声明 image 支持、通用 MCP 桥已保存图像，这些 CLI 请求也没有传递实际图像。

本地格式化探针保留了文字，但图像引用在两个结果中均消失。不能因此声称子模型已经看见截图。证据：`three-ai-review-probes.json` 最后一项；源码 `packages/llm/llm-gemini/src/prompt.ts`、`antigravity-adapter.ts:353`、`packages/llm/llm-codex/src/adapter.ts:630` 与 `:647`。

另一个问题：主进程的 `captureWindowScreenshot` 固定使用 mainWindow.webContents.capturePage()。`personal-desktop-control.ts` 把它替换到 Screenshot 的失败结果并清掉错误。这是 Personal Desktop 自身页面截图，不能代替外部编辑器、浏览器或整个 Windows 桌面的截图。

修复要求：按官方 CLI 实际支持的协议传图；确实不支持则明确给出能力限制，不能丢图后继续声称视觉任务成功。按目标窗口标注截图来源/范围，Electron 页面截图单独保存，保留桌面截图失败。用临时图像中的随机可见内容验证所选子模型真正收到图像。

### R4 / P1：诊断数据固定，和实际页面相矛盾

`apps/desktop/src/personal-diagnostics.ts:353` 无条件返回 gpt-6.1-sol/low、固定子模型列表、membership-cli 及 configuredMatchesActual: true。没有读取真实配置或实际请求路线。当前真实桌面会话显示 ultra，诊断仍返回 low 和“匹配”。

账号检查把历史 checkedAt 文件视为当下 verified；没有接入最近失败、429 或认证事件。当前账号页 Gemini 两槽 saved、Codex idle，诊断却将三者全部标 verified。本地假凭据文件和 2020 年时间戳也被标 verified。

依赖版本与“stdio 就绪、20 工具”同样由文件存在及固定文案得出。运行阶段只有手动 setLiveStage() 的 IPC，没有模型/工具/子任务事件接线；staleness 只比较磁盘时间，不能证明运行进程加载版本。

修复要求：展示配置选择与真实请求分别取得的数据；未测项显示未知。复用现有账号解析和运行事件，记录最近实际验证，保留 saved 状态，额度不足不要求重登。运行版本以真实构建标识和已加载进程为依据。

### R5 / P1：工作台能够把失败/未验证证据标成已验收，且尚未连接真实任务

`personal-workbench.ts:380` 只依据调用者的 judgment: passed 将任务改为 accepted，不检查 exitCode、failedItems 或 unverifiedItems。独立探针传入 Exit 1、失败项和未验证项，同时 judgment: passed，仍得到 accepted。

updateTask() 也接受整个 Partial<ProjectTask> 覆盖，缺少允许的状态转换与字段校验。不能把一个 phase 字符串列表称为有严格状态流转的状态机。

工作台目前是 Electron 侧手动记录服务；ProjectTask 没有真实 sessionId / 子任务 / 调用证据关联，UI 插件的 Host apply() 为空。项目记忆面板存在，但未见新任务/续作自动检索和向主/子模型传递该面板规则的接线。不能以直接 IPC 创建记录证明真实 AI 工程流已经接入。

修复要求：沿用现有会话和子任务系统连接任务、资料、规则及证据。外部声明、证据记录和最终验收判断分开；存在失败或必要未验证项时不得自动 accepted。明确保留用户人工确认入口和有证据的主模型判定，不造第二套 agent runtime。

### R6 / P1：记忆撤销错误目标，空查询仍返回已撤销记录

`personal-memory.ts:230` 在目标 ID 不存在或无效时回退撤销文件里最后一条有效记录。独立探针调用 `revokeEntry(..., 'CANON.md:nonexistent')` 返回 true，并误撤销另一条要求。

`search()` 的空查询分支没有过滤 revoked；再次检索又返回被撤销条目。还需限制条目 ID 的文件部分为允许的账本名，不能任意 join() 外部路径。核心修复必须阻止错误 ID 修改其他记录，并按已有 requirement-memory 的优先级和撤销语义工作。

此次整合额外发现测试污染：正式 CANON 中有三条仍有效的测试生成“Personal Workbench and Desktop Control acceptance verified”。已仅将这三条精确来源匹配的测试数据标为 REVOKED:CONFIRMED，保留历史，真实用户要求未改。原验收脚本后续必须使用临时项目与独立 dataRoot。

### R7 / P1：代码技能和独立叶子复核证据是固定脚本数据

`personal/verify-code-skills-workflow.mjs` 直接写入源码/测试再执行 npm/git，未加载所列 Skill，也没有调用所列主模型或子模型。leaf-coder-1、leaf-reviewer-2、delegatedChildren: 0 和 approved 都是固定数据。

桌面 25 项验收脚本还直接把 leaf-verifier-alpha / leaf-reviewer-beta 写入 recordEvidence。这种宿主脚本练习可以作为本地测试，但不能当作真实两个独立 AI 的派发/执行/复核。数据已经落入真实工作台记录，必须核对重分类，不能再冒充已真实验收。

修复要求：保留脚本的真实测试价值并明确标为 fixture/mock；真实验收另行通过用户所选主模型派发授权子模型，取实际会话、工具、技能、文件与独立复核证据。额度阻塞则保留未完成，不捏造通过。

### R8 / P2：Codex 重新验证仍可能偏离当前模型/账号

检测与 loginCodex 子进程现已共用 resolvedCodexHome；这是源码中实际改善。但 Launch.ps1:46 默认设置 DSH_PERSONAL_CODEX_MODEL=gpt-6.1-sol，main.ts:756 又优先采用该环境值，并仅在启动时用正则读取默认模型。

因此从标准启动器启动后，后续用户选择的 gpt-6-astra、其他会话模型或更改的默认模型不会自动绑定到“重新验证”。传入 model 的局部单测不等于 UI 当前选择已接线。还需统一账号页、诊断与真实 Codex LLM 子进程的 home 解析；当前账号页和诊断页的 Codex 状态已不一致。

修复要求：从现有活动配置/当前任务取得实际 provider/model/effort/home，登录/验证时取新快照；只在用户没有选择时使用默认值。选择 Astra 后必须检查请求模型确实 Astra，不能用 Sol 的成功为其背书。

### R9 / P2：字幕下载失败被误报无字幕，MCP 错误丢失具体分类

YouTube 字幕提取捕获任意异常后直接返回空列表，youtube_fetch 再输出“无字幕”。独立探针提供明确存在的人工字幕元数据并制造字幕下载超时，仍返回 HTTP 200 且声称没有字幕。

X 全局 CLI 本次正确返回 WEB_EXTENSION_NOT_CONNECTED；但新的共享 MCP 连接对同一调用只返回泛化的 Error executing tool web_search，缺少用户需要的桥接/登录步骤。错误分类不能仅出现在 stderr 或 CLI traceback。

修复要求：区分确实无字幕、获取超时、解析失败、受限；向 MCP 消费者返回已脱敏的结构化错误码和操作提示。避免 SDK 默认异常遮蔽已知业务错误。

## 仍未验收的内容

- X 浏览器桥接本次仍未连接；登录后搜索、帖子、串帖和长文未真实复核。
- 新功能的真实用户发送 → 当前所选主模型 → 授权叶子子模型 → 工具 → 主模型收回证据，没有在本轮重新执行。交付报告称此前受 Google 429 阻塞；本轮未重新调用远端模型，不能把该额度状态当作已确认的当前状态。
- 真实 AI 桌面观察/操作/保存随机内容/重新观察，与截图实际传给模型的闭环未通过。
- 真实 AI 加载代码 Skill、实现/调试/测试、另一个真实授权叶子独立复核未通过；固定脚本不能替代。
- 超长会话、重启后远端凭据续期和所有国内平台真实登录仍不能由本次局部检查证明。
- UI 大量固定中文文案和宽泛 any/空 catch 等需要按原仓库 locale、类型和生命周期规范复核；类型通过不代表全部仓库规范门禁通过。

## 交给执行 AI

执行范围、修复顺序及验收要求见 `personal/THREE-AI-DELIVERY-REPAIR-HANDOFF.md`。修复后重新复核上述具体路径；避免把 129 个已有测试再次通过当作新增缺陷已经解决。
