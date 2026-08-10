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
| Source commit (latest automated rehearsal) | `396a6cccd0d09e264ebd4344021ea8ce624808ab`; replace with the exact production checkout SHA |
| Release ID (local rehearsal) | `softmatrix-vm-v1.0.0-396a6cc` |
| Build timestamp (UTC) | `2026-08-10T14:44:10.824Z` |
| Release directory | `/tmp/softmatrix-vm-v1.0.0-396a6cc` |
| `manifest.json` SHA-256 | `789ed154ef0331af5877eac153456e30c8273fe6d9d738a4d5349d9b02c8c4bc` |
| `checksums.sha256` SHA-256 | `4e5fcaddcd1589b3165c43e165fe6a5b9e22a1cfe73d0950af7b5f5ba5c847c0` |
| `legal-manifest.json` SHA-256 | `a8dc8b170d5d742e3e88da0491858a93c12c59724668f0bd5e01c3f3681b08c1` |
| Apache-2.0 `LICENSE` SHA-256 | `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594` |
| `tools/vm-config.mjs` SHA-256 | `f7974028822f010879df7e91d75b61800c5cd74032beef45d749d080cfc2184d` |
| `workerd` version/binary SHA-256 | `2026-08-01` / `3da61644318c8fab32e68a504513865aef12329b1356d75d7e6f83a713ea9f7b` (local binary; verify the VM binary separately) |
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

After the real VM rehearsal, copy [`vm-acceptance-report.example.json`](vm-acceptance-report.example.json),
fill it with evidence references (never secrets), and validate it before changing this report to
`GO`:

```sh
pnpm validate:vm:evidence -- --report /secure/release-records/softmatrix-v1.0.0.json
```

The validator requires all production checks, release hashes, recovery data, and three sign-offs;
`GO` is rejected if any check is missing, failed, pending, or lacks evidence.

From a clean source checkout matching the recorded source commit, the repository can seed a `NO-GO`
draft from a release directory so artifact hashes and pinned runtime facts are not copied manually.
The immutable release directory does not contain these operator scripts. This draft is not acceptance
evidence and must be completed on the operator VM, outside the release directory:

```sh
pnpm init:vm:evidence -- \
  --release /opt/softmatrix/incoming-v1.0.0 \
  --out /secure/release-records/softmatrix-v1.0.0.json \
  --origin https://softmatrix.example \
  --workerd /usr/local/bin/workerd
```

## Automated evidence from this source milestone

These results are development evidence only and must be re-run from the clean release checkout:

| Check | Result | Evidence timestamp / log |
|---|---|---|
| VM build artifact tests | PASS (2/2) | `node --test scripts/vm/build-release.test.js` |
| VM config preflight tests | PASS (5/5) | `node --test scripts/vm/vm-config.test.js`; packaged CLI also passed |
| VM network boundary tests | PASS (4/4) | `pnpm test:vm:network`; service/profile loopback and Caddy/Nginx WebSocket proxy templates |
| VM public endpoint probe tests | PASS (3/3) | `pnpm test:vm:probe`; HTTP status, HTTPS requirement, and `/api` WebSocket 101 checks |
| VM release evidence schema | PASS (4/4) | `node --test scripts/vm/release-evidence.test.js`; GO/NO-GO completeness, hash, timestamp, and secret-field guards |
| VM evidence draft initializer | PASS (2/2) | `node --test scripts/vm/release-evidence-init.test.js`; immutable facts only, explicit NO-GO |
| VM evidence collector contract | PASS (7/7) | `node --test scripts/vm/release-evidence-collect.test.js`; automated facts and log audit cannot change NO-GO to GO |
| VM log-redaction audit contract | PASS (5/5) | `node --test scripts/vm/log-redaction-audit.test.js`; findings never include log values or unsafe journal arguments |
| Install, health, backup, restore tests | PASS (6/6) | `node --test scripts/vm/install-release.test.js scripts/vm/vm-data.test.js` |
| Router asset MIME tests | PASS (14/14) | `pnpm --filter @gadgets/router test` |
| VM workerd config compile | PASS | `workerd compile runtime/workerd.capnp config` |
| Bilingual VM browser journey | PASS (8/8) | Ubuntu `VM Smoke` run below; English/Chinese password restart, OIDC success, cancellation, and domain-denial journeys |
| Compliance and i18n coverage | PASS (3/3) | `node --test scripts/softmatrix-compliance.test.js scripts/i18n-coverage.test.js` |

The `softmatrix-vm-v1.0.0-396a6cc` artifact contains 18 workers, 84 modules, and 31 asset blobs. Its generated
`runtime/workerd.capnp` compiled successfully; the current local compiled configuration SHA-256 is
`34dda6332c6a7716118c0a3a6969e76e3b39e4c99e20667669dc0ebd488d6773`. The immutable package
also includes the systemd fail-closed preflight at `tools/vm-config.mjs`.

## Latest clean-checkout CI gate

The release builder has since been hardened to generate every ignored worker input before Wrangler
collects modules (`build:app`, `build:configurator`, and `build:format-blueprints`). The latest
release gate is `43d435c`; its GitHub CI run passed build, tests, lint, and Chromium browser E2E,
and its Ubuntu `VM Smoke` run passed the network contract, public probe, and all eight browser
journeys on an ephemeral Linux VM:

The follow-on head `43d435c` adds the safe log audit and evidence-collector integration and re-ran
the same gates successfully: [CI run 31398677663](https://github.com/yonglun/softmatrix-os/actions/runs/31398677663)
and [VM Smoke run 31398677796](https://github.com/yonglun/softmatrix-os/actions/runs/31398677796).

| Check | Result | Evidence |
|---|---|---|
| Repository build, tests, lint, and browser E2E | PASS | [GitHub CI run](https://github.com/yonglun/softmatrix-os/actions/runs/31388086502) |
| VM configuration contract | PASS | [GitHub VM Smoke run](https://github.com/yonglun/softmatrix-os/actions/runs/31388086580) |
| VM network boundary contract | PASS (4/4) | [GitHub VM Smoke run](https://github.com/yonglun/softmatrix-os/actions/runs/31388086580) |
| VM public endpoint probe | PASS (3/3) | [GitHub VM Smoke run](https://github.com/yonglun/softmatrix-os/actions/runs/31388086580) |
| VM release evidence schema | PASS (4/4) | [GitHub VM Smoke run](https://github.com/yonglun/softmatrix-os/actions/runs/31388086580) |
| Native workerd persistence | PASS | [GitHub VM Smoke run](https://github.com/yonglun/softmatrix-os/actions/runs/31388086580) |
| Clean immutable release build (18 workers / 84 modules) | PASS | [GitHub VM Smoke run](https://github.com/yonglun/softmatrix-os/actions/runs/31388086580) |
| English and Simplified Chinese password/restart journeys | PASS (2/2) | [GitHub VM Smoke run](https://github.com/yonglun/softmatrix-os/actions/runs/31388086580) |
| English and Simplified Chinese OIDC success journeys | PASS (2/2) | [GitHub VM Smoke run](https://github.com/yonglun/softmatrix-os/actions/runs/31388086580) |
| English and Simplified Chinese OIDC cancellation/domain-denial journeys | PASS (4/4) | [GitHub VM Smoke run](https://github.com/yonglun/softmatrix-os/actions/runs/31388086580) |

This is CI evidence on an ephemeral Ubuntu runner, not production VM sign-off. Keep the status below
as `PENDING OPERATOR EXECUTION` until the real VM, TLS proxy, OIDC provider, backup destination,
logs, reboot, rollback, and operator signatures have been recorded.

## Manual acceptance matrix

Mark each item only after attaching a timestamped log, screenshot, or checksum reference.

| Check | Status | Evidence |
|---|---|---|
| English password signup/login | `[x]` local | release `softmatrix-vm-v1-rc3`; `e2e/vm-self-hosting.spec.ts` |
| Simplified Chinese password signup/login | `[x]` local | release `softmatrix-vm-v1-rc3`; `e2e/vm-self-hosting.spec.ts` |
| OIDC success with local RS256/JWKS/PKCE fixture | `[x]` CI | [Ubuntu VM Smoke](https://github.com/yonglun/softmatrix-os/actions/runs/31372285224/job/93403695490); production IdP still pending |
| OIDC cancellation and domain-denial mapping with local fixture | `[x]` CI | [Ubuntu VM Smoke](https://github.com/yonglun/softmatrix-os/actions/runs/31372285224/job/93403695490); production IdP replay still pending |
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
