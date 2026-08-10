#!/usr/bin/env node

import { readFileSync } from "node:fs";

const CHECK_NAMES = [
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
];
export const RELEASE_EVIDENCE_SCHEMA_VERSION = 2;

const HEX_SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{7,64}$/u;
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const SENSITIVE_KEY = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|cookie|authorization|secret|token)$/iu;

export class ReleaseEvidenceError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ReleaseEvidenceError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReleaseEvidenceError(code, message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value, path) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("<fill")) {
    fail("VM_EVIDENCE_INCOMPLETE", `${path} must be a non-empty recorded value`);
  }
  return value.trim();
}

function timestamp(value, path) {
  const text = requiredString(value, path);
  if (!Number.isFinite(Date.parse(text))) fail("VM_EVIDENCE_INVALID", `${path} must be an ISO timestamp`);
  return text;
}

function hash(value, path, { allowPending = false } = {}) {
  const text = requiredString(value, path).toLowerCase();
  if (allowPending && text === "pending") return text;
  if (!HEX_SHA256.test(text)) fail("VM_EVIDENCE_INVALID", `${path} must be a SHA-256 hex digest`);
  return text;
}

function checkSecretKeys(value, path = "report") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkSecretKeys(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) fail("VM_EVIDENCE_SECRET", `${path}.${key} must not be recorded`);
    checkSecretKeys(child, `${path}.${key}`);
  }
}

function checkObject(value, path) {
  if (!isRecord(value)) fail("VM_EVIDENCE_INCOMPLETE", `${path} must be an object`);
  return value;
}

function checkStatus(value, path) {
  const check = checkObject(value, path);
  if (check.status !== "PASS" && check.status !== "FAIL") {
    fail("VM_EVIDENCE_INCOMPLETE", `${path}.status must be PASS or FAIL`);
  }
  requiredString(check.evidence, `${path}.evidence`);
  return check;
}

function checkSignoff(value, path) {
  const signoff = checkObject(value, path);
  requiredString(signoff.name, `${path}.name`);
  if (!["APPROVE", "HOLD", "REJECT"].includes(signoff.decision)) {
    fail("VM_EVIDENCE_INCOMPLETE", `${path}.decision must be APPROVE, HOLD, or REJECT`);
  }
  timestamp(signoff.capturedAt, `${path}.capturedAt`);
  requiredString(signoff.ticket, `${path}.ticket`);
  return signoff;
}

export function validateReleaseEvidence(report) {
  checkObject(report, "report");
  checkSecretKeys(report);
  if (report.schemaVersion !== RELEASE_EVIDENCE_SCHEMA_VERSION) {
    fail("VM_EVIDENCE_INVALID", `schemaVersion must be ${RELEASE_EVIDENCE_SCHEMA_VERSION}`);
  }
  if (report.decision !== "GO" && report.decision !== "NO-GO") {
    fail("VM_EVIDENCE_INVALID", "decision must be GO or NO-GO");
  }
  if (report.draft === true && report.decision !== "NO-GO") {
    fail("VM_EVIDENCE_INVALID", "draft evidence must use the NO-GO decision");
  }
  timestamp(report.capturedAt, "capturedAt");

  const release = checkObject(report.release, "release");
  const releaseId = requiredString(release.id, "release.id");
  if (!RELEASE_ID.test(releaseId)) fail("VM_EVIDENCE_INVALID", "release.id is not safe");
  const sourceCommit = requiredString(release.sourceCommit, "release.sourceCommit").toLowerCase();
  if (!COMMIT.test(sourceCommit)) fail("VM_EVIDENCE_INVALID", "release.sourceCommit must be a Git SHA");
  hash(release.manifestSha256, "release.manifestSha256");
  hash(release.checksumsSha256, "release.checksumsSha256");
  hash(release.legalManifestSha256, "release.legalManifestSha256");
  requiredString(release.workerdVersion, "release.workerdVersion");

  const vm = checkObject(report.vm, "vm");
  requiredString(vm.hostname, "vm.hostname");
  requiredString(vm.os, "vm.os");
  requiredString(vm.kernel, "vm.kernel");
  requiredString(vm.nodeVersion, "vm.nodeVersion");
  requiredString(vm.pnpmVersion, "vm.pnpmVersion");
  requiredString(vm.systemdVersion, "vm.systemdVersion");
  const proxy = checkObject(vm.proxy, "vm.proxy");
  requiredString(proxy.name, "vm.proxy.name");
  requiredString(proxy.version, "vm.proxy.version");
  const origin = requiredString(proxy.origin, "vm.proxy.origin");
  try {
    if (new URL(origin).protocol !== "https:") throw new Error("not HTTPS");
  } catch {
    fail("VM_EVIDENCE_INVALID", "vm.proxy.origin must be an HTTPS URL");
  }
  requiredString(proxy.tlsEvidence, "vm.proxy.tlsEvidence");
  requiredString(proxy.websocketEvidence, "vm.proxy.websocketEvidence");

  const checks = checkObject(report.checks, "checks");
  for (const name of CHECK_NAMES) checkStatus(checks[name], `checks.${name}`);
  if (report.decision === "GO" && CHECK_NAMES.some(name => checks[name].status !== "PASS")) {
    fail("VM_EVIDENCE_NOT_GO", "GO requires every production check to be PASS");
  }

  const recovery = checkObject(report.recovery, "recovery");
  requiredString(recovery.backupArchive, "recovery.backupArchive");
  hash(recovery.backupSha256, "recovery.backupSha256", {
    allowPending: report.draft === true && report.decision === "NO-GO",
  });
  requiredString(recovery.restoreTarget, "recovery.restoreTarget");
  const rollbackId = requiredString(recovery.rollbackReleaseId, "recovery.rollbackReleaseId");
  if (!RELEASE_ID.test(rollbackId)) fail("VM_EVIDENCE_INVALID", "recovery.rollbackReleaseId is not safe");
  if (!Number.isFinite(recovery.recoveryTimeSeconds) || recovery.recoveryTimeSeconds < 0) {
    fail("VM_EVIDENCE_INVALID", "recovery.recoveryTimeSeconds must be a non-negative number");
  }

  const signoff = checkObject(report.signoff, "signoff");
  const signoffs = [
    checkSignoff(signoff.releaseOwner, "signoff.releaseOwner"),
    checkSignoff(signoff.vmOperator, "signoff.vmOperator"),
    checkSignoff(signoff.securityReviewer, "signoff.securityReviewer"),
  ];
  if (report.decision === "GO" && signoffs.some(item => item.decision !== "APPROVE")) {
    fail("VM_EVIDENCE_NOT_GO", "GO requires all three sign-offs to be APPROVE");
  }

  return { decision: report.decision, checkCount: CHECK_NAMES.length };
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--report") {
    throw new Error("Usage: node scripts/vm/release-evidence.mjs --report <path>");
  }
  return argv[1];
}

if (process.argv[1]?.endsWith("release-evidence.mjs")) {
  try {
    const path = parseArgs(process.argv.slice(2));
    const report = JSON.parse(readFileSync(path, "utf8"));
    console.log(JSON.stringify({ ok: true, ...validateReleaseEvidence(report) }, null, 2));
  } catch (error) {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  }
}
