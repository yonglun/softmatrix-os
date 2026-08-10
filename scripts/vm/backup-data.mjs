#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export class VmBackupError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "VmBackupError";
    this.code = code;
  }
}

function safeReleaseId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertDirectory(path, name) {
  if (!path || !existsSync(path) || !lstatSync(path).isDirectory()) {
    throw new VmBackupError("VM_DATA_INVALID", `${name} must be an existing directory`);
  }
  return resolve(path);
}

function within(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("../") && !isAbsolute(rel));
}

function walkFiles(root, current = root) {
  const result = [];
  for (const name of readdirSync(current).toSorted()) {
    const path = join(current, name);
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) throw new VmBackupError("VM_DATA_INVALID", `symbolic links are not backed up: ${path}`);
    if (entry.isDirectory()) result.push(...walkFiles(root, path));
    else if (entry.isFile()) result.push(path);
    else throw new VmBackupError("VM_DATA_INVALID", `unsupported filesystem entry: ${path}`);
  }
  return result;
}

function copyTree(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(source).toSorted()) {
    const from = join(source, name);
    const to = join(destination, name);
    const entry = lstatSync(from);
    if (entry.isSymbolicLink()) throw new VmBackupError("VM_DATA_INVALID", `symbolic links are not backed up: ${from}`);
    cpSync(from, to, { recursive: entry.isDirectory() });
  }
}

function collectFiles(source, scope, root) {
  return walkFiles(source).map(path => {
    const bytes = readFileSync(path);
    return {
      scope,
      path: relative(source, path).split("\\").join("/"),
      size: bytes.byteLength,
      sha256: sha256(bytes),
      archivePath: `${scope}/${relative(source, path).split("\\").join("/")}`,
      root,
    };
  });
}

/** Create a tar.gz snapshot with an internal per-file manifest and an external archive checksum. */
export async function backupVmData({
  dataDir,
  objectStoreDir,
  outDir,
  releaseId = "manual",
  migrationVersion = "unknown",
  quiesce,
  resume,
} = {}) {
  if (!safeReleaseId(releaseId)) throw new VmBackupError("VM_CONFIG_INVALID", "releaseId is invalid");
  const data = assertDirectory(dataDir, "dataDir");
  const objects = assertDirectory(objectStoreDir, "objectStoreDir");
  const output = resolve(outDir ?? join(ROOT, "backups"));
  if (within(data, output) || within(objects, output)) {
    throw new VmBackupError("VM_CONFIG_INVALID", "backup output must not be inside an active data directory");
  }
  mkdirSync(output, { recursive: true });
  const staging = join(output, `.staging-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
  const archive = join(output, `${releaseId}-${stamp}.tar.gz`);
  const temporaryArchive = `${archive}.tmp-${process.pid}`;
  let quiesced = false;
  try {
    if (quiesce) {
      await quiesce();
      quiesced = true;
    }
    mkdirSync(staging, { recursive: true });
    copyTree(data, join(staging, "data"));
    copyTree(objects, join(staging, "objects"));
    const files = [
      ...collectFiles(data, "data", data),
      ...collectFiles(objects, "objects", objects),
    ].map(({ root, ...entry }) => entry).toSorted((left, right) => left.archivePath.localeCompare(right.archivePath));
    const manifest = {
      schemaVersion: 1,
      releaseId,
      migrationVersion,
      createdAt: new Date().toISOString(),
      files,
    };
    writeFileSync(join(staging, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    execFileSync("tar", ["-czf", temporaryArchive, "-C", staging, "."], { stdio: "ignore" });
    renameSync(temporaryArchive, archive);
    const checksum = sha256(readFileSync(archive));
    writeFileSync(`${archive}.sha256`, `${checksum}  ${archive.split("/").pop()}\n`);
    return { archive, checksum, releaseId };
  } finally {
    if (temporaryArchive && existsSync(temporaryArchive)) rmSync(temporaryArchive, { force: true });
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    if (quiesced && resume) await resume();
  }
}

function parseArgs(argv) {
  const args = {
    dataDir: process.env.SOFTMATRIX_DATA_DIR,
    objectStoreDir: process.env.SOFTMATRIX_OBJECT_STORE_DIR,
    outDir: "./backups",
    releaseId: "manual",
    migrationVersion: "unknown",
  };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--data-dir") args.dataDir = argv[++index];
    else if (argv[index] === "--object-store-dir") args.objectStoreDir = argv[++index];
    else if (argv[index] === "--out") args.outDir = argv[++index];
    else if (argv[index] === "--release-id") args.releaseId = argv[++index];
    else if (argv[index] === "--migration-version") args.migrationVersion = argv[++index];
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await backupVmData(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  }
}
