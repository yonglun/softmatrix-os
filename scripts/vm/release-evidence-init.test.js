import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createReleaseEvidenceDraft } from "./release-evidence-init.mjs";
import { validateReleaseEvidence } from "./release-evidence.mjs";

async function fixtureRelease() {
  const releaseDir = await mkdtemp(join(tmpdir(), "softmatrix-evidence-release-"));
  await mkdir(join(releaseDir, "legal"));
  await writeFile(join(releaseDir, "manifest.json"), JSON.stringify({
    releaseId: "softmatrix-vm-test",
    commit: "0123456789abcdef0123456789abcdef01234567",
  }));
  await writeFile(join(releaseDir, "checksums.sha256"), "abc  manifest.json\n");
  await writeFile(join(releaseDir, "legal-manifest.json"), JSON.stringify({ files: [] }));
  return releaseDir;
}

test("creates a valid NO-GO draft from an immutable release without inventing production evidence", async () => {
  const releaseDir = await fixtureRelease();
  const draft = await createReleaseEvidenceDraft({
    releaseDir,
    capturedAt: "2026-08-10T12:00:00Z",
    hostname: "fixture-vm",
    osRelease: "Ubuntu fixture",
    kernel: "6.8-fixture",
    nodeVersion: "v22.14.0",
    pnpmVersion: "11.17.0",
    systemdVersion: "255-fixture",
    proxyName: "PENDING",
    proxyVersion: "PENDING",
    origin: "https://pending.invalid",
    workerdVersion: "2026-08-01 (binary hash pending)",
  });

  assert.equal(draft.decision, "NO-GO");
  assert.equal(draft.release.id, "softmatrix-vm-test");
  assert.equal(draft.release.sourceCommit, "0123456789abcdef0123456789abcdef01234567");
  assert.match(draft.release.manifestSha256, /^[a-f0-9]{64}$/u);
  assert.match(draft.release.checksumsSha256, /^[a-f0-9]{64}$/u);
  assert.match(draft.release.legalManifestSha256, /^[a-f0-9]{64}$/u);
  assert.equal(Object.values(draft.checks).length, 13);
  assert.ok(Object.values(draft.checks).every(check => check.status === "FAIL"));
  assert.ok(Object.values(draft.checks).every(check => check.evidence.includes("PENDING")));
  assert.deepEqual(validateReleaseEvidence(draft), { decision: "NO-GO", checkCount: 13 });
  assert.equal(JSON.stringify(draft).includes("client-secret"), false);
});

test("rejects a release directory without its immutable manifest", async () => {
  const releaseDir = await mkdtemp(join(tmpdir(), "softmatrix-evidence-empty-"));
  await assert.rejects(
    () => createReleaseEvidenceDraft({ releaseDir }),
    /manifest\.json/,
  );
});
