# Softmatrix OS VM operations

## Daily health

Run the authenticated external health check and confirm the systemd unit is active:

```sh
node scripts/vm/healthcheck.mjs --base-url https://softmatrix.example
node scripts/vm/operator-probe.mjs --base-url https://softmatrix.example
systemctl is-active softmatrix
```

The public origin comes from `PUBLIC_BASE_URL`; `workerd` must remain bound to loopback. Check
that Caddy/Nginx is the only public listener and that WebSocket upgrades succeed.

## Storage and backups

The durable paths are `/var/lib/softmatrix/data` (SQLite/metadata and local KV) and
`/var/lib/softmatrix/objects` (local R2-compatible objects). Stop `softmatrix` before copying or
backing up. Keep the archive and `.sha256` sidecar on an independent disk. Test an isolated restore
monthly with `scripts/vm/restore-data.mjs`.

## Logs and incidents

Use `journalctl -u softmatrix` and the health check correlation output. Do not log prompts,
responses, tokens, OIDC codes, cookies, or raw provider bodies. Treat repeated `MODEL_*`,
`OIDC_*`, storage checksum, or readiness errors as incidents; preserve the release ID and the
latest backup checksum before changing state.

## Secrets and model providers

Rotate `OIDC_CLIENT_SECRET`, model-provider tokens, and any Gatekeeper client secrets through the
VM secret manager. `ORG_AI_MODELS` is the deployment-owned catalog. Keep `ALLOW_USER_BYOK=false`
unless the operator has approved personal credentials. A local Ollama endpoint is allowed only
through the backend's model-network service; it is never exposed by the reverse proxy.

## Upgrade

Build a new immutable VM release, validate its legal sidecar/checksums, copy it beneath
`/opt/softmatrix`, and install it with `scripts/vm/install-release.mjs`. The installer atomically
switches `current`, restarts systemd, and runs readiness. Keep `previous` until the acceptance gate
and backup verification are complete.

## Rollback

Record the active release before upgrading. Roll back by exact ID, then run the external health
check and bilingual login/chat smoke tests:

```sh
node scripts/vm/install-release.mjs --root /opt/softmatrix \
  --rollback <release-id> --base-url https://softmatrix.example
```

Never replace `current` by hand or delete the only known-good release.

## Monitoring

Alert on systemd restarts, health-check failures, disk usage in `/var/lib/softmatrix`, backup age,
checksum mismatch, OIDC denial spikes, model-provider latency/errors, and unexpected public
listeners. Review Gatekeeper approvals and model policy changes as security events.

## Support boundaries

This profile is independent Softmatrix OS software. Cloudflare does not operate the VM, provide
its IdP, host its model provider, or receive its data. Keep the exact release, runtime version,
backup checksum, and operator sign-off with each incident and release.

## Release rehearsal

Use [`vm-release-rehearsal.md`](vm-release-rehearsal.md) for the first-release evidence record.
The report must remain `PENDING OPERATOR EXECUTION` until the commands run on a clean single VM.
Record the source commit, release ID, workerd/runtime versions, artifact and backup checksums,
restart/persistence result, isolated restore result, rollback result, and operator approval. Local
automated E2E output is supporting evidence only; it does not replace the clean-VM sign-off.
Validate the completed record with `pnpm validate:vm:evidence -- --report <record.json>` before
publishing the release.
