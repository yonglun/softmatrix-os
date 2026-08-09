# Softmatrix OS operations

## Prerequisites

Use a dedicated operator account, a password manager, read-only observability access, and a
disposable staging instance. Operators must know the currently promoted release ID.

## Install

Operations begin from a candidate that passed `pnpm verify:softmatrix` and `pnpm test:e2e`; do not
edit a running Worker bundle by hand.

## Environment and Secrets

Review `PUBLIC_BASE_URL`, `CF_ACCESS_AUD`, `CF_ACCESS_ISS`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
`OIDC_CLIENT_SECRET`, `OIDC_ALLOWED_EMAIL_DOMAINS`, `DISABLE_PASSWORD_AUTH`, `ORG_AI_MODELS`,
`ALLOW_USER_BYOK`, `CF_AI_GATEWAY`, `CF_AI_GATEWAY_ACCOUNT_ID`, `CF_AI_GATEWAY_API_TOKEN`, and
`ADMINS` against the deployment's secret inventory. Values are never copied into tickets.

## Cloudflare Access

Check Access policy changes before changing `CF_ACCESS_AUD` or `CF_ACCESS_ISS`. Keep one break-glass
operator path and test an invalid assertion after every policy update.

## OIDC

Review OIDC error-rate and domain-policy metrics. A discovery, JWKS, nonce, state, or signature
failure is an authentication incident; preserve only the stable error code and correlation ID.

## Model catalog and BYOK

Treat `ORG_AI_MODELS` changes as a reviewed policy change. Verify provider, model, context window,
and organization scope. If `ALLOW_USER_BYOK` is true, monitor credential-test failures and ensure
tokens never appear in logs, analytics, RPC errors, or client bundles.

## Backup

Run a daily metadata backup and a pre-release R2/KV snapshot. Record backup age, release ID, and
restore owner. Exercise a restore quarterly in an isolated account.

## Monitoring

Page on sustained Worker 5xx, authentication failure spikes, model policy denials, storage errors,
or a missing legal sidecar. Dashboard response latency, OIDC codes, model error codes, Gatekeeper
approval queue age, and release-manifest availability.

## Secret rotation

Rotate one credential at a time: add the new secret, deploy and smoke test, then revoke the old
secret. Keep the previous release available for rollback but never retain revoked credentials.

## Common failures

- Authentication failures: compare issuer/audience and callback URL, then test the IdP directly.
- Empty model catalog: validate `ORG_AI_MODELS` JSON and organization mapping.
- Provider outage: switch only to an approved catalog model and record the incident.
- Candidate missing legal files: stop promotion and rebuild; never bypass the sidecar check.

## Upgrade

Use the release checklist, compare migrations and manifest hashes, run staging smoke tests, and
announce the maintenance window. Monitor for one complete error-budget window after promotion.

## Rollback

Promote the recorded previous release ID. Verify login, model selection, Gatekeeper approval, and
workspace persistence. Keep the failed candidate immutable for forensic comparison.

## Support boundaries

The release maintainer owns Softmatrix operations. Cloudflare support covers the underlying
platform only; IdP, provider, policy, and application incidents remain the operator's responsibility.

