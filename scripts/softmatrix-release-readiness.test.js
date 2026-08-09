import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("root exposes the Softmatrix release gate", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(
    pkg.scripts["verify:softmatrix"],
    "pnpm lint && pnpm test && pnpm build && pnpm licenses list --json",
  );
});
