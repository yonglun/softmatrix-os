# Softmatrix OS upgrade

## Prerequisites

准备旧 release ID、已审批候选版本、维护窗口、QA 与安全审核人以及经过测试的备份。确认没有未解决的上游同步或安全阻塞。

## Install

```sh
pnpm install --frozen-lockfile
pnpm verify:softmatrix
pnpm test:e2e
```

## Environment and Secrets

将候选版本文档中的 `PUBLIC_BASE_URL`、`CF_ACCESS_AUD`、`CF_ACCESS_ISS`、`OIDC_ISSUER`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、
`OIDC_ALLOWED_EMAIL_DOMAINS`、`DISABLE_PASSWORD_AUTH`、`ORG_AI_MODELS`、`ALLOW_USER_BYOK`、`CF_AI_GATEWAY`、
`CF_AI_GATEWAY_ACCOUNT_ID`、`CF_AI_GATEWAY_API_TOKEN` 和 `ADMINS` 与当前部署值比较。

## Cloudflare Access

晋级前在 staging 重新检查允许、拒绝、过期和错误 audience 的 Access 场景。

## OIDC

重新检查登录、取消、域名拒绝、state/nonce 重放和服务商不可用。除非迁移计划明确要求，不要在一次晋级中同时修改 issuer 与客户端凭据。

## Model catalog and BYOK

比较组织模型 ID 和策略标志。验证已知模型、不可用模型、显式切换模型和禁用 BYOK 的界面。为回滚保留旧目录。

## Backup

重新生成 KV/R2 元数据快照，并用旧 release ID 记录 checksum。不要删除旧 migration history。

## Monitoring

首小时观察部署错误、登录完成率、模型延迟/错误码、Gatekeeper 审批和存储健康。错误率或认证完成率回退时停止。

## Secret rotation

若升级包含轮换，先部署新值并完成冒烟检查，再撤销旧值。绝不要把 secret 放进发布说明或截图。

## Common failures

- Manifest hash 不匹配：丢弃候选版本并从同一 commit 重新构建。
- Migration 失败：停止晋级并恢复旧 release ID。
- OIDC 回调不匹配：恢复旧 issuer/client 配置。
- 模型策略回退：恢复旧目录并禁用 BYOK。

## Upgrade

使用 `node scripts/release/build-release.mjs --out release-out --release-id softmatrix-v1-rc1` 构建，校验法务 hash，使用 `--candidate` 上传，
获得 QA/安全审批后再 promote。

## Rollback

Promote 已记录的旧 ID。确认法务文件、sidecar 和 manifest 都可见，然后运行双语冒烟套件。保留候选版本分析并建立后续 issue。

## Support boundaries

升级由 Softmatrix release owner 维护。Cloudflare OS 上游变更必须单独进行同步审查，不会静默进入生产版本。

