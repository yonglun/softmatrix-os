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
| Source commit (local rehearsal) | `774a90f120c6e3385f244d11b650a3b9467a217c` |
| Release ID (local rehearsal) | `softmatrix-vm-v1-rc3` |
| Build timestamp (UTC) | `2026-08-09T22:38:33.008Z` |
| Release directory | `/tmp/softmatrix-vm-rehearsal-release-d` |
| `manifest.json` SHA-256 | `383a4c4d09a10a90a3829abc341db49f02717b41faf4c9e28febf133a7971602` |
| `checksums.sha256` SHA-256 | `11f5bbc4389860866fc4629a24506b0efe5c413679f98b5ff1a1630b1fd1884a` |
| `legal-manifest.json` SHA-256 | `a8dc8b170d5d742e3e88da0491858a93c12c59724668f0bd5e01c3f3681b08c1` |
| Apache-2.0 `LICENSE` SHA-256 | `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594` |
| `tools/vm-config.mjs` SHA-256 | `f7974028822f010879df7e91d75b61800c5cd74032beef45d749d080cfc2184d` |
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
pnpm build:vm -- --release-id softmatrix-vm-v1-rc3
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
| VM config preflight tests | PASS (5/5) | `node --test scripts/vm/vm-config.test.js`; packaged CLI also passed |
| Install, health, backup, restore tests | PASS (6/6) | `node --test scripts/vm/install-release.test.js scripts/vm/vm-data.test.js` |
| Router asset MIME tests | PASS (14/14) | `pnpm --filter @gadgets/router test` |
| VM workerd config compile | PASS | `workerd compile runtime/workerd.capnp config` |
| Bilingual VM browser journey | PASS (4/4) | Ubuntu `VM Smoke` run below; English/Chinese password restart and OIDC journeys |
| Compliance and i18n coverage | PASS (3/3) | `node --test scripts/softmatrix-compliance.test.js scripts/i18n-coverage.test.js` |

The RC artifact contains 18 workers, 84 modules, and 31 asset blobs. Its generated
`runtime/workerd.capnp` compiled successfully; the compiled configuration SHA-256 was
`bfedaaa192e03ca40cca5e6e0c483436b6a400daa54a706dc3b5a66286ad953c`. The immutable package
also includes the systemd fail-closed preflight at `tools/vm-config.mjs`.

## Latest clean-checkout CI gate

The release builder has since been hardened to generate every ignored worker input before Wrangler
collects modules (`build:app`, `build:configurator`, and `build:format-blueprints`). The latest
OIDC fixture hardening is `b45452b`; its Ubuntu `VM Smoke` run passed all four browser journeys on
an ephemeral Linux VM:

| Check | Result | Evidence |
|---|---|---|
| VM configuration contract | PASS | [GitHub job step](https://github.com/yonglun/softmatrix-os/actions/runs/31365676828/job/93383410367) |
| Native workerd persistence | PASS | [GitHub job step](https://github.com/yonglun/softmatrix-os/actions/runs/31365676828/job/93383410367) |
| Clean immutable release build (18 workers / 84 modules) | PASS | [GitHub job step](https://github.com/yonglun/softmatrix-os/actions/runs/31365676828/job/93383410367) |
| English and Simplified Chinese password/restart journeys | PASS (2/2) | [GitHub job](https://github.com/yonglun/softmatrix-os/actions/runs/31365676828/job/93383410367) |
| English and Simplified Chinese OIDC fixture journeys | PASS (2/2) | [GitHub job](https://github.com/yonglun/softmatrix-os/actions/runs/31365676828/job/93383410367) |

This is CI evidence on an ephemeral Ubuntu runner, not production VM sign-off. Keep the status below
as `PENDING OPERATOR EXECUTION` until the real VM, TLS proxy, OIDC provider, backup destination,
logs, reboot, rollback, and operator signatures have been recorded.

## Manual acceptance matrix

Mark each item only after attaching a timestamped log, screenshot, or checksum reference.

| Check | Status | Evidence |
|---|---|---|
| English password signup/login | `[x]` local | release `softmatrix-vm-v1-rc3`; `e2e/vm-self-hosting.spec.ts` |
| Simplified Chinese password signup/login | `[x]` local | release `softmatrix-vm-v1-rc3`; `e2e/vm-self-hosting.spec.ts` |
| OIDC success with local RS256/JWKS/PKCE fixture | `[x]` CI | [Ubuntu VM Smoke](https://github.com/yonglun/softmatrix-os/actions/runs/31365676828/job/93383410367); production IdP still pending |
| OIDC cancellation and domain-denial mapping against the chosen production IdP | `[ ]` | `PENDING operator execution` |
| Model catalog policy and `ALLOW_USER_BYOK=false` | `[x]` local | Fixture Model visible; Add model action absent in release `softmatrix-vm-v1-rc3` |
| Approved BYOK behavior (if enabled) | `[ ]` | `PENDING` |
| Gatekeeper availability and approval flow | `[x]` local availability | `/gatekeepers` localized heading visible in release `softmatrix-vm-v1-rc3`; approval flow still requires VM/provider setup |
| Workspace/chat persists after browser reload | `[x]` local | release `softmatrix-vm-v1-rc3`; restart E2E passed 2/2 |
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
  --release-id softmatrix-vm-v1-rc3
sudo systemctl start softmatrix
sudo pnpm healthcheck:vm -- --base-url https://softmatrix.example
```

Record the archive path, `.sha256` sidecar, checksum, backup age, and time to recover:

Local rehearsal archive: `/tmp/softmatrix-vm-rehearsal-backups-d/softmatrix-vm-v1-rc3-20260809224123.tar.gz`.
Its SHA-256 is `4b7ccd987bee531df18ced129d94b66679604b22c38532b3942d675030820053`; the isolated
restore target was `/tmp/softmatrix-vm-rehearsal-restore-d`.

| Recovery check | Status | Evidence |
|---|---|---|
| Reboot VM and restore the same workspace/model preference | `[ ]` | `PENDING` |
| Restore archive into an empty isolated directory | `[x]` local | checksum `4b7ccd987bee531df18ced129d94b66679604b22c38532b3942d675030820053`; migration `v3` |
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
