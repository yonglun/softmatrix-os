# Softmatrix OS upgrade

## Prerequisites

Have the previous release ID, an approved candidate, a maintenance window, QA and security
reviewers, and a tested backup. Confirm no unresolved upstream-sync or security blocker exists.

## Install

```sh
pnpm install --frozen-lockfile
pnpm verify:softmatrix
pnpm test:e2e
```

## Environment and Secrets

Compare the candidate's documented `PUBLIC_BASE_URL`, `CF_ACCESS_AUD`, `CF_ACCESS_ISS`, `OIDC_ISSUER`,
`OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_ALLOWED_EMAIL_DOMAINS`, `DISABLE_PASSWORD_AUTH`,
`ORG_AI_MODELS`, `ALLOW_USER_BYOK`, `CF_AI_GATEWAY`, `CF_AI_GATEWAY_ACCOUNT_ID`,
`CF_AI_GATEWAY_API_TOKEN`, and `ADMINS` with the currently deployed values.

## Cloudflare Access

Re-run allowed, denied, expired, and wrong-audience Access checks against staging before promotion.

## OIDC

Re-run login, cancel, domain rejection, state/nonce replay, and provider-outage checks. Do not
change issuer and client credentials in the same promotion unless the migration plan says so.

## Model catalog and BYOK

Compare organization model IDs and policy flags. Verify a known model, an unavailable model, an
explicit model switch, and the disabled-BYOK UI. Preserve the previous catalog for rollback.

## Backup

Take a fresh KV/R2 metadata snapshot and record its checksum with the previous release ID. Do not
delete old migration history.

## Monitoring

Watch deploy errors, login completion, model latency/error codes, Gatekeeper approvals, and storage
health during the first hour. Stop if error rate or authentication completion regresses.

## Secret rotation

If rotation is part of the upgrade, deploy new values first, smoke-test, then revoke old values.
Never put a secret in release notes or screenshots.

## Common failures

- Manifest hash mismatch: discard the candidate and rebuild from the same commit.
- Migration failure: stop promotion and restore the previous release ID.
- OIDC callback mismatch: restore the previous issuer/client configuration.
- Model policy regression: restore the previous catalog and disable BYOK.

## Upgrade

Build with `node scripts/release/build-release.mjs --out release-out --release-id softmatrix-v1-rc1`,
verify legal hashes, upload with `--candidate`, and obtain QA/security sign-off before promote.

## Rollback

Promote the recorded previous ID. Confirm legal files, sidecar, and manifest are all visible, then
run the bilingual smoke suite. Keep the candidate for analysis and open a follow-up issue.

## Support boundaries

Upgrades are maintained by Softmatrix release owners. Upstream Cloudflare OS changes require a
separate synchronization review; they are not silently pulled into a production release.

