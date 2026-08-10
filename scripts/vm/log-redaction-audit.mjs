#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const REDACTED = /^(?:redacted|omitted|<redacted>|<omitted>|\[redacted\]|\[omitted\]|\*{3,}|<none>|null|undefined)$/iu;
const KEY_VALUE = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|cookie|authorization|prompt|(?:provider|request|response)[ _-]?(?:body|payload))\b\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|((?:Bearer\s+)?[^\s,;}]+))/giu;
const BEARER = /\bBearer\s+([A-Za-z0-9._~+/=-]{8,})\b/giu;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;

function valueOf(match) {
  return match[2] ?? match[3] ?? match[4] ?? "";
}

function isRedacted(value) {
  return REDACTED.test(value.trim().replace(/^Bearer\s+/iu, ""));
}

function lineHasSensitivePattern(line) {
  KEY_VALUE.lastIndex = 0;
  for (const match of line.matchAll(KEY_VALUE)) {
    if (!isRedacted(valueOf(match))) return true;
  }
  BEARER.lastIndex = 0;
  for (const match of line.matchAll(BEARER)) {
    if (!isRedacted(match[1])) return true;
  }
  JWT.lastIndex = 0;
  return JWT.test(line);
}

/** Audit text without ever returning the matching log content. */
export function auditLogText(text) {
  const lines = [];
  String(text ?? "").split(/\r?\n/u).forEach((line, index) => {
    if (lineHasSensitivePattern(line)) lines.push(index + 1);
  });
  const findingCount = lines.length;
  return {
    ok: findingCount === 0,
    findingCount,
    lines,
    evidence: findingCount === 0
      ? "log audit: no unredacted credential, prompt, or provider-body patterns"
      : `log audit: ${findingCount} unredacted sensitive pattern line${findingCount === 1 ? "" : "s"}`,
  };
}

function parseArgs(argv) {
  const args = { file: undefined, unit: "softmatrix", since: undefined };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--file") args.file = argv[++index];
    else if (arg === "--unit") args.unit = argv[++index];
    else if (arg === "--since") args.since = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.file && !args.since) {
    throw new Error("Usage: node scripts/vm/log-redaction-audit.mjs (--file <path> | --since <journal-time>) [--unit <systemd-unit>]");
  }
  if (args.file && args.since) throw new Error("--file and --since are mutually exclusive");
  if (!args.unit || !/^[A-Za-z0-9_.@:-]+$/u.test(args.unit)) {
    throw new Error("--unit must be a safe systemd unit name");
  }
  return args;
}

async function readSource(args) {
  if (args.file) return readFile(args.file, "utf8");
  try {
    return execFileSync("journalctl", ["--unit", args.unit, "--since", args.since, "--no-pager", "--output=cat"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    throw new Error("VM_LOG_AUDIT_SOURCE: unable to read the requested journal window", { cause: error });
  }
}

if (process.argv[1]?.endsWith("log-redaction-audit.mjs")) {
  try {
    const result = auditLogText(await readSource(parseArgs(process.argv.slice(2))));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  }
}
