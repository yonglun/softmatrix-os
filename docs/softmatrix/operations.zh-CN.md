# Softmatrix OS operations

## Prerequisites

使用专用运维账户、密码管理器、只读观测权限和临时 staging 实例。运维人员必须知道当前 promote 的
release ID。

## Install

运维只能从通过 `pnpm verify:softmatrix` 和 `pnpm test:e2e` 的候选版本开始，不能手工修改运行中的 Worker bundle。

## Environment and Secrets

核对部署的 secret inventory 中的 `PUBLIC_BASE_URL`、`CF_ACCESS_AUD`、`CF_ACCESS_ISS`、`OIDC_ISSUER`、
`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`OIDC_ALLOWED_EMAIL_DOMAINS`、`DISABLE_PASSWORD_AUTH`、`ORG_AI_MODELS`、
`ALLOW_USER_BYOK`、`CF_AI_GATEWAY`、`CF_AI_GATEWAY_ACCOUNT_ID`、`CF_AI_GATEWAY_API_TOKEN` 和 `ADMINS`。绝不把值复制到工单。

## Cloudflare Access

修改 `CF_ACCESS_AUD` 或 `CF_ACCESS_ISS` 前检查 Access 策略。保留一条 break-glass 运维路径，每次策略变更后测试无效断言。

## OIDC

查看 OIDC 错误率和域名策略指标。discovery、JWKS、nonce、state 或签名失败属于认证事件；只保留稳定错误码和 correlation ID。

## Model catalog and BYOK

把 `ORG_AI_MODELS` 变更作为经过审查的策略变更。验证 provider、model、context window 和组织范围。若 `ALLOW_USER_BYOK` 为 true，
监控凭据测试失败，并确保 token 不出现在日志、analytics、RPC 错误或客户端 bundle 中。

## Backup

每天备份元数据，发布前做 R2/KV 快照。记录备份年龄、release ID 和恢复负责人。每季度在隔离账户演练恢复。

## Monitoring

持续 Worker 5xx、认证失败激增、模型策略拒绝、存储错误或法务 sidecar 缺失时告警。仪表盘展示延迟、OIDC 码、模型错误码、Gatekeeper
审批队列等待时间和 release manifest 可用性。

## Secret rotation

一次只轮换一个凭据：加入新 secret，部署并完成冒烟检查，再撤销旧 secret。保留旧 release 以便回滚，但不能保留已撤销凭据。

## Common failures

- 认证失败：比较 issuer/audience 和回调 URL，然后直接测试 IdP。
- 模型目录为空：校验 `ORG_AI_MODELS` JSON 和组织映射。
- 服务商不可用：只切换到已审批目录中的模型并记录事件。
- 候选版本缺少法务文件：停止晋级并重新构建，绝不绕过 sidecar 检查。

## Upgrade

使用发布清单，比较 migrations 和 manifest hash，运行 staging 冒烟测试并公告维护窗口。晋级后观察一个完整 error-budget 窗口。

## Rollback

Promote 已记录的旧 release ID。验证登录、模型选择、Gatekeeper 审批和工作区持久化。保留失败候选版本用于取证比较。

## Support boundaries

Softmatrix 运维由 release maintainer 负责。Cloudflare 支持只覆盖底层平台；IdP、服务商、策略和应用事件由运维负责。

