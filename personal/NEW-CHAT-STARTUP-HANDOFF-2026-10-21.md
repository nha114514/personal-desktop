# Personal Desktop：重新启动默认进入新会话

请接手完成此任务并做真实桌面验收。当前实现是半成品，尚未解决，不要根据旧测试通过记录判断已经交付。

## 用户要求

- 完全退出 Personal Desktop 后重新启动，应进入一个新的空白主会话，不恢复上一个聊天或子代理页面。
- 保留历史聊天、工作区、旧会话的未发送草稿、模型配置、账号凭据及未提交修改。
- 应用已经运行时，再点击桌面快捷方式仍只唤起原窗口，不反复新建会话、不打断当前任务。
- 保留用户当前选定的主模型和授权子模型。默认子模型由用户自己在界面选择，不替用户选，也不恢复已取消的授权项。
- 不新增或派发子代理。电脑操作只由主模型使用 Windows-MCP。
- 不顺带修改其它 LLM、工作台或子代理限制功能。

仓库：`D:\desktop\personal-desktop`。

活动配置：`D:\desktop\personal-data\home\profiles\desktop\cordis.patch.yml`。

先读取项目 AGENTS.md，并使用需求记忆 skill 检索上下文。保留脏工作区，禁止 reset/clean/覆盖式 checkout。

## 已修改的半成品

1. `packages/client/ui-workspace/src/client/navigation.ts`
   - `UiWorkspaceService` 构造函数增加 `restoreLastSession` 参数，默认 true。
   - false 时跳过旧主会话及子代理地址恢复；保留上次工作区，调用 `sessions.create({ workspaceId })` 创建全新的空白会话，避免复用带旧草稿的 blank。
   - 使用现有导航取消机制；用户手动选择其它聊天/面板后，迟到的启动结果不能抢回页面。
   - false 时选择新会话并显示 Conversation 面板。
2. `packages/client/ui-workspace/src/client/index.ts`
   - 新增浏览器侧 `Config` schema，`restoreLastSession` 默认 true。
   - `apply(ctx, config = {})` 将配置传入导航服务。
   - **这里存在真实接入缺陷，见下节。**
3. `personal/personal.patch.yml` 与活动配置均加入：

   ```yaml
   - id: ui-workspace
     config:
       restoreLastSession: false
   ```

   `.artifacts/new-chat-startup-20261021/config-verification.json` 确认除此新增条目外，活动配置其它条目与备份一致。不要回写旧备份覆盖用户最新修改。
4. 两个测试文件增加启动选择与异步导航回归：
   - `packages/client/ui-workspace/tests/workspaces-service.client.spec.ts`
   - `packages/client/ui-workspace/tests/apply.client.spec.ts`
5. 更新了 `ui-workspace` 的中英文 README 和 `personal/README.md`；其中描述的是目标行为，当前实机尚未实现。

## 已定位的真实阻塞：Host 配置没有传到浏览器

第一次修改后的源码测试、局部类型检查和 bundle 均通过；但通过 Windows-MCP 正常“应用→退出”，确认仓库 Electron 进程为 0，再运行原桌面快捷方式，实机仍恢复旧聊天。

已经查明：`packages/client/modules/src/client/entries.ts` 的 `create()` 只用 `{ name: id }` 创建浏览器插件，**不会自动把 Host Loader 条目的 config 传给浏览器 apply**。

因此浏览器 `apply(ctx, config = {})` 实际一直得到默认值，`restoreLastSession` 仍为 true。`packages/client/ui-workspace/src/index.ts` 的 Host 半边现在仍是空 apply，没有配置注入。

不要修改全局 Client Module Loader 给所有插件增加隐式传参。沿用仓库已有的显式页面初始化方式，参考：

- `packages/client/ui-settings-models/src/index.ts`
- `packages/client/ui-settings-models/src/onboarding-config.ts`
- `packages/client/ui-settings-models/src/client/index.ts`
- `packages/client/ui-settings-models/tests/apply.client.spec.ts`
- `packages/client/shortcuts/src/index.ts`

建议最小方案：

1. ui-workspace 用一个共享配置文件定义 schema 和只承载公开布尔值的页面 global，例如 `__DSH_WORKSPACE_STARTUP__`。
2. Host 导出并验证 Config，通过 `ctx.on('webserver/index-inject', ...)` 注入配置，随插件卸载移除回调。
3. 浏览器 apply 从该 global 读取并用同一 schema 验证，再传给导航服务；不要依赖未传入的第二参数。
4. 按现有包规范补齐必要的类型引用、已安装工作区依赖及锁文件，避免让源码测试能解析、运行包却缺依赖。
5. 保持默认 true，只在 Personal Desktop 配置中 false，不擅自改变其它 Web 部署。

共享配置文件及以上 Host 注入修复**尚未编写**。不要误以为已完成。

## 当前测试证据，注意先后顺序

目录：`.artifacts/new-chat-startup-20261021/`。

- `red.json`：最初 6 条启动行为断言失败，真实复现恢复旧聊天的问题；其它测试因筛选未运行。
- `tests.json`：第一次修改后，ui-workspace 12 个测试文件 402/402 通过。**这是发现 Host 注入缺陷之前的结果，不是当前最终通过。**
- `typecheck.log`、`bundle.log`：第一次局部类型检查和构建 Exit 0；不代表当前所有后续修改已验证。
- `injection-red.json`：最新补充的真实 Host→页面→Client 接入测试，执行 2 条、失败 2 条，Exit 1：
  - `passes the startup restoration preference to workspace navigation`
  - `publishes the startup preference and removes its page hook on disposal`
- 最新 `apply.client.spec.ts` 已改为先挂载 Host 插件，采集 `webserver/index-inject` 的真实输出、注入测试 global，再启动无配置参数的 Client 插件。请保留这条接入测试，不改回直接传浏览器 apply 第二参数。

仓库根目录运行：

```powershell
$pnpm = 'D:\desktop\personal-desktop\apps\desktop\node_modules\pnpm\bin\pnpm.mjs'
node $pnpm --dir 'D:\desktop\personal-desktop' exec vitest run packages/client/ui-workspace/tests --maxWorkers=1
node node_modules/typescript/bin/tsc -b packages/client/ui-workspace/tsconfig.json --pretty false
node $pnpm --dir 'D:\desktop\personal-desktop' --filter @deepseek-ai/dsh-client-ui-workspace run bundle
node --test personal/bootstrap.test.mjs
```

先重现上述接入失败，再修复并跑完整相关测试。增加默认恢复行为仍有效、非法页面配置拒绝、卸载清理等必要覆盖。不要删除失败断言或用类型断言掩盖错误。

## 必须完成的实机验收

1. 通过 Windows-MCP 查看当前状态，确认没有运行中的用户任务。走应用菜单正常退出，不按名称批量杀进程。
2. 确认本仓库的 Electron 进程已退出后，从原桌面快捷方式启动。
3. 确认实际界面是新空白会话、编辑框可用、工作区正确，旧聊天仍在历史列表中。
4. 手动打开旧聊天后，再完全退出并启动一次，确认仍进入另一个新会话。
5. 应用运行时重复启动快捷方式，确认仅唤起现有窗口，不产生额外会话，不替换当前用户页面。
6. 保留界面证据和必要的会话身份/时间证据；不要发送消息给模型来证明空白窗口，避免无关费用。
7. 核对模型、授权名单、账号、历史日志未被更改或删除。

当前半成品会在每次客户端初始化时创建新聊天，也包括 renderer reload。核查它是否会在普通重连、HMR 等情况下意外反复新建或抢占用户导航；只做本任务所需的最小修复，不搭建新的通用框架。

桌面快捷方式：`C:\Users\mouwe\Desktop\Personal Desktop.lnk`。入口已改为 `wscript.exe` 调用 `personal/Launch.vbs`，再隐藏启动原 `Launch.ps1`，用于减少启动器任务栏过渡。不要恢复旧 PowerShell 最小化快捷方式，也不要破坏原命名管道激活确认。

最终分别报告：已改动、自动化测试结果、已构建、真实完整退出后验证结果、仍未验证项。只有真实退出重开后进入空白会话，才算本任务完成。
