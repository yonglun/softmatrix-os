#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateLegalArtifacts } from "../release/legal-artifacts.mjs";
import { healthcheckVm } from "./healthcheck.mjs";

export class VmInstallError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "VmInstallError";
    this.code = code;
  }
}

function safeReleaseId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}

function within(root, candidate) {
  const relativePath = relative(resolve(root), resolve(candidate));
  return relativePath === "" || (!relativePath.startsWith("../") && !isAbsolute(relativePath));
}

function readJson(path, code) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new VmInstallError(code, `invalid JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function validateChecksums(releaseDir) {
  const path = join(releaseDir, "checksums.sha256");
  if (!existsSync(path)) throw new VmInstallError("VM_ARTIFACT_INVALID", "checksums.sha256 is missing");
  const entries = readFileSync(path, "utf8").trim().split(/\r?\n/u).filter(Boolean);
  if (entries.length === 0) throw new VmInstallError("VM_ARTIFACT_INVALID", "checksums.sha256 is empty");
  for (const line of entries) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line);
    if (!match || !match[2] || isAbsolute(match[2]) || match[2].split("/").includes("..")) {
      throw new VmInstallError("VM_ARTIFACT_INVALID", `invalid checksum entry: ${line}`);
    }
    const file = join(releaseDir, match[2]);
    if (!within(releaseDir, file) || !existsSync(file) || !lstatSync(file).isFile()) {
      throw new VmInstallError("VM_ARTIFACT_INVALID", `checksum file is missing: ${match[2]}`);
    }
    if (digest(file) !== match[1]) {
      throw new VmInstallError("VM_ARTIFACT_INVALID", `checksum mismatch: ${match[2]}`);
    }
  }
}

function validateModules(releaseDir, manifest) {
  for (const [pkgName, worker] of Object.entries(manifest.workers ?? {})) {
    if (!worker.mainModule || !Array.isArray(worker.modules)) {
      throw new VmInstallError("VM_ARTIFACT_INVALID", `worker ${pkgName} has no module list`);
    }
    for (const module of worker.modules) {
      const path = join(releaseDir, module.localPath ?? `modules/${module.sha256}`);
      if (!module.sha256 || !within(releaseDir, path) || !existsSync(path) || digest(path) !== module.sha256) {
        throw new VmInstallError("VM_ARTIFACT_INVALID", `module hash mismatch: ${pkgName}/${module.name}`);
      }
    }
  }
}

function runtimeServiceHasTls(runtimeConfig, serviceName) {
  const marker = `(name = "${serviceName}"`;
  const start = runtimeConfig.indexOf(marker);
  if (start < 0) return false;
  const nextService = runtimeConfig.indexOf("(name =", start + marker.length);
  const service = runtimeConfig.slice(start, nextService < 0 ? undefined : nextService);
  return /network\s*=\s*\(/u.test(service)
    && /tlsOptions\s*=\s*\(\s*trustBrowserCas\s*=\s*true\s*\)/u.test(service);
}

function validateRuntimeTls(releaseDir) {
  const runtimePath = join(releaseDir, "runtime", "workerd.capnp");
  const runtimeConfig = readFileSync(runtimePath, "utf8");
  const missing = ["internet", "softmatrix-model-network"]
      .filter(serviceName => !runtimeServiceHasTls(runtimeConfig, serviceName));
  if (missing.length > 0) {
    throw new VmInstallError(
        "VM_RUNTIME_TLS_MISSING",
        `outbound TLS is not enabled for workerd network service(s): ${missing.join(", ")}`,
    );
  }
}

function validateRelease(releaseDir) {
  if (!existsSync(releaseDir) || !lstatSync(releaseDir).isDirectory()) {
    throw new VmInstallError("VM_RELEASE_NOT_FOUND", `release directory does not exist: ${releaseDir}`);
  }
  const manifest = readJson(join(releaseDir, "manifest.json"), "VM_ARTIFACT_INVALID");
  if (manifest.target !== "vm" || !safeReleaseId(manifest.releaseId)) {
    throw new VmInstallError("VM_ARTIFACT_INVALID", "manifest is not a valid VM release");
  }
  if (!existsSync(join(releaseDir, "runtime", "workerd.capnp"))) {
    throw new VmInstallError("VM_ARTIFACT_INVALID", "runtime/workerd.capnp is missing");
  }
  validateRuntimeTls(releaseDir);
  try {
    validateLegalArtifacts(releaseDir);
  } catch (error) {
    throw new VmInstallError("VM_ARTIFACT_INVALID", error instanceof Error ? error.message : String(error));
  }
  validateChecksums(releaseDir);
  validateModules(releaseDir, manifest);
  return manifest;
}

function currentTarget(rootDir) {
  const current = join(rootDir, "current");
  if (!existsSync(current)) return undefined;
  if (!lstatSync(current).isSymbolicLink()) throw new VmInstallError("VM_PATH_INVALID", "current must be a symlink");
  const target = readlinkSync(current);
  const resolved = resolve(rootDir, target);
  const releasesRoot = join(rootDir, "releases");
  if (!within(releasesRoot, resolved)) throw new VmInstallError("VM_PATH_INVALID", "current points outside releases");
  return { id: resolved.slice(releasesRoot.length + 1), target: resolved };
}

function replaceSymlink(rootDir, name, target) {
  const temp = join(rootDir, `.${name}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  symlinkSync(relative(rootDir, target), temp);
  renameSync(temp, join(rootDir, name));
}

function removeLink(rootDir, name) {
  const path = join(rootDir, name);
  if (existsSync(path) || lstatSync(path, { throwIfNoEntry: false })) rmSync(path, { force: true });
}

async function restartService(service) {
  if (service?.restart) return service.restart();
  execFileSync("systemctl", ["restart", "softmatrix"], { stdio: "inherit" });
}

async function readiness(healthcheck, baseUrl) {
  const result = await (healthcheck ?? healthcheckVm)({ baseUrl });
  if (!result?.ok) throw new VmInstallError("VM_READINESS_FAILED", "VM health check did not pass");
  return result;
}

function ensureRoot(rootDir) {
  const root = resolve(rootDir);
  mkdirSync(join(root, "releases"), { recursive: true });
  return root;
}

export async function installVmRelease({
  releaseDir,
  rootDir = "/opt/softmatrix",
  service,
  healthcheck,
  baseUrl,
} = {}) {
  if (!releaseDir) throw new VmInstallError("VM_CONFIG_INVALID", "releaseDir is required");
  const root = ensureRoot(rootDir);
  const source = resolve(releaseDir);
  if (!within(root, source)) throw new VmInstallError("VM_PATH_INVALID", "release must be inside the VM root");
  const manifest = validateRelease(source);
  const id = manifest.releaseId;
  const releasesRoot = join(root, "releases");
  const destination = join(releasesRoot, id);
  if (existsSync(destination)) throw new VmInstallError("VM_RELEASE_EXISTS", `release already exists: ${id}`);
  const staging = join(releasesRoot, `.staging-${id}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const old = currentTarget(root);
  try {
    cpSync(source, staging, { recursive: true, dereference: false });
    renameSync(staging, destination);
    replaceSymlink(root, "current", destination);
    try {
      await restartService(service);
      await readiness(healthcheck, baseUrl);
    } catch (error) {
      if (old) replaceSymlink(root, "current", old.target);
      else removeLink(root, "current");
      try { await restartService(service); } catch { /* preserve the original readiness failure */ }
      throw error instanceof VmInstallError ? error : new VmInstallError("VM_READINESS_FAILED", String(error));
    }
    if (old) replaceSymlink(root, "previous", old.target);
    else removeLink(root, "previous");
    return { releaseId: id, previousReleaseId: old?.id };
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    if (error instanceof VmInstallError) throw error;
    throw new VmInstallError("VM_INSTALL_FAILED", error instanceof Error ? error.message : String(error));
  }
}

export async function rollbackVmRelease({
  rootDir = "/opt/softmatrix",
  releaseId,
  service,
  healthcheck,
  baseUrl,
} = {}) {
  const root = ensureRoot(rootDir);
  if (!safeReleaseId(releaseId)) throw new VmInstallError("VM_RELEASE_NOT_FOUND", "invalid release ID");
  const target = join(root, "releases", releaseId);
  if (!within(join(root, "releases"), target) || !existsSync(target)) {
    throw new VmInstallError("VM_RELEASE_NOT_FOUND", `release does not exist: ${releaseId}`);
  }
  const manifest = validateRelease(target);
  const old = currentTarget(root);
  if (old?.id === releaseId) return { releaseId };
  replaceSymlink(root, "current", target);
  try {
    await restartService(service);
    await readiness(healthcheck, baseUrl);
  } catch (error) {
    if (old) replaceSymlink(root, "current", old.target);
    else removeLink(root, "current");
    try { await restartService(service); } catch { /* preserve the original readiness failure */ }
    throw error instanceof VmInstallError ? error : new VmInstallError("VM_READINESS_FAILED", String(error));
  }
  if (old) replaceSymlink(root, "previous", old.target);
  return { releaseId: manifest.releaseId };
}

function parseArgs(argv) {
  const args = { rootDir: "/opt/softmatrix", releaseDir: undefined, rollback: undefined, baseUrl: undefined };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--root") args.rootDir = resolve(argv[++index]);
    else if (argv[index] === "--release") args.releaseDir = resolve(argv[++index]);
    else if (argv[index] === "--rollback") args.rollback = argv[++index];
    else if (argv[index] === "--base-url") args.baseUrl = argv[++index];
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = args.rollback
      ? await rollbackVmRelease({ rootDir: args.rootDir, releaseId: args.rollback, baseUrl: args.baseUrl })
      : await installVmRelease({ rootDir: args.rootDir, releaseDir: args.releaseDir, baseUrl: args.baseUrl });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  }
}

export { healthcheckVm };
