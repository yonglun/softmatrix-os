import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const ARTIFACT_ROOTS = ["packages/workshop-frontend/dist", "release-out"];
const FORBIDDEN_FIXTURE_SECRETS = [
  "oidc-client-secret-fixture",
  "org-model-secret-fixture",
  "byok-secret-fixture",
  "fixture-oidc-secret",
  "fixture-model-secret",
];

async function listFiles(roots) {
  const files = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  for (const root of roots) await walk(root);
  return files;
}

test("built frontend and release artifacts contain no fixture secrets", async () => {
  const files = await listFiles(ARTIFACT_ROOTS);
  for (const file of files) {
    const text = await readFile(file, "utf8").catch(() => "");
    for (const secret of FORBIDDEN_FIXTURE_SECRETS) {
      assert.equal(text.includes(secret), false, `${secret} found in ${file}`);
    }
  }
});

