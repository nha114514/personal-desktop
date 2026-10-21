# 移除自定义 API 思考强度

用户要求删除刚才的思考强度接口。本次范围是新加的自定义 API 模型：移除模型设置页手工声明等级的开关/胶囊，并将活动 qwen 目录的模型设为 `reasoningEfforts: false`，移除该路由主模型的强度默认值。模型 ID、容量、接口协议、凭据及其他配置保持不变，Codex/Gemini 原生能力保留。不会把删除强度描述为已经修复远端 Unsupported model。

执行步骤：

- [x] 用 ModelRow 回归先确认移除前仍渲染等级开关，出现预期失败后删除控件。
- [x] 删除 ModelReasoningEfforts 组件、样式、文案和旧功能测试，保留输入类型与容量编辑。
- [x] 对活动配置作精确迁移；比较除授权强度字段外的完整配置，保留本地备份和配置变动竞争检查。
- [x] 使用实际 SDK 与 loopback HTTP 验证全部 12 个自定义模型不发送 reasoning/thinking 参数，不调用真实付费模型；其他提供方的既有适配器测试通过。
- [x] 两个客户端程序类型检查及 bundle 构建通过；7 个测试文件共 140 项通过，无失败、无跳过。两组 README 双语检查和定向 diff 空白检查通过。
- [x] 使用 Windows-MCP 检查真实界面。刷新曾因资源加载失败出现恢复对话框，使用其正常重启后恢复；未禁用插件、未重置配置。当前主界面显示 `deepseek-v4.1-flash-1017`，无强度等级后缀。

## 验证证据与边界

- `.artifacts/remove-api-reasoning-20261020/tests.json`：88 项通过，含 12 模型实际 SDK 本地 HTTP 请求捕获。
- `.artifacts/remove-api-reasoning-20261020/selection-tests.json`：52 项通过，覆盖同模型重新选择时清除旧 effort，保持原生有推理能力模型的选择行为。
- `.artifacts/remove-api-reasoning-20261020/wire.json`：12 个模型均无 `reasoning`、`reasoning_effort`、`thinking`、`thinking_budget` 请求字段，模型目录不再提供等级选择。
- `.artifacts/remove-api-reasoning-20261020/migration.json`：精确配置迁移、模型 ID 清单及私有备份位置。迁移提交时完整非目标配置逐项一致。随后界面中的主模型选择变为上述 DeepSeek，最终检查保留这一最新选择；不以旧 hash 覆盖新选择。模型清单及其余配置仍保持。
- `.artifacts/remove-api-reasoning-20261020/wire.spec.ts`：本机专项探针归档；默认测试目录已移除依赖私人配置的临时测试，保留通用 UI 回归。

此次没有调用真实远端模型，也没有验证新选模型可成功推理。旧 MiMo 的 `Unsupported model` 属于单独的上游模型/协议问题，不能因本次移除强度而标为已解决。已保存等级的其他历史会话可重新选择同一个模型清掉旧值，不改写历史日志。

后续自修复交接中的 R4 原“恢复手动等级控件”方向已由本次要求覆盖。原验收报告和证据保持历史原样，其他待修项目仍未完成。
