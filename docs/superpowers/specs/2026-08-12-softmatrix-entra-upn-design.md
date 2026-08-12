# Softmatrix OS Entra UPN identity mode

## Status

Proposed

## Date

2026-08-12

## Context

The generic OIDC implementation intentionally requires `email_verified=true`. Microsoft Entra
workforce v2.0 tokens commonly provide a UPN-like username but do not consistently provide that
claim. Requiring Entra External ID would solve the claim problem but adds a second tenant and a
federation setup that is too heavy for the first self-hosted VM release.

The implementation must support a single Workforce Entra tenant without treating a mutable human
identifier as the account's security identity. Existing password, gatekeeper, Cloudflare Access,
and generic OIDC accounts must continue to work unchanged.

## Decision

Add an explicit, opt-in Entra tenant identity mode:

- `OIDC_IDENTITY_MODE=verified-email` remains the default and preserves the current generic OIDC
  contract (`email` plus `email_verified === true`).
- `OIDC_IDENTITY_MODE=entra-tenant` enables the Workforce Entra path.
- `OIDC_ENTRA_TENANT_ID` is required in Entra mode and must equal the token `tid` claim.
- `OIDC_ALLOWED_EMAIL_DOMAINS` must be non-empty in Entra mode and must exactly match the normalized
  UPN domain.
- The token must contain a non-empty `oid` claim. The internal account key is the opaque,
  delimiter-safe value `entra-<tid>-<oid>`; it is used as the User Durable Object name and session
  token prefix.
- The token must contain a non-empty `upn` claim. UPN is normalized and stored as the profile ID
  and display identity, but it is never used as the Durable Object name or session security key.
- Entra mode validates issuer, audience, signature, nonce, `exp`, `iat`, `tid`, `oid`, UPN syntax,
  and the exact domain allowlist. It does not require `email_verified` because tenant-bound `tid`
  plus immutable `oid` are the security identity for this mode.

The mode is deliberately explicit. A deployment cannot silently fall back from verified email to
UPN, and a generic OIDC provider cannot opt into Entra semantics accidentally.

## Identity and storage behavior

`VerifiedOidcIdentity` gains an internal account-key field. The OIDC Durable Object passes the
account key and normalized UPN to a dedicated User Durable Object login method. The new method:

1. Resolves the User Durable Object by the stable account key.
2. Creates the profile on first sign-in when signups are enabled, using UPN as profile ID and the
   UPN local part as the initial display name.
3. Leaves an existing profile unchanged on later sign-ins, preserving custom names and sharing IDs.
4. Returns a session token whose first segment is the stable account key, so authentication remains
   routable even if the user's UPN later changes.

Existing users and all existing email-keyed Durable Objects are not migrated or automatically linked.
The authenticated API must obtain the user-facing profile ID from the User Durable Object rather
than assuming `durableObjectId.name` is an email. Internal workspace ownership and analytics may
continue using the Durable Object ID.

## Configuration contract

```dotenv
OIDC_IDENTITY_MODE=entra-tenant
OIDC_ENTRA_TENANT_ID=<workforce-tenant-guid>
OIDC_ALLOWED_EMAIL_DOMAINS=example.com
OIDC_ISSUER=https://login.microsoftonline.com/<workforce-tenant-guid>/v2.0
OIDC_CLIENT_ID=<application-id>
OIDC_CLIENT_SECRET=<secret-value>
```

The Entra application must emit the `upn` ID-token optional claim. Secrets remain in the VM
environment file or secret manager and never enter a release manifest, logs, or browser config.
Configuration validation rejects an unknown mode, a missing tenant ID, or an empty domain list in
Entra mode before the service starts.

## Error handling

Malformed or mismatched Entra claims fail closed as `OIDC_TOKEN_INVALID` with the existing
correlation-ID mechanism. The public response never exposes token claims, tenant IDs, UPNs, client
secrets, or provider error details.

## Testing and acceptance

- Config tests cover default mode, Entra mode, missing tenant ID, and empty domain allowlist.
- Protocol tests cover a valid UPN-only Entra token, wrong `tid`, missing/invalid `oid`, missing
  `upn`, disallowed UPN domain, wrong audience, wrong issuer, nonce mismatch, and expired tokens.
- User Durable Object tests prove the stable account key routes sessions while the stored profile ID
  remains the UPN.
- Existing generic OIDC tests continue to require `email_verified=true`.
- Backend type checks, focused OIDC tests, VM release tests, lint, branding/compliance checks, and
  diff checks must pass before release.
- Manual VM acceptance signs in through Workforce Entra, verifies that a token with no
  `email_verified` claim succeeds only when `tid`, `oid`, `upn`, and the domain allowlist are valid,
  then confirms password-auth rollback remains available.

## Alternatives rejected

### Use UPN as the Durable Object name

Rejected because UPN can change and would split one person into multiple accounts after a directory
rename.

### Accept `email_verified` when absent for every OIDC provider

Rejected because it silently weakens the generic OIDC security contract and allows arbitrary
providers to supply mutable email identities.

### Require Entra External ID federation

Rejected for the first VM release because it adds a second tenant, federation application, user flow,
and claims-mapping setup. It remains the preferred multi-tenant/customer identity architecture.

## Rollback

Set `OIDC_IDENTITY_MODE=verified-email` or remove the Entra-specific variables, run the VM config
check, and restart the service. Existing accounts are preserved; newly created Entra Durable Objects
remain isolated and can be retained or removed through the normal data-retention process.
