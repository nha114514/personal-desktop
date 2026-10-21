---
description: "dsh Web 客户端插件页上的子智能体设置页：运行限制、模型授权与可选的默认模型，同一页一次保存。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-subagent

[English](README.md) | 中文

## 概述

在侧栏打开**插件**，在官方分组里选择**子智能体**，即可设置委派限制、授权模型和子智能体默认模型。页面统一保存 `subagent`、`subagent-model-selection-settings` 与可选的 `subagent-default-model` 命名空间；Host 服务其中任一命名空间时页面就存在，并只显示被服务的部分。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在**设置 → 模型 → 自定义模型 API**中填写提供方 ID、接口地址、密钥和任意模型 ID，支持兼容 OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages 的接口。保存后，新增模型会加入本页的授权列表，无需修改代码中的模型白名单。密钥沿用凭据存储。

当 Host 提供 `subagent-default-model` 时，本页还显示**子智能体默认模型**和该模型声明的推理等级。切换模型会清除旧等级，改用**提供方默认**；这也会覆盖配置底层继承的旧等级。默认配置用于未指定模型的进程内子智能体新任务，主代理和账号 CLI 工具继续使用各自配置。保存按钮一并保存此命名空间，使用独立的版本校验。

**运行限制**把**最大递归深度**和**子智能体并行数量上限**并排放置，窄屏时上下堆叠；每个标签旁的信息按钮展开它的规则——深度是一张两行示例表，容量是计数口径——填了不在范围内的整数会阻止保存并在字段下说明。深度让位于工具自己的上限；容量统计同一主 Agent 下所有层级存活的子智能体，主 Agent 不计入。

**模型选择**把权限开关和精确的适配器路由一起暂存。开启时至少要选一条路由；关闭会保留已选路由以备后用。Host 已存储但没有适配器公布的路由留在**已保存但当前不可用**分组里并且仍可移除；加载失败的提供方会被报告而不隐藏其他提供方，加载失败时提供**重试**。

一次**保存**通过各自的命名空间写入有改动的部分，每次写入都校验草稿读取时的修订号。写入相互独立：Host 拒绝的部分保留草稿并报告失败，其他部分可以照常保存。较新的 Host 修订号会阻止旧草稿覆盖当前设置。离开页面即丢弃所有草稿。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

宿主半侧是一个空的 `apply`，只为让本包占一条 Loader 行，客户端模块系统据此送出浏览器半侧。浏览器半侧通过 `ctx.configForms.get` 分别绑定各命名空间。`SubagentLimitsCardController` 用 `ui-primitives` 的共享 `SettingsFormModel` 暂存运行限制，字段规格只接受不低于各自下限的安全整数。`SubagentModelSelectionCardController` 把已存储的授权路由与 `remote.session.modelCatalog()` 合并。`SubagentDefaultModelCardController` 用共享表单暂存默认模型与推理等级。适配器、设置文档和凭据事件刷新目录；连接重置会丢弃模型草稿并忽略旧保存请求的后续结果。`subagentCardFace` 在同一个 `SettingsForm` 中合并三个来源，校验所有被服务的部分，再分别保存有改动的命名空间。`ctx.configForms.whileServed` 在任一命名空间被服务时注册本页。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-plugin-manager](../ui-plugin-manager/README.zh.md)——插件页以及本页注册进去的 `plugins.item` slot。
- [ui-settings](../ui-settings/README.zh.md)——本页依赖的设置 scope 与"命名空间被服务期间"的监视。
- [ui-primitives](../ui-primitives/README.zh.md)——运行限制部分渲染的设置表单模型与字段。
- [tool-subagent](../../subagent/tool-subagent/README.zh.md)——注册这两个命名空间的委派工具。

-----

<a id="model-experience"></a>
## 模型体验

无，本包是浏览器侧的设置界面，不注册任何模型面。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **模型目录不会定时轮询**——适配器、设置文档和凭据变化以及重连触发刷新；提供方在这些信号之外变更模型时，可点击**刷新模型**或**重试**。
- **运行时不变量：**不发布伴生。本页没有自己拥有的关系：它显示的内容派生自设置镜像与模型目录，它写入的内容由 Host 校验。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
