# Softmatrix OS 单 VM 完全自托管设计

- **状态**：已确认，待拆解实施计划
- **日期**：2026-08-09
- **产品**：Softmatrix OS
- **目标**：生产环境不依赖 Cloudflare Workers、KV、R2、Access 或 AI Gateway，全部运行在用户自有的一台 VM 上
- **运行时基线**：standalone `workerd`
- **部署形态**：单节点、可备份、可回滚；本阶段不承诺多节点高可用

## 1. 决策摘要

Softmatrix OS 保留现有 Worker、Durable Object、Cap'n Web RPC、Gatekeeper 和动态 Worker
模型，但增加 VM 自托管运行时边界。生产实例由 standalone `workerd` 承载，Caddy 或 Nginx
负责 TLS 和反向代理，应用状态写入 VM 的持久化卷。Cloudflare 的生产服务绑定不再是必需
依赖；现有 Cloudflare 集成只作为可选兼容能力，不进入 VM 发布 profile。

首次发布采用单 VM 部署，优先保证数据持久化、备份、升级和回滚，而不是横向扩展。单 VM
故障属于已知可接受风险，恢复目标由备份频率和恢复演练定义。

## 2. 目标与非目标

### 2.1 目标

- 一台干净 VM 可以从 release artifact 安装并启动 Softmatrix OS。
- 生产运行时不需要 Cloudflare 账号、Workers、KV、R2、Access 或 AI Gateway。
- 保留英文/简体中文、OIDC SSO、组织模型、BYOK、Gatekeeper 和现有核心工作流。
- Worker/DO 迁移、数据备份、健康检查、升级和回滚均有可执行命令。
- 密钥、用户数据、提示词和模型响应不进入 release artifact、日志或错误响应。

### 2.2 非目标

- 多 VM 高可用、自动扩缩容和跨节点 Durable Object 调度。
- 将所有业务代码重写为 Node.js/Express 或其他非 Worker 框架。
- Cloudflare Access 作为 VM 内认证方式。
- Cloudflare AI Gateway 作为 VM 内模型路由或计费依赖。
- 在本阶段实现 Kubernetes operator、自动证书平台或托管控制面板。

## 3. 架构

```text
Internet
   │
   ▼
Caddy/Nginx (TLS, proxy, limits)
   │
   ▼
standalone workerd
   ├── router Worker
   ├── workshop-backend Worker
   ├── Gatekeeper Workers
   ├── Dynamic Worker / loader runtime
   └── Durable Object SQLite storage
          │
          ├── VM SQLite KV adapter
          ├── VM object-store adapter (filesystem or MinIO)
          ├── local secret provider
          └── direct LLM provider APIs
```

### 3.1 Runtime boundary

- `workerd` 是唯一生产 Worker runtime；`pnpm run-local` 仅用于开发和测试。
- 所有 Worker、Gatekeeper、service binding、worker loader 和 Dynamic Worker Facet 必须在
  standalone 配置下可解析。
- 现有 Durable Object SQLite migrations (`v0`–`v3`) 保持顺序和语义不变。
- VM profile 不生成或要求 `$ACCOUNT_ID`、`$KV_*`、`$R2_*`、`$WORKERS_AI` 等 Cloudflare
  部署占位符。

### 3.2 状态与存储

#### Durable Object 状态

User、Overseer、AdminSettings、PendingLogin 和 OidcLogin Durable Object 继续使用
`workerd` 的 SQLite durable storage。运行目录必须位于显式持久化卷，不得使用临时目录。

#### KV

新增 `VmKvStore` 接口，覆盖当前实际使用的 `get`、`put`、`delete`、`list` 和 metadata
语义。默认实现使用同一 VM 上的 SQLite 数据库，并提供命名空间隔离、事务边界和备份导出。
Cloudflare `KVNamespace` 通过 adapter 接入现有业务代码；应用层不直接依赖 Cloudflare
KV 类型。

#### 对象存储

新增 `VmObjectStore` 接口，覆盖 Blueprint 内容、截图、站点 Logo 和 release object 的
读写、删除、列表、范围读取及 content metadata。首发默认使用 VM 本地对象目录；可选使用
同一 VM 内的 MinIO 作为 S3-compatible backend。对象 key 和版本格式保持现有约定。

#### 备份

- SQLite 数据库使用一致性快照。
- 对象目录或 MinIO bucket 使用版本化快照/归档。
- 每个备份记录 release ID、schema/migration 版本、时间、大小和 SHA-256。
- 恢复必须先在隔离目录完成，再切换生产数据目录。

### 3.3 认证

- 保留密码登录和通用 OIDC。
- OIDC callback 使用 VM 公网地址：`<PUBLIC_BASE_URL>/api/auth/oidc/callback`。
- `CF_ACCESS_AUD`、`CF_ACCESS_ISS` 在 VM profile 中禁用；如需额外入口保护，由反向代理
  或独立 OIDC proxy 实现，不能改变应用内部会话语义。
- OIDC secret 只能来自 Docker secret、systemd protected environment、Vault 或同等密钥
  存储。
- 首次部署保留密码登录，完成 OIDC staging 验收后才允许关闭密码登录。

### 3.4 多 LLM

- 组织模型仍由 `ORG_AI_MODELS` 描述，前端只能收到脱敏 catalog。
- 模型凭据从 VM secret provider 读取，不写入 catalog、SQLite 普通数据、release manifest
  或日志。
- 直接调用 OpenAI、Anthropic、Google、Ollama 等 provider；每个 provider 通过已存在的
  adapter/兼容 API 配置。
- `ALLOW_USER_BYOK` 继续由服务端强制执行。
- `CF_AI_GATEWAY*` 和 Workers AI 在 VM profile 中不可用；选择这些 provider 时必须得到
  明确的配置错误，不能静默 fallback。

### 3.5 网络与进程

- Caddy/Nginx 只暴露 HTTPS 和必要的 WebSocket/Cap'n Web 路径。
- `workerd` 仅绑定 loopback 或私有网卡，禁止直接暴露管理端口。
- 限制请求体、文件附件、OIDC callback、登录尝试和模型调用速率。
- systemd/Docker restart policy 负责进程恢复；健康检查区分 liveness 和 readiness。
- 日志输出 JSON，包含 correlation ID 和稳定错误码，不包含 secret、authorization code、
  prompt 或完整 model response。

## 4. 发布模型

VM 发布不再上传 Cloudflare release manifest，而是生成本地 immutable release 目录：

```text
/var/lib/softmatrix/releases/<release-id>/
/var/lib/softmatrix/current -> releases/<release-id>
/var/lib/softmatrix/previous -> releases/<previous-id>
```

发布顺序：

1. 从固定 Git commit 构建 Worker bundle、前端资产、法律文件和 VM runtime config。
2. 扫描 secret、依赖许可证和 manifest 内容。
3. 写入新的 release 目录并校验 SHA-256。
4. 在 offline/isolated 数据副本上执行 migration dry-run。
5. 运行 liveness/readiness、英文/中文、OIDC、模型和 Gatekeeper smoke tests。
6. 原子切换 `current`，重启或 reload `workerd`。
7. 失败时恢复 `previous` 链接和对应 runtime/config 快照。

发布工具必须支持：

- `build-vm-release`
- `install-vm-release`
- `healthcheck-vm-release`
- `rollback-vm-release`
- `backup-vm-data` / `restore-vm-data`

## 5. 配置契约

非敏感配置可使用受版本控制的模板；敏感配置只能通过 secret provider 注入。首发至少
支持：

- `PUBLIC_BASE_URL`
- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `OIDC_ALLOWED_EMAIL_DOMAINS`
- `DISABLE_PASSWORD_AUTH`
- `ORG_AI_MODELS`
- `ALLOW_USER_BYOK`
- `ADMINS`
- 各模型 provider 的 secret 引用
- `SOFTMATRIX_DATA_DIR`
- `SOFTMATRIX_OBJECT_STORE_DIR` 或 MinIO endpoint/credentials

配置加载必须原子化：缺少必需项、JSON 非法、provider 不支持或路径权限不足时，进程启动
失败并返回稳定错误码，不得以空配置启动并造成静默降级。

## 6. 验收标准

### 功能

- 单台 VM 重启后用户、workspace、Blueprint、聊天和模型偏好保持不变。
- 英文和中文核心流程通过：登录、创建 workspace、聊天、模型选择、设置和管理操作。
- OIDC 登录、取消、域名拒绝、state/nonce 重放、provider outage 均有明确结果。
- 组织模型、BYOK 禁用/启用、凭据失败和模型不可用策略均符合服务端 policy。
- Gatekeeper 能完成连接、授权、审批和错误处理。

### 运维

- 从空 VM 安装并启动不依赖 Cloudflare 账号。
- 数据备份可以在隔离目录恢复并通过 checksum 校验。
- 发布失败可以在五分钟内切回上一版本，且旧数据和旧配置可用。
- 健康检查、错误日志、磁盘空间、备份年龄和模型错误率可观测。

### 安全与合规

- Git、release artifact、日志、RPC 和前端 bundle 无 secret。
- Apache-2.0、NOTICE、第三方声明随 release 提供。
- HTTPS、OIDC callback、管理入口和内部端口均有明确网络边界。
- 单 VM 限制、备份策略、恢复责任和支持边界写入中英文运维文档。

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| standalone `workerd` 与本地 binding 能力存在差异 | 高 | 先做 runtime smoke harness，再迁移业务；失败时由 adapter 隔离差异 |
| 单 VM 磁盘损坏 | 高 | 独立备份介质、checksum、定期恢复演练 |
| KV/R2 adapter 与现有语义不一致 | 高 | 先覆盖实际调用的 list/range/metadata 行为，再运行数据兼容测试 |
| Dynamic Worker/Facet 加载失败 | 高 | 将全部 worker loader 和 Gatekeeper 纳入启动与 E2E 验收 |
| 模型供应商不可用 | 中 | 明确错误、人工切换，不做静默 fallback |
| VM 被入侵导致 secret 泄漏 | 高 | 最小权限、secret provider、磁盘加密、网络隔离和轮换流程 |

## 8. 迁移原则

1. 先实现接口和测试，再替换生产 binding；保持 Cloudflare adapter 可用于现有测试。
2. 每次只迁移一个存储边界，完成数据兼容和恢复测试后再进入下一项。
3. 不修改用户数据格式，不把 Cloudflare 专有 ID 暴露到新的公共 API。
4. VM profile 与 Cloudflare profile 明确分离，禁止通过环境变量隐式混用。
5. 未通过空 VM 安装、重启、备份恢复和回滚演练，不进入首次生产发布。
