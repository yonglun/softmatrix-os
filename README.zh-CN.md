# Softmatrix OS：AI 生产力环境

[English](README.md) | 简体中文

Softmatrix OS 是基于 [Cloudflare OS](https://github.com/cloudflare/cloudflare-os) 派生的独立发行版。它保留上游的 [Apache License 2.0](LICENSE) 许可证及 [NOTICE](NOTICE) 中记录的归属信息。Softmatrix OS 不隶属于 Cloudflare，也未获得 Cloudflare 的赞助或背书。

上游 Cloudflare OS 项目是一个最初为 Cloudflare 内部开发的 AI 生产力“操作系统”。Softmatrix OS 延续这一架构，作为独立 fork，面向希望自行部署和定制平台的组织。

合规状态以及发布前必须完成的第三方许可证清单要求，记录在[合规基线](docs/compliance.md)中。本源代码里程碑尚不是生产发行版。

![上游 Cloudflare OS Q3 规划工作区及 AI 生成的演示文稿](docs/images/q3-planning-workspace.png)

*上图仅作为架构参考，展示的是上游界面；Softmatrix OS 已替换默认产品标识。*

这里的“操作系统”并不是传统意义上的计算机操作系统，而是同时包含两层含义：

* 面向公司的操作系统：以安全的方式帮助团队借助 AI 提高生产力，让安全团队可以安心工作。
* 面向 AI 工作负载的操作系统：类似传统操作系统管理计算工作负载的方式，管理 AI 应用和代理。

Softmatrix OS 主要提供三项能力：

1. **代理聊天界面**：你可以让代理执行任务，并预先提供关于公司运作方式的知识。
2. **沙箱化应用开发**：你可以让代理构建“小工具”（Gadgets，即小型个人应用），并安全地与他人分享。
3. **安全框架**：名为 Gatekeepers 的安全框架同时约束代理和应用，让非技术用户也能放心探索，而不会轻易造成安全事故。

Softmatrix OS 保持开源，组织可以复制它并按自身需求定制。目标不是让所有人使用一个固定产品，而是让每个组织都拥有自己的“*Your Company* OS”。

## 快速开始

要在本地快速运行 Softmatrix OS，请先[安装 pnpm](https://pnpm.io/)，然后执行：

    pnpm run-local

接着访问：http://localhost:8787

该命令会在 wrangler 和 workerd 上本地运行完整技术栈。它不适合生产环境，只用于快速体验产品能力。

（更多运行方式见本文末尾。）

### 可以尝试什么

可以尝试以下提示词：

* “为我和客户即将举行的会议制作演示文稿。”（会使用内置的幻灯片 Blueprint。）
* “制作一个协作白板应用。”（会从零创建一个新应用。）
* “制作一个井字棋游戏。”然后说：“我执 X，你执 O。我已经走了第一步，该你了。”
* “为这个 GitHub 仓库制作问题看板。”（附加仓库后即可使用，但需要先配置 GitHub 集成。）
* “修正这个 Google 文档中的错别字。”（附加文档后即可使用，但需要先配置 Google 集成。）

### 警告：早期体验版

Softmatrix OS 仍处于快速开发阶段。本仓库是版本 2，是一次完整重写，建立在全新基础之上，同时吸收了版本 1 的经验。

截至 2026 年 8 月版本，Softmatrix OS v2 已经具备较强能力，但仍存在不少粗糙之处。我们对此有清晰认识，并会持续改进。目前请将其视为“早期体验版”。

## Softmatrix OS 到底是什么？

### Gadgets：一种全新的软件思路

Softmatrix OS 不只是一个带连接器的聊天框。它围绕一种新的软件理念构建：每个用户都可以运行自己使用的生产力应用副本。

当你在 Softmatrix OS 中制作一套幻灯片时，并不是调用云端运行的某个 SaaS 软件。系统会为你创建一个专属的幻灯片软件实例。我们把这种实例称为一个“Gadget”。它运行在与其他用户幻灯片隔离的独立沙箱中。

这会带来两个重要影响：

1. 即使幻灯片应用本身存在安全漏洞，也无法轻易泄露你的幻灯片。Softmatrix OS 的沙箱控制着该私有实例的全部访问权限。
2. 你可以自由修改代码。如果幻灯片应用缺少某项功能，只需让代理为你添加即可。由于第一点，这样做仍然是安全的。

这与过去 25 年的云架构和“软件即服务”模式有很大不同，但我们认为 AI 已经改变了软件开发的平衡。当任何用户都能通过提示词让代理增加所需功能时，软件的集中式模型就不再总是合理。

### Gatekeepers：基于能力的安全层

Gatekeepers 可以理解为增强版的 MCP 服务器。

当你要让代理或 Gadget 访问外部资源时，会创建一个 Gatekeeper 来管理这项访问。每个 Gatekeeper 都针对特定外部服务实现，负责调节 Gadget 与该服务之间的连接。它会：

* 为服务提供简洁的 Cap'n Web API，封装服务原生 API 的复杂性。
* 处理授权，例如 OAuth。
* 将访问范围限制在用户明确指定的资源上。
* 记录 Gadget 或代理执行的每个操作，供你审查。
* 对具有副作用的操作，让用户有机会批准或拒绝，即实现“人在回路中”。

最后一点是 Gatekeeper 对现有实践的重要改进。传统的人工审批通常要求同步进行：代理要执行操作时必须停下来等待批准。这很麻烦——你给代理安排任务后去喝杯咖啡，回来却发现它在第一步就因为等待审批而卡住了。于是人们常常选择自动批准，甚至使用 `--dangerously-skip-permissions`，这显然不安全。

Gatekeeper 提供了更好的方式。当代理或 Gadget 执行需要审批的操作时，Gatekeeper 会在本地模拟结果，让代理继续工作并排队更多操作。Gatekeeper 告诉代理操作已经完成；如果代理尝试读取结果，Gatekeeper 会返回模拟结果。代理完成任务后，用户可以批量或逐条批准、拒绝这些操作，并且可以在方便时再处理。

从工程上看，每个 Gatekeeper 都是一个独立 Worker。未来我们希望 Gatekeeper 服务可以独立于 OS 实例进行部署和维护，但具体方案仍在设计中。目前，本仓库提供了一些可以和你自己的 OS 实例一起部署的 Gatekeeper。

### 把它想象成办公套件

Softmatrix OS 的基础体验有点像在线办公套件，例如 Google Docs 或 Microsoft Office。但这里不再只有固定的文档、表格和幻灯片类型；每个文件（或称“Gadget”）都可能是一个由 AI 为特定需求编写的定制应用。

和办公文档一样，每个 Gadget 默认是私有的，但也可以安全地共享给团队或朋友协作。

和办公文档一样，你可以拥有成千上万个 Gadget，随时创建新的 Gadget。

和办公文档一样，你可以从“模板”开始，只是这里的模板称为“Blueprint”。但 Blueprint 描述的是整个应用，而不只是一些内容。

你还可以从自己的文档（Gadget）创建新 Blueprint，并与他人分享。分享的其实是一整个应用的代码。

### 它确实有点像操作系统

“操作系统”这个称呼并不完全是营销。Softmatrix OS 在技术层面确实类似一个操作系统：

| 传统操作系统 | Softmatrix OS |
| --- | --- |
| 内核 | `packages/workshop-backend` |
| 设备驱动 | `packages/gatekeeper-*` |
| Shell | `packages/workshop-frontend` |
| 进程 | Gadgets |
| 可执行文件 | Blueprints |
| 用户 | 用户 |
| ACL | 共享权限 |
| ??? | 代理 |

我们的“内核”是 `workshop-backend` 包。后端确实执行了许多类似真实操作系统内核的工作：将用户连接到程序和设备（也就是 Gadgets 与 Gatekeepers），并通过应用沙箱和访问控制实现安全性。

在这个类比中，连接用户、代理与外部服务的 Gatekeeper，就像连接用户、程序与外部设备的驱动程序。

传统操作系统今天通常不会管理的一项内容是 AI 代理，而 Softmatrix OS 会管理。我们认为 AI 代理不能简单地被视为用户：它们必须对人类用户负责，同时拥有受限制的独立权限。代理通过编写代码片段并即时执行来完成工作。对这种工作方式而言，基于能力的安全模型比访问控制列表更理想。也许传统操作系统也应该为 AI 代理提供特殊待遇。

### 构建于 Cloudflare Workers 之上

Softmatrix OS 构建于 [Cloudflare Workers](https://workers.cloudflare.com)，重点使用了 [Durable Objects](https://developers.cloudflare.com/durable-objects/)、[Dynamic Workers](https://blog.cloudflare.com/dynamic-workers/) 和 [Facets](https://blog.cloudflare.com/durable-object-facets-dynamic-workers/) 等能力。每个工作区都是一个 Durable Object，每个 Gadget 都运行在 Dynamic Worker Facet 中，而 Gatekeeper 也会向每个工作区安装 Facet 来管理远程服务访问。

底层架构源自 Cloudflare OS，由构建 Workers 的团队设计。Dynamic Workers、Facets 和其他运行时能力，都是为了支持上游项目而加入的。Softmatrix OS 保留了这套架构，同时维护清晰、独立的产品身份。

构建于 Workers 之上并不意味着 Softmatrix OS 只能运行在 Cloudflare 上。事实上，[`workerd`（Cloudflare Workers Runtime）本身就是开源项目](https://github.com/cloudflare/workerd)，Softmatrix OS 可以完全运行在你自己的服务器上。

## 功能

### 通用多用途代理

Softmatrix OS 的编码代理实际上是一个可以执行任意任务的通用代理。和其他流行的编码代理一样，你不必真的用它来编程。你可以让它构建 Gadget，也可以跳过 Gadget，直接让代理完成任务。Softmatrix OS 代理是一个 [Code Mode](https://blog.cloudflare.com/code-mode/) 代理：它通过编写并立即执行代码片段来完成任务，也可以通过 Gatekeeper（类似 MCP）连接外部资源。

### 用 AI 构建应用

如果你愿意，也可以手动编写 Gadget；但我们的预期是由 AI 为你编写代码。Softmatrix OS 内置的编码代理会按你的要求构建应用、测试应用并调试错误。

你可以选择 LLM。Softmatrix OS 支持许多主流 AI 模型提供商和自托管模型，未来还会持续增加更多提供商。

由于平台高度集成且使用方式简单，即使底层使用相同 AI 模型，Softmatrix OS 编码代理通常也能以更少 token、更快速度完成任务，表现优于通用编码代理。

### 与 AI 协作

使用 Softmatrix OS 构建的每个应用都会自动拥有对代理友好的 API。让 AI 构建应用后，你还可以继续让 AI 在应用内部与你协作。不需要额外编写 MCP 服务器，也不需要集成自定义代理循环，应用默认就具备这些能力。

这是因为 Gadget 的客户端和服务端必须通过 [Cap'n Web RPC](https://github.com/cloudflare/capnweb) 通信。这是双赢的设计：

1. Cap'n Web 的样板代码极少，代理很容易使用。你只需在服务端定义方法，就能从客户端像调用本地方法一样调用它。
2. 同时，服务端必然暴露出易于理解的 API，代理可以直接调用。AI 代理运行时使用 [Code Mode](https://blog.cloudflare.com/code-mode/) 进行工具调用，因此将 Gadget API 暴露给代理非常简单。

### 实时多人协作

你可以像分享在线文档一样分享 Gadget。你可以授予指定用户访问权限，也可以创建分享链接，让任何打开链接的人访问。和在线办公套件一样，你能实时看到协作者的操作。

每个 Gadget 都由一个 [Durable Object](https://developers.cloudflare.com/durable-objects/) 支撑。Durable Object 是 Cloudflare 提供的有状态无服务器原语，可以轻松实现实时多人协作，因此编码代理无需额外提示就能默认实现这项能力。

### Blueprint：分享你的代码

如果你创建的 Gadget 对他人有用，但不想直接分享 Gadget 本身，可以分享 Blueprint，让其他人创建自己的 Gadget 副本。Blueprint 本质上是一份应用代码副本。

这听起来简单，却改变了传统云软件的工作方式。传统上，如果你想把 Web 应用分享给其他用户，需要把应用部署在自己的服务器上；而 Blueprint 更像手机应用或传统 PC 应用：每个人运行自己的软件副本。

在 AI 时代，这种变化非常重要。一方面，AI 让个人开发者比过去更有能力，但个人仍然很难维护一个在线服务；Blueprint 消除了这项负担。另一方面，更重要的是，每个用户都能运行软件自己的副本，也就能用 AI 修改软件以满足自己的需求。不必提交功能请求，也不必等待开发者排期，最终用户可以自己解决问题。

### 默认沙箱与安全

每个 Gadget 都运行在安全沙箱中，默认完全不能访问互联网，除非你明确授予许可。具体来说：

* 服务端运行在一个被禁用互联网访问的 [Dynamic Worker](https://blog.cloudflare.com/dynamic-workers/) 中。它只能通过 [Workers Bindings](https://blog.cloudflare.com/workers-environment-live-object-bindings/) 与你明确指定的外部资源通信。
* 客户端代码运行在沙箱 iframe 中。这个 iframe 只能通过父框架经 `postMessage()` 提供的 Cap'n Web RPC 会话与服务端通信；在浏览器允许的最大范围内，它通过 `Content-Security-Policy` 和 iframe sandbox 设置被阻止访问互联网。

### 基于能力的访问控制

默认情况下，每个代理和每个 Gadget 都没有任何访问权限。即使你已经为 Gadget Workshop 配置了外部账号，代理和 Gadget 也不会自动获得这些账号的使用权。

你必须显式地把想要访问的资源介绍给某个代理或 Gadget。例如，你可以粘贴 GitHub 仓库链接，或点击“添加资源”并通过界面选择资源。代理也可以请求介绍它认为需要的资源，然后由你决定允许还是拒绝。

这与大多数预先配置 MCP 服务器的代理运行环境不同：那些环境会让每个聊天默认拥有所有服务的广泛访问权限。基于能力的资源介绍机制，只授予代理完成当前任务实际需要的权限。

## 开始使用

### 部署状态

Cloudflare 的[托管部署流程](https://os.cloudflare.app/deploy)和[部署启动模板](https://github.com/cloudflare/cloudflare-os-starter)面向上游 Cloudflare OS 项目，而不是本 Softmatrix OS fork。Softmatrix 专属的生产部署说明会在首个正式版本发布前提供。请不要误以为这些上游流程会部署本仓库中的修改。

### 本地运行

要快速运行 Softmatrix OS，请先[安装 pnpm](https://pnpm.io/)，然后执行：

    pnpm run-local

接着访问：http://localhost:8787

该命令通过 `wrangler`（Workers 开发工具 CLI）运行 Softmatrix OS。它不是在生产服务器上运行 OS 的正确方式，但非常适合本地体验。

你的数据会存储在名为 `.wrangler` 的子目录中。

### 使用 `workerd` 部署到自己的服务器

**即将推出**

Softmatrix OS 可以完全运行在 `workerd` 上。事实上，上面的本地运行命令就在底层使用 `workerd`。我们仍在完善相关文档和工具，以便你顺利把 OS 部署到自己的服务器。如果你愿意尝试，可以阅读 [workerd 配置低级文档](https://github.com/cloudflare/workerd/blob/main/src/workerd/server/workerd.capnp)，也可以让代理协助你研究。

#### 配置外部服务

许多 Gatekeeper 需要额外配置，才能连接第三方服务并获取每项服务的 OAuth 客户端凭据。遗憾的是，许多服务提供商有意让这一步不够简单，因为 OAuth 的目标用户通常是开发者。

每个 Gatekeeper 包都包含自己的配置说明：

* [GitHub API](packages/gatekeeper-github/README.md)
* [Google API](packages/gatekeeper-google/README.md)
* [Cloudflare API](packages/gatekeeper-cloudflare/README.md)
* [Supabase API](packages/gatekeeper-supabase/README.md)
* [Notion API](packages/gatekeeper-notion/README.md)
* [Confluence API](packages/gatekeeper-confluence/README.md)
* [Email Workers](packages/gatekeeper-email/README.md)
* [Home Assistant](packages/gatekeeper-homeassistant/README.md)
* [Slack API](packages/gatekeeper-slack/README.md)
* [Spotify](packages/gatekeeper-spotify/README.md)
* [ZoomInfo API](packages/gatekeeper-zoominfo/README.md)

## 开发

开发时，建议在两个终端中分别运行前端和后端：

    pnpm dev-server
    pnpm dev-client

然后访问：http://localhost:3000

### 贡献代码

目前我们暂不寻求外部贡献。

今天，AI 已经让编写代码变得容易。真正困难的是审查代码、保证质量并保持产品的一致性。因此，外部代码贡献虽然容易提交，却会带来更多审查和维护工作。

如果你愿意，我们仍然接受小型且容易验证的修复类 PR。但请避免提交低价值 PR（例如错别字修正）或超过十几行的 PR。此类 PR 可能会被关闭，并附上本指南作为说明。

Softmatrix OS 独立的讨论渠道尚未发布。请不要把 Softmatrix 特有的提案提交到上游项目；在独立 `origin` 建立后，仓库维护者应在这里补充项目自己的 issue 或讨论链接。

随着项目成熟，这项政策可能会改变。在此之前，感谢你的理解。

## 致谢

Softmatrix OS 依赖的开源项目很多，无法在此全部列出；下面列出几项承担重要工作的项目：

* [Pi](https://pi.dev/)（特别是 `pi-agent-core`），让我们可以通过一个 API 支持所有 LLM 提供商。
* [Monaco](https://microsoft.github.io/monaco-editor/)，让我们可以轻松嵌入漂亮的文本编辑器——献给仍然喜欢查看代码的人。
* [Yjs](https://yjs.dev/)，我们大量使用它在客户端与代理之间同步代码变更，并重放历史记录。
* [Vite](https://vite.dev/)，让开发循环变得非常顺畅。
