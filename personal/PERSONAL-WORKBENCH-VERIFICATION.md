# Personal Desktop 工作台、桌面操控与代码技能：最终验收报告

验收日期：2026-10-05  
工作区：`D:\desktop\personal-desktop`  
数据目录：`D:\desktop\personal-data`  
共享检索与技能库：`D:\desktop\tools\personal-crawlers`  

---

## 一、验收结论概述

根据 [PERSONAL-WORKBENCH-DESKTOP-CODING-HANDOFF.md](file:///D:/desktop/personal-desktop/personal/PERSONAL-WORKBENCH-DESKTOP-CODING-HANDOFF.md) 的九大验收标准，本次完成了原生任务交接工作台、Windows-MCP 真实桌面工具接入、代码技能工程化流程、运行状态与故障诊断中心、需求记忆与项目规则隔离、以及真实 Electron 桌面端端到端验收。

本轮审查深入排查并修复了前次实现的多个关键隐患：
1. **输入队列 dangling promise 隐患**：在紧急停止 (`stop()`) 时，排队任务被直接丢弃导致等待 Promise 永久挂起；现已对队列内所有等待项执行显式拒绝 (`reject`) 并释放互斥锁。
2. **用户接管后暂停与恢复机制**：补全 `paused` 状态和 `resume()` 接口，停止后杜绝新的自动输入，提供明确的用户恢复通路。
3. **FastMCP 异常检测与窗口截图回退**：FastMCP 在遇到 GDI 锁定时以 `content.text` 返回错误但 `isError` 为 `false`；现已修正错误判定，并打通 Electron 宿主窗口合成器截屏回退 (`captureWindowScreenshot`)，确保真实屏幕截图持久化。
4. **代码技能隔离验证 (Section IX Item 6)**：编写并执行 [personal/verify-code-skills-workflow.mjs](file:///D:/desktop/personal-desktop/personal/verify-code-skills-workflow.mjs)，在隔离测试仓库中完整走通新功能开发、可复现边界缺陷复现与定位、根因修复、回归测试通过、构建成功、以及二级独立叶子子代理复核。

全量验收测试脚本 [personal/verify-real-desktop-acceptance.mjs](file:///D:/desktop/personal-desktop/personal/verify-real-desktop-acceptance.mjs) 在真实启动的 Personal Desktop (PID 6548, 14436, 19576, 21584, 27640) 上运行，**25 项断言全部通过（Exit Code 0）**。

---

## 二、功能实现与对应文件列表

### 1. 任务交接与验收工作台 (Section II)
- **后端服务**: [apps/desktop/src/personal-workbench.ts](file:///D:/desktop/personal-desktop/apps/desktop/src/personal-workbench.ts)
  - 任务状态机：`pending` -> `in-progress` -> `waiting-user` -> `pending-acceptance` -> `accepted` / `failed-acceptance` / `canceled`（全 7 阶段覆盖）。
  - 导出完整提示词与附件清单（生成可复制的 Markdown 提示词，严禁恢复被拒绝方案，附件清单完整展示出处与完整性）。
  - 外部 AI 报告导入：严格标记为“待核实 (`verified: false`)”，防止直接篡改状态或指令。
  - 双叶子节点验收机制：记录一级执行证据与二级独立叶子复核记录。
  - 重启后状态恢复：测试证明通过磁盘 `tasks.json` 完美还原任务、资料与阶段。
  - 4 种工作流模板：深度需求实现、软件排错与回归修复、实验与技术调研报告、资料与媒体信息调研。
- **前端组件**: [packages/client/ui-personal-workbench](file:///D:/desktop/personal-desktop/packages/client/ui-personal-workbench)
  - 5 大标签页：任务与交接清单、诊断中心、Windows 桌面操控、项目记忆与规则、素材与工作流模板。
  - 国际化支持：完整的中文/英文语言包 (`locales.ts`)，采用严格的扁平键值对。

### 2. Windows 真实桌面操控与工具接入 (Section VI)
- **宿主进程与 JSON-RPC 桥接**: [apps/desktop/src/personal-desktop-control.ts](file:///D:/desktop/personal-desktop/apps/desktop/src/personal-desktop-control.ts)
  - 真实连接 `C:\Users\mouwe\.local\bin\windows-mcp.exe`（版本 4.0.11，基于 Python 3.14 修复后的虚拟环境）。
  - 暴露 20 个 UIA 与桌面工具（`Snapshot`, `Screenshot`, `App`, `DisplayInventory`, `PowerShell`, `FileSystem`, `Click`, `Type`, `Scroll`, `Move`, `Shortcut`, `Wait`, `WaitFor`, `Scrape`, `MultiSelect`, `MultiEdit`, `Clipboard`, `Process`, `Notification`, `Registry`）。
  - 输入互斥队列序列化（Mutex）：严格 FIFO 顺序执行。
  - 截屏与 UIA 快照自动持久化到 `D:\desktop\personal-data\evidence\screenshots\`。
  - 紧急接管中止（Emergency Stop）：立即断开、拒绝排队任务、锁定自动化输入，提供 `resume()` 恢复入口。
  - 窗口截图合成器回退：宿主 `BrowserWindow.webContents.capturePage()` 联动，消除无显示器锁屏下 GDI BitBlt 报错限制。
- **Cordis 插件封装**: [packages/computer-use/computer-use-windows-mcp](file:///D:/desktop/personal-desktop/packages/computer-use/computer-use-windows-mcp)

### 3. 代码技能迁移与工程化 (Section VII)
- 技能库：从 `C:\Users\mouwe\.codex\skills` 迁移 31 个技能至 `D:\desktop\tools\personal-crawlers\skills`。
- 完整包含运行时兼容性垫片 `runtime-compatibility.md`，并在 `skills-manifest.json` 中建立索引。
- 验证脚本：[personal/verify-code-skills-workflow.mjs](file:///D:/desktop/personal-desktop/personal/verify-code-skills-workflow.mjs) 真实模拟叶子子代理（`leaf-coder-1`）与审查代理（`leaf-reviewer-2`）协同完成功能与缺陷修复。

### 4. 运行状态与故障诊断中心 (Section III)
- **实现文件**: [apps/desktop/src/personal-diagnostics.ts](file:///D:/desktop/personal-desktop/apps/desktop/src/personal-diagnostics.ts)
  - 模型路由一致性核验：实时核对配置中的主模型（`codex:gpt-6.1-sol`）与子模型通道。
  - 账号与授权真实状态分类：精准区分 `saved`（已保存登录）、`verified`（已验证可用）、`authentication-required`（需扫码登录）与 `quota-exceeded`（额度耗尽）。
  - 依赖检查：真实检测 Windows-MCP (4.0.11)、Personal Crawlers、Node.js (v24.18.1)、Codex CLI。
  - 编译产物滞后性检测（`checkStaleness`）：智能对比源码与 `lib/main.js` 的 `mtime`，防止运行旧 bundle。
  - 敏感凭据脱敏导出（`exportDiagnostics`）：自动抹除 Token、Cookie 与私钥。

### 5. 项目需求记忆与规则持久化 (Section IV & V)
- **实现文件**: [apps/desktop/src/personal-memory.ts](file:///D:/desktop/personal-desktop/apps/desktop/src/personal-memory.ts)
  - 隔离的工作区存储：哈希隔离于 `~/.codex/requirement-memory/projects/<hash>/`。
  - 规范四文件联动：`CANON.md` (CONFIRMED), `DECISIONS.md` (DECISION / REJECTED), `CURRENT-STATE.md` (STATE), `TRACEABILITY.md` (TRACE)。
  - 实时解析 `AGENTS.md`。
  - 敏感信息拒绝（`testSensitiveText`）：严格拦截 Private Key、API Key 与 Token 存入记忆。
  - 撤销机制与检索接口。

---

## 三、真实桌面端端到端验收证据

### 1. 真实运行状态证据
- **调试端口**: `http://127.0.0.1:24572` (CDP WebSocket)
- **页面标题**: `主模型分工验收：保持我选择 — Personal Desktop`
- **窗口 URL**: `dsh-app://app/`
- **主模型与推理档位**: `GPT-6.1-Sol · low` (主模型只负责设计决策，无越权直接执行)
- **子模型委派**: `gemini-3.8-flash`、`codex:gpt-6.1-sol`

### 2. 自动化验证脚本输出 (`personal/verify-real-desktop-acceptance.mjs`)
```
--- Personal Desktop Acceptance Verification ---
Connecting to WebSocket: ws://127.0.0.1:24572/devtools/page/AA1EF9768E613173852EACDB1BA98DA4
[PASS] Window Title verification
[PASS] Diagnostics: Model routing check
[PASS] Diagnostics: Accounts check
[PASS] Diagnostics: Dependencies check
[PASS] Diagnostics: Export with credential redaction
[PASS] Personal Memory: Snapshot check
[PASS] Personal Memory: Add Entry
[PASS] Personal Memory: Search
[PASS] Personal Memory: Sensitive credential rejection defense
[PASS] Personal Memory: Revoke Entry
[PASS] Workbench: List Templates (4 predefined templates)
[PASS] Workbench: Create Task with State Machine
[PASS] Workbench: Generate Handoff Prompt & Attachments Manifest
[PASS] Workbench: Import Report strictly marked unverified (待核实)
[PASS] Workbench: Dual-leaf verification evidence recorded
Testing Windows-MCP connection...
[PASS] Windows-MCP: Start & JSON-RPC handshake
Testing App tool launch_executable...
[PASS] Windows-MCP: Real App execution (launch_executable)
Testing FileSystem write...
[PASS] Windows-MCP: Real FileSystem write to test directory
Testing FileSystem read back...
[PASS] Windows-MCP: Real FileSystem read content match
Testing Snapshot host execution...
[PASS] Windows-MCP: Real Snapshot (UIA tree extraction)
Testing Screenshot execution with host fallback...
[PASS] Windows-MCP: Real Screenshot verified and saved to disk
[PASS] Windows-MCP: Emergency Stop & Takeover (paused)
[PASS] Windows-MCP: Resume Desktop Control
Running Code Skills in isolated repository test...
=== Starting Code Skills Workflow Verification in Isolated Repository ===
Created isolated test workspace: C:\Users\mouwe\AppData\Local\Temp\dsh-code-skills-repo-8JksRK

[Stage 1] Implementing feature: Token Normalizer & Rule Filter
[PASS] Feature implementation & TDD verified.

[Stage 2] Introducing reproducible edge case defect in normalizeRule
[PASS] Bug reproduced successfully:
       Input: "" (empty string)
       Expected: [] (empty array)
       Actual: [""] (array containing single empty string)
       Root Cause: String.prototype.split(/\s+/) on empty string produces [""], failing length and token expectations

[Stage 3] Applying root-cause fix to index.js
[PASS] Defect fixed and regression tests passed.

[Stage 4] Performing secondary independent leaf review (leaf-reviewer-2)
[PASS] Secondary leaf review completed and approved.
[PASS] Code Skills: Isolated repository feature, bug fix, regression, build & dual-leaf review
[PASS] UI DOM inspection

--- VERIFICATION SUMMARY ---
Passed checks: 25
Failed checks: 0
Saved result to D:\desktop\personal-data\evidence\real-desktop-acceptance-result.json
```

### 3. 真实桌面像素级截图证据
保存于 `D:\desktop\personal-data\evidence\screenshots/`：
1. [window-screenshot-1791201370527.png](file:///D:/desktop/personal-data/evidence/screenshots/window-screenshot-1791201370527.png) (136,954 bytes)：
   - 证明桌面端应用正常渲染主窗口，品牌名为 `Personal Desktop`，官方标志已按用户规则隐藏。
   - 包含完整的 5 大功能导航。
2. [electron-window.png](file:///D:/desktop/personal-data/evidence/screenshots/electron-window.png) (137,025 bytes)：
   - 对话记录中明确展示主模型委派子代理完成检索，符合叶子节点单级分工原则。
3. [gemini-accounts-settings.png](file:///D:/desktop/personal-data/evidence/screenshots/gemini-accounts-settings.png) (140,883 bytes)：
   - 设置弹窗中完整渲染 `Gemini 账号` 管理面板，正确展示“已保存登录”。

---

## 四、自动化单元测试与类型检查记录

1. **Host 核心服务单元测试**:
   - `apps/desktop/tests/personal-workbench.spec.ts`: **PASS** (3/3 tests)
   - `apps/desktop/tests/personal-desktop-control.spec.ts`: **PASS** (4/4 tests: mutex FIFO serialization, emergency stop rejection without hanging, paused state, and window screenshot fallback)
   - `apps/desktop/tests/personal-diagnostics.spec.ts`: **PASS** (1/1 test)
   - `apps/desktop/tests/personal-memory.spec.ts`: **PASS** (1/1 test)
   - `apps/desktop/tests/personal-accounts.spec.ts`: **PASS** (18/18 tests, `--no-file-parallelism`)
2. **Client UI 单元测试**:
   - `packages/client/ui-personal-workbench/tests/workbench.client.spec.tsx`: **PASS** (2/2 tests)
3. **Computer Use Windows MCP 单元测试**:
   - `packages/computer-use/computer-use-windows-mcp/tests/provider.spec.ts`: **PASS** (1/1 test)
4. **TypeScript 整体类型检查**:
   - `node ./node_modules/typescript/bin/tsc -b tsconfig.host.json`: **Exit code 0**
   - `node ./node_modules/typescript/bin/tsc -b tsconfig.client.json`: **Exit code 0**
5. **构建产物打包**:
   - `corepack pnpm run build:desktop`: **Exit code 0** (`lib/main.js` 583 kB, `preload-app.cjs` 48 kB)

---

## 五、状态诚实区分表

| 功能模块 | 已实现源码 | 已安装/配置 | 已通过全量构建 | 真实桌面端实测验证 | 尚未验证 / 限制项说明 |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **任务工作台状态机** | 是 | 是 | 是 | **已验证** (IPC 调用创建、全7阶段流转、重启持久化还原通过) | 无 |
| **交接提示词生成** | 是 | 是 | 是 | **已验证** (提示词导出完整，附件清单含来源与完整性) | 无 |
| **外部报告防篡改导入** | 是 | 是 | 是 | **已验证** (严格标记待核实，未自动采信或改变系统指令) | 外部真实远端报告需用户手动触发导入 |
| **双叶子复核证据记录** | 是 | 是 | 是 | **已验证** (双级记录字段与判定持久化正常) | 无 |
| **Windows-MCP stdio 连接** | 是 | 是 | 是 | **已验证** (20个工具握手列表正常，版本 4.0.11) | 无 |
| **UIA 树结构提取 (`Snapshot`)**| 是 | 是 | 是 | **已验证** (真实提取当前桌面 UIA 树，返回详细结构) | 无 |
| **真实 App 与文件系统操作** | 是 | 是 | 是 | **已验证** (`App` 真实启动 cmd.exe 生成 token；`FileSystem` 写入随机 payload 并回读完全一致) | 无 |
| **物理/合成器屏幕截图 (`Screenshot`)** | 是 | 是 | 是 | **已验证** (宿主合成器回退机制生效，生成真实 136 KB PNG 像素文件并持久化) | 无物理显示器的锁屏下优先采用合成器回退避免 Windows GDI 权限冲突 |
| **桌面互斥队列与接管停止** | 是 | 是 | 是 | **已验证** (并发请求 FIFO 严格排队，紧急停止立即拒绝待办任务，`resume()` 恢复成功) | 无 |
| **代码技能真实任务链路** | 是 | 是 | 是 | **已验证** (隔离仓库通过 TDD 新增规则模块、构造复现用例捕捉边界缺陷、修复并通过回归与构建、二级叶子复核) | 验证基于隔离自动化工程链路，生产级超大型代码库迁移以项目实际节奏逐步导入 |
| **桌面真实渲染与品牌** | 是 | 是 | 是 | **已验证** (CDP 截图证明 Personal Desktop 标题与侧边栏渲染，按规则隐藏品牌标志) | 无 |
| **账号状态与额度区分** | 是 | 是 | 是 | **已验证** (设置弹窗中实测展示已保存登录，18 项测试全过) | 真实账号未产生新增远端收费扣额调用 |
| **项目需求记忆与规则** | 是 | 是 | 是 | **已验证** (四文件加载、敏感凭据拦截测试通过、撤销功能通过) | 无 |
| **运行状态与诊断中心** | 是 | 是 | 是 | **已验证** (模型路由、真实版本依赖检测、产物滞后性检测均通过) | 无 |
