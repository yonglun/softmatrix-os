#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { hostname as systemHostname, release as systemKernel } from "node:os";
import { dirname, resolve } from "node:path";

import { sha256Hex } from "../release/hash-lib.mjs";
import { validateReleaseEvidence } from "./release-evidence.mjs";

const CHECK_NAMES = [
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
];

const PENDING = "PENDING operator execution";

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

async function sha256File(path) {
  return sha256Hex(await readFile(path));
}

async function readOsRelease() {
  try {
    const text = await readFile("/etc/os-release", "utf8");
    const match = /^PRETTY_NAME="?([^"\n]+)"?$/mu.exec(text);
    return match?.[1] ?? text.split("\n")[0] ?? "unknown host OS";
  } catch {
    return `${process.platform} (operator VM value pending)`;
  }
}

function parseArgs(argv) {
  const args = { releaseDir: undefined, outputPath: undefined, origin: "https://pending.invalid", workerdPath: undefined };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--release") args.releaseDir = resolve(argv[++index]);
    else if (arg === "--out") args.outputPath = resolve(argv[++index]);
    else if (arg === "--origin") args.origin = argv[++index];
    else if (arg === "--workerd") args.workerdPath = resolve(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.releaseDir || !args.outputPath) {
    throw new Error("Usage: node scripts/vm/release-evidence-init.mjs --release <dir> --out <report> [--origin <https-url>] [--workerd <path>]");
  }
  return args;
}

/** Create an explicitly NO-GO report seeded only with local release/host facts. */
export async function createReleaseEvidenceDraft({
  releaseDir,
  outputPath,
  capturedAt = new Date().toISOString(),
  hostname = systemHostname(),
  osRelease,
  kernel = systemKernel(),
  nodeVersion = process.version,
  pnpmVersion = commandOutput("pnpm", ["--version"]) || PENDING,
  systemdVersion = commandOutput("systemctl", ["--version"]).split("\n")[0] || PENDING,
  proxyName = PENDING,
  proxyVersion = PENDING,
  origin = "https://pending.invalid",
  workerdVersion = commandOutput("workerd", ["--version"]) || PENDING,
  workerdPath,
} = {}) {
  if (!releaseDir) throw new Error("releaseDir is required");
  const resolvedOsRelease = osRelease ?? await readOsRelease();
  const root = resolve(releaseDir);
  const manifestPath = `${root}/manifest.json`;
  const checksumsPath = `${root}/checksums.sha256`;
  const legalManifestPath = `${root}/legal-manifest.json`;
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`release manifest.json is required: ${error.message}`, { cause: error });
  }
  for (const path of [checksumsPath, legalManifestPath]) {
    try {
      await readFile(path);
    } catch (error) {
      throw new Error(`release evidence input is required: ${path}: ${error.message}`, { cause: error });
    }
  }

  let resolvedWorkerdVersion = workerdVersion;
  if (workerdPath) {
    const version = commandOutput(workerdPath, ["--version"]);
    if (version) {
      const binarySha = await sha256File(workerdPath);
      resolvedWorkerdVersion = `${version} (binary SHA-256: ${binarySha})`;
    }
  }

  const report = {
    schemaVersion: 1,
    draft: true,
    decision: "NO-GO",
    capturedAt,
    release: {
      id: manifest.releaseId,
      sourceCommit: manifest.commit,
      manifestSha256: await sha256File(manifestPath),
      checksumsSha256: await sha256File(checksumsPath),
      legalManifestSha256: await sha256File(legalManifestPath),
      workerdVersion: resolvedWorkerdVersion,
    },
    vm: {
      hostname,
      os: resolvedOsRelease,
      kernel,
      nodeVersion,
      pnpmVersion,
      systemdVersion,
      proxy: {
        name: proxyName,
        version: proxyVersion,
        origin,
        tlsEvidence: PENDING,
        websocketEvidence: PENDING,
      },
    },
    checks: Object.fromEntries(CHECK_NAMES.map(name => [name, {
      status: "FAIL",
      evidence: `${PENDING}: ${name}`,
    }])),
    recovery: {
      backupArchive: PENDING,
      backupSha256: "PENDING",
      restoreTarget: PENDING,
      rollbackReleaseId: "PENDING",
      recoveryTimeSeconds: 0,
    },
    signoff: Object.fromEntries([
      ["releaseOwner", "Release owner"],
      ["vmOperator", "VM operator"],
      ["securityReviewer", "Security reviewer"],
    ].map(([key, label]) => [key, {
      name: PENDING,
      decision: "HOLD",
      capturedAt,
      ticket: PENDING,
      role: label,
    }])),
  };

  validateReleaseEvidence(report);
  if (outputPath) {
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (process.argv[1]?.endsWith("release-evidence-init.mjs")) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = await createReleaseEvidenceDraft(args);
    console.log(JSON.stringify({ ok: true, decision: report.decision, output: args.outputPath }, null, 2));
  } catch (error) {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  }
}
