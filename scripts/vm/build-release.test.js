import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildVmRelease } from "./build-release.mjs";

test("VM release records commit, worker hashes, legal files, and runtime config", async () => {
  const root = await mkdtemp(join(tmpdir(), "softmatrix-vm-build-test-"));
  const source = join(root, "source");
  const outDir = join(root, "release");
  await mkdir(join(source, "modules"), { recursive: true });
  await mkdir(join(source, "assets"), { recursive: true });

  const moduleBytes = Buffer.from("export default {fetch(){return new Response('ok')}};\n");
  const textModuleBytes = Buffer.from("fixture module text\n");
  const assetBytes = Buffer.from("hello");
  const moduleHash = "a".repeat(64);
  const textModuleHash = "c".repeat(64);
  const assetHash = "b".repeat(32);
  await writeFile(join(source, "modules", moduleHash), moduleBytes);
  await writeFile(join(source, "modules", textModuleHash), textModuleBytes);
  await writeFile(join(source, "assets", assetHash), assetBytes);
  await writeFile(join(source, "manifest.json"), JSON.stringify({
    manifestVersion: 1,
    releaseId: "fixture",
    commit: "fixture",
    createdAt: "2026-08-09T00:00:00.000Z",
    wranglerVersion: "fixture",
    workers: {
      router: {
        kind: "router",
        mainModule: "index.js",
        modules: [
          { name: "types.txt", type: "text", sha256: textModuleHash, size: textModuleBytes.length },
          { name: "index.js", type: "esm", sha256: moduleHash, size: moduleBytes.length },
        ],
        compatibilityDate: "2026-01-01",
        compatibilityFlags: [],
        migrations: [],
        bindings: [
          { type: "assets", name: "ASSETS" },
          { type: "service", name: "WORKSHOP_BACKEND", service: "$WORKER_NAME(workshop-backend)" },
        ],
        vars: { PUBLIC_BASE_URL: "$PUBLIC_BASE_URL" },
        assetsConfig: {
          variants: { access: { manifest: { "/index.html": { hash: assetHash, size: assetBytes.length } } } },
        },
      },
    },
    assets: { [assetHash]: { size: assetBytes.length } },
  }, null, 2));

  try {
    const release = await buildVmRelease({
      outDir,
      releaseId: "softmatrix-vm-test",
      commit: "fixture",
      sourceReleaseDir: source,
      rootDir: process.cwd(),
    });

    assert.equal(release.manifest.target, "vm");
    assert.equal(release.manifest.releaseId, "softmatrix-vm-test");
    assert.equal(release.manifest.commit, "fixture");
    assert.deepEqual(release.legalManifest.files.map(file => file.filename), [
      "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md",
    ]);
    assert.equal(JSON.stringify(release.manifest).includes("$R2_"), false);
    assert.equal(JSON.stringify(release.manifest).includes("$SECRET("), false);
    assert.equal(JSON.stringify(release.manifest).includes("$WORKER_NAME("), false);
    assert.equal(await readFile(join(outDir, "modules", moduleHash), "utf8"), moduleBytes.toString());
    assert.equal(await readFile(join(outDir, "assets", assetHash), "utf8"), assetBytes.toString());
    assert.equal(await readFile(join(outDir, "assets", "index.html"), "utf8"), assetBytes.toString());
    const runtimeConfig = await readFile(join(outDir, "runtime", "workerd.capnp"), "utf8");
    assert.match(runtimeConfig, /const config/);
    assert.match(runtimeConfig, /\(name = "softmatrix-router", worker/);
    assert.match(runtimeConfig, /durableObjectStorage/);
    assert.ok(runtimeConfig.indexOf('name = "index.js"') < runtimeConfig.indexOf('name = "types.txt"'));
    assert.match(await readFile(join(outDir, "checksums.sha256"), "utf8"), /runtime\/workerd\.capnp/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("VM release provisions Miniflare-compatible local KV and R2 services", async () => {
  const root = await mkdtemp(join(tmpdir(), "softmatrix-vm-storage-test-"));
  const source = join(root, "source");
  const outDir = join(root, "release");
  await mkdir(join(source, "modules"), { recursive: true });
  await mkdir(join(source, "assets"), { recursive: true });

  const moduleBytes = Buffer.from("export default {fetch(){return new Response('ok')}};\n");
  const moduleHash = "d".repeat(64);
  await writeFile(join(source, "modules", moduleHash), moduleBytes);
  await writeFile(join(source, "assets", "e".repeat(32)), Buffer.from("hello"));
  await writeFile(join(source, "manifest.json"), JSON.stringify({
    manifestVersion: 1,
    releaseId: "fixture",
    commit: "fixture",
    createdAt: "2026-08-09T00:00:00.000Z",
    wranglerVersion: "fixture",
    workers: {
      "workshop-backend": {
        kind: "backend",
        mainModule: "index.js",
        modules: [{ name: "index.js", type: "esm", sha256: moduleHash, size: moduleBytes.length }],
        compatibilityDate: "2026-01-01",
        compatibilityFlags: [],
        migrations: [],
        bindings: [
          { type: "kv_namespace", name: "BLUEPRINTS", namespace_id: "$KV_BLUEPRINTS_ID" },
          { type: "r2_bucket", name: "BLUEPRINT_CONTENT", bucket_name: "$R2_BLUEPRINT_CONTENT_NAME" },
        ],
        vars: {},
      },
    },
    assets: { ["e".repeat(32)]: { size: 5 } },
  }, null, 2));

  try {
    const release = await buildVmRelease({
      outDir,
      releaseId: "softmatrix-vm-storage-test",
      commit: "fixture",
      sourceReleaseDir: source,
      rootDir: process.cwd(),
    });

    const runtimeConfig = await readFile(join(outDir, "runtime", "workerd.capnp"), "utf8");
    assert.match(runtimeConfig, /name = "miniflare:shared"/);
    assert.match(runtimeConfig, /name = "softmatrix-kv-storage"/);
    assert.match(runtimeConfig, /name = "softmatrix-r2-storage"/);
    assert.match(runtimeConfig, /name = "softmatrix-kv-blueprints"/);
    assert.match(runtimeConfig, /name = "softmatrix-r2-blueprint_content"/);
    assert.match(runtimeConfig, /name = "softmatrix-model-network"/);
    assert.match(runtimeConfig, /globalOutbound = "softmatrix-model-network"/);
    assert.match(runtimeConfig, /KVNamespaceObject/);
    assert.match(runtimeConfig, /R2BucketObject/);
    assert.ok(release.manifest.runtime.storageAdapters?.miniflareLocal);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
