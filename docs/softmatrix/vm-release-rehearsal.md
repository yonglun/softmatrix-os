# Softmatrix OS first VM release rehearsal

Status: `PENDING OPERATOR EXECUTION`

This is an auditable checklist and evidence record for the first fully self-hosted, single-VM
release. The local automated checks listed below were run during development; they do not prove
that a clean production VM, TLS proxy, secret store, backup destination, or operator rollback has
been exercised. Do not change the status to `GO` until every required field has evidence.

The values marked **local rehearsal** below describe a macOS development host and disposable
directories. They are useful for reproducing the release mechanics, but are not production VM
sign-off.

## Recorded release identity

Fill these values from the exact clean checkout and immutable artifact:

| Field | Value |
|---|---|
| Source commit (local rehearsal) | `f16c386885b6fc388e3600ea86584295eaf3271b` |
| Release ID (local rehearsal) | `softmatrix-vm-v1-rc1` |
| Build timestamp (UTC) | `2026-08-09T15:06:43.939Z` |
| Release directory | `/tmp/softmatrix-vm-rehearsal-release-a` |
| `manifest.json` SHA-256 | `69b8567ea918bf0314dffc1792e0fa5fd3cf3e460bd77d4818c983e6f56e19a4` |
| `checksums.sha256` SHA-256 | `f841592e9d614611ee80848c1c2faffc016e61882b1fd15b52216168d12c6ada` |
| `legal-manifest.json` SHA-256 | `a8dc8b170d5d742e3e88da0491858a93c12c59724668f0bd5e01c3f3681b08c1` |
| Apache-2.0 `LICENSE` SHA-256 | `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594` |
| `workerd` version/binary SHA-256 | `2026-08-01` / `3da61644318c8fab32e68a504513865aef12329b1356d75d7e6f83a713ea9f7b` |
| Node.js / pnpm versions | `v22.14.0` / `11.17.0` |
| OS / kernel | `macOS 26.5.2` / `Darwin 25.5.0 arm64` |
| systemd and TLS proxy versions | `PENDING` |

## Clean VM execution

Record the VM hostname, service account, persistent volume, independent backup volume, proxy
origin, and secret-provider reference before running the commands. Keep secrets out of this file.

```sh
pnpm install --frozen-lockfile
pnpm verify:softmatrix
pnpm test:e2e:vm
pnpm build:vm -- --release-id softmatrix-vm-v1-rc1
sudo cp -a release-out /opt/softmatrix/release-out
sudo pnpm install:vm -- --root /opt/softmatrix --release /opt/softmatrix/release-out
pnpm healthcheck:vm
```

The candidate must start without a Cloudflare account, Access policy, AI Gateway, KV deployment,
or R2 deployment. Store the artifact manifest and checksum files with this report.

## Automated evidence from this source milestone

These results are development evidence only and must be re-run from the clean release checkout:

| Check | Result | Evidence timestamp / log |
|---|---|---|
| VM build artifact tests | PASS (2/2) | `node --test scripts/vm/build-release.test.js` |
| Install, health, backup, restore tests | PASS (6/6) | `node --test scripts/vm/install-release.test.js scripts/vm/vm-data.test.js` |
| Router asset MIME tests | PASS (14/14) | `pnpm --filter @gadgets/router test` |
| VM workerd config compile | PASS | `workerd compile runtime/workerd.capnp config` |
| Bilingual VM browser journey | PASS (2/2) | `pnpm exec playwright test e2e/vm-self-hosting.spec.ts --workers=1` |
| Compliance and i18n coverage | PASS (3/3) | `node --test scripts/softmatrix-compliance.test.js scripts/i18n-coverage.test.js` |

The RC artifact contains 18 workers, 84 modules, and 31 asset blobs. Its generated
`runtime/workerd.capnp` compiled successfully; the compiled configuration SHA-256 was
`bfedaaa192e03ca40cca5e6e0c483436b6a400daa54a706dc3b5a66286ad953c`.

## Manual acceptance matrix

Mark each item only after attaching a timestamped log, screenshot, or checksum reference.

| Check | Status | Evidence |
|---|---|---|
| English password signup/login | `[x]` local | VM re-run required; `e2e/vm-self-hosting.spec.ts` |
| Simplified Chinese password signup/login | `[x]` local | VM re-run required; `e2e/vm-self-hosting.spec.ts` |
| OIDC success, cancel, and domain-denial mapping | `[ ]` | `PENDING` |
| Model catalog policy and `ALLOW_USER_BYOK=false` | `[x]` local | Fixture Model visible; Add model action absent; VM re-run required |
| Approved BYOK behavior (if enabled) | `[ ]` | `PENDING` |
| Gatekeeper availability and approval flow | `[x]` local availability | `/gatekeepers` localized heading visible; approval flow still requires VM/provider setup |
| Workspace/chat persists after browser reload | `[x]` local | VM re-run required; restart E2E passed 2/2 |
| Attachment and Blueprint KV/R2-compatible storage | `[ ]` | `PENDING` |
| Logs contain no prompts, tokens, cookies, or provider bodies | `[ ]` | `PENDING` |
| Public HTTPS, WebSocket upgrade, and loopback-only workerd | `[ ]` | `PENDING` |

## Recovery and rollback evidence

Quiesce writes before backup. Save the archive checksum beside the release record.

```sh
sudo systemctl stop softmatrix
sudo pnpm backup:vm -- \
  --data-dir /var/lib/softmatrix/data \
  --object-store-dir /var/lib/softmatrix/objects \
  --out /var/backups/softmatrix \
  --release-id softmatrix-vm-v1-rc1
sudo systemctl start softmatrix
sudo pnpm healthcheck:vm -- --base-url https://softmatrix.example
```

Record the archive path, `.sha256` sidecar, checksum, backup age, and time to recover:

Local rehearsal archive: `/tmp/softmatrix-vm-rehearsal-backups/softmatrix-vm-v1-rc1-20260809150804.tar.gz`.
Its SHA-256 is `4a76e455fdc17915dce0446be8b2b545bdd3bae6e54d33fc9aeb4654b71214a4`; the isolated
restore target was `/tmp/softmatrix-vm-rehearsal-restore`.

| Recovery check | Status | Evidence |
|---|---|---|
| Reboot VM and restore the same workspace/model preference | `[ ]` | `PENDING` |
| Restore archive into an empty isolated directory | `[x]` local | checksum `4a76e455fdc17915dce0446be8b2b545bdd3bae6e54d33fc9aeb4654b71214a4`; migration `v3` |
| Install release B and pass readiness | `[x]` local | local stub service; `softmatrix-vm-v1-rc2` |
| Force a readiness failure without changing active release | `[x]` automated | `install-release.test.js` failure-path coverage |
| Roll back to the exact release A ID | `[x]` local | current `releases/softmatrix-vm-v1-rc1`, previous `releases/softmatrix-vm-v1-rc2` |
| Workspace remains available after rollback | `[ ]` | `PENDING` |

For an isolated restore, use a target outside the active paths and verify the expected checksum:

```sh
sudo pnpm restore:vm -- \
  --archive /var/backups/softmatrix/<release>-<timestamp>.tar.gz \
  --target /var/lib/softmatrix-restore \
  --checksum <archive-sha256>
```

Rollback must use an exact known release ID and the installer must run readiness before accepting
the switch:

```sh
sudo pnpm rollback:vm -- \
  --root /opt/softmatrix \
  --rollback <release-a-id> \
  --base-url https://softmatrix.example
```

## Go / no-go decision

The release is **GO** only when all of the following are true:

- no secret appears in artifacts, manifests, browser assets, or logs;
- bilingual login, OIDC, model governance, Gatekeeper, attachment, and Blueprint checks pass;
- restart and VM reboot preserve the same workspace and model preference;
- the backup checksum verifies and isolated restore succeeds;
- a deliberately failed readiness check leaves `current` unchanged;
- rollback selects the recorded release ID and the original data remains available; and
- the operator has recorded the exact release ID, artifact checksums, backup checksum, and sign-off.

Otherwise mark **NO-GO**, preserve the failing evidence, and keep the last known-good release
active.

## Operator sign-off

| Role | Name | Decision | UTC timestamp | Signature / ticket |
|---|---|---|---|---|
| Release owner | `PENDING` | `PENDING` | `PENDING` | `PENDING` |
| VM operator | `PENDING` | `PENDING` | `PENDING` | `PENDING` |
| Security reviewer | `PENDING` | `PENDING` | `PENDING` | `PENDING` |
