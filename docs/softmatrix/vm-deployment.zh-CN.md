# Softmatrix OS single-VM deployment

本手册用于完全自托管生产模式：单台 Linux VM、standalone `workerd`、本地 Durable Object
SQLite、本地 KV/R2 兼容存储，以及可选的 VM 内模型服务。不需要 Cloudflare 账户、Workers、KV、
R2、Access 或 AI Gateway。

## 1. Prepare the VM

- Linux VM，Node.js 22+（安装到 `/usr/bin/node`，供安装工具和 systemd 启动预检使用）、
  `systemd`，以及与发布构建匹配的固定版本 `workerd`。
- FNM/nvm 安装的 Node 只存在于当前用户的 shell 环境，`sudo` 和 systemd 默认看不到它。
  可以继续用 FNM 做开发，但生产 VM 还应安装一个系统级 Node 到 `/usr/bin/node`。如果暂时只能
  使用 FNM，下面的发布安装步骤可以显式传入当前 Node 的绝对路径；这只解决一次性安装，systemd
  启动前仍需要 `/usr/bin/node`。
- 至少 4 GB 内存、持久化磁盘、带 TLS 的 DNS 名称。`workerd` 只监听回环地址
  `127.0.0.1:8787`，由 Caddy 或 Nginx 对外提供 HTTPS。
- 创建服务账号和目录，再创建存储子目录：

```sh
sudo useradd --system --home /var/lib/softmatrix --shell /usr/sbin/nologin softmatrix || true
sudo install -d -o softmatrix -g softmatrix /opt/softmatrix /etc/softmatrix
sudo systemd-tmpfiles --create deploy/vm/softmatrix.tmpfiles
sudo cp deploy/vm/softmatrix.env.example /etc/softmatrix/softmatrix.env
sudoedit /etc/softmatrix/softmatrix.env
sudo cp deploy/vm/softmatrix.service /etc/systemd/system/softmatrix.service
sudo systemctl daemon-reload
```

## 2. Build and verify an immutable release

在经过审查的源码 checkout 中执行：

```sh
corepack enable pnpm
corepack install --global pnpm@11.17.0
pnpm --version  # 应输出 11.17.0
pnpm install --frozen-lockfile
pnpm verify:softmatrix
pnpm build:vm -- --release-id softmatrix-v1.0.0
node scripts/vm/build-release.mjs \
  --out /tmp/softmatrix-vm-v1.0.0 \
  --release-id softmatrix-v1.0.0
```

将与本次构建匹配的 `workerd` 安装到 systemd 约定的路径：

```sh
WORKERD_BIN="$(readlink -f node_modules/.pnpm/node_modules/workerd/bin/workerd)"
test -x "$WORKERD_BIN"
sudo install -o root -g root -m 0755 "$WORKERD_BIN" /usr/local/bin/workerd
sudo /usr/local/bin/workerd --version
```

发布包包含 `manifest.json`、内容寻址 Worker 模块、前端资源、生成的
`runtime/workerd.capnp`、本地存储所需的 Miniflare worker，以及完整法务制品。发布目录应保持
不可变；先复制到 `/opt/softmatrix` 再安装：

```sh
sudo cp -a /tmp/softmatrix-vm-v1.0.0 /opt/softmatrix/incoming-v1.0.0
sudo /usr/bin/node scripts/vm/install-release.mjs \
  --root /opt/softmatrix \
  --release /opt/softmatrix/incoming-v1.0.0 \
  --base-url https://softmatrix.example
```

如果暂时只有 FNM 的 Node，可将上面的安装命令替换为：

```sh
NODE_BIN="$(command -v node)"
sudo "$NODE_BIN" scripts/vm/install-release.mjs \
  --root /opt/softmatrix \
  --release /opt/softmatrix/incoming-v1.0.0 \
  --base-url https://softmatrix.example
```

同一安装流程也可以使用稳定的根命令：

```sh
sudo pnpm install:vm -- --root /opt/softmatrix \
  --release /opt/softmatrix/incoming-v1.0.0 \
  --base-url https://softmatrix.example
```

上面的 `sudo pnpm` 形式要求 pnpm 已安装到系统级 PATH；如果 pnpm 也由 FNM 管理，请使用前面的
`sudo "$NODE_BIN" ...` 命令，不要尝试用 `sudo -E` 绕过 PATH 隔离。

安装器会校验 checksum、Apache-2.0/notice sidecar 和模块哈希，再原子切换 `current`。它还会在
重启 systemd 前检查 `internet` 与 `softmatrix-model-network` 是否包含
`tlsOptions = (trustBrowserCas = true)`；旧 runtime 缺少该配置时返回
`VM_RUNTIME_TLS_MISSING`。就绪检查失败时会自动恢复上一版本。发布目录不可变；runtime 配置
发生变化后必须使用新的 release ID 重新构建和安装，不能原地修改已有 release。

## 3. Configure and start systemd

```sh
sudo systemctl enable --now softmatrix
pnpm healthcheck:vm -- --base-url https://softmatrix.example
```

systemd 单元会在启动 `workerd` 前执行 `tools/vm-config.mjs --check`。如果缺少必需密钥、模型 JSON
无效、公开地址不是 HTTPS、存在禁止的 Cloudflare binding 或数据目录不可写，服务会保持停止，避免
启动配置错误的运行时。

将 `PUBLIC_BASE_URL` 设置为公网 HTTPS 地址。`ORG_AI_MODELS` 是 JSON 模型目录；API token 应放在
VM secret manager 或仅 root 可读的环境文件中。受治理部署设置 `ALLOW_USER_BYOK=false`。后端有
专用的模型网络服务，可访问 public/private/local；Gatekeeper worker 仍只允许 public 出站。

如使用 VM 内 Ollama，请使用 `ollama` provider，并设置类似
`http://127.0.0.1:11434` 的 `apiUrl`。不要把 Ollama 或 8787 暴露到公网。Caddy/Nginx 只应把
HTTPS 代理到 `127.0.0.1:8787`，并保留 WebSocket upgrade。

如果启用 OIDC（例如 Microsoft Entra ID），身份提供商的重定向 URI 必须精确设置为
`https://<你的域名>/api/auth/oidc/callback`。Nginx 模板会发送
`X-Forwarded-Proto: https`，VM runtime 会读取该头；后端还会依据 `PUBLIC_BASE_URL` 规范化
回调地址。对于不输出 `email_verified=true` 的 Workforce Entra 租户，请按
`docs/oidc-sso.md` 中的 Microsoft Entra External ID 联邦流程配置；VM 仍使用通用的
`OIDC_*` 变量，但 `OIDC_ISSUER` 应改为 External ID 的 issuer。修改 OIDC 或代理配置后必须
构建新的 release ID，再安装新发布，不能复用旧制品。

仓库提供了已纳入版本控制的代理模板。使用 Caddy 时，将 `SOFTMATRIX_DOMAIN` 注入 Caddy
服务环境，复制 `deploy/vm/Caddyfile.example` 到 Caddy 配置路径后 reload。使用 Nginx 时，先
替换 `deploy/vm/nginx.conf.example` 中的域名和证书路径，将它 include 到 `http {}` 配置后
reload。模板只代理到回环地址；网络契约测试会保护该边界以及 WebSocket upgrade 请求头。

代理上线后运行只读公网探针（不会发送 cookie 或凭据），并将 JSON 输出附到验收记录：

```sh
pnpm probe:vm -- --base-url https://softmatrix.example
```

生产验收记录应保存在发布目录之外。请从 `docs/softmatrix/vm-acceptance-report.example.json`
开始填写，并在记录 `GO` 前运行
`pnpm validate:vm:evidence -- --report <record.json>`。校验器会拒绝缺失/失败的检查、无效的
制品哈希以及带有密钥形状的字段。

请在与发布 `sourceCommit` 一致的干净源码 checkout 中执行此命令（不可变制品目录不包含仓库中的
操作脚本）。为避免手工复制制品哈希，可以先从不可变发布目录生成明确为 `NO-GO` 的草稿。它只记录
本机的发布/主机事实；必须将所有待处理检查替换为真实 VM 证据后，校验器才会接受 `GO`。报告应保存在
制品目录之外：

```sh
pnpm init:vm:evidence -- \
  --release /opt/softmatrix/incoming-v1.0.0 \
  --out /secure/release-records/softmatrix-v1.0.0.json \
  --origin https://softmatrix.example \
  --workerd /usr/local/bin/workerd
```

草稿生成后，可以在目标 VM 上运行自动证据收集器。它只会写入当前主机事实、制品运行时版本、
HTTPS/WSS 探针和 `ss` loopback 检查；OIDC、模型治理、存储、日志、重启、备份、恢复、回滚和三方签署
仍保持待人工验收，输出也始终是 `NO-GO`：

```sh
pnpm collect:vm:evidence -- \
  --report /secure/release-records/softmatrix-v1.0.0.json \
  --out /secure/release-records/softmatrix-v1.0.0.collected.json \
  --base-url https://softmatrix.example \
  --log-since "2026-08-10 00:00:00" \
  --log-unit softmatrix \
  --workerd /usr/local/bin/workerd \
  --proxy-name Caddy \
  --proxy-version 2.9.1
```

`--allow-http-loopback` 仅用于本机测试，绝不会把 HTTP/WS 结果记录为生产 HTTPS/WSS 通过证据。
传入 `--log-file` 或 `--log-since` 后，收集器只把日志审计状态和安全的行号写入报告；日志源不可读或发现未脱敏模式时仍保持 `FAIL`。
请人工复核收集结果、补齐所有剩余检查和签署后，再运行 `validate:vm:evidence`。

日志脱敏审计不会输出日志内容，只输出结果和命中行号。生产验收时应覆盖与本次发布相关的 journal 时间窗：

```sh
pnpm audit:vm:logs -- --unit softmatrix --since "2026-08-10 00:00:00"
```

命令失败或发现未脱敏的凭据、提示词、Cookie、JWT 或 provider body 时，`logsRedacted` 必须保持 `FAIL`。

## 4. Backup, restore, and rollback

备份前停止服务（或用等价方式暂停写入）：

```sh
sudo systemctl stop softmatrix
sudo /usr/bin/node scripts/vm/backup-data.mjs \
  --data-dir /var/lib/softmatrix/data \
  --object-store-dir /var/lib/softmatrix/objects \
  --out /var/backups/softmatrix \
  --release-id softmatrix-v1.0.0
sudo systemctl start softmatrix
```

归档包含逐文件 manifest 和外部 SHA-256 sidecar。只能恢复到空闲、未运行实例的空目录，并校验
checksum：

```sh
sudo /usr/bin/node scripts/vm/restore-data.mjs \
  --archive /var/backups/softmatrix/softmatrix-v1.0.0-*.tar.gz \
  --target /var/lib/softmatrix-restore \
  --checksum "<sha256>"
```

需要回滚时使用精确的旧版本 ID：

```sh
sudo /usr/bin/node scripts/vm/install-release.mjs \
  --root /opt/softmatrix \
  --rollback <previous-release-id> \
  --base-url https://softmatrix.example
```

## 5. Release acceptance gate

发布前执行 `pnpm test:vm:workerd`、VM release 测试，并在临时 state 目录上运行
`pnpm test:e2e:vm`。必须确认中英文注册、模型选择、聊天响应、workerd 重启后数据仍在、备份/恢复
以及发布回滚均成功。发布记录应保留 manifest、checksums、法务 sidecar 和备份 checksum。
