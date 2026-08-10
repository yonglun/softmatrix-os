import assert from "node:assert/strict";
import test from "node:test";
import { ReleaseEvidenceError, validateReleaseEvidence } from "./release-evidence.mjs";

function validEvidence() {
  return {
    schemaVersion: 1,
    decision: "GO",
    capturedAt: "2026-08-10T12:00:00Z",
    release: {
      id: "softmatrix-v1.0.0",
      sourceCommit: "0123456789abcdef0123456789abcdef01234567",
      manifestSha256: "a".repeat(64),
      checksumsSha256: "b".repeat(64),
      legalManifestSha256: "c".repeat(64),
      workerdVersion: "2026.08.01",
    },
    vm: {
      hostname: "softmatrix-prod-1",
      os: "Ubuntu 24.04.2 LTS",
      kernel: "6.8.0-40-generic",
      nodeVersion: "v22.14.0",
      pnpmVersion: "11.17.0",
      systemdVersion: "255.4",
      proxy: {
        name: "Caddy",
        version: "2.10.0",
        origin: "https://softmatrix.example",
        tlsEvidence: "cert fingerprint recorded in release ticket REL-1",
        websocketEvidence: "wss handshake returned 101 in release ticket REL-1",
      },
    },
    checks: Object.fromEntries([
      "oidcProductionSuccess",
      "oidcProductionCancellation",
      "oidcProductionDomainDenial",
      "modelGovernance",
      "attachmentBlueprintStorage",
      "logsRedacted",
      "publicHttps",
      "websocketUpgrade",
      "loopbackOnly",
      "rebootPersistence",
      "isolatedRestore",
      "rollbackWorkspace",
    ].map(name => [name, { status: "PASS", evidence: `release ticket REL-1: ${name}` }])),
    recovery: {
      backupArchive: "/backups/softmatrix-v1.0.0-20260810.tar.gz",
      backupSha256: "d".repeat(64),
      restoreTarget: "/var/lib/softmatrix-restore-20260810",
      rollbackReleaseId: "softmatrix-v0.9.0",
      recoveryTimeSeconds: 143,
    },
    signoff: {
      releaseOwner: { name: "Release Owner", decision: "APPROVE", capturedAt: "2026-08-10T12:10:00Z", ticket: "REL-1" },
      vmOperator: { name: "VM Operator", decision: "APPROVE", capturedAt: "2026-08-10T12:11:00Z", ticket: "REL-1" },
      securityReviewer: { name: "Security Reviewer", decision: "APPROVE", capturedAt: "2026-08-10T12:12:00Z", ticket: "REL-1" },
    },
  };
}

test("accepts a complete GO evidence record without secret fields", () => {
  assert.deepEqual(validateReleaseEvidence(validEvidence()), { decision: "GO", checkCount: 12 });
});

test("rejects GO when a production check is missing or pending", () => {
  const evidence = validEvidence();
  delete evidence.checks.websocketUpgrade;
  assert.throws(
    () => validateReleaseEvidence(evidence),
    error => error instanceof ReleaseEvidenceError && error.code === "VM_EVIDENCE_INCOMPLETE",
  );

  const pending = validEvidence();
  pending.checks.logsRedacted = { status: "PENDING", evidence: "not run" };
  assert.throws(
    () => validateReleaseEvidence(pending),
    error => error instanceof ReleaseEvidenceError && error.code === "VM_EVIDENCE_INCOMPLETE",
  );
});

test("rejects malformed hashes, timestamps, and secret-shaped fields", () => {
  const malformed = validEvidence();
  malformed.release.manifestSha256 = "not-a-hash";
  assert.throws(
    () => validateReleaseEvidence(malformed),
    error => error instanceof ReleaseEvidenceError && error.code === "VM_EVIDENCE_INVALID",
  );

  const secret = validEvidence();
  secret.vm.clientSecret = "must-not-be-recorded";
  assert.throws(
    () => validateReleaseEvidence(secret),
    error => error instanceof ReleaseEvidenceError && error.code === "VM_EVIDENCE_SECRET",
  );
});

test("allows a fully evidenced NO-GO record for auditability", () => {
  const evidence = validEvidence();
  evidence.decision = "NO-GO";
  evidence.checks.modelGovernance = { status: "FAIL", evidence: "provider policy rejected model REL-2" };
  for (const signoff of Object.values(evidence.signoff)) signoff.decision = "HOLD";
  assert.deepEqual(validateReleaseEvidence(evidence), { decision: "NO-GO", checkCount: 12 });
});
