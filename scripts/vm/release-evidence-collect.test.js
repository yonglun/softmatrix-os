import assert from "node:assert/strict";
import test from "node:test";

import { auditLogText } from "./log-redaction-audit.mjs";
import { assessLoopbackListeners, collectVmEvidence } from "./release-evidence-collect.mjs";

const draft = () => ({
  schemaVersion: 2,
  draft: true,
  decision: "NO-GO",
  capturedAt: "2026-08-10T15:00:00Z",
  release: {
    id: "softmatrix-vm-test",
    sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    manifestSha256: "a".repeat(64),
    checksumsSha256: "b".repeat(64),
    legalManifestSha256: "c".repeat(64),
    workerdVersion: "workerd fixture",
  },
  vm: {
    hostname: "fixture-vm",
    os: "Ubuntu fixture",
    kernel: "6.8-fixture",
    nodeVersion: "v22.14.0",
    pnpmVersion: "11.17.0",
    systemdVersion: "systemd 255",
    proxy: {
      name: "Caddy",
      version: "2.9.1",
      origin: "https://softmatrix.example",
      tlsEvidence: "PENDING",
      websocketEvidence: "PENDING",
    },
  },
  checks: Object.fromEntries([
    "oidcProductionSuccess",
    "oidcProductionCancellation",
    "oidcProductionDomainDenial",
    "modelGovernance",
    "attachmentBlueprintStorage",
    "licenseInventory",
    "logsRedacted",
    "publicHttps",
    "websocketUpgrade",
    "loopbackOnly",
    "rebootPersistence",
    "isolatedRestore",
    "rollbackWorkspace",
  ].map(name => [name, { status: "FAIL", evidence: `PENDING operator execution: ${name}` }])),
  recovery: {
    backupArchive: "PENDING",
    backupSha256: "PENDING",
    restoreTarget: "PENDING",
    rollbackReleaseId: "PENDING",
    recoveryTimeSeconds: 0,
  },
  signoff: Object.fromEntries([
    ["releaseOwner", "Release owner"],
    ["vmOperator", "VM operator"],
    ["securityReviewer", "Security reviewer"],
  ].map(([key, label]) => [key, {
    name: "PENDING",
    decision: "HOLD",
    capturedAt: "2026-08-10T15:00:00Z",
    ticket: "PENDING",
    role: label,
  }])),
});

test("accepts a listener set only when every workerd listener is loopback-only", () => {
  const safe = assessLoopbackListeners([
    "LISTEN 0 4096 127.0.0.1:8787 0.0.0.0:* users:((\"workerd\",pid=42,fd=8))",
    "LISTEN 0 4096 [::1]:8787 [::]:* users:((\"workerd\",pid=42,fd=9))",
  ].join("\n"));
  assert.deepEqual(safe, { ok: true, evidence: "ss: workerd listeners are loopback-only" });

  const exposed = assessLoopbackListeners(
    "LISTEN 0 4096 0.0.0.0:8787 0.0.0.0:* users:((\"workerd\",pid=42,fd=8))",
  );
  assert.deepEqual(exposed, { ok: false, evidence: "ss: workerd listener is publicly bound" });

  const exposedIpv6 = assessLoopbackListeners(
    "LISTEN 0 4096 [::]:8787 [::]:* users:((\"workerd\",pid=42,fd=8))",
  );
  assert.deepEqual(exposedIpv6, { ok: false, evidence: "ss: workerd listener is publicly bound" });
});

test("rejects missing or unrecognizable listener evidence", () => {
  assert.deepEqual(assessLoopbackListeners(""), { ok: false, evidence: "ss: no workerd listener evidence" });
  assert.deepEqual(
    assessLoopbackListeners("LISTEN 0 4096 127.0.0.1:8787 0.0.0.0:* users:((\"node\",pid=42,fd=8))"),
    { ok: false, evidence: "ss: no workerd listener evidence" },
  );
});

test("merges only passing automated evidence and keeps the report NO-GO", () => {
  const result = collectVmEvidence({
    report: draft(),
    capturedAt: "2026-08-10T15:01:00Z",
    probe: {
      checks: [
        { name: "http", ok: true, status: 200 },
        { name: "websocket", ok: true, status: 101 },
      ],
    },
    loopback: { ok: true, evidence: "ss: workerd listeners are loopback-only" },
    vmFacts: {
      hostname: "prod-vm-1",
      os: "Ubuntu 24.04 LTS",
      kernel: "6.8.0-prod",
      nodeVersion: "v22.14.0",
      pnpmVersion: "11.17.0",
      systemdVersion: "systemd 255",
      proxyName: "Caddy",
      proxyVersion: "2.9.1",
      origin: "https://softmatrix.example",
      workerdVersion: "workerd 2026-08-01 (binary SHA-256: dddddddd)",
    },
  });

  assert.equal(result.decision, "NO-GO");
  assert.equal(result.draft, true);
  assert.equal(result.checks.publicHttps.status, "PASS");
  assert.equal(result.checks.websocketUpgrade.status, "PASS");
  assert.equal(result.checks.loopbackOnly.status, "PASS");
  assert.equal(result.checks.modelGovernance.status, "FAIL");
  assert.equal(result.vm.hostname, "prod-vm-1");
  assert.equal(result.release.workerdVersion, "workerd 2026-08-01 (binary SHA-256: dddddddd)");
  assert.equal(JSON.stringify(result).includes("fixture-model-secret"), false);
});

test("does not downgrade or rewrite an already signed report", () => {
  const report = draft();
  report.draft = false;
  report.decision = "GO";
  assert.throws(
    () => collectVmEvidence({
      report,
      probe: { checks: [] },
      loopback: { ok: true, evidence: "ss: workerd listeners are loopback-only" },
    }),
    /VM_EVIDENCE_DRAFT_REQUIRED/,
  );
});

test("does not treat an HTTP loopback fixture as production HTTPS/WSS evidence", () => {
  const result = collectVmEvidence({
    report: draft(),
    secure: false,
    probe: {
      checks: [
        { name: "http", ok: true, status: 200 },
        { name: "websocket", ok: true, status: 101 },
      ],
    },
    loopback: { ok: true, evidence: "ss: workerd listeners are loopback-only" },
  });
  assert.equal(result.checks.publicHttps.status, "FAIL");
  assert.equal(result.checks.websocketUpgrade.status, "FAIL");
  assert.equal(result.checks.loopbackOnly.status, "PASS");
  assert.equal(result.vm.proxy.tlsEvidence, "PENDING");
  assert.equal(result.vm.proxy.websocketEvidence, "PENDING");
});

test("records a passing log audit without copying log content into the report", () => {
  const result = collectVmEvidence({
    report: draft(),
    logAudit: auditLogText("authorization: [redacted]\nprompt: <omitted>"),
  });

  assert.deepEqual(result.checks.logsRedacted, {
    status: "PASS",
    evidence: "log audit: no unredacted credential, prompt, or provider-body patterns",
  });
});

test("records an audit failure without copying an unredacted secret into the report", () => {
  const secret = "collector-secret-never-return-this";
  const result = collectVmEvidence({
    report: draft(),
    logAudit: auditLogText(`authorization: Bearer ${secret}`),
  });

  assert.equal(result.checks.logsRedacted.status, "FAIL");
  assert.match(result.checks.logsRedacted.evidence, /unredacted sensitive pattern line; lines: 1/u);
  assert.equal(JSON.stringify(result).includes(secret), false);
});
