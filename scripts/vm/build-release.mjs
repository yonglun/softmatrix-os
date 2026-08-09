#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { buildLegalArtifacts } from "../release/legal-artifacts.mjs";
import { sha256Hex, stableStringify } from "../release/hash-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PLACEHOLDER = /\$(?:R2_|KV_|SECRET\(|WORKER_NAME\(|ACCOUNT_ID|PUBLIC_BASE_URL)/;

function parseArgs(argv) {
  const args = { out: undefined, releaseId: undefined, commit: undefined, allowDirty: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--out") args.out = resolve(argv[++index]);
    else if (arg === "--release-id") args.releaseId = argv[++index];
    else if (arg === "--commit") args.commit = argv[++index];
    else if (arg === "--allow-dirty") args.allowDirty = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.out) throw new Error("--out <dir> is required");
  return args;
}

function gitCommit() {
  return process.env.CI_COMMIT_SHA
    || execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function assertCleanTree() {
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (status) {
    throw new Error("VM release requires a clean tracked worktree; pass --allow-dirty for local builds");
  }
}

function copyDirectory(source, destination) {
  if (!existsSync(source)) throw new Error(`missing release directory: ${source}`);
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source)) {
    cpSync(join(source, entry), join(destination, entry), { recursive: true });
  }
}

function materializeAssetPaths(sourceManifest, sourceDir, outputDir) {
  const variants = Object.values(sourceManifest.workers ?? {})
      .flatMap(worker => Object.values(worker.assetsConfig?.variants ?? {}));
  const variant = variants.find(candidate => candidate?.manifest) ?? { manifest: {} };
  for (const [urlPath, entry] of Object.entries(variant.manifest)) {
    if (!urlPath.startsWith("/") || urlPath.includes("..")) {
      throw new Error(`invalid asset path in release manifest: ${urlPath}`);
    }
    const relativePath = urlPath === "/" ? "index.html" : urlPath.slice(1);
    const source = join(sourceDir, "assets", entry.hash);
    const destination = join(outputDir, "assets", relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(source));
  }
}

function sanitizeEnvironmentName(value) {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
}

function serviceNameForBinding(type, name) {
  const prefix = type === "kv_namespace" ? "kv" : "r2";
  return `softmatrix-${prefix}-${sanitizeEnvironmentName(name).toLowerCase()}`;
}

function workerServiceName(pkgName) {
  return `softmatrix-${pkgName}`;
}

function localizePlaceholder(value) {
  if (typeof value !== "string") return value;
  const publicBase = /^\$PUBLIC_BASE_URL(.*)$/u.exec(value);
  if (publicBase) {
    return { fromEnvironment: "PUBLIC_BASE_URL", suffix: publicBase[1] };
  }
  const worker = /^\$WORKER_NAME\(([^)]+)\)$/u.exec(value);
  if (worker) return workerServiceName(worker[1]);
  if (value.startsWith("$SECRET(")) {
    const secretName = value.slice(8, -1);
    return { fromEnvironment: `SOFTMATRIX_${sanitizeEnvironmentName(secretName)}` };
  }
  if (/^\$(?:KV_|R2_|ACCOUNT_ID)/u.test(value)) {
    throw new Error(`Cloudflare resource placeholder cannot be used in VM release: ${value}`);
  }
  return value;
}

function transformBinding(binding, pkgName) {
  switch (binding.type) {
    case "service":
      return {
        type: "service",
        name: binding.name,
        service: localizePlaceholder(binding.service),
        ...(binding.entrypoint ? { entrypoint: binding.entrypoint } : {}),
      };
    case "assets":
      return { type: "assets", name: binding.name, service: "softmatrix-assets" };
    case "kv_namespace":
    case "r2_bucket":
      return {
        type: binding.type,
        name: binding.name,
        service: serviceNameForBinding(binding.type, binding.name),
      };
    case "worker_loader":
      return { type: "worker_loader", name: binding.name, id: "softmatrix-dynamic-workers" };
    case "secret_text":
      return {
        type: "from_environment",
        name: binding.name,
        environment: `SOFTMATRIX_${sanitizeEnvironmentName(pkgName)}_${sanitizeEnvironmentName(binding.name)}`,
      };
    case "browser":
    case "ai":
      return { type: "disabled", name: binding.name, reason: "not available in the single-VM profile" };
    default:
      throw new Error(`unsupported binding type in VM release: ${binding.type}`);
  }
}

function transformAssetsConfig(assetsConfig) {
  if (!assetsConfig) return undefined;
  const variants = {};
  for (const [variant, value] of Object.entries(assetsConfig.variants ?? {})) {
    const manifest = {};
    for (const [path, entry] of Object.entries(value.manifest ?? {})) {
      manifest[path] = { hash: entry.hash, size: entry.size, localPath: `assets/${entry.hash}` };
    }
    variants[variant] = { manifest };
  }
  return { ...assetsConfig, variants };
}

function transformWorker(pkgName, worker) {
  const vars = Object.fromEntries(Object.entries(worker.vars ?? {})
      .map(([name, value]) => [name, localizePlaceholder(value)]));
  return {
    kind: worker.kind,
    pkgName,
    serviceName: workerServiceName(pkgName),
    ...(worker.shortName ? { shortName: worker.shortName } : {}),
    mainModule: worker.mainModule,
    modules: (worker.modules ?? []).map(module => ({
      name: module.name,
      type: module.type,
      sha256: module.sha256,
      size: module.size,
      localPath: `modules/${module.sha256}`,
    })),
    compatibilityDate: worker.compatibilityDate,
    compatibilityFlags: worker.compatibilityFlags ?? [],
    migrations: worker.migrations ?? [],
    bindings: [
      ...(worker.bindings ?? []).map(binding => transformBinding(binding, pkgName)),
      ...(pkgName === "workshop-backend"
        ? ["ADMINS", "ORG_AI_MODELS", "ALLOW_USER_BYOK", "DISABLE_PASSWORD_AUTH",
          "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_DISPLAY_NAME",
          "OIDC_ALLOWED_EMAIL_DOMAINS", "AUTH_GATEKEEPERS"].map(name => ({
          type: "from_environment",
          name,
          environment: name,
        }))
        : []),
    ],
    vars,
    observability: worker.observability ?? { enabled: false },
    ...(transformAssetsConfig(worker.assetsConfig)
      ? { assetsConfig: transformAssetsConfig(worker.assetsConfig) } : {}),
    ...(worker.inputs ? { inputs: worker.inputs.map(input => ({ name: input.name, kind: input.kind })) } : {}),
  };
}

function migrationClasses(worker) {
  const classes = [];
  for (const migration of worker.migrations ?? []) {
    for (const className of migration.new_sqlite_classes ?? []) classes.push(className);
    for (const className of migration.new_classes ?? []) classes.push(className);
  }
  return [...new Set(classes)];
}

function capnpString(value) {
  return JSON.stringify(String(value));
}

function capnpTextList(values) {
  return `[${values.map(capnpString).join(", ")}]`;
}

function capnpBinding(binding) {
  const prefix = `(name = ${capnpString(binding.name)}, `;
  if (binding.type === "service") {
    const service = `(name = ${capnpString(binding.service)}${binding.entrypoint
      ? `, entrypoint = ${capnpString(binding.entrypoint)}` : ""})`;
    return `${prefix}service = ${service})`;
  }
  if (binding.type === "kv_namespace") return `${prefix}kvNamespace = ${capnpString(binding.service)})`;
  if (binding.type === "r2_bucket") return `${prefix}r2Bucket = ${capnpString(binding.service)})`;
  if (binding.type === "worker_loader") {
    return `${prefix}workerLoader = (id = ${capnpString(binding.id)}))`;
  }
  if (binding.type === "from_environment") {
    return `${prefix}fromEnvironment = ${capnpString(binding.environment)})`;
  }
  if (binding.type === "assets") return `${prefix}service = "softmatrix-assets")`;
  if (binding.type === "disabled") return `${prefix}parameter = (type = (text = void), optional = true))`;
  throw new Error(`cannot render binding type: ${binding.type}`);
}

function capnpModules(worker) {
  const main = worker.modules.find(module => module.name === worker.mainModule);
  if (!main) throw new Error(`main module ${worker.mainModule} is missing from ${worker.pkgName}`);
  const modules = [main, ...worker.modules.filter(module => module !== main)];
  return modules.map(module => {
    const field = module.type === "esm" ? "esModule"
      : module.type === "text" ? "text"
        : module.type === "data" || module.type === "wasm" ? module.type
          : undefined;
    if (!field) throw new Error(`cannot render module type: ${module.type}`);
    return `(name = ${capnpString(module.name)}, ${field} = embed "../${module.localPath}")`;
  }).join(",\n        ");
}

function capnpNamespaces(pkgName, worker) {
  return migrationClasses(worker).map(className =>
    `(className = ${capnpString(className)}, uniqueKey = ${capnpString(`softmatrix:${pkgName}:${className}`)}, enableSql = true)`)
      .join(",\n        ");
}

function renderWorker(pkgName, worker) {
  const bindings = worker.bindings.filter(binding => binding.type !== "disabled");
  const vars = Object.entries(worker.vars ?? {}).map(([name, value]) => {
    if (value && typeof value === "object" && value.fromEnvironment) {
      // Workerd cannot concatenate environment values in Cap'n Proto. The launcher resolves
      // suffixes before starting and exports one derived value per worker.
      if (value.suffix) {
        const environment = `SOFTMATRIX_BASE_URL_${sanitizeEnvironmentName(pkgName)}`;
        return `(name = ${capnpString(name)}, fromEnvironment = ${capnpString(environment)})`;
      }
      return `(name = ${capnpString(name)}, fromEnvironment = ${capnpString(value.fromEnvironment)})`;
    }
    if (Array.isArray(value)) return `(name = ${capnpString(name)}, json = ${capnpString(JSON.stringify(value))})`;
    return `(name = ${capnpString(name)}, text = ${capnpString(value)})`;
  });
  const namespaceList = capnpNamespaces(pkgName, worker);
  return `(name = ${capnpString(worker.serviceName)}, worker = (
      modules = [
        ${capnpModules(worker)}
      ],
      compatibilityDate = ${capnpString(worker.compatibilityDate)},
      compatibilityFlags = ${capnpTextList(worker.compatibilityFlags)},
      bindings = [
        ${[...bindings.map(capnpBinding), ...vars].join(",\n        ")}
      ],
      durableObjectNamespaces = [
        ${namespaceList}
      ],
      durableObjectStorage = (localDisk = "data")
    ))`;
}

function renderStorageServices(workers) {
  const services = new Map();
  for (const worker of Object.values(workers)) {
    for (const binding of worker.bindings) {
      if (binding.type !== "kv_namespace" && binding.type !== "r2_bucket") continue;
      const directory = binding.type === "kv_namespace" ? "data" : "objects";
      const suffix = binding.service.replace(/^softmatrix-(?:kv|r2)-/u, "");
      services.set(binding.service, `${directory}/${binding.type === "kv_namespace" ? "kv" : "r2"}-${suffix}`);
    }
  }
  return [...services.entries()].toSorted(([left], [right]) => left.localeCompare(right)).map(([name, path]) =>
    `(name = ${capnpString(name)}, disk = (path = ${capnpString(path)}, writable = true))`).join(",\n    ");
}

function renderWorkerdConfig(workers) {
  const workerServices = Object.entries(workers).map(([pkgName, worker]) => renderWorker(pkgName, worker));
  const storageServices = renderStorageServices(workers);
  return `using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  logging = (structuredLogging = true),
  services = [
    (name = "data", disk = (writable = true)),
    (name = "objects", disk = (writable = true)),
    (name = "softmatrix-assets", disk = (path = "assets", writable = false)),
    (name = "internet", network = (allow = ["public"])),
    ${storageServices},
    ${workerServices.join(",\n    ")}
  ],
  sockets = [
    (name = "http", address = "127.0.0.1:8787", http = (), service = "softmatrix-router")
  ]
);
`;
}

function rejectPlaceholders(value, path = "manifest") {
  if (typeof value === "string") {
    if (PLACEHOLDER.test(value)) throw new Error(`Cloudflare placeholder remains at ${path}`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((item, index) => rejectPlaceholders(item, `${path}[${index}]`));
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) rejectPlaceholders(item, `${path}.${key}`);
  }
}

function walkFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir).toSorted()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walkFiles(path));
    else files.push(path);
  }
  return files;
}

function writeChecksums(outDir) {
  const files = walkFiles(outDir)
      .filter(file => relative(outDir, file) !== "checksums.sha256")
      .map(file => {
        const bytes = readFileSync(file);
        return `${sha256Hex(bytes)}  ${relative(outDir, file).split(sep).join("/")}`;
      });
  writeFileSync(join(outDir, "checksums.sha256"), `${files.toSorted().join("\n")}\n`);
}

/** Transform a Wrangler release directory into a local, immutable VM release. */
export async function buildVmRelease({
  outDir,
  releaseId,
  commit = gitCommit(),
  sourceReleaseDir,
  rootDir = ROOT,
  allowDirty = false,
} = {}) {
  if (!outDir) throw new Error("outDir is required");
  if (!releaseId) throw new Error("releaseId is required");
  if (!sourceReleaseDir && !allowDirty) assertCleanTree();

  const output = resolve(outDir);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const temporary = sourceReleaseDir ? undefined : mkdtempSync(join(tmpdir(), "softmatrix-vm-source-"));
  const source = resolve(sourceReleaseDir ?? temporary);
  try {
    if (!sourceReleaseDir) {
      execFileSync(process.execPath, [
        join(ROOT, "scripts/release/build-release.mjs"),
        "--out", source,
        "--release-id", releaseId,
      ], { cwd: ROOT, stdio: "inherit", env: { ...process.env, CI: "true" } });
    }
    const sourceManifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
    mkdirSync(join(output, "modules"), { recursive: true });
    mkdirSync(join(output, "assets"), { recursive: true });
    copyDirectory(join(source, "modules"), join(output, "modules"));
    copyDirectory(join(source, "assets"), join(output, "assets"));
    materializeAssetPaths(sourceManifest, source, output);
    const workers = Object.fromEntries(Object.entries(sourceManifest.workers ?? {})
        .map(([pkgName, worker]) => [pkgName, transformWorker(pkgName, worker)]));
    const manifest = {
      manifestVersion: 1,
      target: "vm",
      releaseId,
      commit,
      createdAt: new Date().toISOString(),
      wranglerVersion: sourceManifest.wranglerVersion,
      workers,
      assets: Object.fromEntries(Object.entries(sourceManifest.assets ?? {})
          .map(([hash, asset]) => [hash, { size: asset.size, localPath: `assets/${hash}` }])),
      runtime: {
        configPath: "runtime/workerd.capnp",
        dataDirectory: "data",
        objectStoreDirectory: "objects",
        assetsDirectory: "assets",
      },
    };
    rejectPlaceholders(manifest);
    mkdirSync(join(output, "runtime"), { recursive: true });
    const runtimeConfig = renderWorkerdConfig(workers);
    writeFileSync(join(output, "runtime", "workerd.capnp"), runtimeConfig);
    writeFileSync(join(output, "manifest.json"), `${stableStringify(manifest)}\n`);
    const legalManifest = buildLegalArtifacts({ rootDir, outDir: output });
    writeChecksums(output);
    return {
      manifest,
      runtimeConfig,
      workers,
      assets: manifest.assets,
      legalManifest,
      outDir: output,
    };
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const commit = args.commit ?? gitCommit();
    const releaseId = args.releaseId ?? `vm-${Math.floor(Date.now() / 1000).toString(36)}`;
    const release = await buildVmRelease({
      outDir: args.out,
      releaseId,
      commit,
      allowDirty: args.allowDirty,
    });
    console.log(`VM release ${release.manifest.releaseId}: ${Object.keys(release.workers).length} workers -> ${args.out}`);
  } catch (error) {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  }
}
