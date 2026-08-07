import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ALLOWED = new Set([
  "NOTICE",
  "README.md",
  "docs/upstream-sync.md",
  "scripts/softmatrix-branding.test.js",
  // This test verifies that NOTICE retains the upstream project name.
  "scripts/softmatrix-compliance.test.js",
]);

test("Cloudflare OS appears only in factual attribution", () => {
  const output = execFileSync(
    "rg",
    ["-l", "Cloudflare OS", ".", "--glob", "!.git/**", "--glob", "!.superpowers/**"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const unexpected = output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((file) => file.replace(/^\.\//, ""))
    .filter((file) => !ALLOWED.has(file) && !file.startsWith("docs/superpowers/"));

  assert.deepEqual(unexpected, []);
});
