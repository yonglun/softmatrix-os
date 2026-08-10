# Softmatrix OS VM operations

## Daily health

执行带认证的外部健康检查，并确认 systemd 服务正常：

```sh
node scripts/vm/healthcheck.mjs --base-url https://softmatrix.example
systemctl is-active softmatrix
```

公网地址由 `PUBLIC_BASE_URL` 决定；`workerd` 必须只监听回环地址。确认 Caddy/Nginx 是唯一公网
监听，并验证 WebSocket upgrade 正常。

## Storage and backups

持久化目录是 `/var/lib/softmatrix/data`（SQLite/元数据和本地 KV）以及
`/var/lib/softmatrix/objects`（本地 R2 兼容对象）。复制或备份前停止 `softmatrix`。将归档和
`.sha256` sidecar 保存到独立磁盘。每月使用 `scripts/vm/restore-data.mjs` 做一次隔离恢复演练。

## Logs and incidents

使用 `journalctl -u softmatrix` 和健康检查的 correlation 输出。不得记录 prompt、响应、token、
OIDC code、cookie 或服务商原始响应。重复出现 `MODEL_*`、`OIDC_*`、存储 checksum 或 readiness
错误时应按事故处理；变更状态前保留 release ID 和最新备份 checksum。

## Secrets and model providers

通过 VM secret manager 轮换 `OIDC_CLIENT_SECRET`、模型服务商 token 和 Gatekeeper client secret。
`ORG_AI_MODELS` 是部署侧模型目录；除非经过审批，否则保持 `ALLOW_USER_BYOK=false`。本地 Ollama
只允许经由后端专用模型网络服务访问，反向代理不会暴露该地址。

## Upgrade

构建新的不可变 VM release，校验法务 sidecar/checksum，复制到 `/opt/softmatrix` 下，再使用
`scripts/vm/install-release.mjs` 安装。安装器会原子切换 `current`、重启 systemd 并执行 readiness。
验收和备份确认完成前保留 `previous`。

## Rollback

升级前记录当前 release。按精确 ID 回滚，然后执行外部健康检查和中英文登录/聊天冒烟：

```sh
node scripts/vm/install-release.mjs --root /opt/softmatrix \
  --rollback <release-id> --base-url https://softmatrix.example
```

不要手工替换 `current`，也不要删除唯一的已知可用版本。

## Monitoring

监控 systemd 重启、健康检查失败、`/var/lib/softmatrix` 磁盘使用量、备份年龄、checksum 不匹配、
OIDC 拒绝峰值、模型服务商延迟/错误以及异常公网监听。将 Gatekeeper 审批和模型策略变更作为
安全事件审查。

## Support boundaries

此模式是独立的 Softmatrix OS 软件。Cloudflare 不运营该 VM，不提供其 IdP、不托管模型服务商，也
不会接收实例数据。每次事故和发布都应保留精确 release、runtime 版本、备份 checksum 及操作员签字。

## Release rehearsal

首次发布的证据记录请使用 [`vm-release-rehearsal.md`](vm-release-rehearsal.md)。在干净的单台 VM
上完成全部命令前，报告必须保持 `PENDING OPERATOR EXECUTION`。记录源代码 commit、release ID、
workerd/runtime 版本、发布包和备份 checksum、重启/持久化结果、隔离恢复结果、回滚结果及操作员
批准。本地自动化 E2E 只能作为辅助证据，不能替代干净 VM 的签字验收。
在发布前运行 `pnpm validate:vm:evidence -- --report <record.json>`，确认验收记录完整。
