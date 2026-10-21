# Gemini 双账号登录与 CLI

个人桌面现在优先使用本机官方 Antigravity CLI `agy 1.2.16`，路径为 `C:\Users\mouwe\AppData\Local\agy\bin\agy.exe`。旧 Gemini CLI `0.62.0` 已在真实 Google 授权后收到个人版客户端停用错误，保留的旧启动器用于历史兼容，不是当前登录入口。

## 界面登录

1. 从 `D:\desktop\Personal Desktop.cmd` 启动桌面，进入“设置 → Gemini 账号”。
2. 点击账号 1 的“一键登录”，在打开的 Google 页面选择第一个账号并完成授权。
3. 如果官方 CLI 要求授权码，界面会提供对应账号的输入框；仅在 Google 页面确实显示授权码时，将其粘贴到应用内并提交。不要将授权码或带参数的授权网址发送到聊天。
4. 账号 2 使用同样步骤，并在 Google 页面选择第二个账号。每个账号分别验证，失败时不会自动切换账号。

界面只有在官方 CLI 的真实模型请求返回成功且内容为 `OK` 时，才显示“账号请求已验证”。打开浏览器、存在缓存或缓存中的 onboarding 标记均不能替代调用结果。重启后显示未验证，需要重新验证已有授权。

官方 CLI 的远程登录等待约 60 秒；超过时限请重新点击登录，从新授权页继续。不要刷新已结束登录流程的 localhost 回跳页面。取消会结束对应的 CLI 子进程，关闭回跳监听。

## 两个 CLI 入口

双击 `D:\desktop\Gemini Account 1.cmd` 或 `D:\desktop\Gemini Account 2.cmd`。入口调用官方 Antigravity CLI，而不是旧 npm Gemini CLI。PowerShell 等效命令：

```powershell
node .\personal\AntigravityCli.mjs --account 1 --
node .\personal\AntigravityCli.mjs --account 2 --
```

两个独立目录为：

- `D:\desktop\personal-data\antigravity\account-1`
- `D:\desktop\personal-data\antigravity\account-2`

仅改变 `HOME` 或 `USERPROFILE` 时，Windows CLI 仍可能复用全局凭据管理器中的授权。当前启动器同时启用官方 CLI 的远程 OAuth 流程；本机对照测试中，空账号目录已要求重新登录，没有复用全局账号。目录权限仅授予当前 Windows 用户和 SYSTEM。凭据由官方 CLI 保存与读取，应用不读取或复制原有凭据。

目前尚未完成两个账号的新流程授权及重启后复用验收，因此不能宣称双账号持久化已全部验证。官方原生 profile 支持仍在讨论中；远程 OAuth 的文件存储行为也应在 CLI 升级后重新验证。

## 模型与推理等级

2026-10-03，本机 `agy 1.2.16 models` 实际返回以下 Gemini 3.1 及以上模型：

| 模型 | 推理等级 |
| --- | --- |
| `gemini-3.8-flash` | `low`、`medium`、`high` |
| `gemini-3.7-flash` | `low`、`medium`、`high` |
| `gemini-3.6-flash` | `low`、`medium`、`high` |
| `gemini-3.1-pro` | `low`、`high` |

会员权益及可调用模型按实际账号和官方返回判断，不合并两个账号的额度。CLI 启动器会剔除继承的 API 密钥与外部认证环境变量；账号设置存在 `modelProvider` 时会停止并保留文件，避免账号入口意外使用 API。

## Harness 接入范围

登录控制器支持 Antigravity 的结构化 print 输出，可发起独立账号的短验证请求。账号授权网址只交给系统浏览器，授权码只写入对应 CLI 的标准输入，不进入模型对话或应用日志。

旧 `subagent_gemini_1`、`subagent_gemini_2` 使用 Gemini ACP 协议。Antigravity CLI 使用 print / stream-json，不能把二进制路径替换后当作 ACP 兼容。任务路由尚未迁移，登录成功也不会自动启用这两个旧工具。

进程内 `gemini` LLM provider 使用官方 API，需要 API 凭据；它与这里的会员账号登录分别配置。不要把会员登录状态视为该 API provider 已接通。

依据：[官方安装和认证](https://antigravity.google/docs/cli/install/)、[Gemini CLI 迁移说明](https://antigravity.google/docs/gcli-migration/)、[官方 profile 功能讨论](https://github.com/google-antigravity/antigravity-cli/issues/381)。
