import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildLegalArtifacts } from "../release/legal-artifacts.mjs";
import {
  healthcheckVm,
  installVmRelease,
  rollbackVmRelease,
} from "./install-release.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeChecksums(root) {
  const files = ["manifest.json", "runtime/workerd.capnp", "modules/main.js", "legal/LICENSE",
    "legal/NOTICE", "legal/THIRD_PARTY_NOTICES.md"];
  const lines = [];
  for (const file of files) {
    const bytes = await readFile(join(root, file));
    lines.push(`${sha256(bytes)}  ${file}`);
  }
  await writeFile(join(root, "checksums.sha256"), `${lines.toSorted().join("\n")}\n`);
}

async function createRelease(root, releaseId) {
  const release = join(root, "incoming", releaseId);
  await mkdir(join(release, "modules"), { recursive: true });
  await mkdir(join(release, "runtime"), { recursive: true });
  await writeFile(join(release, "runtime/workerd.capnp"), "using Workerd = import \"/workerd/workerd.capnp\";\n");
  const module = Buffer.from(`export default {fetch(){return new Response('${releaseId}')}};`);
  await writeFile(join(release, "modules/main.js"), module);
  const moduleHash = sha256(module);
  const manifest = {
    manifestVersion: 1,
    target: "vm",
    releaseId,
    commit: "fixture",
    workers: {
      router: {
        pkgName: "router",
        serviceName: "softmatrix-router",
        mainModule: "main.js",
        modules: [{ name: "main.js", type: "esm", sha256: moduleHash, size: module.length,
          localPath: "modules/main.js" }],
      },
    },
  };
  await writeFile(join(release, "manifest.json"), `${JSON.stringify(manifest)}\n`);
  buildLegalArtifacts({ rootDir: process.cwd(), outDir: release });
  await writeChecksums(release);
  return release;
}

test("install switches current atomically and records previous only after readiness", async () => {
  const root = await mkdtemp(join(tmpdir(), "softmatrix-vm-install-test-"));
  const calls = [];
  const service = { restart: async () => calls.push("restart") };
  const healthcheck = async () => ({ ok: true, checks: [{ name: "root", ok: true }] });
  try {
    const first = await createRelease(root, "one");
    const installed = await installVmRelease({ rootDir: root, releaseDir: first, service, healthcheck });
    assert.equal(installed.releaseId, "one");
    assert.equal(installed.previousReleaseId, undefined);
    assert.equal(await readlink(join(root, "current")), "releases/one");

    const second = await createRelease(root, "two");
    const upgraded = await installVmRelease({ rootDir: root, releaseDir: second, service, healthcheck });
    assert.equal(upgraded.releaseId, "two");
    assert.equal(upgraded.previousReleaseId, "one");
    assert.equal(await readlink(join(root, "current")), "releases/two");
    assert.equal(await readlink(join(root, "previous")), "releases/one");
    assert.deepEqual(calls, ["restart", "restart"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed readiness leaves current unchanged and rejects release paths outside root", async () => {
  const root = await mkdtemp(join(tmpdir(), "softmatrix-vm-install-safety-test-"));
  const service = { restart: async () => {} };
  try {
    const first = await createRelease(root, "one");
    await installVmRelease({ rootDir: root, releaseDir: first, service, healthcheck: async () => ({ ok: true, checks: [] }) });
    const second = await createRelease(root, "two");
    await assert.rejects(
        installVmRelease({ rootDir: root, releaseDir: second, service, healthcheck: async () => ({ ok: false, checks: [] }) }),
        /VM_READINESS_FAILED/);
    assert.equal(await readlink(join(root, "current")), "releases/one");
    const outside = await mkdtemp(join(tmpdir(), "softmatrix-vm-outside-"));
    try {
      await assert.rejects(
          installVmRelease({ rootDir: root, releaseDir: outside, healthcheck: async () => ({ ok: true, checks: [] }) }),
          /VM_PATH_INVALID/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rollback refuses unknown release IDs and switches to a validated release", async () => {
  const root = await mkdtemp(join(tmpdir(), "softmatrix-vm-rollback-test-"));
  const service = { restart: async () => {} };
  try {
    const first = await createRelease(root, "one");
    const second = await createRelease(root, "two");
    const healthcheck = async () => ({ ok: true, checks: [] });
    await installVmRelease({ rootDir: root, releaseDir: first, service, healthcheck });
    await installVmRelease({ rootDir: root, releaseDir: second, service, healthcheck });
    await assert.rejects(
        rollbackVmRelease({ rootDir: root, releaseId: "missing", service, healthcheck }),
        /VM_RELEASE_NOT_FOUND/);
    const rollback = await rollbackVmRelease({ rootDir: root, releaseId: "one", service, healthcheck });
    assert.equal(rollback.releaseId, "one");
    assert.equal(await readlink(join(root, "current")), "releases/one");
    assert.equal(await readlink(join(root, "previous")), "releases/two");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("healthcheck reports a stable failed check when the VM is unreachable", async () => {
  const result = await healthcheckVm({ baseUrl: "http://127.0.0.1:1", timeoutMs: 25 });
  assert.equal(result.ok, false);
  assert.equal(result.checks[0].name, "http");
});
