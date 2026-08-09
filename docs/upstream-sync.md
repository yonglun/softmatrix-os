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

## Ownership and cadence

The repository's release maintainer owns upstream synchronization. Until the independent repository
publishes a `CODEOWNERS` mapping, the person approving a release is the acting release maintainer.
That maintainer must fetch and review upstream on the first business day of every month and again
before every Softmatrix release, recording the reviewed upstream commit in the merge or release
notes.

Security updates use an expedited path: the acting release maintainer reviews relevant upstream
security commits within one business day of notification, opens a dedicated sync branch, and runs
the full verification gate before merging. An applicable fix must not wait for the monthly cadence;
if it cannot be merged promptly, document the exposure, mitigation, owner, and target date in the
independent repository's security tracker.

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

## Release rehearsal evidence

Before a release, perform the merge in a disposable worktree and record the upstream SHA,
conflicts, resolution rules, and verification output. The latest rehearsal is recorded in
[`docs/softmatrix/upstream-sync-report.md`](softmatrix/upstream-sync-report.md). The rehearsal
must be removed after the report is written; it must never be merged merely to satisfy the
exercise.
