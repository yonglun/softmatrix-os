#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hostname as systemHostname, release as systemKernel } from "node:os";
import { dirname, resolve } from "node:path";

import { sha256Hex } from "../release/hash-lib.mjs";
import { auditLogText, readLogSource } from "./log-redaction-audit.mjs";
import { probePublicEndpoints } from "./operator-probe.mjs";
import { validateReleaseEvidence } from "./release-evidence.mjs";

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

async function readOsRelease() {
  try {
    const text = await readFile("/etc/os-release", "utf8");
    return /^PRETTY_NAME="?([^"\n]+)"?$/mu.exec(text)?.[1] ?? text.split("\n")[0] ?? "unknown host OS";
  } catch {
    return `${process.platform} (operator VM value pending)`;
  }
}

function checkResult(check, fallbackName) {
  if (!check) return undefined;
  const status = check.ok === true ? "PASS" : "FAIL";
  const suffix = Number.isInteger(check.status) ? ` (HTTP ${check.status})` : "";
  return { status, evidence: `operator-probe: ${fallbackName}${suffix}` };
}

/**
 * Interpret only `ss -ltnp` lines that identify workerd. Unknown output is a
 * failure, so a missing permission or missing process cannot become a false PASS.
 */
export function assessLoopbackListeners(listenerText) {
  const listeners = String(listenerText ?? "")
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => /\bLISTEN\b/iu.test(line) && /\bworkerd\b/iu.test(line));
  if (listeners.length === 0) return { ok: false, evidence: "ss: no workerd listener evidence" };

  for (const line of listeners) {
    const localAddress = line.split(/\s+/u)[3] ?? "";
    const loopback = /^(?:127(?:\.\d{1,3}){3}|\[::1\]|::1):/u.test(localAddress);
    if (!loopback) return { ok: false, evidence: "ss: workerd listener is publicly bound" };
  }
  return { ok: true, evidence: "ss: workerd listeners are loopback-only" };
}

function copyString(target, key, source) {
  if (typeof source === "string" && source.trim() !== "") target[key] = source.trim();
}

function updateAutomatedCheck(report, name, result) {
  if (!result) return;
  report.checks[name] = result;
}

function logAuditCheck(logAudit) {
  if (!logAudit) return undefined;
  const lines = Array.isArray(logAudit.lines)
    ? logAudit.lines.filter(line => Number.isInteger(line) && line > 0).join(",")
    : "";
  return {
    status: logAudit.ok === true ? "PASS" : "FAIL",
    evidence: `${logAudit.evidence || "log audit: source unavailable or unredacted patterns found"}${lines ? `; lines: ${lines}` : ""}`,
  };
}

/**
 * Merge facts that are directly observable on the VM into an existing draft.
 * This function intentionally accepts only a draft NO-GO report and never
 * changes the decision or any manual acceptance/sign-off fields.
 */
export function collectVmEvidence({ report, capturedAt = new Date().toISOString(), probe, secure = true, loopback, logAudit, vmFacts = {} } = {}) {
  if (!report || report.draft !== true || report.decision !== "NO-GO") {
    throw new Error("VM_EVIDENCE_DRAFT_REQUIRED: collector only accepts a draft NO-GO report");
  }
  const result = JSON.parse(JSON.stringify(report));
  result.capturedAt = capturedAt;

  const http = probe?.checks?.find(check => check.name === "http");
  const websocket = probe?.checks?.find(check => check.name === "websocket");
  // A loopback HTTP fixture is useful for exercising the collector itself, but
  // it must never be recorded as production HTTPS/WSS evidence.
  if (secure) {
    updateAutomatedCheck(result, "publicHttps", checkResult(http, "HTTPS origin"));
    updateAutomatedCheck(result, "websocketUpgrade", checkResult(websocket, "WebSocket upgrade"));
  }
  if (loopback) {
    updateAutomatedCheck(result, "loopbackOnly", {
      status: loopback.ok === true ? "PASS" : "FAIL",
      evidence: loopback.ok === true
        ? "ss: workerd listeners are loopback-only"
        : "ss: workerd listener is publicly bound or unverified",
    });
  }
  updateAutomatedCheck(result, "logsRedacted", logAuditCheck(logAudit));

  copyString(result.vm, "hostname", vmFacts.hostname);
  copyString(result.vm, "os", vmFacts.os);
  copyString(result.vm, "kernel", vmFacts.kernel);
  copyString(result.vm, "nodeVersion", vmFacts.nodeVersion);
  copyString(result.vm, "pnpmVersion", vmFacts.pnpmVersion);
  copyString(result.vm, "systemdVersion", vmFacts.systemdVersion);
  copyString(result.vm.proxy, "name", vmFacts.proxyName);
  copyString(result.vm.proxy, "version", vmFacts.proxyVersion);
  copyString(result.vm.proxy, "origin", vmFacts.origin);
  copyString(result.release, "workerdVersion", vmFacts.workerdVersion);

  if (secure && http?.ok === true) result.vm.proxy.tlsEvidence = "operator-probe: HTTPS origin returned a successful response";
  if (secure && websocket?.ok === true) result.vm.proxy.websocketEvidence = "operator-probe: /api returned HTTP 101";

  // The collector must never turn operator work into a release decision.
  result.draft = true;
  result.decision = "NO-GO";
  validateReleaseEvidence(result);
  return result;
}

async function fileSha256(path) {
  return sha256Hex(await readFile(path));
}

function version(command, args) {
  return commandOutput(command, args) || "PENDING";
}

async function workerdFact(workerdPath) {
  if (!workerdPath) return undefined;
  const output = commandOutput(workerdPath, ["--version"]);
  if (!output) return undefined;
  return `${output} (binary SHA-256: ${await fileSha256(workerdPath)})`;
}

function parseArgs(argv) {
  const args = {
    report: undefined,
    out: undefined,
    baseUrl: undefined,
    allowHttpLoopback: false,
    workerd: undefined,
    proxyName: undefined,
    proxyVersion: undefined,
    origin: undefined,
    logFile: undefined,
    logSince: undefined,
    logUnit: "softmatrix",
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--report") args.report = resolve(argv[++index]);
    else if (arg === "--out") args.out = resolve(argv[++index]);
    else if (arg === "--base-url") args.baseUrl = argv[++index];
    else if (arg === "--allow-http-loopback") args.allowHttpLoopback = true;
    else if (arg === "--workerd") args.workerd = resolve(argv[++index]);
    else if (arg === "--proxy-name") args.proxyName = argv[++index];
    else if (arg === "--proxy-version") args.proxyVersion = argv[++index];
    else if (arg === "--origin") args.origin = argv[++index];
    else if (arg === "--log-file") args.logFile = resolve(argv[++index]);
    else if (arg === "--log-since") args.logSince = argv[++index];
    else if (arg === "--log-unit") args.logUnit = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.report || !args.out || !args.baseUrl) {
    throw new Error("Usage: node scripts/vm/release-evidence-collect.mjs --report <draft> --out <report> --base-url <url> [--allow-http-loopback] [--workerd <path>] [--proxy-name <name>] [--proxy-version <version>] [--log-file <path> | --log-since <journal-time> --log-unit <unit>]");
  }
  if (args.allowHttpLoopback) {
    const parsed = new URL(args.baseUrl);
    if (parsed.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
      throw new Error("--allow-http-loopback is restricted to http loopback URLs");
    }
  }
  if (args.logFile && args.logSince) throw new Error("--log-file and --log-since are mutually exclusive");
  if (args.logUnit && !/^[A-Za-z0-9_.@:-]+$/u.test(args.logUnit)) {
    throw new Error("--log-unit must be a safe systemd unit name");
  }
  return args;
}

async function collectLogAudit(args) {
  if (!args.logFile && !args.logSince) return undefined;
  try {
    return auditLogText(await readLogSource({
      file: args.logFile,
      since: args.logSince,
      unit: args.logUnit,
    }));
  } catch {
    return {
      ok: false,
      findingCount: 0,
      lines: [],
      evidence: "log audit: unable to read the requested source",
    };
  }
}

async function collectFromCli(args) {
  const report = JSON.parse(await readFile(args.report, "utf8"));
  const probe = await probePublicEndpoints({
    baseUrl: args.baseUrl,
    requireHttps: !args.allowHttpLoopback,
  });
  const loopback = assessLoopbackListeners(commandOutput("ss", ["-ltnp"]));
  const workerdVersion = await workerdFact(args.workerd);
  const logAudit = await collectLogAudit(args);
  const result = collectVmEvidence({
    report,
    probe,
    secure: !args.allowHttpLoopback,
    loopback,
    logAudit,
    vmFacts: {
      hostname: systemHostname(),
      os: await readOsRelease(),
      kernel: systemKernel(),
      nodeVersion: process.version,
      pnpmVersion: version("pnpm", ["--version"]),
      systemdVersion: version("systemctl", ["--version"]).split("\n")[0],
      proxyName: args.proxyName,
      proxyVersion: args.proxyVersion,
      origin: args.origin ?? (args.allowHttpLoopback ? report.vm.proxy.origin : args.baseUrl),
      workerdVersion,
    },
  });
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1]?.endsWith("release-evidence-collect.mjs")) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = await collectFromCli(args);
    console.log(JSON.stringify({ ok: true, decision: report.decision, output: args.out }, null, 2));
  } catch (error) {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  }
}
