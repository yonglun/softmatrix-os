# Softmatrix OS generic OIDC SSO

Softmatrix OS supports one generic OpenID Connect provider per deployment. OIDC is an additive
login method: existing password accounts, Cloudflare Access, and authentication gatekeepers remain
available according to their deployment settings.

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
| `PUBLIC_BASE_URL` | yes with OIDC | Public HTTPS origin of the Softmatrix deployment |

The exact redirect URI is:

```text
<PUBLIC_BASE_URL>/api/auth/oidc/callback
```

Register the redirect URI exactly, including scheme, hostname, port, path, and trailing slash
behavior. The authorization request uses the `openid email profile` scopes, Authorization Code
flow, PKCE `S256`, an unpredictable state value, and a nonce.

The deployment service must inject the four OIDC values and non-secret display/domain settings via
its backend instance-state (`backendExtraVars`) contract. The repository release manifest only
contains `PUBLIC_BASE_URL`; it must never contain a client secret or an OIDC secret placeholder.

## Provider setup

| Provider | Client type | Setup notes |
| --- | --- | --- |
| Keycloak | Confidential OpenID Connect client | Set access type to confidential, enable Standard Flow, add the exact redirect URI, and expose the `email` and `email_verified` claims in the ID token. |
| Microsoft Entra ID | Web platform app registration | Add the redirect URI under Authentication, create a client secret, and request the standard OIDC scopes. Workforce tenants that do not emit `email_verified=true` should use the External ID federation flow below. |
| Okta | Web OIDC application | Use Authorization Code, add the exact redirect URI, create a client secret, and map `email` plus `email_verified` into the ID token. |

Softmatrix validates discovery metadata, issuer, audience, signature, `exp`, `iat`, nonce, and
`email_verified === true`. Group claims and role mapping are intentionally out of scope.

## Microsoft Entra External ID federation

This is the recommended path when the workforce Microsoft Entra ID token does not contain
`email_verified=true`. Softmatrix remains a normal OIDC client; Microsoft Entra External ID becomes
the OIDC issuer and federates the workforce tenant. The External ID flow can map the upstream
identity claims, including `email` and `email_verified`, in its OIDC identity-provider configuration.

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

The canonical account key is `email.trim().toLowerCase()`. This same identity boundary is used for
OIDC, Cloudflare Access, and auth-capable gatekeepers, so case and surrounding whitespace cannot
create duplicate accounts. A new OIDC account is created only when `AdminConfig.signupsEnabled`
is true. Existing accounts may still sign in when signups are closed. If the allowlist is non-empty,
the email domain must equal one of its normalized entries; suffixes do not match (`example.com.evil`
is not `example.com`).

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
3. Check that the provider emits `email` and boolean `email_verified: true`.
4. Check the exact email domain allowlist and the `signupsEnabled` admin setting.
5. Retry after a stale popup; the five-minute state is single-use and cannot be replayed.
