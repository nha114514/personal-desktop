# 子代理数量与授权修复（2026-10-21）

状态：本地回归通过、相关包已构建，并通过应用菜单重启应用与 Host；未调用远端模型。默认子模型由用户自行在界面选择，本次没有替换。

## 需求与实际原因

用户确认：每次用户任务最多新建 8 个子代理，优先通过 `send_message` 复用已有子代理；只能使用当前勾选的模型，子代理不能继续派生。电脑控制仍仅供主模型通过 Windows-MCP 使用，其他授权能力不因此移除。

目标历史会话确有 59 个直接子会话，未发现孙级子会话。原界面显示的是累计数量，不能据此判断有 59 个同时运行。实际日志中一个后端 turn 曾记录 16 次创建；原有 `maxActiveSubagents: 8` 限制活跃数量，无法限制完成后的累计新建数量。首次请求路由统计为 Codex GPT-6.1-Sol 46 个、Gemini 账号 2 Flash 9 个、Codex GPT-5.6-Sol 4 个；并非 59 个不同模型。

旧会话还捕获了创建时的模型授权列表，后续执行和查询优先使用旧列表，导致撤销授权后仍可派发，也不能及时发现新授权模型。

## 修改

| 项目 | 实现位置 | 行为 |
|---|---|---|
| 每次用户任务最多新建 8 个 | `packages/subagent/subagent/src/creation-budget.ts`；`src/index.ts:282`、`:300`、`:620` | 根据已有 `subagent/catalog` 及真正的 `user/message` 恢复计数；异步启动前预留名额，所有已注册创建入口共用计数。 |
| 禁止通过自动续跑扩张 | `creation-budget.ts:25` | 只有新的用户消息重置额度，`turn/start`、子代理完成消息及自动续跑均不重置。已有历史不删除。 |
| 避免并发提前耗尽额度 | `src/index.ts:312`；`tests/creation-budget.spec.ts` | 已发布目录事件和仍未结束的启动预留不重复计数；第 8 个可正常创建，第 9 个拒绝。 |
| 子代理为叶节点 | `src/index.ts:293`；`tool-subagent/src/index.ts:495` | 同时检查持久化深度、运行深度、`origin`、`parentSession`，禁止从另一个服务入口绕过。个人模式启用 `enforceLeafSubagents`。 |
| 当前授权列表即时生效 | `packages/subagent/tool-subagent/src/index.ts:500`、`:570`；`src/list-models.ts:42` | 查询、派发和异步预检完成后均读取当前设置；撤销项不能继续派发，新勾选项无需新建主会话。 |
| 恢复旧子会话仍受授权约束 | `tool-subagent/src/model-selection-settings.ts:48` | 个人模式 `enforceAllowedModels: true`，在实际 `agent/request` 检查最终路由；空授权列表不放行，主模型选择不受这个子代理列表限制。 |
| 区分历史数量和运行数量 | `packages/client/ui-subagent/src/client/locales.ts:34` | 页头改成“累计 59 个子智能体”，保留历史记录和原有运行计数。 |

模板 `personal/personal.patch.yml` 和活动配置只增加上述限制配置；没有把模板的模型列表覆盖到用户配置。活动名单在工作期间由备份中的 13 项变成 12 项，本次保留最新列表，不恢复已取消的项目。排除两条策略配置后，其余配置条目与工作前备份一致，见 `config-verification.json`。

收尾时默认仍为 `codex/gpt-5.6-sol`，已不在当前授权列表。按用户回答“我自己在界面里选择”，没有替换默认值，也没有把该模型加回；选择前相关派发会明确失败。

## 验证

证据目录：`.artifacts/subagent-policy-20261021/`。

| 检查 | 结果 | 证据 |
|---|---|---|
| 修前数量、权限与旧会话回归 | 9 条失败断言复现 | `red.json` |
| 恢复旧子会话实际请求绕过 | 2 条失败断言复现 | `request-guard-red.json` |
| 异步预检期间撤销授权 | 1 条失败断言复现 | `authorization-race-red.json` |
| 已发布但仍在启动的重复计数 | 1 条失败断言复现，修后通过 | `reservation-publication-red.json`；`regression.json` |
| 最终相关回归 | **13 个测试文件，328/328 通过，Exit 0** | `regression.json` |
| 四个修改包的 TypeScript 检查 | **Exit 0** | `typecheck-changed.log` |
| 四个修改包构建 | **Exit 0** | `bundle.log`；`built-fingerprints.json` |
| Windows-MCP 实机界面检查 | 最终构建重启后新累计标签可见，历史 59 条保留 | `live-cumulative-count-final.png` |
| 配置保护 | 非策略条目一致，最新 12 项授权保留，未替用户选默认 | `config-verification.json` |

回归在仓库根目录执行：

```powershell
node apps/desktop/node_modules/pnpm/bin/pnpm.mjs --dir D:/desktop/personal-desktop exec vitest run packages/subagent/subagent/tests/creation-budget.spec.ts packages/subagent/subagent/tests/leaf-node-enforcement.spec.ts packages/subagent/subagent/tests/continuation.spec.ts packages/subagent/tool-subagent/tests/model-selection.spec.ts packages/subagent/tool-subagent/tests/model-selection-settings.spec.ts packages/subagent/tool-subagent/tests/list-models.spec.ts packages/client/ui-subagent/tests packages/client/ui-settings-subagent/tests --maxWorkers=1 --reporter=json --outputFile=.artifacts/subagent-policy-20261021/regression.json
```

## 验证范围

本地测试使用协议/代理夹具，未派发真实付费模型任务；不把这些结果描述成远端主模型到子模型完整实测。全仓库类型检查仍有其他问题，见独立自修复复核报告。

个人模式使用会写入本地子会话目录的 `spawn`/`fork` 创建路径，计数可从日志恢复。通用库中不写本地 catalog 的外部一次性 provider 只能在当前宿主进程保持新增计数；不能把该通用能力说成跨重启完整计费系统。叶节点严格限制为个人配置显式开启，保留通用库现有的合法嵌套用例。
