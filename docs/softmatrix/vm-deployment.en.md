# Softmatrix OS single-VM deployment

This is the production runbook for the fully self-hosted profile: one Linux VM, standalone
`workerd`, local Durable Object SQLite, local KV/R2-compatible storage, and an optional on-VM
model provider. No Cloudflare account, Workers deployment, KV, R2, Access, or AI Gateway is
required.

## 1. Prepare the VM

- Linux VM with Node.js 22+ installed at `/usr/bin/node` (used by installation tooling and the
  systemd preflight), `systemd`, and a pinned `workerd` binary matching the release build.
- At least 4 GB RAM, a persistent filesystem, and a DNS name with TLS terminated by Caddy or
  Nginx. Keep `workerd` on loopback (`127.0.0.1:8787`).
- Create the service account and directories, then create the storage subdirectories:

```sh
sudo useradd --system --home /var/lib/softmatrix --shell /usr/sbin/nologin softmatrix || true
sudo install -d -o softmatrix -g softmatrix /opt/softmatrix /etc/softmatrix
sudo systemd-tmpfiles --create deploy/vm/softmatrix.tmpfiles
```

## 2. Build and verify an immutable release

Run this on the reviewed source checkout:

```sh
pnpm install --frozen-lockfile
pnpm verify:softmatrix
pnpm build:vm -- --release-id softmatrix-v1.0.0
node scripts/vm/build-release.mjs \
  --out /tmp/softmatrix-vm-v1.0.0 \
  --release-id softmatrix-v1.0.0
```

The artifact contains `manifest.json`, content-addressed Worker modules, browser assets, a
generated `runtime/workerd.capnp`, vendored Miniflare local-storage workers, and exact legal
artifacts. Keep the release directory immutable. Copy it under `/opt/softmatrix` before install:

```sh
sudo cp -a /tmp/softmatrix-vm-v1.0.0 /opt/softmatrix/incoming-v1.0.0
sudo node scripts/vm/install-release.mjs \
  --root /opt/softmatrix \
  --release /opt/softmatrix/incoming-v1.0.0 \
  --base-url https://softmatrix.example
```

The stable root command for the same install is:

```sh
sudo pnpm install:vm -- --root /opt/softmatrix \
  --release /opt/softmatrix/incoming-v1.0.0 \
  --base-url https://softmatrix.example
```

The installer validates checksums, Apache-2.0/notice sidecars, and module hashes before an
atomic `current` switch. A failed readiness check restores the previous release automatically.

## 3. Configure and start systemd

```sh
sudo cp deploy/vm/softmatrix.env.example /etc/softmatrix/softmatrix.env
sudoedit /etc/softmatrix/softmatrix.env
sudo cp deploy/vm/softmatrix.service /etc/systemd/system/softmatrix.service
sudo systemctl daemon-reload
sudo systemctl enable --now softmatrix
pnpm healthcheck:vm -- --base-url https://softmatrix.example
```

The systemd unit runs `tools/vm-config.mjs --check` before `workerd`. A missing required secret,
invalid model JSON, non-HTTPS public URL, forbidden Cloudflare binding, or unwritable data path
leaves the service stopped instead of starting a misconfigured runtime.

Set `PUBLIC_BASE_URL` to the public HTTPS origin. `ORG_AI_MODELS` is a JSON catalog; keep API
tokens in the VM secret manager or a root-readable environment file. Set `ALLOW_USER_BYOK=false`
for a governed deployment. The backend has a dedicated model-network service that permits public,
private, and local destinations; all gatekeeper workers keep public-only egress.

For an on-VM Ollama provider, use an `ollama` model with `apiUrl` such as
`http://127.0.0.1:11434`. Do not expose Ollama or port 8787 to the Internet. Configure Caddy/Nginx
to proxy only HTTPS traffic to `127.0.0.1:8787` and preserve WebSocket upgrades.

The repository includes checked-in proxy templates. For Caddy, set `SOFTMATRIX_DOMAIN` in the
Caddy service environment, copy `deploy/vm/Caddyfile.example` to the Caddy configuration path,
and reload Caddy. For Nginx, replace the hostname and certificate paths in
`deploy/vm/nginx.conf.example`, include it from the `http {}` configuration, then reload Nginx.
The templates deliberately proxy only to loopback; the network-contract test protects this
boundary and the WebSocket upgrade headers.

After the proxy is live, run the read-only public probe (it sends no cookies or credentials) and
attach its JSON output to the acceptance record:

```sh
pnpm probe:vm -- --base-url https://softmatrix.example
```

Keep the production acceptance record outside the release directory. Start from
`docs/softmatrix/vm-acceptance-report.example.json` and validate the filled record with
`pnpm validate:vm:evidence -- --report <record.json>` before recording a `GO` decision. The
validator rejects missing checks, failed checks, invalid artifact hashes, and secret-shaped fields.

To avoid copying artifact hashes by hand, initialize an explicitly `NO-GO` draft from the immutable
release. It records only local release/host facts; replace every pending check with real VM evidence
before validation can accept `GO`:

```sh
pnpm init:vm:evidence -- \
  --release /opt/softmatrix/incoming-v1.0.0 \
  --out /secure/release-records/softmatrix-v1.0.0.json \
  --origin https://softmatrix.example \
  --workerd /usr/local/bin/workerd
```

## 4. Backup, restore, and rollback

Stop the service (or otherwise quiesce writes) before taking a backup:

```sh
sudo systemctl stop softmatrix
sudo node scripts/vm/backup-data.mjs \
  --data-dir /var/lib/softmatrix/data \
  --object-store-dir /var/lib/softmatrix/objects \
  --out /var/backups/softmatrix \
  --release-id softmatrix-v1.0.0
sudo systemctl start softmatrix
```

The archive has a per-file manifest and an external SHA-256 sidecar. Restore only into an empty,
inactive target, verify the checksum, then start the service:

```sh
sudo node scripts/vm/restore-data.mjs \
  --archive /var/backups/softmatrix/softmatrix-v1.0.0-*.tar.gz \
  --target /var/lib/softmatrix-restore \
  --checksum "<sha256>"
```

Use the exact previous release for a rollback:

```sh
sudo node scripts/vm/install-release.mjs \
  --root /opt/softmatrix \
  --rollback <previous-release-id> \
  --base-url https://softmatrix.example
```

## 5. Release acceptance gate

Before announcing a release, run `pnpm test:vm:workerd`, the VM release tests, and
`pnpm test:e2e:vm` against a disposable VM state directory. Confirm English and Chinese signup,
model selection, a chat response, a workerd restart with the same data, backup/restore, and
release rollback. Retain the release manifest, checksums, legal sidecar, and backup checksum with
the release record.
