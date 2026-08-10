#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class VmRestoreError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "VmRestoreError";
    this.code = code;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function within(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("../") && !isAbsolute(rel));
}

function assertSafeArchiveEntries(archive) {
  let listing;
  try {
    listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" });
  } catch (error) {
    throw new VmRestoreError("VM_BACKUP_INVALID", `cannot list archive: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const raw of listing.split(/\r?\n/u).filter(Boolean)) {
    const name = raw.replace(/^\.\//u, "");
    if (!name) continue;
    if (isAbsolute(name) || name.split("/").includes("..")
        || !(name === "data" || name.startsWith("data/") || name === "objects"
          || name.startsWith("objects/") || name === "backup-manifest.json")) {
      throw new VmRestoreError("VM_BACKUP_INVALID", `unsafe archive entry: ${raw}`);
    }
  }
}

function activePath(targetDir) {
  const target = resolve(targetDir);
  const configured = [process.env.SOFTMATRIX_DATA_DIR, process.env.SOFTMATRIX_OBJECT_STORE_DIR]
      .filter(Boolean).map(resolve);
  if (configured.includes(target) || configured.some(path => target === resolve(path, ".."))) return true;
  return configured.some(path => target === resolve(dirname(path), "data") || target === resolve(dirname(path), "objects"));
}

function validateManifest(staging, manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)
      || typeof manifest.releaseId !== "string") {
    throw new VmRestoreError("VM_BACKUP_INVALID", "invalid backup-manifest.json");
  }
  for (const entry of manifest.files) {
    if (!entry || !["data", "objects"].includes(entry.scope) || typeof entry.path !== "string"
        || isAbsolute(entry.path) || entry.path.split("/").includes("..")) {
      throw new VmRestoreError("VM_BACKUP_INVALID", "invalid backup file entry");
    }
    const path = join(staging, entry.scope, entry.path);
    if (!within(staging, path) || !existsSync(path) || !lstatSync(path).isFile()) {
      throw new VmRestoreError("VM_BACKUP_INVALID", `missing backup file: ${entry.archivePath}`);
    }
    const bytes = readFileSync(path);
    if (bytes.byteLength !== entry.size || sha256(bytes) !== entry.sha256) {
      throw new VmRestoreError("VM_BACKUP_CHECKSUM", `backup file checksum mismatch: ${entry.archivePath}`);
    }
  }
  return manifest;
}

export async function restoreVmData({ archive, targetDir, expectedChecksum } = {}) {
  if (!archive || !existsSync(archive) || !lstatSync(archive).isFile()) {
    throw new VmRestoreError("VM_BACKUP_NOT_FOUND", "archive does not exist");
  }
  if (!targetDir) throw new VmRestoreError("VM_CONFIG_INVALID", "targetDir is required");
  const target = resolve(targetDir);
  if (activePath(target)) throw new VmRestoreError("VM_RESTORE_ACTIVE", "refusing to restore into active data paths");
  const checksum = sha256(readFileSync(archive));
  if (expectedChecksum && checksum !== expectedChecksum) {
    throw new VmRestoreError("VM_BACKUP_CHECKSUM", "archive checksum mismatch");
  }
  assertSafeArchiveEntries(archive);
  if (existsSync(target)) {
    if (!lstatSync(target).isDirectory() || readdirSync(target).length > 0) {
      throw new VmRestoreError("VM_RESTORE_EXISTS", "target directory must be empty or absent");
    }
  }
  mkdirSync(dirname(target), { recursive: true });
  const staging = join(dirname(target), `.restore-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    mkdirSync(staging, { recursive: true });
    execFileSync("tar", ["-xzf", archive, "-C", staging], { stdio: "ignore" });
    const manifest = JSON.parse(readFileSync(join(staging, "backup-manifest.json"), "utf8"));
    validateManifest(staging, manifest);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
    return { releaseId: manifest.releaseId, checksum, migrationVersion: manifest.migrationVersion };
  } catch (error) {
    if (error instanceof VmRestoreError) throw error;
    throw new VmRestoreError("VM_BACKUP_INVALID", error instanceof Error ? error.message : String(error));
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = { archive: undefined, targetDir: undefined, expectedChecksum: undefined };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--archive") args.archive = resolve(argv[++index]);
    else if (argv[index] === "--target") args.targetDir = resolve(argv[++index]);
    else if (argv[index] === "--checksum") args.expectedChecksum = argv[++index];
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await restoreVmData(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  }
}
