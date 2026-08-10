import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditLogText } from "./log-redaction-audit.mjs";

test("accepts ordinary logs and explicitly redacted sensitive fields", () => {
  const result = auditLogText([
    "service started release=softmatrix-vm-v1",
    "authorization: [REDACTED]",
    "authorization: Bearer <redacted>",
    'prompt: "<redacted>" provider_body=<omitted>',
    "request completed status=200 duration_ms=21",
  ].join("\n"));

  assert.deepEqual(result, {
    ok: true,
    findingCount: 0,
    lines: [],
    evidence: "log audit: no unredacted credential, prompt, or provider-body patterns",
  });
});

test("detects credentials without returning their values", () => {
  const secret = "sk-live-never-return-this";
  const result = auditLogText([
    `authorization: Bearer ${secret}`,
    "access_token: abcdefghijklmnop",
    "cookie: session=private-cookie",
  ].join("\n"));

  assert.equal(result.ok, false);
  assert.equal(result.findingCount, 3);
  assert.deepEqual(result.lines, [1, 2, 3]);
  assert.match(result.evidence, /3 unredacted sensitive pattern/iu);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes("private-cookie"), false);
});

test("detects prompts, provider bodies, JWTs, and unredacted values while ignoring placeholders", () => {
  const result = auditLogText([
    'prompt: "build a private report"',
    'provider_body: {"messages":[{"role":"user"}]}',
    "response_payload: eyJhbGciOiJIUzI1NiJ9.payload.signature",
    "client_secret=***",
  ].join("\n"));

  assert.equal(result.ok, false);
  assert.equal(result.findingCount, 3);
  assert.deepEqual(result.lines, [1, 2, 3]);
  assert.equal(JSON.stringify(result).includes("build a private report"), false);
});

test("CLI reports only safe metadata when a file contains a secret", async () => {
  const secret = "fixture-secret-never-print";
  const dir = await mkdtemp(join(tmpdir(), "softmatrix-log-audit-"));
  const file = join(dir, "journal.log");
  await writeFile(file, `authorization: Bearer ${secret}\n`, "utf8");
  const script = new URL("./log-redaction-audit.mjs", import.meta.url);

  assert.throws(
    () => execFileSync(process.execPath, [script.pathname, "--file", file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
    error => {
      assert.equal(error.status, 1);
      assert.equal(`${error.stdout}\n${error.stderr}`.includes(secret), false);
      assert.match(error.stdout, /findingCount/u);
      return true;
    },
  );
});
