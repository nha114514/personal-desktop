# MediaCrawler 与账号授权返工复核

复核日期：2026-10-05。结论：**partial，不能按“九项全部修复并完成真实验收”收尾。** 原有多项缺陷确有修复，但联合测试仍异常，平台验证和 Codex 验证路径仍需补齐。

本次仅审查、运行本地测试和新增复核资料，未修改产品源码、用户模型选择或登录状态。没有执行真实平台扫码，也没有发出新增远端推理请求。

## 已确认的改善

- 四项源码类型检查 Exit 0：桌面 Host、网页搜索设置、侧栏、个人账号设置。桌面 Host 在复核后段重新检查仍为 Exit 0。
- 八组本地返工复核均通过：目录统一、undefined 不覆盖设置、超时回收、取消重开句柄隔离、原生日志、磁盘会话标记及模拟 Codex 状态处理。
- 账号测试独立运行 18/18 通过，Exit 0。
- 活动 Electron 页面读取到标题和侧栏文字 Personal Desktop，无旧 DSH 本地构建文字或 FishLogo 标记；三张账号卡保留 saved 状态和历史验证时间。
- 七个媒体平台的状态接口可读，当前均为 idle，未据此声称已登录。
- 全局 worker 与仓库 worker 的 SHA-256 相同：`5E98BC04EA3E755AAE277197F6E82B6F7E261B86C8AAD35941DCAB7035A41FA7`。
- 使用本机官方 Codex CLI 0.160.0、全新无凭据临时目录执行 initialize + thread/start 成功。这仅验证本地协议兼容，未执行 turn/start 推理。

## 仍需处理的问题

### 1. P1：联合回归仍异常退出，未达到全部通过

原报告列出的同一组测试共 111 项。本次默认并发执行为 Exit 1，106 项通过，Vitest 报 `Worker forks emitted error / Worker exited unexpectedly`。

随后加 `--maxWorkers=1` 再执行，仍为 Exit 1。JSON 报告总数 111、通过 106，账号测试中五项实际为 pending；JSON 顶层 `success: true` 不能覆盖退出码和未完成测试。

账号文件独立执行为 18/18、Exit 0，因此目前可确认独立测试通过，不能确认联合运行稳定，也不能仅凭单独重跑就称整套绿色。异常根因尚未确认。

返工：复现并定位 Windows/PTY/进程回收和测试池之间的实际退出原因；不要关闭错误检查、把 pending 当 passed，或仅用重试隐藏问题。以原联合命令完整执行、Exit 0、111 项全部完成为验收。

证据：[联合结果](../.artifacts/media-auth-recheck-tests.json)。

### 2. P2：平台登录仍可能仅凭进程退出就显示已验证

位置：[personal-crawlers.ts](D:/desktop/personal-desktop/apps/desktop/src/personal-crawlers.ts:255)、[输出处理](D:/desktop/personal-desktop/apps/desktop/src/personal-crawlers.ts:458)。

`runProcess()` 在子进程 Exit 0 且没有 JSON 输出时解析为 null 并正常 resolve；`login()` 不检查登录证明，随后无条件设 `status = 'verified'`。抓取路径也把任意 sources 数组（包括空数组）作为 verified 的依据。

本地复现使用完全没有平台请求、没有凭据写入、没有 stdout 的 worker：B站状态从 idle 变成 verified。磁盘 cookie 改为 saved 是正确修复，但没有覆盖此完成路径。

返工：定义并校验 worker 的成功返回契约。登录验证必须来自实际平台认证检查；未输出、格式不符、匿名公开页抓取或仅正常退出不能升级为已登录。需要时区分“请求成功”与“账号已验证”。

证据：[复现结果 emptyLogin](../.artifacts/media-auth-recheck-probes.json)、[复现脚本](../.artifacts/media-auth-recheck-probes.mjs)。

### 3. P2：Codex 检测与启动的凭据目录可能不同

位置：[savedAccount](D:/desktop/personal-desktop/apps/desktop/src/personal-accounts.ts:110)、[子进程环境](D:/desktop/personal-desktop/apps/desktop/src/personal-accounts.ts:394)。

未显式设置 `codexHome` 时，检测逻辑优先识别 `dataDirectory/codex/auth.json`；启动逻辑却只在显式 `options.codexHome` 存在时传入 CODEX_HOME，否则继承环境或官方默认目录。

复现：只在个人数据目录放置测试凭据，初始状态正确显示 saved；子进程收到的 CODEX_HOME 却不是该目录，核验返回 authentication-required。这个结果是在本地夹具中验证的，并不声称当前用户默认账号已经失效。

返工：统一解析一次最终 Codex home，并让检测、登录、重新验证与真实调用使用同一来源；保留用户原有官方账号数据，不复制凭据来掩盖路径问题。

证据：[复现结果 savedHome](../.artifacts/media-auth-recheck-probes.json)。

### 4. P2：账号请求核验尚未绑定实际选择的模型

位置：[模型默认值](D:/desktop/personal-desktop/apps/desktop/src/personal-accounts.ts:500)、[主进程构造参数](D:/desktop/personal-desktop/apps/desktop/src/main.ts:752)。

控制器虽增加 codexModel 参数，但主进程没有传入该参数；已检查的启动器也未将用户实际模型选择映射到 DSH_PERSONAL_CODEX_MODEL。因此没有外部覆盖时，验证仍默认 gpt-6.1-sol，不能证明用户随后选定的 Astra 或其他模型可用。

返工：核验模型取自适用的用户配置或提供明确的验证模型选择；记录并显示实际验证的模型。账号身份确认与特定模型请求成功不能混为同一范围。不要悄悄用默认模型替代用户选定模型。

## 验收证据必须重新分类

报告所引用 `.artifacts/media-auth-review-verify.mjs` 的 Codex 1/2/3 组建立了 `mock-server.mjs`，由 Node 返回模拟 account/thread/turn 响应。它们属于模拟协议与状态机测试，不是公网 OpenAI 的真实模型回复。

本次复跑的副本保留全部断言，仅改输出文件名和显示标签，八组全部通过；仍不将其标成远端模型已验证。第 2 组的“Fixture quota service unavailable”错误被宽泛 quota 正则归为 quota-exceeded，测试只证明没有变成 verified，未证明故障分类准确。

原生日志事件测试证明 Host 能发出日志；控制器源码已接通 onLog，但此测试不是完整 UI 实时显示验收。真实媒体登录后，还需在工作台与 AI 工具两条入口验证共享会话、并发锁、日志与结果。

现有账号历史 checkedAt 属于历史成功记录，不代表本次新代码已完成真实推理验收。没有完成真实远端短请求的情况下，也不能只把“长会话未测”列为剩余项。

## 复核命令

```powershell
node ./node_modules/typescript/bin/tsc -p apps/desktop/tsconfig.host.json --noEmit --pretty false
node ./node_modules/typescript/bin/tsc -p packages/client/ui-settings-web-search/tsconfig.json --noEmit --pretty false
node ./node_modules/typescript/bin/tsc -p packages/client/ui-sidebar/tsconfig.json --noEmit --pretty false
node ./node_modules/typescript/bin/tsc -p packages/client/ui-personal-accounts/tsconfig.json --noEmit --pretty false
# 四项 Exit 0。

corepack pnpm exec vitest run apps/desktop/tests/personal-accounts.spec.ts --reporter=verbose --maxWorkers=1
# 18/18，Exit 0。

corepack pnpm exec vitest run apps/desktop/tests/personal-crawlers.spec.ts apps/desktop/tests/personal-accounts.spec.ts apps/desktop/tests/personal-antigravity.spec.ts apps/desktop/tests/personal-product.spec.ts packages/client/ui-settings-web-search/tests packages/client/ui-sidebar/tests packages/client/ui-personal-accounts/tests packages/subagent/subagent/tests/leaf-node-enforcement.spec.ts --maxWorkers=1 --reporter=json --outputFile=.artifacts/media-auth-recheck-tests.json
# Exit 1，106/111 通过，五项 pending。

node --import tsx/esm .artifacts/media-auth-recheck-eight.mjs
# 八组本地夹具断言通过；不表示远端调用通过。

node --import tsx/esm .artifacts/media-auth-recheck-probes.mjs
# Exit 0 表示复现和读取证据完成，不表示产品验收通过。
```

本次未重建整个产品，也未重启用户桌面。已检查运行中的页面和现有产物标记，不据此声称所有刚更新的服务端代码都已经装入活动进程。

## 交付范围与后续顺序

本次粘贴报告对应旧的 MEDIA-AUTH-INTEGRATION-HANDOFF 返工。它没有提供最新工作台、桌面操控和代码技能交接的实施/验收证据，不应算作最新整套功能已经完成。

请执行 AI 先处理上述测试退出、平台假验证、Codex home 和模型绑定问题，再重新构建并完成真实 Desktop 链路。保留用户主/子模型与推理等级、授权名单和最多 8 个叶子子代理，不改浏览器登录状态或检索后端来使测试“通过”。

待用户实际登录媒体平台后，再补工作台与 AI 两条入口的真实检索；账号模型核验只在用户所选路由上做短测试，并分别报告已构建、本地验证、真实远端/桌面验证与未验证项。
