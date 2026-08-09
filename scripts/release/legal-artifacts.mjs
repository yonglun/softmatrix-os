import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const LEGAL_FILENAMES = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"];
export const LEGAL_MANIFEST_FILENAME = "legal-manifest.json";
export const LEGAL_MANIFEST_VERSION = 1;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function legalManifest(files) {
  return {
    schemaVersion: LEGAL_MANIFEST_VERSION,
    files: LEGAL_FILENAMES.map((name) => ({
      filename: name,
      sha256: sha256(files.get(name)),
      size: files.get(name).byteLength,
    })),
  };
}

/** Validate a parsed sidecar against a map of exact legal filenames and bytes. */
export function assertLegalManifest(manifest, files) {
  if (!manifest || manifest.schemaVersion !== LEGAL_MANIFEST_VERSION
      || !Array.isArray(manifest.files)) {
    throw new Error("invalid legal-manifest.json schema");
  }
  const entries = new Map(manifest.files.map((entry) => [entry?.filename, entry]));
  if (entries.size !== LEGAL_FILENAMES.length
      || LEGAL_FILENAMES.some((name) => !entries.has(name))) {
    throw new Error("legal manifest must contain LICENSE, NOTICE, and THIRD_PARTY_NOTICES.md");
  }
  for (const name of LEGAL_FILENAMES) {
    const bytes = files.get(name);
    const entry = entries.get(name);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new Error(`missing or empty legal artifact: ${name}`);
    }
    if (entry.sha256 !== sha256(bytes) || entry.size !== bytes.byteLength) {
      throw new Error(`legal artifact hash/size mismatch: ${name}`);
    }
  }
  return true;
}

/** Copy the exact repository legal files and write their immutable sidecar. */
export function buildLegalArtifacts({ rootDir, outDir }) {
  const root = resolve(rootDir);
  const legalDir = join(resolve(outDir), "legal");
  mkdirSync(legalDir, { recursive: true });
  const files = new Map();
  for (const name of LEGAL_FILENAMES) {
    const source = join(root, name);
    let bytes;
    try {
      if (statSync(source).size === 0) throw new Error("empty");
      bytes = readFileSync(source);
    } catch {
      throw new Error(`missing or empty required legal file: ${source}`);
    }
    if (bytes.byteLength === 0) throw new Error(`missing or empty required legal file: ${source}`);
    files.set(name, bytes);
    writeFileSync(join(legalDir, name), bytes);
  }
  const manifest = legalManifest(files);
  writeFileSync(join(resolve(outDir), LEGAL_MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function readLegalManifest(outDir) {
  return JSON.parse(readFileSync(join(resolve(outDir), LEGAL_MANIFEST_FILENAME), "utf8"));
}

/** Verify a built release before it can be uploaded or promoted. */
export function validateLegalArtifacts(outDir) {
  const root = resolve(outDir);
  const files = new Map(LEGAL_FILENAMES.map((name) => [
    name,
    readFileSync(join(root, "legal", name)),
  ]));
  assertLegalManifest(readLegalManifest(root), files);
  return true;
}

