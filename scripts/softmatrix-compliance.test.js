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
  const [license, notice, readme, readmeZh, contributing, compliance, upstreamSync, releasePlan,
    envDts, deploymentEn, deploymentZh, operationsEn, operationsZh, upgradeEn, upgradeZh,
    vmDeploymentEn, vmDeploymentZh, vmOperationsEn, vmOperationsZh, vmService] =
    await Promise.all([
      readFile(new URL("../LICENSE", import.meta.url)),
      readFile(new URL("../NOTICE", import.meta.url), "utf8"),
      readFile(new URL("../README.md", import.meta.url), "utf8"),
      readFile(new URL("../README.zh-CN.md", import.meta.url), "utf8"),
      readFile(new URL("../CONTRIBUTING.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/compliance.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/upstream-sync.md", import.meta.url), "utf8"),
      readFile(
        new URL("../docs/superpowers/plans/2026-08-07-softmatrix-release-hardening.md", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../packages/workshop-backend/src/env.d.ts", import.meta.url), "utf8"),
      readFile(new URL("../docs/softmatrix/deployment.en.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/softmatrix/deployment.zh-CN.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/softmatrix/operations.en.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/softmatrix/operations.zh-CN.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/softmatrix/upgrade.en.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/softmatrix/upgrade.zh-CN.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/softmatrix/vm-deployment.en.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/softmatrix/vm-deployment.zh-CN.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/softmatrix/vm-operations.en.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/softmatrix/vm-operations.zh-CN.md", import.meta.url), "utf8"),
      readFile(new URL("../deploy/vm/softmatrix.service", import.meta.url), "utf8"),
    ]);

  assert.equal(createHash("sha256").update(license).digest("hex"), APACHE_2_LICENSE_SHA256);
  assert.equal(notice, EXPECTED_NOTICE);
  assert.match(readme, /^# Softmatrix OS/m);
  assert.match(readme, /Apache License 2\.0/);
  assert.match(readmeZh, /^# Softmatrix OS：AI 生产力环境/m);
  assert.match(readmeZh, /README\.md/);
  assert.match(readmeZh, /Apache License 2\.0/);
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

  const vmDocs = [vmDeploymentEn, vmDeploymentZh, vmOperationsEn, vmOperationsZh];
  const vmDocumentation = vmDocs.join("\n");
  for (const phrase of [
    "softmatrix-vm",
    "workerd",
    "PUBLIC_BASE_URL",
    "ORG_AI_MODELS",
    "ALLOW_USER_BYOK",
    "/var/lib/softmatrix/data",
    "/var/lib/softmatrix/objects",
    "backup-data.mjs",
    "restore-data.mjs",
    "healthcheck.mjs",
    "install-release.mjs",
    "rollback",
    "OIDC_CLIENT_SECRET",
    "journalctl",
    "Cloudflare",
  ]) {
    assert.ok(vmDocumentation.includes(phrase), `VM documentation is missing ${phrase}`);
  }
  for (const command of ["build:vm", "install:vm", "healthcheck:vm", "test:e2e:vm"]) {
    assert.ok(vmDocumentation.includes(command), `VM documentation is missing ${command}`);
  }
  assert.match(vmService, /ExecStartPre=.*tools\/vm-config\.mjs --check/);
  assert.match(vmService, /ExecStart=.*workerd/);

  function headingSignature(markdown) {
    return markdown.split("\n")
      .filter((line) => /^#{1,6} [^#]/.test(line))
      .map((line) => line.replace(/^(#+)\s+/, "$1 ").trim());
  }
  for (const [english, chinese] of [
    [deploymentEn, deploymentZh],
    [operationsEn, operationsZh],
    [upgradeEn, upgradeZh],
    [vmDeploymentEn, vmDeploymentZh],
    [vmOperationsEn, vmOperationsZh],
  ]) {
    assert.deepEqual(headingSignature(english), headingSignature(chinese));
  }
  const documentedVars = new Set(
    [deploymentEn, deploymentZh, operationsEn, operationsZh, upgradeEn, upgradeZh]
      .flatMap((doc) => [...doc.matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)].map((match) => match[1])),
  );
  for (const code of ["MODEL_CREDENTIAL_INVALID", "OIDC_DOMAIN_NOT_ALLOWED", "OIDC_PROVIDER_UNAVAILABLE"]) {
    documentedVars.delete(code);
  }
  for (const variable of documentedVars) {
    assert.match(envDts, new RegExp(`\\b${variable}\\b`),
      `${variable} is documented but missing from workshop-backend/src/env.d.ts`);
  }
});
