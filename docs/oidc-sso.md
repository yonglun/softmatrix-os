# Softmatrix OS OIDC SSO

Softmatrix OS supports one OpenID Connect provider per deployment. The default generic mode requires
a verified email; an explicit Workforce Microsoft Entra mode uses tenant-bound `tid` + `oid` for the
security identity and UPN for the user-facing profile. OIDC is additive: existing password accounts,
Cloudflare Access, and authentication gatekeepers remain available according to deployment settings.

## Configuration

Set these values in the backend instance environment. They are not AdminConfig values and are never
sent to the browser, release manifest, logs, analytics, or frontend assets.

| Variable | Required | Meaning |
| --- | --- | --- |
| `OIDC_ISSUER` | yes | Provider issuer URL, for example `https://login.example.com/realms/acme` |
| `OIDC_CLIENT_ID` | yes | OIDC web client identifier |
| `OIDC_CLIENT_SECRET` | yes | OIDC client secret, injected as a secret binding |
| `OIDC_DISPLAY_NAME` | no | Button label; defaults to `SSO` |
| `OIDC_ALLOWED_EMAIL_DOMAINS` | no | Comma-separated exact domains, for example `example.com,subs.example.com` |
| `OIDC_IDENTITY_MODE` | no | `verified-email` (default) or explicit `entra-tenant` |
| `OIDC_ENTRA_TENANT_ID` | Entra mode | Exact Workforce Entra tenant GUID; never used as a browser setting |
| `PUBLIC_BASE_URL` | yes with OIDC | Public HTTPS origin of the Softmatrix deployment |

The exact redirect URI is:

```text
<PUBLIC_BASE_URL>/api/auth/oidc/callback
```

Register the redirect URI exactly, including scheme, hostname, port, path, and trailing slash
behavior. The authorization request uses the `openid email profile` scopes, Authorization Code
flow, PKCE `S256`, an unpredictable state value, and a nonce.

The deployment service must inject the OIDC credentials and non-secret mode/display/domain settings
via its backend instance-state (`backendExtraVars`) contract. The repository release manifest only
contains `PUBLIC_BASE_URL`; it must never contain a client secret or an OIDC secret placeholder.

## Provider setup

| Provider | Client type | Setup notes |
| --- | --- | --- |
| Keycloak | Confidential OpenID Connect client | Set access type to confidential, enable Standard Flow, add the exact redirect URI, and expose the `email` and `email_verified` claims in the ID token. |
| Microsoft Entra ID | Web platform app registration | Use `verified-email` when the token includes `email_verified=true`; use the explicit Workforce Entra mode below when it does not. |
| Okta | Web OIDC application | Use Authorization Code, add the exact redirect URI, create a client secret, and map `email` plus `email_verified` into the ID token. |

Softmatrix validates discovery metadata, issuer, audience, signature, `exp`, `iat`, and nonce in both
modes. Generic mode additionally requires `email_verified === true`; Entra mode additionally
requires exact `tid`, UUID-shaped `oid`, non-empty `upn`, and an exact UPN-domain allowlist match.
Group claims and role mapping are intentionally out of scope.

## Microsoft Entra Workforce tenant mode

Use this explicit mode for a single Workforce Entra tenant when its ID token does not contain
`email_verified`. The application must emit the `upn` optional ID-token claim. `tid` must equal the
configured tenant, `oid` is the immutable tenant-local object identifier, and the UPN domain must be
allowlisted. UPN is stored as the profile ID and initial display identity; it is not the Durable Object
name or session security key. A directory rename therefore keeps the same account and preserves any
custom display name and sharing identity.

```dotenv
OIDC_IDENTITY_MODE=entra-tenant
OIDC_ENTRA_TENANT_ID=<workforce-tenant-guid>
OIDC_ALLOWED_EMAIL_DOMAINS=example.com
OIDC_ISSUER=https://login.microsoftonline.com/<workforce-tenant-guid>/v2.0
OIDC_CLIENT_ID=<application-id>
OIDC_CLIENT_SECRET=<secret-value>
```

Configure `ADMINS` with normalized UPN values (for example `alice@example.com`). Existing generic
email-keyed accounts are not automatically linked to new Entra accounts. The exact callback remains
`https://<your-domain>/api/auth/oidc/callback`.

## Microsoft Entra External ID federation

External ID federation remains an optional path for multi-tenant/customer identity. It is not
required for the single-VM Workforce Entra mode above. In this design Softmatrix remains a normal
OIDC client; Microsoft Entra External ID becomes the OIDC issuer and federates the workforce tenant.
The External ID flow can map the upstream identity claims, including `email` and `email_verified`, in
its OIDC identity-provider configuration.

1. Create an External tenant and register a Web application for Softmatrix. Add the exact redirect
   URI `https://<your-domain>/api/auth/oidc/callback`, create a client secret, and associate the app
   with a sign-up/sign-in user flow.
2. In the workforce tenant, register the External tenant as an application for federation. Use the
   federation redirect URIs shown by the External tenant, grant the delegated Graph permissions
   `email`, `openid`, `profile`, and `User.Read`, and grant admin consent. Do not use the Softmatrix
   callback URI for this federation registration; it belongs to the External tenant's federation
   endpoint.
3. In the External tenant, add the workforce tenant as a custom OpenID Connect identity provider.
   Use the workforce tenant's well-known endpoint and tenant-specific issuer, then configure the
   `sub`, `name`, `email`, and `email_verified` claim mappings. Keep `email` required in the user
   flow unless there is a separate, reviewed identity policy.
4. Set `OIDC_ISSUER` to the exact `issuer` value returned by the External tenant's discovery
   document (not the `.well-known` URL), `OIDC_CLIENT_ID` to the Softmatrix app registration in the
   External tenant, and `OIDC_CLIENT_SECRET` to its secret value. Set
   `OIDC_ALLOWED_EMAIL_DOMAINS` to the approved domains.

The External ID discovery URL uses the tenant-specific `ciamlogin.com` form, for example
`https://<external-tenant>.ciamlogin.com/<external-tenant-id>/v2.0/.well-known/openid-configuration`.
Microsoft's federation guide documents the workforce-to-External-ID registration and federation
redirect URIs; its claims-mapping guide defines the `email_verified` meaning and requirement.

Sources:

- https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-entra-id-federation-customers
- https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-custom-oidc-federation-customers
- https://learn.microsoft.com/en-us/entra/external-id/customers/reference-oidc-claims-mapping-customers

## Account and domain policy

In generic `verified-email` mode the canonical account key is `email.trim().toLowerCase()`. In
`entra-tenant` mode the account key is the delimiter-safe `entra-<tid>-<oid>` value; the normalized
UPN is the user-facing profile ID. Case and surrounding whitespace cannot create duplicate profiles.
A new OIDC account is created only when `AdminConfig.signupsEnabled` is true. Existing accounts may
still sign in when signups are closed. If the allowlist is non-empty, the email or UPN domain must
equal one of its normalized entries; suffixes do not match (`example.com.evil` is not `example.com`).

## Password-mode safety

`DISABLE_PASSWORD_AUTH=true` disables password login only when a usable external method (OIDC or an
allowlisted auth gatekeeper) is configured. If no external method is available, password login stays
enabled to prevent locking an installation out. To recover from a bad SSO deployment, remove the
OIDC settings or set `DISABLE_PASSWORD_AUTH=false`, then redeploy.

## Security and operations

- OIDC state and PKCE material live in a short-lived SQLite Durable Object and expire after five minutes.
- The callback is GET-only, accepts exactly one `state` and `code`, and returns a static popup-closing
  page with `Content-Security-Policy: default-src 'none'`, `Cache-Control: no-store`, and no token in
  the URL or response body.
- Callback replay is rejected after the one-time result is recorded.
- ID/access/refresh tokens are not persisted after identity validation; only a session token is
  delivered over the initiating RPC capability.
- Rotate `OIDC_CLIENT_SECRET` in the provider and deployment secret store together. Never paste a
  secret into an issue, manifest, screenshot, or log.
- Discovery and JWKS data are bounded and expire. Provider failures fail closed with a stable public
  error code.

Public failures include a correlation ID, without exposing provider descriptions. Use that ID with
backend observability logs when diagnosing a deployment. Common checks are:

1. Confirm the redirect URI and issuer URL match exactly.
2. Confirm the client secret is present in backend instance state and was not serialized into a release manifest.
3. In generic mode, check that the provider emits `email` and boolean `email_verified: true`; in
   Entra mode, check exact `tid`, `oid`, `upn`, and `OIDC_ALLOWED_EMAIL_DOMAINS` instead.
4. Check the exact email/UPN domain allowlist and the `signupsEnabled` admin setting.
5. Retry after a stale popup; the five-minute state is single-use and cannot be replayed.
