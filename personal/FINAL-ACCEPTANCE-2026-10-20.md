# Personal Desktop 最终复核：整体未通过验收

复核日期：2026-10-20。范围为用户指定的 8 个维度、当前未提交工作树，以及 `D:\desktop\personal-data\home\profiles\desktop\cordis.patch.yml`。本报告依据重新执行的测试、源码、真实 HTTP 请求和 Windows-MCP 界面操作，不采用两份交付自评作为通过证据。第 1–3 项包含我此前参与的实现，本报告同样列出其中的缺陷；这不是另一位完全未参与实现者的交叉审计。

**结论：2 项通过，6 项未通过完整验收。**“未通过”不表示该项所有功能都不存在；下文分别列出已经通过和仍不满足的部分。本轮不修改产品实现、现有模型或账号配置。

## 一、八项结论与证据

| 维度 | 结果 | 已核实事实、证据路径 | 残余问题与风险 |
| --- | --- | --- | --- |
| 1. 权威队列与 Stop/Resume | **未通过** | UI 和 Host 均调用 Main 中的同一 `PersonalDesktopControl`；队列、取消及旧代际拒绝的指定测试 **13/13** 通过，含相邻桥接测试共 **20/20**。源码见 [main.ts:477](D:/desktop/personal-desktop/apps/desktop/src/main.ts:477)、[personal-desktop-control.ts:265](D:/desktop/personal-desktop/apps/desktop/src/personal-desktop-control.ts:265)、[execution.ts:127](D:/desktop/personal-desktop/packages/computer-use/computer-use-windows-mcp/src/execution.ts:127)。真实界面快照调用成功、急停后连接断开。 | **界面没有 Resume 入口**，停止后无法从该控制台继续操作；独立 UI 探针失败。后台 Resume IPC 已有，不能代替用户可用的恢复操作。真实“模型发起→Host→Windows-MCP”成功调用受当前主模型接口拒绝阻断，本轮没有宣称通过。 |
| 2. 个人模式升级 IPC、启动计时与缓存 | **通过** | 指定测试 **144/144**；[preload-app.ts:16](D:/desktop/personal-desktop/apps/desktop/src/preload-app.ts:16) 在个人模式跳过 mandatory overlay。真实退出并重新启动后无该未注册 IPC 报错。新启动日志记录 `preLaunchTotalMs=162.02`、运行时检查 `6.12ms`，Electron Node 探测、开发项目和 runtime/smoke 均命中缓存。见 [startup-timings.txt](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/startup-timings.txt)。 | 这是本次 **warm prelaunch** 单次测量，不是完整冷启动、首屏绘制或模型首字耗时；不能宣传“桌面 162ms 完全启动”。 |
| 3. 模型路由一致性与请求计时 | **未通过** | 指定测试 **13/13**，相邻观测/模型选择测试另 **6/6**。实机请求明确记录 `qwen/xiaomi/mimo-v2.6-pro-ultraspeed`、`api-direct`，首事件约 `4354ms`、结束约 `4355ms`，无首段文字并显示 `INVALID_REQUEST`。见 [diagnostics-after.png](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/diagnostics-after.png)、[personal-observations.ts:20](D:/desktop/personal-desktop/apps/desktop-host/src/personal-observations.ts:20)。未发现本轮自动改写所选模型。 | **配置解析另写了一套与 Loader 不同的 patch 算法**：错误合并后续 `config`，也会读取实际应因目标不存在而跳过的 `insert`。独立探针两项失败。这会影响诊断和 Codex 核验模型的准确性。 |
| 4. 自定义模型推理等级 | **未通过完整验收** | 编辑器真实显示 7 个等级胶囊及总开关：[model-effort-editor.png](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/model-effort-editor.png)。指定测试 **29/29**。12 个 qwen 模型均保存了 6 档映射；`minimal` 可在编辑器启用，当前配置未启用。实际 SDK 经本地 HTTP 服务发送 **72/72** 组不同 effort，证明客户端确有参数传递，见 [reasoning-wire.json](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/reasoning-wire.json)。 | **关闭总开关时删除字段，实际会恢复目录继承**，不能保证关闭推理；独立探针失败。更关键的是远端未验证各模型的真实等级能力：当前选中模型实际被 `/responses` 拒绝，详见下节。不能把胶囊或请求成功当成全部真实强度已验证。 |
| 5. 原生暗黑主题 | **通过** | 工作台 CSS 使用已定义主题令牌，无所述 `--dsh-color-*` 或亮色字面量回退。样式/组件指定测试 **8/8**。真实深色界面的卡片、文字和表单已检查，见 [diagnostics.png](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/diagnostics.png)、[desktop-control-restarted.png](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/desktop-control-restarted.png)、[PersonalWorkbenchPage.module.css:13](D:/desktop/personal-desktop/packages/client/ui-personal-workbench/src/client/PersonalWorkbenchPage.module.css:13)。 | 本轮没有覆盖所有 DPI、Windows 高对比度及辅助技术组合，不声称完成这些额外验收。 |
| 6. 原语、下拉框和代码规范 | **未通过** | `ModelReasoningEfforts` 使用 `Pill`/`Switch` 且有组件 JSDoc；工作台使用 `Button`/`Pill`/`Tag`，下拉框使用 `.input.selectInput`；相关样式测试通过。 | 工作台仍有大量固定界面文案和固定状态。复用仓库现有 i18n 检查器，工作台报告 **79 条候选**，两个模型组件为 0；明确中文固定句已人工确认，未把所有技术单位候选都算成独立缺陷。见 [style-review.json](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/style-review.json)、[PersonalWorkbenchPage.tsx:245](D:/desktop/personal-desktop/packages/client/ui-personal-workbench/src/client/PersonalWorkbenchPage.tsx:245)。`ModelRow` 的两个原生图标按钮是沿用代码，未当作本次新引入问题归责。 |
| 7. 自动上下文压缩 | **未通过** | 模板与活动个人预设中确有 `auto:true`、85%、32768 headroom、20% 保留及 2 次 overflow 恢复配置。压缩包 **151/151**，指定 Codex/Gemini 适配器测试 **12/12** 通过。[compaction-basic/index.ts:158](D:/desktop/personal-desktop/packages/compaction/compaction-basic/src/index.ts:158) 和 [index.ts:190](D:/desktop/personal-desktop/packages/compaction/compaction-basic/src/index.ts:190) 有 pressure/overflow 钩子。 | **CLI 远端会话没有跟随本地压缩失效/重建**。Codex 仍用旧 thread；Gemini 仍用旧 conversation，甚至只发送末条用户输入而丢掉替换摘要。两个协议探针均失败。统计钩子打通，不等于三套适配器的压缩闭环全部打通。 |
| 8. 1M–2M 上下文与 65536 输出 | **未通过** | 大多数目录值和 qwen 的全部 12 条配置确实返回 1M/2M、65536 元数据；通过真实编辑器与本地 SDK 元数据核对。安全配置快照见 [source-profile-snapshot.json](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/source-profile-snapshot.json)。 | **存在明确例外**：GPT-5.5 仍为 400000/32768；Gemini 2.0 Flash 和 1.5 Pro 的输出仍为 32768。Gemini API 不传 `maxOutputTokens`，Codex/Antigravity CLI 也未消费请求的 `maxTokens`。真实 1M–2M 服务端容量未验证；改目录数字不扩容服务端。工作台还把“1M 自动压缩已启用”写死显示。 |

## 二、推理强度是真实现还是虚标

**客户端确实实现了选择与传参；服务端真实能力没有完成验收。当前证据不足以认定全部是真强度，也不能一概称为纯 UI 假按钮。**

核验链路如下：

1. [ModelReasoningEfforts.tsx:10](D:/desktop/personal-desktop/packages/client/ui-settings-models/src/client/ModelReasoningEfforts.tsx:10) 提供 `off/minimal/low/medium/high/xhigh/max`；这些胶囊编辑模型的“允许等级声明”。主界面选择器再选择单次请求等级。
2. [llm-pi-ai/adapter.ts:344](D:/desktop/personal-desktop/packages/llm/llm-pi-ai/src/adapter.ts:344) 解析选择并送入实际 SDK。针对当前 12 个模型，本地 HTTP 捕获确认实际请求发送 `reasoning.effort=none/low/medium/high/xhigh/max`；不是仅改变界面文案。
3. 这些模型统一声明六档，并没有因此自动获得供应商六档能力。`GET /models` 实际 HTTP 200，返回 178 个条目，当前 12 个 ID 都在列表中，但未提供本轮要求的上下文/输出容量数据。见 [catalog-live.json](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/catalog-live.json)。
4. 使用当前账号、当前所选 `xiaomi/mimo-v2.6-pro-ultraspeed`，生产协议 `/responses` 的 Max、Low、Off 短请求均实际 HTTP 400。已保留明确报错：`Unsupported model: xiaomi/mimo-v2.6-pro-ultraspeed.` 真实桌面发送同样失败。见 [reasoning-live.json](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/reasoning-live.json)、[reasoning-live-max-low.json](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/reasoning-live-max-low.json)、[live-primary.png](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/live-primary.png)。
5. 另做不修改生产配置的 Chat Completions 兼容性探针，仍使用同一模型与凭据；Max 与 Off 均 HTTP 400，报 `The product is not activated...`。见 [reasoning-live-completions.json](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/reasoning-live-completions.json)。这说明还存在协议/产品开通问题，不能归因成“Max 档本身不支持”，也不能当成强度已验证。

因此，**当前模型的 Max 只能算“已配置、已发送”，不能算“服务端已执行”**。其余模型未逐个发起付费远端推理，不虚报为已验证；本地 72 组传输测试不冒充远端测试。真实探针的测试进程 Exit 0 只表示探针正常记录完成，JSON 中 HTTP 400/`finishKind:error` 才是推理结果。

返工应为每个模型分别核实协议、实际授权以及供应商接受的等级/预算，保存 `configured`、`transport-verified`、`provider-verified` 的区分；不支持的等级应明确提示，禁止暗中降档或换模型。返回 200、回答更长、等待更久，或有少量 reasoning tokens，都不能单独证明所有档位真实不同或达到了最高档。

## 三、可复现缺陷与返工优先级

### P1：压缩没有清理远端历史

- Codex 在 [adapter.ts:512](D:/desktop/personal-desktop/packages/llm/llm-codex/src/adapter.ts:512) 仅依据 session/model 复用连接，在 [adapter.ts:688](D:/desktop/personal-desktop/packages/llm/llm-codex/src/adapter.ts:688) 继续原线程。独立 fixture 将旧历史替换为摘要后，第二次请求仍为 `remote-thread-1`。旧远端上下文未被删除，反复本地压缩不能据此保证恢复超窗。
- Antigravity 在 [antigravity-adapter.ts:138](D:/desktop/personal-desktop/packages/llm/llm-gemini/src/antigravity-adapter.ts:138) 直接恢复原会话，调用 `formatLatestTurn`；探针第二次实际收到的 prompt 只有 `NEW_TURN`，缺失 `REPLACEMENT_SUMMARY`。
- [summarizer.ts:159](D:/desktop/personal-desktop/packages/compaction/compaction-basic/src/summarizer.ts:159) 的辅助摘要还使用原 `sessionId` 与 `purpose:compaction`，两个 CLI 缓存都没有按 purpose 隔离。修复需让辅助摘要调用隔离，并以请求历史替换/代际变化决定重建远端会话，验证重建时工具调用结果仍完整。
- 证据：[probes/protocol.spec.ts:28](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/probes/protocol.spec.ts:28)、[review-probes.json](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/review-probes.json)。这是本地真实子进程协议 fixture，不冒充已发送 1M tokens 的线上测试。

### P1：急停之后没有用户恢复入口

- [PersonalWorkbenchPage.tsx:191](D:/desktop/personal-desktop/packages/client/ui-personal-workbench/src/client/PersonalWorkbenchPage.tsx:191) 仅调用 stop，桌面控制页 [第 614 行](D:/desktop/personal-desktop/packages/client/ui-personal-workbench/src/client/PersonalWorkbenchPage.tsx:614) 仍只显示 Stop。
- 后台 [preload-app.ts:92](D:/desktop/personal-desktop/apps/desktop/src/preload-app.ts:92) 与 [main.ts:958](D:/desktop/personal-desktop/apps/desktop/src/main.ts:958) 已暴露 Resume，界面未调用。应显示 paused/generation 并提供恢复按钮，恢复后验证 UI 和 Host 两侧的新动作，不允许恢复旧队列。
- 证据：[desktop-control-stopped.txt](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/desktop-control-stopped.txt)、[probes/resume.client.spec.tsx](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/probes/resume.client.spec.tsx)。本轮通过正常退出重启恢复可用，并真实再次调用 Snapshot；应用现保持运行，未留在急停状态。
- 额外静态风险：[main.ts:939](D:/desktop/personal-desktop/apps/desktop/src/main.ts:939) 的 will-quit 异步 stop 未被等待，[main.ts:1517](D:/desktop/personal-desktop/apps/desktop/src/main.ts:1517) 的关停 Promise 未包含控制器 dispose。本轮未实测出孤儿进程，不能将这个风险描述为已复现事故。

### P1：路由解析和真实 Loader 语义不一致

- 真正的 [applyEntryPatches:120](D:/desktop/personal-desktop/vendor/include/src/index.ts:120) 用新 `config` 整体替换旧值；[personal-model-routing.ts:68](D:/desktop/personal-desktop/apps/desktop/src/personal-model-routing.ts:68) 却逐字段保留旧 provider/effort，可能构造实际未挂载的混合路由。
- Loader 在 [include/index.ts:81](D:/desktop/personal-desktop/vendor/include/src/index.ts:81) 跳过目标不存在的 insert；当前诊断解析器 [第 75 行](D:/desktop/personal-desktop/apps/desktop/src/personal-model-routing.ts:75) 直接递归它。
- 两个复现均以仓库真实 `applyEntryPatches` 为对照。应复用原生 patch 组合能力，并保留不执行 `!!js`、不返回凭据和不把未选择预设视作全局选择的限制。现有“partial patch 合并通过”单元测试本身固定了错误预期，也需调整。
- 证据：[probes/protocol.spec.ts:105](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/probes/protocol.spec.ts:105)。本次完整字面量活动配置的所选模型读数相符，但不能推广为任意 patch 一致。

### P2：推理关闭语义与输出上限

- [ModelReasoningEfforts.tsx:70](D:/desktop/personal-desktop/packages/client/ui-settings-models/src/client/ModelReasoningEfforts.tsx:70) 关闭时删除字段；[catalog.ts:709](D:/desktop/personal-desktop/packages/llm/llm-pi-ai/src/catalog.ts:709) 将缺失解释为继承。对原生 reasoning 模型应写 `reasoningEfforts:false`，而不是显示关、运行时仍继承。证据：[probes/reasoning.client.spec.tsx](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/probes/reasoning.client.spec.tsx)。
- [Gemini adapter.ts:139](D:/desktop/personal-desktop/packages/llm/llm-gemini/src/adapter.ts:139) 只构造 thinking budget，未消费 `options.maxTokens`；探针传入 1234，实际请求无 `maxOutputTokens`。Codex/Antigravity CLI 的 stream 同样未消费该字段。不能用目录里的 `defaultMaxTokens` 代替实际 cap 履约。
- [Codex catalog.ts:122](D:/desktop/personal-desktop/packages/llm/llm-codex/src/catalog.ts:122)、[Gemini catalog.ts:159](D:/desktop/personal-desktop/packages/llm/llm-gemini/src/catalog.ts:159)、[第 167 行](D:/desktop/personal-desktop/packages/llm/llm-gemini/src/catalog.ts:167) 保留了与“全部 1M/65536”不同的值。不要为满足表格而盲目扩大；应以实际上游能力为准记录例外。

### P2：固定能力文案与原生代码规范

- [PersonalWorkbenchPage.tsx:248](D:/desktop/personal-desktop/packages/client/ui-personal-workbench/src/client/PersonalWorkbenchPage.tsx:248) 固定 `1M 自动压缩`；[第 478 行](D:/desktop/personal-desktop/packages/client/ui-personal-workbench/src/client/PersonalWorkbenchPage.tsx:478) 固定绿色“自动压缩已启用 85%/20%”。它们不读取实际模型容量/压缩服务状态，对 2M 或不支持模型会误导。
- 应从有效运行时数据生成文案，未获取时显示未知；普通界面文案进入现有 locales。模型编辑器和工作台的原语/下拉框/JSDoc 已有改善，不需要再造一套组件系统。

## 四、本轮执行证据与复现

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 用户指定测试路径 + 相邻桥接、观测、模型核验测试 | 22 个文件，383 passed，0 failed，0 pending；Exit 0 | [vitest.json](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/vitest.json) |
| pi-ai 适配器与 12 模型 HTTP 传输补充 | 2 个文件，54 passed；其中 1 项测试内捕获 72 个 loopback 请求；Exit 0 | [reasoning-tests.json](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/reasoning-tests.json) |
| 新增独立边界验收探针 | 3 个文件，7 failed；Exit 1。不是环境失败或跳过 | [review-probes.json](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/review-probes.json) |
| 局部 TypeScript build check | 桌面 Host、desktop-host、workbench、model settings、Windows-MCP、compaction-basic、Codex、Gemini、pi-ai 共 9 个程序；Exit 0 | [typecheck.log](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/typecheck.log)、[test-summary.json](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/test-summary.json) |
| 仓库原有 UI i18n 规则的定向扫描 | Exit 1，工作台 79 条候选；两个模型组件 0 | [style-review.json](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/style-review.json) |
| 当前 API 模型实际请求 | 主界面和直接生产协议都 HTTP 400；替代协议隔离测试也 HTTP 400 | 上文远端 JSON、实机 PNG；不计作推理通过 |
| 实机启动、暗黑主题、UI Snapshot、急停 | 由 root 使用 Windows-MCP 操作；成功连接 20 工具，停止断开，重启后再次成功 Snapshot | [desktop-control-restarted.png](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/desktop-control-restarted.png) 等 |

所有 Vitest 都从仓库根目录，通过用户指定的 `apps\desktop\node_modules\pnpm\bin\pnpm.mjs` 执行；使用 `--maxWorkers=1` 避免 Windows 进程 fixture 争用。这不是整个仓库所有测试/覆盖率/发布检查均已通过的声明。完整命令对应测试路径在原始 JSON 中；汇总见 `test-summary.json`。

新增复现用例已归档到 `.artifacts/final-acceptance-20261020/probes/`，默认测试目录中不保留会故意失败的临时文件。可在仓库根目录重放：

```powershell
# 预期 Exit 1：重现本报告的七个失败。完成后自动移除本次临时生成的测试文件。
powershell -NoProfile -ExecutionPolicy Bypass -File .artifacts\final-acceptance-20261020\Run-ReviewProbes.ps1 -Mode Regression

# 仅本地 72 组 HTTP 请求，不使用真实 API Key。
powershell -NoProfile -ExecutionPolicy Bypass -File .artifacts\final-acceptance-20261020\Run-ReviewProbes.ps1 -Mode Wire
```

`Live` / `LiveCompletions` 模式会实际调用当前配置的远端 API，只有显式选择这些模式才运行；默认 Regression 无远端推理。探针不输出或持久化密钥、授权码、Cookie、请求正文或模型回答原文。UI 证据已裁剪/过滤为 Personal Desktop，其他应用内容不用于验收。

## 五、保护范围和最终建议

活动配置 SHA256 在本轮操作前后保持 `5dcfcd909a3e054e0f1f841d7391c04d0d5b9d1bed0366bfeb218c64b1664d3d`。12 个新模型保留，所选主模型仍为 qwen/MiMo/Max，默认 Codex 子模型、Google 账号 2、既有委派限制和凭据均未修改。25 个指定源码/产物指纹未被本轮评审改写，见 [source-freshness.json](D:/desktop/personal-desktop/.artifacts/final-acceptance-20261020/source-freshness.json)。为了真实发送，新建了验收短测会话并关联本仓库工作区；没有派生子智能体。应用现已重启并运行，桌面控制已恢复可用。

先修远端会话压缩、急停恢复和 Loader 路由一致性；同时解决当前模型接口/产品开通问题，再做真实最低/最高推理档位验收。最后修推理关闭语义、实际输出 cap 和动态能力展示。修复后以这些失败探针转绿，以及当前选定模型在真实桌面成功完成请求为验收依据；不要靠改标签、扩大目录数字或换模型凑通过。
