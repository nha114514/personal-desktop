# MediaCrawler 与账号授权集成验收复核

复核日期：2026-10-05。工作区：`D:/desktop/personal-desktop`。

结论：**部分完成，仍需返工。** 三个账号入口、七个平台工作台及 IPC 已出现在真实桌面，重启后账号显示“已保存登录”。但共享浏览器状态、请求验证、爬虫生命周期和源码类型检查尚未达到交接要求。

本次仅检查产品；没有修改业务源码、用户模型配置或真实凭据。新增了复核记录与本地模拟复现脚本。以下模拟均使用临时目录和假进程，不访问 Google、OpenAI 或媒体平台。

## 需要修复的发现

### 1. P1：原生工作台与 AI 搜索使用不同数据目录

位置：[main.ts](D:/desktop/personal-desktop/apps/desktop/src/main.ts:791)、[personal-crawlers.ts](D:/desktop/personal-desktop/apps/desktop/src/personal-crawlers.ts:71)、[Launch.ps1](D:/desktop/personal-desktop/personal/Launch.ps1:21)。

启动器将 `DSH_PERSONAL_DATA_DIRECTORY` 设为 `D:/desktop/personal-data`，主进程直接把它作为原生爬虫的 `dataDirectory`。AI 搜索从全局配置读取的却是 `D:/desktop/personal-data/crawlers`。因此，工作台扫码登录、结果目录、浏览器配置和平台锁与 AI 搜索分离。界面写着“共用同一份本机配置”，实际没有共用同一套状态。

另外，主进程显式传入值为 `undefined` 的可选路径，经 `{ ...defaults, ...options }` 合并后，会抹掉全局配置中的 Python、worker 和 MediaCrawler 路径，再回退到硬编码路径。

本地复现：同一设置文件下，主进程形状的选项得到根目录 `.`、B站状态 `idle`；按设置文件初始化得到子目录 `crawlers`、B站状态 `saved`。配置中的 executable 同时被 `undefined` 覆盖。

修复要求：从同一全局配置加载所有检索参数；区分产品数据根目录和爬虫数据目录；没有设置的环境变量不能覆盖有效配置。UI、AI、全局命令必须共用浏览器状态、结果目录和平台锁。修改配置后也要让原生服务采用新配置。

### 2. P1：Codex 未发模型请求，却显示“请求已验证”

位置：[personal-accounts.ts](D:/desktop/personal-desktop/apps/desktop/src/personal-accounts.ts:470)。

`verifyStatusAndFinish()` 只调用 `account/read` 与 `account/rateLimits/read`，随后直接 `finish(0, true)`，记录验证时间并显示 `verified`。没有 `thread/start` 或 `turn/start`，不能证明用户选择的模型可以推理。额度查询发生错误时被 `.catch(() => null)` 吞掉，仍会显示已验证。

本地复现两种情况均得到 `phase: verified`、`modelRequests: 0`：额度查询正常，以及额度查询返回错误。现有 Codex 登录测试也只模拟账号信息与额度，因此测试通过不能证明真实模型验证成功。

修复要求：区分“登录已保存”“账号身份已确认”“模型请求已验证”。只有真实指定模型的短请求成功才能更新请求验证时间。查询失败保留已有登录，并显示当前查询失败；额度不足保留登录状态并单独提示额度，不能宣称推理验证成功。不得为验证成功替换用户选择的模型。

### 3. P1：取消后立即启动新任务，旧任务会清除新任务状态

位置：[personal-crawlers.ts](D:/desktop/personal-desktop/apps/desktop/src/personal-crawlers.ts:285)、[personal-crawlers.ts](D:/desktop/personal-desktop/apps/desktop/src/personal-crawlers.ts:364)。

`cancel()` 杀进程后立刻清空活动任务，允许下一任务开始；旧任务随后触发 `close` 和 `finally`，无条件清除 `activeChild`、`activeAbort`、`activePlatform` 和 `activeOperation`。这些变量已经属于新任务。

本地复现：取消 B站任务后立即启动小红书任务，旧任务收尾时小红书进程仍在运行，但界面活动平台变成空值，新进程句柄也丢失，服务无法再取消它。

修复要求：每个任务持有独立身份及生命周期；收尾前核对所属任务。取消完成应等待所属进程树退出，或保持取消中状态，不能让旧回调改写新任务。禁止通过禁用正常重开功能掩盖问题。

### 4. P1：原生爬虫的 timeoutMs 没有执行超时回收

位置：[personal-crawlers.ts](D:/desktop/personal-desktop/apps/desktop/src/personal-crawlers.ts:317)。

原生服务只是把 `timeoutMs` 写入 worker 输入，`spawn` 没有实际超时控制；MediaCrawler 平台流程也没有相应请求边界。挂住的浏览器或 worker 会一直保持 busy。AI provider 自己有进程超时，不代表原生工作台也有。

本地复现：设置 `timeoutMs: 100`，worker 就绪后再等待 300ms，任务仍未结束并保持 busy；必须手动取消才退出。

修复要求：为当前任务建立实际超时、可取消状态和进程树回收；正常结束、取消、超时均清理计时器和监听器，不能影响其他账号、平台或宿主进程。

### 5. P1：相关源码类型检查存在 27 处错误

实际命令及结果：

```powershell
node ./node_modules/typescript/bin/tsc -p apps/desktop/tsconfig.host.json --noEmit --pretty false
# Exit 1，12 处错误

node ./node_modules/typescript/bin/tsc -p packages/client/ui-settings-web-search/tsconfig.json --noEmit --pretty false
# Exit 1，15 处错误

node ./node_modules/typescript/bin/tsc -p packages/client/ui-personal-accounts/tsconfig.json --noEmit --pretty false
# Exit 0
```

包括 `exactOptionalPropertyTypes` 下显式写入 `undefined`、未使用的参数与变量，以及 `useCrawlers` 的 snapshot 被推导为 `never`。这些错误直接位于新增的主进程服务、工作台控制器与组件，不是无关历史模块。

修复要求：按照仓库现有类型、SnapshotStore、IPC 和 hooks 风格调整。不要关闭严格检查、忽略错误、滥用 `any` 或仅依赖旧构建产物。修复后重新执行类型检查与最终构建。

原始输出：[桌面类型检查](D:/desktop/personal-desktop/.artifacts/media-auth-review-desktop-types.txt)、[搜索界面类型检查](D:/desktop/personal-desktop/.artifacts/media-auth-review-search-types.txt)。

### 6. P2：工作台未订阅运行中的日志事件

位置：[crawler-search-card-controller.ts](D:/desktop/personal-desktop/packages/client/ui-settings-web-search/src/client/crawler-search-card-controller.ts:83)、[personal-crawlers.ts](D:/desktop/personal-desktop/apps/desktop/src/personal-crawlers.ts:186)。

原生服务通过单独的 `onLog`/IPC 发送日志，但 UI 控制器只订阅 snapshot，没有订阅 `onLog`；`appendLog()` 也不会发布 snapshot。因此任务进行中的新增日志不会及时显示，通常需要任务结束才更新。

本地复现：原生 `onLog` 收到 worker 就绪日志，最新发布给控制器的 snapshot 中仍没有该日志。

修复要求：接通日志事件与 UI 状态，按日志 ID 去重、有界保留，组件销毁时取消订阅。不能通过频繁重新抓取或重启 worker 更新日志。

### 7. P2：额度错误后的“重试”重新发起浏览器登录

位置：[personal-accounts.ts](D:/desktop/personal-desktop/apps/desktop/src/personal-accounts.ts:377)。

是否复用登录仅依据当前 phase 为 `saved`/`verified`。额度不足后 phase 变成 `error`，再次点击按钮就走 `account/login/start`，即使凭据文件仍存在。网络查询错误也有同类风险。

本地复现：存在已保存登录，第一次检测到 quota-exceeded，第二次操作立刻调用 `account/login/start` 并请求打开浏览器。

修复要求：登录是否保存、当前连接检查和额度状态分别维护；额度与网络错误后的重试复用官方登录。只有官方明确判定需要重新授权，或用户主动退出/换号时，才开启新授权。

### 8. P2：有任意非空 Cookies 文件就显示“已登录”

位置：[personal-crawlers.ts](D:/desktop/personal-desktop/apps/desktop/src/personal-crawlers.ts:104)、[locales.ts](D:/desktop/personal-desktop/packages/client/ui-settings-web-search/src/client/locales.ts:91)。

状态判断仅检查 Cookies 文件非空。这不能证明平台登录有效：未登录浏览器也可能有 cookie 数据库，保存的登录也可能过期。英文文案为 Saved，中文却显示“已登录”。

本地复现：放置内容为普通测试文字的非空文件即可得到 `saved`，期间没有平台请求。

修复要求：存在浏览器状态只显示“已保存会话/未验证”，平台实际请求证实登录后才显示当前已登录。过期、登录要求和验证码要明确显示，不能覆盖或读取用户凭据内容来伪造验证。

### 9. P2：实际桌面仍保留被要求移除的品牌

实际桌面截图仍显示左上角鲸鱼图标与“DSH 本地构建”，尽管模板与运行时配置有 `showBrandMark: false`。不能仅检查 YAML 就宣称去品牌化生效。

证据：[账号页截图](D:/desktop/personal-desktop/.artifacts/media-auth-review-accounts.png)、[工作台截图](D:/desktop/personal-desktop/.artifacts/media-auth-review-crawlers.png)。

修复要求：沿原有组件与构建方式修复，重启后在真实桌面确认；保持原代码风格，不能覆盖用户数据。

## 已确认通过的内容与边界

- 真实桌面启动成功，三张账号卡片、七个平台工作台、扫码登录入口、抓取入口和结果区已加载。
- 两个 Gemini 账号及 Codex 账号重启后显示 saved，没有仅因重启清空登录。
- 最新联合回归：14 个测试文件、96 项测试全部通过，Exit 0。首次联合运行曾发生 Vitest worker 异常退出，账号文件单独运行和联合复跑均通过；异常原因尚未确认，不能归因于某个组件。
- 主模型委派控制和叶节点防递归回归测试通过。当前主模型仍为用户选择的 GPT-6.1-Sol / ultra，默认子代理为 gemini-1 / gemini-3.8-flash / high；并发上限 8、账号子代理 maxDepth 1 的配置仍在。本次没有切换模型或修改权限。
- 仓库 worker 与全局安装 worker 的 SHA-256 相同：`93C1500820AB0CD415C726629E7307BE70D7511E372ED6825DFC4C1C956898DF`。
- 本次没有执行真实平台扫码登录与登录后搜索，没有执行两个会员账号和主模型的新增远端推理。因此这些环节仍不能据此宣称完整端到端验收通过。

回归结果：[JSON](D:/desktop/personal-desktop/.artifacts/media-auth-review-tests.json)。
缺陷复现：[脚本](D:/desktop/personal-desktop/.artifacts/media-auth-review-repro.mjs)、[结果](D:/desktop/personal-desktop/.artifacts/media-auth-review-repro.json)。脚本 Exit 0 表示上述缺陷成功复现，并不表示产品验收通过。

## 给实施 AI 的返工要求

先阅读原交接 [MEDIA-AUTH-INTEGRATION-HANDOFF.md](D:/desktop/personal-desktop/personal/MEDIA-AUTH-INTEGRATION-HANDOFF.md)，再按本报告逐项复现和最小修复。保留全部既有未提交修改，遵循仓库原代码风格。

1. 优先修复共享数据目录、Codex 假验证、取消重开竞态与实际超时，随后修复类型、日志、登录状态和品牌。
2. 对上述交易过程补充有效回归测试：配置与原生/AI 路径一致、查询失败不变成模型已验证、额度错误重试不重新登录、超时真实回收、旧回调不能修改新任务、运行中日志到达 UI。
3. 不改用户选定的主/子模型及推理等级；主模型负责决策与设计，执行交给已授权子代理，子代理不得继续派生；并发上限保持 8。
4. 使用既有官方 CLI 和凭据刷新机制。禁止复制凭据、索要授权码到聊天、改缓存时间伪装登录有效、静默换模型/账号/检索后端。
5. 最终重新执行三项类型检查、相关测试及最终构建，再检查新桌面加载的是新产物。用户扫码后，必须在 UI 与 AI 两条入口验证共享的登录状态、结果和锁；不能用独立 CLI 成功替代桌面链路成功。
6. 最终分别报告源码修复、构建、自动化测试、真实桌面验证、尚未验证的项目。未完成的真实授权与模型请求必须如实标注。
