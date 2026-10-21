<!-- PERSONAL_DESKTOP_OVERVIEW -->
# Personal Desktop

**让 Agent 更智能地规划、分工和执行。**

Personal Desktop 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 改造开发的 Windows 个人桌面工作台。项目保留上游插件架构，并围绕任务决策、受控分工、桌面操作与结果验收进行扩展。

[English](README.md) | 中文

## 我们的优势

- **主模型专注决策。** 将需求分析、设计方向、任务拆解与验收判断交给用户选择的主模型，让执行工作沿明确的分工推进。
- **分工受用户控制。** 支持自定义 API 和独立执行模型配置；个人预设按当前授权名单派发，默认每次用户请求最多新建 8 个执行子代理，优先复用已有实例，禁止递归派生。
- **能与真实电脑协作。** 接入 Windows-MCP，将桌面控制保留给主模型，并提供统一执行队列及停止、恢复入口。
- **统一获取网页与平台信息。** 整合 MediaCrawler、Better Crawler、yt-dlp 和 OpenCLI 的检索路径，让任务使用共享的搜索与正文读取入口。
- **工作过程可追踪。** 提供任务交接与验收工作台、项目记忆、证据记录及运行诊断，帮助判断任务完成到了哪一步。
- **沿用插件化扩展。** 复用上游 Cordis 插件机制，模型、工具和界面能力可以按需要组合。

## 从源码启动

需要 Windows、Node.js 22.19+ 或 24+，以及项目声明的 pnpm 版本。首次构建和启动：

```powershell
git clone https://github.com/nha114514/personal-desktop.git
cd personal-desktop
powershell -NoProfile -ExecutionPolicy Bypass -File .\personal\Prepare.ps1
wscript.exe .\personal\Launch.vbs
```

运行前按需配置可用的模型账号或 API。外部 CLI、Windows-MCP 和爬虫运行环境分别按其说明安装；部分个人脚本的本地路径需结合部署位置调整。

- [个人版使用说明](personal/README.md)
- [检索与外部工具配置](personal/CRAWLERS.md)
- [项目架构](docs/architecture.zh.md)

## 当前状态

当前提供源码开发快照，包含持续改进中的实现、测试和开发记录。历史验收文档记录的是各自日期的验证范围，不能代替对当前版本的完整实机验收。

账号缓存、API 密钥、聊天记录、个人运行数据、依赖安装目录和本机构建产物不包含在公开仓库中。源码中的测试凭据为测试夹具。

## 来源与许可

本项目基于 **DeepSeek Harness** 改造开发。保留上游版权、[MIT 许可证](LICENSE)和[第三方声明](THIRD_PARTY_NOTICES.md)；外部工具分别遵循各自的许可证。

---


<details>
<summary>上游原始说明</summary>

# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

文档：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## 开发者预览

DeepSeek Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

## 社区与支持

- 通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群！扫描下方二维码填写入群问卷，小助手会定期发送入群邀请。

<table>
  <thead>
    <tr>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

`pnpm run dev:web` 会在一个终端里完成构建、启动，并在源码修改时重建 client bundle；`make help` 列出 Web 与 Desktop 对应的 Make target。完整表格见开发指南的「应用命令」一节。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 引用

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

</details>
