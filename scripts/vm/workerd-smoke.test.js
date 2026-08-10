import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runWorkerdSmoke } from "./workerd-smoke.mjs";

const fixtureConfig = join(import.meta.dirname, "../../deploy/vm/fixtures/minimal-workerd.capnp");

test("standalone workerd keeps native durable state across restart", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "softmatrix-workerd-smoke-"));
  try {
    const result = await runWorkerdSmoke({
      configPath: fixtureConfig,
      dataDir,
      port: 8788,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body, "counter=2");
    assert.equal(result.persisted, true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
