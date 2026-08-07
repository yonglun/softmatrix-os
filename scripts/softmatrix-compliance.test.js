import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const APACHE_2_LICENSE_SHA256 = "0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594";
const EXPECTED_NOTICE = `Softmatrix OS
Copyright 2026 Softmatrix OS contributors

This product is derived from Cloudflare OS:
https://github.com/cloudflare/cloudflare-os

Cloudflare OS is licensed under the Apache License, Version 2.0. Softmatrix OS retains
the upstream license and attribution. Softmatrix OS is an independent project and is not
affiliated with, sponsored by, or endorsed by Cloudflare, Inc.

Softmatrix OS contributors have modified the upstream work to establish independent branding,
centralized product metadata, and compliance controls. The Git history records the detailed changes.
`;

test("Softmatrix distribution retains the exact Apache-2.0 license and attribution", async () => {
  const [license, notice, readme, contributing, compliance, upstreamSync, releasePlan] =
    await Promise.all([
      readFile(new URL("../LICENSE", import.meta.url)),
      readFile(new URL("../NOTICE", import.meta.url), "utf8"),
      readFile(new URL("../README.md", import.meta.url), "utf8"),
      readFile(new URL("../CONTRIBUTING.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/compliance.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/upstream-sync.md", import.meta.url), "utf8"),
      readFile(
        new URL("../docs/superpowers/plans/2026-08-07-softmatrix-release-hardening.md", import.meta.url),
        "utf8",
      ),
    ]);

  assert.equal(createHash("sha256").update(license).digest("hex"), APACHE_2_LICENSE_SHA256);
  assert.equal(notice, EXPECTED_NOTICE);
  assert.match(readme, /^# Softmatrix OS/m);
  assert.match(readme, /Apache License 2\.0/);
  assert.doesNotMatch(readme, /cloudflare\/cloudflare-os\/discussions/);
  assert.doesNotMatch(contributing, /cloudflare\/cloudflare-os\/discussions/);
  assert.match(compliance, /THIRD_PARTY_NOTICES\.md/);
  assert.match(compliance, /release-blocking/i);
  assert.match(upstreamSync, /first business day of every month/i);
  assert.match(upstreamSync, /one business day/i);
  assert.match(releasePlan, /scripts\/release\/build-release\.mjs/);
  assert.match(releasePlan, /scripts\/release\/upload-release\.mjs/);
  assert.match(releasePlan, /scripts\/release\/promote-release\.mjs/);
  assert.match(releasePlan, /scripts\/release-legal-artifacts\.test\.js/);
});
