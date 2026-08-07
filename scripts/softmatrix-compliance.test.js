import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Softmatrix distribution retains Apache-2.0 and upstream attribution", async () => {
  const [license, notice, readme] = await Promise.all([
    readFile(new URL("../LICENSE", import.meta.url), "utf8"),
    readFile(new URL("../NOTICE", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(notice, /derived from Cloudflare OS/i);
  assert.match(notice, /https:\/\/github\.com\/cloudflare\/cloudflare-os/);
  assert.match(readme, /^# Softmatrix OS/m);
  assert.match(readme, /Apache License 2\.0/);
});
