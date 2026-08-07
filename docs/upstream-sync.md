# Synchronizing with Cloudflare OS

Softmatrix OS is derived from [Cloudflare OS](https://github.com/cloudflare/cloudflare-os)
at baseline commit `0eaec6c5e8fc6b3298ea1aa73bf5c3e47b923c7f`. Keep the upstream repository as a
fetch-only remote so upstream changes cannot accidentally receive Softmatrix commits.

For a checkout whose current `origin` still points at the Cloudflare repository, initialize
the remotes once:

```sh
git remote rename origin upstream
git remote set-url --push upstream DISABLED
```

The repository owner must then add the independently chosen Softmatrix fork URL as `origin`
before the first push. This project deliberately does not prescribe or hard-code a hosting
organization.

To synchronize an existing Softmatrix fork:

```sh
git fetch upstream --prune --tags
git switch main
git merge --no-ff upstream/main
pnpm install --frozen-lockfile
pnpm lint && pnpm test && pnpm build
```

Resolve conflicts deliberately and preserve Softmatrix-specific tests. The main conflict
hotspots are:

- `packages/workshop-backend/src/server.ts`, where authentication and public RPC flows meet.
- `packages/workshop-shared/src/api.ts`, the public frontend/backend RPC contract.
- `packages/workshop-backend/src/auth/` and deployment authentication configuration.
- Model provider resolution and organization model policy.
- Frontend branding, locale resources, and product metadata.

After merging, verify that the root `LICENSE` is unchanged, `NOTICE` still identifies the
derivative relationship, tenant branding overrides still work, and the complete lint, test,
and build commands pass. Record the upstream commit in the merge or release notes so every
Softmatrix release has a reproducible provenance point.
