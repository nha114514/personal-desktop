# 自修复交付独立复核（2026-10-21）

结论：**未达到最终验收通过**。原报告的 6 条有效断言本次重跑全部通过，但新增边界测试复现 Codex 旧线程污染；运行产物仍未包含工作台及适配器的自修复；全仓库类型检查仍失败。此次没有擅自修改这些自修复实现或切换用户模型。

复核对象：`personal/SELF-REPAIR-RESULT-2026-10-20.md` 与当前仓库、真实桌面。证据：`.artifacts/subagent-policy-20261021/`。该目录中的协议测试均为本地进程/协议夹具，不代表真实远端推理。

## 发现 1 — P1：压缩后新建线程，旧线程消息仍会进入新回答

**未通过。** `packages/llm/llm-codex/src/adapter.ts:572` 在历史不再匹配时清除本地 `activeThreadId`、`activeTurnId`、待处理工具调用，再通过同一进程创建新线程。然而 `:245` 使用当前队列，`:325` 接收所有 `item/agentMessage/delta`，没有验证通知所属 thread/turn；`:361` 的完成消息和 `:248` 的工具调用也缺少相应归属校验。

独立探针先完成线程 1，再以压缩后的历史启动线程 2；线程 2 生成时插入带线程 1/turn 1 标识的迟到文本 `STALE_OLD_CONTEXT`，然后发送线程 2 的 `CURRENT`。预期新回答不含旧文本，实际流包含 `STALE_OLD_CONTEXT`，断言失败，Exit 1。

证据：`self-repair-stale-thread.json`，用例 `does not mix an old thread notification into the compacted thread response`；探针源码 `self-repair-review-protocol.spec.ts`。原有两次 thread/start 断言能通过，说明它只证明换线程，没有证明事件隔离。

修复方向：为请求建立明确的线程/轮次及本地代际归属，统一约束文字、摘要、错误、完成通知和工具 RPC；切换历史时正确终结旧轮及未完成工具请求，不能只清空 Map。补充迟到文本、旧 completed、旧工具调用和取消后重开的测试。工具调用风险是源码推断，本次实测复现的是文本串入，不能混为同一实测结果。

## 发现 2 — P1：源码通过，实际工作台和 LLM 运行包仍旧

**未通过。** Windows-MCP 观察真实工作台仍显示固定“上下文: 1M 自动压缩”。对应 `lib/client.js` 也包含该字符串，源码已改成未知态。

| 文件 | 修改时间（北京时间） |
|---|---|
| `packages/client/ui-personal-workbench/src/client/PersonalWorkbenchPage.tsx` | 2026-10-21 10:00:35 |
| `packages/client/ui-personal-workbench/lib/client.js` | 2026-10-20 21:57:53 |
| `packages/llm/llm-codex/src/adapter.ts` | 2026-10-21 10:05:00 |
| `packages/llm/llm-codex/lib/index.js` | 2026-10-20 21:57:21 |
| `packages/llm/llm-gemini/src/antigravity-adapter.ts` | 2026-10-21 10:01:14 |
| `packages/llm/llm-gemini/lib/index.js` | 2026-10-20 21:57:21 |

Codex 旧运行包中也没有新实现的 `deliveredMessages` 追踪。证据：`live-workbench-old-capacity.png` 及上述源码/运行包。原报告明确把构建和实机列为未验证，这一点应保留；不能把本地源码测试通过等同于实际应用已更新。

修复方向：先修发现 1 并完成类型检查，再构建对应 LLM 包、工作台客户端及必要上层产物；核验实际加载路径和文件指纹后重启空闲实例，重新走真实界面链路。本次子代理限制修复只构建其四个相关包，没有顺带把未验收的自修复适配器投入运行。

## 发现 3 — P2：新增客户端测试不满足组件类型，全仓库检查未通过

**未通过。** `packages/client/ui-personal-workbench/tests/capacity.client.spec.tsx:36`、`tests/resume.client.spec.tsx:38` 向 `PersonalWorkbenchPage` 传递不存在的 `t` 属性，还引入隐式 any/字典索引错误。组件使用其自己的 locale 机制，测试应遵守实际属性定义，不能靠测试转译跳过类型错误。

本次 `tsc -p tsconfig.host.json --pretty false` 为 Exit 2，6 条错误：两个测试仍传入已删除的账号槽位 `1`，另有 4 个未使用变量；`tsc -p tsconfig.client.json --pretty false` 为 Exit 2，41 条错误，包含上述新增测试及其他跨项目文件列表、SessionStore 接口等问题。不能根据文件是 `??` 就认定是谁引入，需对照可靠基线。

证据：`typecheck-host.log`、`typecheck-client.log`。原报告所称 Gemini `adapter.spec.ts(45,46) TS2379` **本次没有复现**，不能继续当作当前缺陷；应更新报告，而不是重复修已经变化的代码。

## 发现 4 — P2：上下文状态数据尚未接入，源码也只会显示未知

**部分通过。** `PersonalWorkbenchPage.tsx:262`、`:497` 已删除固定 1M/85%/20% 文案，这是正确方向；但仍无条件展示未知。`packages/client/ui-personal-workbench/src/types.ts:169` 和宿主诊断快照没有实际容量、压缩启用/禁用、压力或错误状态数据，无法验收已知容量分支。

修复方向：从当前真实模型元数据及压缩服务读取诊断信息，明确区分已知、未知、禁用与错误；界面只显示证据支持的能力。配置写了 1M/2M 或阈值，不等于远端真实支持，不能恢复固定承诺。

## 原交付 R1–R6 逐项结论

| 条目 | 本次结论 | 证据与残余风险 |
|---|---|---|
| R1 压缩重建远端会话 | **未通过最终验收** | 原协议断言通过；新迟到通知探针失败；真实远端未测。 |
| R2 Stop 后 Resume | **本地 UI/DOM 通过，实机未通过验收** | 原恢复按钮断言通过；旧工作台运行包未更新，未执行真实 Snapshot→Stop→Resume。 |
| R3 Loader 路由 | **有限范围通过** | 原 config 替换及 insert 断言通过；仍为 patch 的保守投影，没有完整 base/layers 挂载等价证据。 |
| R4 移除手动思考强度接口 | **方向符合现行要求** | `ModelReasoningEfforts.tsx` 不存在；不恢复已取消组件。未额外证明远端推理档位。 |
| R5 Gemini 输出上限 | **本地参数断言通过，远端未验收** | 原 generationConfig 断言通过；报告旧 TS2379 未复现；不能外推 CLI 已传递输出上限。 |
| R6 动态容量文案 | **部分通过且尚未部署** | 源码未知态存在；实时容量数据面缺失；运行界面仍旧固定文案。 |

## 本轮证据与复现

1. 原 6 条有效断言：**2 文件、6/6 通过，Exit 0**，`self-repair-six-tests.json`。
2. 新增迟到线程消息用例：**1 条执行、1 条失败，Exit 1**，`self-repair-stale-thread.json`；其余用例因 `-t` 筛选未执行，不能计作通过。
3. 协议/DOM 探针归档在 `self-repair-review-protocol.spec.ts`、`self-repair-review-resume.client.spec.tsx`。它们使用原包相对导入，复现时分别复制到 `apps/desktop/tests/` 和 `packages/client/ui-personal-workbench/tests/` 的独立临时名称，在仓库根运行 Vitest；完成后只删除本次复制的文件。已有测试和历史证据未删改。
4. 全仓库 Host/Client 类型检查失败分别见两份日志；本轮修改的四个子代理包单独类型检查通过，不应混淆。
5. 实机证据来自 Windows-MCP；没有派生评审子代理，没有重试远端 HTTP 400，没有替换模型、账号或 API 配置。

应按“旧线程隔离 → 类型检查 → 正确构建并核对加载产物 → 实机恢复链路 → 实际容量数据”的顺序收口。原交付对多项限制的坦诚说明是准确的，但当前不能标记全部完成。
