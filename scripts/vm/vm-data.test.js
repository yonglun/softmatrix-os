import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { backupVmData } from "./backup-data.mjs";
import { restoreVmData } from "./restore-data.mjs";

test("backup records release/migration metadata and restore verifies every file", async () => {
  const root = await mkdtemp(join(tmpdir(), "softmatrix-vm-data-test-"));
  const dataDir = join(root, "data");
  const objectsDir = join(root, "objects");
  const backupsDir = join(root, "backups");
  const restoreRoot = join(root, "restored");
  try {
    await mkdir(join(dataDir, "do"), { recursive: true });
    await mkdir(join(objectsDir, "blueprints"), { recursive: true });
    await mkdir(backupsDir, { recursive: true });
    await writeFile(join(dataDir, "do", "counter.sqlite"), "sqlite fixture");
    await writeFile(join(objectsDir, "blueprints", "one.bin"), "object fixture");

    const backup = await backupVmData({
      dataDir,
      objectStoreDir: objectsDir,
      outDir: backupsDir,
      releaseId: "release-a",
      migrationVersion: "v3",
    });
    assert.equal(backup.releaseId, "release-a");
    assert.match(backup.checksum, /^[a-f0-9]{64}$/);

    const restored = await restoreVmData({
      archive: backup.archive,
      targetDir: restoreRoot,
      expectedChecksum: backup.checksum,
    });
    assert.equal(restored.releaseId, "release-a");
    assert.equal(restored.checksum, backup.checksum);
    assert.equal(await readFile(join(restoreRoot, "data/do/counter.sqlite"), "utf8"), "sqlite fixture");
    assert.equal(await readFile(join(restoreRoot, "objects/blueprints/one.bin"), "utf8"), "object fixture");
    const metadata = JSON.parse(await readFile(join(restoreRoot, "backup-manifest.json"), "utf8"));
    assert.equal(metadata.migrationVersion, "v3");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restore rejects a tampered archive and refuses active data paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "softmatrix-vm-data-tamper-test-"));
  try {
    const dataDir = join(root, "data");
    const objectsDir = join(root, "objects");
    const outDir = join(root, "backups");
    await mkdir(dataDir, { recursive: true });
    await mkdir(objectsDir, { recursive: true });
    await mkdir(outDir, { recursive: true });
    await writeFile(join(dataDir, "state.sqlite"), "state");
    const backup = await backupVmData({ dataDir, objectStoreDir: objectsDir, outDir, releaseId: "release-a" });
    const bytes = await readFile(backup.archive);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(backup.archive, bytes);
    await assert.rejects(
        restoreVmData({ archive: backup.archive, targetDir: join(root, "restored"), expectedChecksum: backup.checksum }),
        /VM_BACKUP_CHECKSUM/);
    await assert.rejects(
        restoreVmData({ archive: backup.archive, targetDir: dataDir, expectedChecksum: backup.checksum }),
        /VM_RESTORE_ACTIVE|VM_BACKUP_CHECKSUM/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
