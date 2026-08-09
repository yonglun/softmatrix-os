# Softmatrix OS deployment

This runbook deploys an independent Softmatrix OS instance from a reviewed release candidate.
It does not use Cloudflare OS hosted deployment links.

## Prerequisites

- Node.js 22+, pnpm 11+, a Cloudflare account with Workers, KV, and R2 permissions.
- A private DNS name and TLS certificate for the instance.
- An organization IdP registered for the exact callback URL.
- Approved model-provider accounts; never paste production credentials into source or tests.

## Install

```sh
pnpm install --frozen-lockfile
pnpm verify:softmatrix
node scripts/release/build-release.mjs --out release-out --release-id softmatrix-v1-rc1
```

Upload a candidate only after review:

```sh
node scripts/release/upload-release.mjs --release release-out --candidate
```

## Environment and Secrets

Set these in the deploy service or Wrangler secret store. Keep values out of `wrangler.jsonc`.

| Variable | Purpose |
| --- | --- |
| `PUBLIC_BASE_URL` | Canonical HTTPS origin used by callbacks and service bindings |
| `CF_ACCESS_AUD`, `CF_ACCESS_ISS` | Optional Cloudflare Access audience and issuer |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | OIDC discovery and confidential client |
| `OIDC_DISPLAY_NAME`, `OIDC_ALLOWED_EMAIL_DOMAINS` | Login button and exact domain policy |
| `DISABLE_PASSWORD_AUTH` | Set `true` only after OIDC/Access smoke checks |
| `ORG_AI_MODELS` | JSON organization model catalog; credentials are secret references |
| `ALLOW_USER_BYOK` | Explicitly enables or disables personal model credentials |
| `CF_AI_GATEWAY`, `CF_AI_GATEWAY_ACCOUNT_ID` | Optional governed AI Gateway routing |
| `CF_AI_GATEWAY_API_TOKEN` | AI Gateway run/read secret |
| `ADMINS` | JSON array of administrator usernames |

## Cloudflare Access

When Access is enabled, configure the application audience and team issuer in the deploy
service. Verify an allowed user, an expired assertion, and a user from a different Access team.
The backend must fail closed before reading error-report bodies when the assertion is invalid.

## OIDC

Register `{{PUBLIC_BASE_URL}}/api/auth/oidc/callback` with the IdP. Verify discovery issuer,
RS256/JWKS validation, PKCE S256, state, nonce, exact audience, expiry, `email_verified`, and
domain allow-list checks. Test cancel, replay, duplicate parameters, and provider outage before
turning off password authentication.

## Model catalog and BYOK

`ORG_AI_MODELS` is the organization-owned catalog. Set `ALLOW_USER_BYOK=false` for governed
deployments and confirm the UI has no personal credential controls. If BYOK is approved, test a
credential failure and verify only a stable error code and correlation ID reach the browser.
Switch models explicitly in a chat and verify the selected model is persisted per user.

## Backup

Back up Durable Object migrations, KV namespaces (`BLUEPRINTS`, `AVATARS`), R2 blueprint content,
and the release ID. Test restoring a workspace and its matching legal sidecar in a disposable
account before every production promotion.

## Monitoring

Monitor Worker errors, OIDC failure codes, model policy denials, Gatekeeper approvals, latency,
rate-limit saturation, and release manifest availability. Alert when a release manifest exists
without all legal objects or content-addressed blobs.

## Secret rotation

Rotate OIDC client secrets, Access keys, model-provider tokens, and AI Gateway tokens through the
secret store. Deploy a new candidate, run smoke checks, then revoke the old value. Never log the
secret, prompt, model response, or authorization code.

## Common failures

- `OIDC_PROVIDER_UNAVAILABLE`: check discovery/JWKS reachability and issuer configuration.
- `OIDC_DOMAIN_NOT_ALLOWED`: use an exact lower-case domain in `OIDC_ALLOWED_EMAIL_DOMAINS`.
- `MODEL_CREDENTIAL_INVALID`: rotate the provider credential; do not expose the provider body.
- Missing model catalog: check JSON syntax and organization policy before enabling BYOK.
- Missing legal artifact: stop promotion and rebuild the candidate.

## Upgrade

Build and upload a new candidate, run `pnpm test:e2e`, deploy to isolated staging, and compare
the candidate manifest and legal sidecar with the previous release. Promote only after QA and
security sign-off.

## Rollback

Record the current release ID before promotion. Roll back by promoting that exact previous ID;
the legal files and sidecar are copied before its manifest. Re-run bilingual login, model-policy,
and Gatekeeper smoke checks, then investigate the failed candidate.

## Support boundaries

Softmatrix OS is an independent Apache-2.0 project derived from Cloudflare OS. Cloudflare does
not operate this distribution or provide its IdP, model-provider, or deployment support.

