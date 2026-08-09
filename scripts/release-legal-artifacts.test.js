import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LEGAL_FILENAMES,
  LEGAL_MANIFEST_FILENAME,
  assertLegalManifest,
  buildLegalArtifacts,
  readLegalManifest,
  validateLegalArtifacts,
} from "./release/legal-artifacts.mjs";
import { uploadRelease } from "./release/upload-release.mjs";
import { promoteRelease } from "./release/promote-release.mjs";

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "softmatrix-legal-test-"));
  for (const [name, value] of [
    ["LICENSE", "Apache License fixture\n"],
    ["NOTICE", "Softmatrix notice fixture\n"],
    ["THIRD_PARTY_NOTICES.md", "Third-party fixture notice\n"],
  ]) writeFileSync(join(root, name), value);
  return root;
}

function releaseFixture() {
  const root = fixtureRoot();
  const release = join(root, "release");
  mkdirSync(join(release, "modules"), { recursive: true });
  mkdirSync(join(release, "assets"), { recursive: true });
  writeFileSync(join(release, "modules", "module"), "module");
  writeFileSync(join(release, "assets", "asset"), "asset");
  buildLegalArtifacts({ rootDir: root, outDir: release });
  writeFileSync(join(release, "manifest.json"), JSON.stringify({ releaseId: "r000001-fixture" }));
  return { root, release };
}

test("legal builds require exact files and detect tampering", () => {
  const { release } = releaseFixture();
  assert.equal(validateLegalArtifacts(release), true);
  const manifest = readLegalManifest(release);
  assert.deepEqual(manifest.files.map((entry) => entry.filename), LEGAL_FILENAMES);
  writeFileSync(join(release, "legal", "NOTICE"), "tampered\n");
  assert.throws(() => validateLegalArtifacts(release), /hash\/size mismatch/);
});

test("legal manifest validates complete in-memory candidate objects", () => {
  const { release } = releaseFixture();
  const manifest = readLegalManifest(release);
  const files = new Map(LEGAL_FILENAMES.map((name) => [name, readFileSync(join(release, "legal", name))]));
  assert.equal(assertLegalManifest(manifest, files), true);
  files.delete("NOTICE");
  assert.throws(() => assertLegalManifest(manifest, files), /missing or empty/);
});

test("upload publishes legal objects and sidecar before manifest", async () => {
  const { release } = releaseFixture();
  const calls = [];
  const client = { fetch: async (url, init = {}) => {
    const key = new URL(url).pathname.split("/").slice(2).join("/");
    calls.push({ key, method: init.method ?? "GET" });
    if (init.method === "HEAD") return new Response(null, { status: 404 });
    return new Response(null, { status: 200 });
  } };
  await uploadRelease({
    release,
    candidate: true,
    client,
    endpoint: "https://r2.example",
    bucket: "bucket",
  });
  const puts = calls.filter((call) => call.method === "PUT").map((call) => call.key);
  const legalLast = Math.max(...LEGAL_FILENAMES.map((name) => puts.indexOf(`blobs/modules/${name}`)));
  const legalIndex = puts.indexOf("candidates/r000001-fixture/legal/LICENSE");
  const sidecarIndex = puts.indexOf(`candidates/r000001-fixture/${LEGAL_MANIFEST_FILENAME}`);
  const manifestIndex = puts.indexOf("candidates/r000001-fixture/manifest.json");
  assert.equal(legalLast, -1); // legal objects are not content-addressed blobs
  assert.ok(legalIndex >= 0 && sidecarIndex > legalIndex && manifestIndex > sidecarIndex);
  assert.equal(manifestIndex, puts.length - 1);
});

test("promotion refuses incomplete legal candidates and publishes legal files first", async () => {
  const { release } = releaseFixture();
  const manifest = readFileSync(join(release, "manifest.json"));
  const legalManifest = readFileSync(join(release, LEGAL_MANIFEST_FILENAME));
  const legalFiles = new Map(LEGAL_FILENAMES.map((name) => [
    name,
    readFileSync(join(release, "legal", name)),
  ]));
  const calls = [];
  const client = { fetch: async (url, init = {}) => {
    const parsed = new URL(url);
    const key = parsed.pathname.split("/").slice(2).join("/");
    calls.push({ key, method: init.method ?? "GET" });
    if (init.method === "HEAD") return new Response(null, { status: 404 });
    if (init.method === "GET" && key === "candidates/r000001-fixture/manifest.json") {
      return new Response(manifest);
    }
    if (init.method === "GET" && key.endsWith(LEGAL_MANIFEST_FILENAME)) return new Response(legalManifest);
    for (const [name, bytes] of legalFiles) {
      if (key.endsWith(`/legal/${name}`)) return new Response(bytes);
    }
    if (init.method === "GET" && parsed.searchParams.get("list-type") === "2") {
      return new Response("<ListBucketResult></ListBucketResult>");
    }
    if (init.method === "PUT") return new Response("<CopyObjectResult></CopyObjectResult>");
    return new Response(null, { status: 404 });
  } };
  await promoteRelease({
    releaseId: "r000001-fixture",
    client,
    endpoint: "https://r2.example",
    bucket: "bucket",
  });
  const puts = calls.filter((call) => call.method === "PUT").map((call) => call.key);
  const sidecarIndex = puts.indexOf(`releases/r000001-fixture/${LEGAL_MANIFEST_FILENAME}`);
  const manifestIndex = puts.indexOf("releases/r000001-fixture/manifest.json");
  for (const name of LEGAL_FILENAMES) {
    assert.ok(puts.indexOf(`releases/r000001-fixture/legal/${name}`) < sidecarIndex);
  }
  assert.ok(sidecarIndex < manifestIndex);
  assert.equal(manifestIndex, puts.length - 1);
});
