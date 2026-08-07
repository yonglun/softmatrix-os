# Softmatrix OS compliance baseline

This source tree keeps the upstream Apache License 2.0 byte-for-byte in `LICENSE`. `NOTICE` records
the upstream provenance, the independent-project disclaimer, and a prominent unified statement
that Softmatrix OS contributors modified the upstream work. The Git history is the detailed record
of modified files and changes.

## Distribution gate

This foundation milestone does not yet claim that a production release bundle has a complete
third-party license inventory. Creating and reviewing the normalized `THIRD_PARTY_NOTICES.md` is a
release-blocking deliverable in
[`docs/superpowers/plans/2026-08-07-softmatrix-release-hardening.md`](superpowers/plans/2026-08-07-softmatrix-release-hardening.md).
No source archive, container, binary, or hosted release should be represented as distribution-ready
until that file lists the applicable production dependency versions, license identifiers, required
copyright or notice text, and source URLs.

The release maintainer must generate the dependency license report with `pnpm licenses list --json`,
review unknown, custom, copyleft, and missing licenses, and update `THIRD_PARTY_NOTICES.md` whenever a
production dependency changes. The release readiness gate must retain the root `LICENSE`, `NOTICE`,
and the reviewed third-party notice in every distributed artifact.
