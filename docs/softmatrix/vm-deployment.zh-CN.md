# Softmatrix OS single-VM deployment

本手册用于完全自托管生产模式：单台 Linux VM、standalone `workerd`、本地 Durable Object
SQLite、本地 KV/R2 兼容存储，以及可选的 VM 内模型服务。不需要 Cloudflare 账户、Workers、KV、
R2、Access 或 AI Gateway。

## 1. Prepare the VM

- Linux VM，Node.js 22+（安装到 `/usr/bin/node`，供安装工具和 systemd 启动预检使用）、
  `systemd`，以及与发布构建匹配的固定版本 `workerd`。
- 至少 4 GB 内存、持久化磁盘、带 TLS 的 DNS 名称。`workerd` 只监听回环地址
  `127.0.0.1:8787`，由 Caddy 或 Nginx 对外提供 HTTPS。
- 创建服务账号和目录，再创建存储子目录：

```sh
sudo useradd --system --home /var/lib/softmatrix --shell /usr/sbin/nologin softmatrix || true
sudo install -d -o softmatrix -g softmatrix /opt/softmatrix /etc/softmatrix
sudo systemd-tmpfiles --create deploy/vm/softmatrix.tmpfiles
```

## 2. Build and verify an immutable release

在经过审查的源码 checkout 中执行：

```sh
pnpm install --frozen-lockfile
pnpm verify:softmatrix
pnpm build:vm -- --release-id softmatrix-v1.0.0
node scripts/vm/build-release.mjs \
  --out /tmp/softmatrix-vm-v1.0.0 \
  --release-id softmatrix-v1.0.0
```

发布包包含 `manifest.json`、内容寻址 Worker 模块、前端资源、生成的
`runtime/workerd.capnp`、本地存储所需的 Miniflare worker，以及完整法务制品。发布目录应保持
不可变；先复制到 `/opt/softmatrix` 再安装：

```sh
sudo cp -a /tmp/softmatrix-vm-v1.0.0 /opt/softmatrix/incoming-v1.0.0
sudo node scripts/vm/install-release.mjs \
  --root /opt/softmatrix \
  --release /opt/softmatrix/incoming-v1.0.0 \
  --base-url https://softmatrix.example

同一安装流程也可以使用稳定的根命令：

```sh
sudo pnpm install:vm -- --root /opt/softmatrix \
  --release /opt/softmatrix/incoming-v1.0.0 \
  --base-url https://softmatrix.example
```
```

安装器会校验 checksum、Apache-2.0/notice sidecar 和模块哈希，再原子切换 `current`。就绪检查
失败时会自动恢复上一版本。

## 3. Configure and start systemd

```sh
sudo cp deploy/vm/softmatrix.env.example /etc/softmatrix/softmatrix.env
sudoedit /etc/softmatrix/softmatrix.env
sudo cp deploy/vm/softmatrix.service /etc/systemd/system/softmatrix.service
sudo systemctl daemon-reload
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

## 4. Backup, restore, and rollback

备份前停止服务（或用等价方式暂停写入）：

```sh
sudo systemctl stop softmatrix
sudo node scripts/vm/backup-data.mjs \
  --data-dir /var/lib/softmatrix/data \
  --object-store-dir /var/lib/softmatrix/objects \
  --out /var/backups/softmatrix \
  --release-id softmatrix-v1.0.0
sudo systemctl start softmatrix
```

归档包含逐文件 manifest 和外部 SHA-256 sidecar。只能恢复到空闲、未运行实例的空目录，并校验
checksum：

```sh
sudo node scripts/vm/restore-data.mjs \
  --archive /var/backups/softmatrix/softmatrix-v1.0.0-*.tar.gz \
  --target /var/lib/softmatrix-restore \
  --checksum "<sha256>"
```

需要回滚时使用精确的旧版本 ID：

```sh
sudo node scripts/vm/install-release.mjs \
  --root /opt/softmatrix \
  --rollback <previous-release-id> \
  --base-url https://softmatrix.example
```

## 5. Release acceptance gate

发布前执行 `pnpm test:vm:workerd`、VM release 测试，并在临时 state 目录上运行
`pnpm test:e2e:vm`。必须确认中英文注册、模型选择、聊天响应、workerd 重启后数据仍在、备份/恢复
以及发布回滚均成功。发布记录应保留 manifest、checksums、法务 sidecar 和备份 checksum。
