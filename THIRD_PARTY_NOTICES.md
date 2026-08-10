# Softmatrix OS third-party notices

Softmatrix OS is distributed under the Apache License, Version 2.0. The upstream
Cloudflare OS attribution and notice remain in [`NOTICE`](NOTICE). This file records the
production dependency inventory for the release line; it is not a blanket claim that every
dependency uses Apache-2.0.

The authoritative versions are pinned in [`pnpm-lock.yaml`](pnpm-lock.yaml). Release CI runs
`pnpm licenses list --json`, reviews every transitive package for `UNKNOWN`, custom, copyleft,
or missing metadata, and stores the JSON report as a build artifact. A release is blocked when
that review has not been completed. The table below is the normalized direct-runtime inventory
used by the current source milestone.

| Package | Version | License | Source / notice |
| --- | --- | --- | --- |
| `@cloudflare/puppeteer` | 1.2.0 | Apache-2.0 | <https://github.com/cloudflare/puppeteer> |
| `@earendil-works/pi-agent-core` | 0.83.0 | MIT | <https://github.com/badlogic/pi-mono> |
| `@earendil-works/pi-ai` | 0.83.0 | MIT | <https://github.com/badlogic/pi-mono> |
| `capnweb` | 0.8.0 | Apache-2.0 | <https://github.com/cloudflare/capnweb> |
| `diff` | 8.0.4 | BSD-3-Clause | <https://github.com/kpdecker/jsdiff> |
| `jose` | 6.2.5 | MIT | <https://github.com/panva/jose> |
| `oauth4webapi` | 3.8.6 | MIT | <https://github.com/panva/oauth4webapi> |
| `yjs` | 13.6.31 | MIT | <https://github.com/yjs/yjs> |
| `react` | 19.2.8 | MIT | <https://github.com/facebook/react> |
| `react-dom` | 19.2.8 | MIT | <https://github.com/facebook/react> |
| `@phosphor-icons/react` | pinned in lockfile | MIT | <https://github.com/phosphor-icons/react> |
| `@tanstack/react-router` | pinned in lockfile | MIT | <https://github.com/TanStack/router> |
| `i18next` | 26.3.6 | MIT | <https://github.com/i18next/i18next> |
| `react-i18next` | 17.0.11 | MIT | <https://github.com/i18next/react-i18next> |
| `miniflare` (vendored local KV/R2 workers) | 5.20260801.0-alpha | MIT | <https://github.com/cloudflare/workers-sdk/tree/main/packages/miniflare> |

## Current license-review findings

The 2026-08-10 development-host inventory also reported the following transitive or optional
packages. They are recorded here so the release review cannot silently omit them:

| Package | Version | License | Review boundary |
| --- | --- | --- | --- |
| `@img/sharp-libvips-darwin-arm64` | 1.3.1 | LGPL-3.0-or-later | Optional macOS ARM build dependency; confirm whether the target Linux VM resolves a corresponding libvips package and retain the required LGPL notices if it is shipped or executed. |
| `isbot` | 5.2.1 | Unlicense | Transitive package; retain its upstream metadata and confirm the approved Unlicense treatment in the final dependency review. |

This snapshot is not a final production approval. Run `pnpm licenses list --json` from the clean
Linux VM release checkout, compare all `UNKNOWN`, copyleft, custom, and missing entries with this
record, and attach the reviewed inventory to the release ticket. A release remains `NO-GO` until
the target-platform review explicitly accepts or removes each flagged dependency and verifies the
corresponding legal notices.

Each package retains the copyright and license text supplied by its upstream project. When a
dependency ships a separate `NOTICE` file, the release job copies that notice into the legal
artifact bundle or records its URL in the CI inventory. The source repository does not replace
or relicense third-party code.

## Release artifact contract

Every candidate and published release contains the exact root `LICENSE`, `NOTICE`, this file,
and a SHA-256/size sidecar at `legal-manifest.json`. See
[`docs/compliance.md`](docs/compliance.md) and the bilingual deployment runbooks for the
review and rollback procedure.
