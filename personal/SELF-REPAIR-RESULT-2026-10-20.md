# Personal Desktop 自修复结果（2026-10-20）

- 最终状态：**待外部复核**
- 仓库：`D:\desktop\personal-desktop`，HEAD `639ed01`
- 执行方式：主模型决策与验收，执行由已授权叶子子代理完成；未使用桌面自动化
- 需求记忆：`CANON.md:28`（2026-10-20 23:51）确认用户已删除自定义 API 手动思考强度接口

## 一、七个失败断言的现行口径

归档为 3 spec / 7 `it` / 7 failed / Exit 1（`.artifacts/final-acceptance-20261020/review-probes.json`）。第 6 条（`probes/reasoning.client.spec.tsx:9`）**已作废**：`personal/SELF-REPAIR-HANDOFF-2026-10-20.md:3,33,75` 取消该方向；`packages/client/ui-settings-models/src/client/ModelReasoningEfforts.tsx` 已不存在（本轮 `Test-Path=False`）；记忆 `CANON.md:28` 同证。

本次只重放 **6 条有效断言**（protocol 5 + resume 1），R4 改用 `model-reasoning-removal.client.spec.tsx` 与 `model-select.client.spec.tsx`。

## 二、基线复现（本轮实跑）

命令（仓库根）：
`node apps\desktop\node_modules\pnpm\bin\pnpm.mjs --dir . exec vitest run apps\desktop\tests\final-review-20261020-protocol.spec.ts packages\client\ui-personal-workbench\tests\final-review-20261020-resume.client.spec.tsx --maxWorkers=1 --reporter=json --outputFile=.artifacts/self-repair-20261020/reproduced-regression.json`

结果：**Exit 1，35327.7058 ms，2 suites / 6 tests / 6 failed**。六条实际观测：Codex 两次均 `remote-thread-1`；Antigravity 仅 `NEW_TURN`；`generationConfig` 为 `undefined`；缺失 insert 目标仍得 `codex`；后到 config 仍为 `provider:'qwen'` 对象；Resume 按钮 `null`。

证据：`reproduced-regression.json`、`reproduced-regression.pretty.json`、`failure-messages.md`（3–377 行）、`vitest-output.txt`/`vitest-output-utf8.txt`、`vitest-timing.txt`、`capability-raw.md`。

## 三、修复后（本轮实跑）

同构造命令输出 `reproduced-after-fix.json`：**Exit 0，6834 ms，6/6 passed，failureMessages 全空**。归档源与副本 SHA256 一致（protocol `3D7B4AF1…C55EA`、resume `3E0F0954…D27A`），跑后删除副本，归档目录未改。

## 四、R1–R6

### R1 压缩后重建远端会话 — 通过（本地）
`llm-codex/src/adapter.ts`：`:106` `initialized`、`:107` `deliveredMessages`、`:222-228` 去 id 快照、`:509` purpose 隔离、`:571-578` 前缀失配清空线程状态、`:604-618` initialize 一次、`:630` **同连接重新 thread/start**、`:692-736` 追加续聊复用、`:738` 更新快照。`llm-gemini/src/antigravity-adapter.ts`：`:69` 缓存 `{id,model,messages}`、`:138` purpose 隔离、`:139-147` 模型+前缀判定否则 full prompt、`:210` 捕获 id、`:291-293` 成功后更新。
新增 `llm-codex/tests/history-replacement.spec.ts`（5 项）与 `llm-gemini/tests/history-replacement.spec.ts`（1 项）。三包回归三次一致：**Exit 0，18 files / 198 passed / 0 failed**。
残余：新增回归无 red→green 对照；未做真实远端调用。

### R2 急停后 Resume — 通过（本地 UI/DOM）
`PersonalWorkbenchPage.tsx`：`:25` epoch 类型、`:53` 既有 resume 桥接、`:96-99` 拒绝旧/无 epoch 快照、`:129-134`/`:202` status/subscribe/stop 同校验、`:207-211` resume 调用既有 IPC 一次、`:267-271` 仅 paused 渲染既有 Button；`locales.ts:42/:91` 新增 `resumeAutomation`（zh 恢复自动操作 / en Resume Automation）。新增 `tests/resume.client.spec.tsx` 5 项：**Exit 0，8 passed，46.25s**。
残余：真实桌面 Snapshot→Stop→Resume（H60 仅主模型）未执行。

### R3 Loader 同语义 — 通过（保守投影）；完整挂载一致性未验收
`apps/desktop/src/personal-model-routing.ts`：删除字段白名单合并与 provider 键并集，改 **config 整体替换**；insert 需命中已索引 group；`src:42-45` 标注保守投影。`personal-model-routing.spec.ts` 纠正原 42/44 错误预期，保留 6 例并新增 3 例：**Exit 0，16/16（routing 9 + diagnostics 7）**。
残余：读取入口只有 patch YAML（`src:101-106`、`main.ts:765-766`、`diagnostics.ts:501`），拿不到真实 base entries 与 layers；base-only insert 保守跳过。断言 #4/#5 转绿≠完整 mounted config 一致。

### R4 移除思考强度 — 通过（移除方向）
组件 `Test-Path=False`，未创建。回归 **Exit 0，2 files / 53 passed（1 + 52）**。活动配置目标 qwen 段：12 模型、12 个 `reasoningEfforts`、非 false=0。
残余：`remove-api-reasoning` loopback 证据属历史，仅证传输层不发该字段。

### R5 输出上限 — 测试通过；typecheck 残留 1 条本次引入，未完全通过
`llm-gemini/src/adapter.ts:138-143`：`options.maxTokens !== undefined` 时写 `generationConfig.maxOutputTokens`；无默认值/不 clamp。`tests/adapter.spec.ts` 新增 5 用例（含 0）：补丁前 **Exit 1，3 failed / 22 passed**；补丁后 **Exit 0，25 passed**。
残余：CLI 不传 cap（未伪造）；catalog 容量无上游证据；**`adapter.spec.ts(45,46) TS2379` 未清**。

### R6 动态状态文案 — 部分通过
`PersonalWorkbenchPage.tsx`：`:242` codex 默认模型改 unknown、`:262` 去掉「上下文: 1M 自动压缩」、`:496-497` 去掉「1,048,576 tokens (1M) · 自动压缩已启用 (85% 阈值 / 20% 保留)」改为本地化标签 + warning 未知；`locales.ts:17-18/:68-69` 新增 `contextCompression`/`contextCompressionUnknown`。新增 `tests/capacity.client.spec.tsx` 4 项，red 先行（4 failed：找不到 `/上下文容量未知/`）→ 工作台 **12 passed**、个人模式与启动契约 **122 passed**（均 Exit 0）。
残余：props 仅 `locale`，`DiagnosticsSnapshot`（`types.ts:169-215`）无容量/压缩字段，已知容量三态无法接入与验证，未伪造输入。

## 五、测试与类型检查汇总

| 范围 | 结果 |
|---|---|
| 六条归档断言（基线） | Exit 1，6/6 failed，35327.7058 ms |
| 六条归档断言（修后） | Exit 0，6/6 passed，6834 ms |
| 三包 R1 | Exit 0，18 files / 198 passed（三次一致） |
| 工作台 R2+R6 | Exit 0，12 passed |
| 路由/诊断 R3 | Exit 0，16 passed |
| R4 回归 | Exit 0，53 passed |
| llm-gemini R5 | Exit 0，25 passed |
| 个人模式/启动 | Exit 0，122 passed |
| `pnpm run typecheck` | **Exit 1，7 条 error TS** |

## 六、类型检查归因

两次独立实测清单一致（17.91 s / 19.25 s），共 7 条：

- `apps/desktop/tests/personal-antigravity.spec.ts(18,80)(31,79)` TS2345 `"1"` 不属于 `PersonalAccountId` —— `??` 用户既有在制品
- `apps/desktop/tests/personal-workbench.spec.ts(213,16)(213,28)(213,43)` TS6133 `ws`/`query`/`limit` —— 同上
- `packages/computer-use/computer-use-windows-mcp/tests/provider.spec.ts(45,11)` TS6133 `p1` —— 同上
- `packages/llm/llm-gemini/tests/adapter.spec.ts(45,46)` TS2379 —— **本次 R5 新增测试引入，未清**

已修：`adapter.ts(573,574)` TS2412（改为 `delete connection.activeThreadId` / `delete connection.activeTurnId`，声明 `:108/109` 可选）；TS6053 随临时探针副本删除消失，`tsconfig.host.json` 无残留。

R5 那条的落地修法：
```ts
function options(extra: Partial<GenerateOptions>): GenerateOptions {
  return { provider: 'gemini', model: '<被测模型>', messages: [], ...extra }
}
// reasoningEffort 用 ReasoningEffortId 合法字面量并 import 该类型；不要传显式 undefined
```

## 七、外部阻塞（未重试、未换模型）

历史：生产 `/responses` 与 Chat Completions 均 HTTP 400，原文 `Unsupported model: xiaomi/mimo-v2.6-pro-ultraspeed.` / `The product is not activated...`；`GET /models` 含 ID 不代表激活。本轮**未发起真实远端请求、未重试、未切协议或账号**，用户所选模型与等级未改。故「真实远端通过」= 0 项；Live 模式 Exit 0 不等于推理成功。

## 八、保护范围

未执行 `reset`/`clean`/覆盖式 `checkout`；12 个 qwen 模型保留且 `reasoningEfforts` 全 false；账号仅槽位 2；未改主/子模型、等级、提供方、地址、凭据；历史证据未改写，新证据在 `.artifacts/self-repair-20261020/`；未删除现有测试（R3 仅纠正错误预期并新增）。

## 九、执行过程问题

1. 锁无强制力：`lock-R1c` 存在时另一执行体仍写入同批文件，最终以文件回读+实跑+SHA256 判定，未采信自述。
2. 同一路由执行权限随机：多个会话成功执行，另有多个在执行前自我停止；末段 `codex` 路由连极简探针亦中断，临时改用已授权 `gemini-2` 取证，未改用户模型配置。
3. 并发双写导致源码归属不可归因（两个 llm 包 untracked，`git diff` 无基准）。
4. R1 新增回归缺 red 对照。

## 十、交付结论

- 本地已验证：R1、R2（UI/DOM）、R3（保守投影范围）、R4（移除方向）、R5（测试层）
- 部分通过：R6（虚标已消除、未知态落地；已知容量路径未验证）；R5 的 typecheck 项（1 条 TS2379 未清）
- 未验证：真实桌面 Snapshot→Stop→Resume、真实远端推理、构建/打包与 GUI 实机
- 外部阻塞：HTTP 400（未重试、未换模型），需用户决定必要的模型选择

最终状态：**待外部复核**。
