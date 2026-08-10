import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("default Playwright E2E excludes the VM-only journey", async () => {
  const config = await readFile(new URL("../playwright.config.ts", import.meta.url), "utf8");
  assert.match(
    config,
    /testIgnore:\s*vmE2E\s*\?\s*\[\]\s*:\s*\["\*\*\/vm-self-hosting\.spec\.ts"\]/u,
  );
});
