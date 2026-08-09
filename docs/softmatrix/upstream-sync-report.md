# Upstream synchronization rehearsal

Date: 2026-08-09 (Asia/Shanghai)

## Inputs

- Upstream remote: `https://github.com/cloudflare/cloudflare-os.git` (fetch-only; push URL is `DISABLED`).
- Upstream branch: `upstream/main` at `1cb5e3d`.
- Rehearsal base: Softmatrix release-hardening commit `85dbc28`.
- Worktree: `/tmp/softmatrix-upstream-rehearsal` (created and removed after verification).

## Conflicts and resolution rules

The merge produced two content conflicts:

1. `packages/workshop-backend/src/overseer.ts`: retain the Softmatrix locale argument and
   authenticated chat context, while wrapping the upstream `agent.run` tracing span around the
   existing call.
2. `packages/workshop-frontend/src/ObserverConfigModal.tsx`: retain Softmatrix i18n resources and
   the upstream resource-scope grant logic. New upstream observer copy was added as
   `management.observer.*` keys in both locales; tests use an explicit translation fixture.

The upstream merge also changed the release manifest golden fixture and added GitHub tracing
coverage. Those changes were isolated to the rehearsal branch and were not merged into the
Softmatrix feature branch.

## Verification

In the disposable worktree, after `pnpm install --frozen-lockfile`:

- `node --test scripts/*.test.js`: 45 tests passed.
- `pnpm test`: all recursive package suites passed (including workshop frontend 161/161 and
  workshop backend 347/347).
- `pnpm build`: all 26 buildable workspace projects passed.
- `pnpm licenses list --json`: passed and was written only to a temporary file.

The browser journey suite is run against the current Softmatrix branch separately because the
rehearsal worktree does not carry the disposable local-provider state between builds. It remains a
release-blocking check before candidate promotion.

## Follow-up

At the next monthly sync, replay the observer i18n resolution and rerun the release gate before
merging any upstream changes. Do not merge this rehearsal branch or copy upstream changes around
the release manifest without a new review.

