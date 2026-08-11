# Softmatrix OS single-VM deployment

This is the production runbook for the fully self-hosted profile: one Linux VM, standalone
`workerd`, local Durable Object SQLite, local KV/R2-compatible storage, and an optional on-VM
model provider. No Cloudflare account, Workers deployment, KV, R2, Access, or AI Gateway is
required.

## 1. Prepare the VM

- Linux VM with Node.js 22+ installed at `/usr/bin/node` (used by installation tooling and the
  systemd preflight), `systemd`, and a pinned `workerd` binary matching the release build.
- A Node.js installed by FNM/nvm is only present in the current user's shell environment; `sudo`
  and systemd do not see it by default. You can keep using FNM for development, but production
  should also have a system Node.js at `/usr/bin/node`. If you temporarily only have FNM, the release
  install step below can pass the current Node's absolute path; systemd still requires `/usr/bin/node`.
- At least 4 GB RAM, a persistent filesystem, and a DNS name with TLS terminated by Caddy or
  Nginx. Keep `workerd` on loopback (`127.0.0.1:8787`).
- Create the service account and directories, then create the storage subdirectories:

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

Run this on the reviewed source checkout:

```sh
corepack enable pnpm
corepack install --global pnpm@11.17.0
pnpm --version  # should print 11.17.0
pnpm install --frozen-lockfile
pnpm verify:softmatrix
pnpm build:vm -- --release-id softmatrix-v1.0.0
node scripts/vm/build-release.mjs \
  --out /tmp/softmatrix-vm-v1.0.0 \
  --release-id softmatrix-v1.0.0
```

Install the `workerd` binary matching this build at the path used by systemd:

```sh
WORKERD_BIN="$(readlink -f node_modules/.pnpm/node_modules/workerd/bin/workerd)"
test -x "$WORKERD_BIN"
sudo install -o root -g root -m 0755 "$WORKERD_BIN" /usr/local/bin/workerd
sudo /usr/local/bin/workerd --version
```

The artifact contains `manifest.json`, content-addressed Worker modules, browser assets, a
generated `runtime/workerd.capnp`, vendored Miniflare local-storage workers, and exact legal
artifacts. Keep the release directory immutable. Copy it under `/opt/softmatrix` before install:

```sh
sudo cp -a /tmp/softmatrix-vm-v1.0.0 /opt/softmatrix/incoming-v1.0.0
sudo /usr/bin/node scripts/vm/install-release.mjs \
  --root /opt/softmatrix \
  --release /opt/softmatrix/incoming-v1.0.0 \
  --base-url https://softmatrix.example
```

If you temporarily only have FNM's Node, replace the install command above with:

```sh
NODE_BIN="$(command -v node)"
sudo "$NODE_BIN" scripts/vm/install-release.mjs \
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

The `sudo pnpm` form requires pnpm to be installed in the system-wide PATH. If pnpm is also managed
by FNM, use the preceding `sudo "$NODE_BIN" ...` command instead of trying to bypass PATH isolation
with `sudo -E`.

The installer validates checksums, Apache-2.0/notice sidecars, and module hashes before an
atomic `current` switch. It also rejects a legacy runtime whose `internet` or
`softmatrix-model-network` service lacks `tlsOptions = (trustBrowserCas = true)` with
`VM_RUNTIME_TLS_MISSING`, before restarting systemd. A failed readiness check restores the
previous release automatically. Release directories are immutable: after changing the runtime
configuration, build and install a new release ID instead of editing an existing release in place.

## 3. Configure and start systemd

```sh
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

Run this from a clean source checkout matching the release `sourceCommit` (the immutable release
directory does not contain the repository's operator scripts). To avoid copying artifact hashes by
hand, initialize an explicitly `NO-GO` draft from the immutable release. It records only local
release/host facts; replace every pending check with real VM evidence before validation can accept
`GO`. Keep the report outside the release directory:

```sh
pnpm init:vm:evidence -- \
  --release /opt/softmatrix/incoming-v1.0.0 \
  --out /secure/release-records/softmatrix-v1.0.0.json \
  --origin https://softmatrix.example \
  --workerd /usr/local/bin/workerd
```

After seeding a draft, run the automated evidence collector on the target VM. It records only
host facts, the runtime binary version, the HTTPS/WSS probe, and the `ss` loopback check. OIDC,
model governance, storage, log review, reboot, backup, restore, rollback, and the three sign-offs
remain manual; the collector always keeps the report `NO-GO`:

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

`--allow-http-loopback` is for local harness tests only; HTTP/WS results are never recorded as
production HTTPS/WSS passes. When `--log-file` or `--log-since` is supplied, the collector writes
only the log-audit status and safe line numbers into the report; unreadable sources and unredacted
patterns remain `FAIL`. Review the collected report, complete every remaining check and sign-off,
then run `validate:vm:evidence`.

The log-redaction audit never prints log content; it emits only a pass/fail result and matching line
numbers. During production acceptance, cover the journal window for this release:

```sh
pnpm audit:vm:logs -- --unit softmatrix --since "2026-08-10 00:00:00"
```

If the command fails or finds an unredacted credential, prompt, cookie, JWT, or provider body,
keep `logsRedacted` as `FAIL`.

## 4. Backup, restore, and rollback

Stop the service (or otherwise quiesce writes) before taking a backup:

```sh
sudo systemctl stop softmatrix
sudo /usr/bin/node scripts/vm/backup-data.mjs \
  --data-dir /var/lib/softmatrix/data \
  --object-store-dir /var/lib/softmatrix/objects \
  --out /var/backups/softmatrix \
  --release-id softmatrix-v1.0.0
sudo systemctl start softmatrix
```

The archive has a per-file manifest and an external SHA-256 sidecar. Restore only into an empty,
inactive target, verify the checksum, then start the service:

```sh
sudo /usr/bin/node scripts/vm/restore-data.mjs \
  --archive /var/backups/softmatrix/softmatrix-v1.0.0-*.tar.gz \
  --target /var/lib/softmatrix-restore \
  --checksum "<sha256>"
```

Use the exact previous release for a rollback:

```sh
sudo /usr/bin/node scripts/vm/install-release.mjs \
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
