# Softmatrix OS deployment

本手册用于从经过审查的候选版本部署独立的 Softmatrix OS 实例，不使用 Cloudflare OS 的托管部署链接。

## Prerequisites

- Node.js 22+、pnpm 11+，以及具备 Workers、KV、R2 权限的 Cloudflare 账户。
- 实例使用的私有 DNS 名称和 TLS 证书。
- 按精确回调地址注册的组织 IdP。
- 已审批的模型服务商账户；绝不要把生产凭据写入源码或测试。

## Install

```sh
pnpm install --frozen-lockfile
pnpm verify:softmatrix
node scripts/release/build-release.mjs --out release-out --release-id softmatrix-v1-rc1
```

审查完成后才上传候选版本：

```sh
node scripts/release/upload-release.mjs --release release-out --candidate
```

## Environment and Secrets

以下变量应设置在部署服务或 Wrangler secret store 中，不能写入 `wrangler.jsonc`。

| Variable | Purpose |
| --- | --- |
| `PUBLIC_BASE_URL` | 回调与服务绑定使用的规范 HTTPS 地址 |
| `CF_ACCESS_AUD`, `CF_ACCESS_ISS` | 可选的 Cloudflare Access audience 与 issuer |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | OIDC discovery 与机密客户端 |
| `OIDC_DISPLAY_NAME`, `OIDC_ALLOWED_EMAIL_DOMAINS` | 登录按钮和精确域名策略 |
| `DISABLE_PASSWORD_AUTH` | 仅在 OIDC/Access 冒烟检查后设置为 `true` |
| `ORG_AI_MODELS` | 组织模型目录 JSON；凭据应使用 secret 引用 |
| `ALLOW_USER_BYOK` | 明确启用或禁用个人模型凭据 |
| `CF_AI_GATEWAY`, `CF_AI_GATEWAY_ACCOUNT_ID` | 可选的受治理 AI Gateway 路由 |
| `CF_AI_GATEWAY_API_TOKEN` | AI Gateway run/read secret |
| `ADMINS` | 管理员用户名 JSON 数组 |

## Cloudflare Access

启用 Access 时，在部署服务中配置 audience 和 team issuer。验证允许用户、过期断言以及来自其他
Access team 的用户。断言无效时，后端必须在读取错误报告正文前失败关闭。

## OIDC

向 IdP 注册 `{{PUBLIC_BASE_URL}}/api/auth/oidc/callback`。验证 discovery issuer、RS256/JWKS、PKCE
S256、state、nonce、精确 audience、过期时间、`email_verified` 和域名白名单。开启密码认证关闭前，
测试取消、重放、重复参数和服务商不可用。

## Model catalog and BYOK

`ORG_AI_MODELS` 是组织所有的模型目录。受治理部署设置 `ALLOW_USER_BYOK=false`，确认界面没有个人
凭据控件。若批准 BYOK，测试凭据失败，确认浏览器只收到稳定错误码和 correlation ID。在聊天中显式切换
模型并验证按用户持久化。

## Backup

备份 Durable Object migrations、KV 命名空间（`BLUEPRINTS`、`AVATARS`）、R2 blueprint 内容以及发布
版本 ID。每次生产发布前，在临时账户测试工作区和对应法务 sidecar 的恢复。

## Monitoring

监控 Worker 错误、OIDC 失败码、模型策略拒绝、Gatekeeper 审批、延迟、限流饱和度和 release manifest
可用性。当 manifest 存在但法务对象或内容寻址 blob 不完整时告警。

## Secret rotation

通过 secret store 轮换 OIDC client secret、Access key、模型服务商 token 和 AI Gateway token。部署新的候选
版本并完成冒烟检查后撤销旧值。绝不记录 secret、prompt、模型响应或 authorization code。

## Common failures

- `OIDC_PROVIDER_UNAVAILABLE`：检查 discovery/JWKS 可达性和 issuer 配置。
- `OIDC_DOMAIN_NOT_ALLOWED`：在 `OIDC_ALLOWED_EMAIL_DOMAINS` 中使用精确的小写域名。
- `MODEL_CREDENTIAL_INVALID`：轮换服务商凭据，不要暴露服务商响应正文。
- 模型目录缺失：在启用 BYOK 前检查 JSON 语法和组织策略。
- 法务制品缺失：停止晋级并重新构建候选版本。

## Upgrade

构建并上传新候选版本，运行 `pnpm test:e2e`，部署到隔离 staging，并将候选 manifest/法务 sidecar 与
上一版本比较。只有 QA 和安全审批后才允许 promote。

## Rollback

晋级前记录当前 release ID。通过 promote 该精确的旧 ID 回滚；法务文件和 sidecar 会在 manifest 之前复制。
重新运行双语登录、模型策略和 Gatekeeper 冒烟检查，然后调查失败候选版本。

## Support boundaries

Softmatrix OS 是从 Cloudflare OS 衍生的独立 Apache-2.0 项目。Cloudflare 不运营此发行版，也不提供其
IdP、模型服务商或部署支持。

