#!/usr/bin/env node

// Mirrors a built release directory (see build-release.mjs) to R2 via the S3 API.
//
// Blobs are content-addressed, so unchanged files dedupe across releases: each key is HEAD'd
// first and skipped if present. The manifest is uploaded LAST — its presence under
// releases/<id>/manifest.json is what marks a release complete, so a crashed upload never
// leaves a manifest pointing at missing blobs.
//
// With --candidate the manifest lands under candidates/<id>/manifest.json instead — invisible
// to the deploy service (which scans only releases/) until promote-release.mjs copies it over
// after the e2e gate passes. Blob handling is identical either way.
//
// Env: R2_ENDPOINT (https://<account>.r2.cloudflarestorage.com), R2_BUCKET,
//      R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
// Usage: node scripts/release/upload-release.mjs --release <dir> [--candidate]

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AwsClient } from "aws4fetch";
import { assetR2Key, moduleR2Key } from "./manifest-lib.mjs";
import {
  LEGAL_FILENAMES, LEGAL_MANIFEST_FILENAME, validateLegalArtifacts,
} from "./legal-artifacts.mjs";

const UPLOAD_CONCURRENCY = 8;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function parseArgs(argv) {
  const args = { release: undefined, candidate: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--release") args.release = resolve(argv[++i]);
    else if (argv[i] === "--candidate") args.candidate = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!args.release) throw new Error("--release <dir> is required");
  return args;
}

function createClient() {
  return new AwsClient({
    accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    service: "s3",
    region: "auto",
  });
}

export async function uploadRelease({ release, candidate = false, client, endpoint, bucket }) {
  const releaseDir = resolve(release);
  validateLegalArtifacts(releaseDir);
  const manifest = JSON.parse(readFileSync(join(releaseDir, "manifest.json"), "utf8"));
  const targetEndpoint = (endpoint ?? requireEnv("R2_ENDPOINT")).replace(/\/$/, "");
  const targetBucket = bucket ?? requireEnv("R2_BUCKET");
  const r2 = client ?? createClient();
  const keyUrl = (key) => `${targetEndpoint}/${targetBucket}/${key}`;

  const blobs = [
    ...readdirSync(join(releaseDir, "modules")).map((sha256) => ({
      key: moduleR2Key(sha256),
      path: join(releaseDir, "modules", sha256),
    })),
    ...readdirSync(join(releaseDir, "assets")).map((hash) => ({
      key: assetR2Key(hash),
      path: join(releaseDir, "assets", hash),
    })),
  ];

  let uploaded = 0;
  let skipped = 0;
  const queue = [...blobs];
  async function worker() {
    for (;;) {
      const blob = queue.shift();
      if (!blob) return;
      const head = await r2.fetch(keyUrl(blob.key), { method: "HEAD" });
      if (head.status === 200) {
        skipped++;
        continue;
      }
      if (head.status !== 404) {
        throw new Error(`HEAD ${blob.key}: unexpected status ${head.status}`);
      }
      const put = await r2.fetch(keyUrl(blob.key), {
        method: "PUT",
        body: readFileSync(blob.path),
      });
      if (!put.ok) {
        throw new Error(`PUT ${blob.key}: ${put.status} ${await put.text()}`);
      }
      uploaded++;
    }
  }
  await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
  console.log(`blobs: ${uploaded} uploaded, ${skipped} already present`);

  const prefix = `${candidate ? "candidates" : "releases"}/${manifest.releaseId}`;
  // Legal objects are deliberately sequential and precede the release manifest. This keeps
  // manifest-last visibility while making every candidate self-contained for audit/rollback.
  for (const name of LEGAL_FILENAMES) {
    const key = `${prefix}/legal/${name}`;
    const putLegal = await r2.fetch(keyUrl(key), {
      method: "PUT",
      body: readFileSync(join(releaseDir, "legal", name)),
    });
    if (!putLegal.ok) throw new Error(`PUT ${key}: ${putLegal.status} ${await putLegal.text()}`);
  }
  const legalManifestKey = `${prefix}/${LEGAL_MANIFEST_FILENAME}`;
  const putLegalManifest = await r2.fetch(keyUrl(legalManifestKey), {
    method: "PUT",
    body: readFileSync(join(releaseDir, LEGAL_MANIFEST_FILENAME)),
    headers: { "Content-Type": "application/json" },
  });
  if (!putLegalManifest.ok) {
    throw new Error(`PUT ${legalManifestKey}: ${putLegalManifest.status} ${await putLegalManifest.text()}`);
  }

  const manifestKey = `${prefix}/manifest.json`;
  const put = await r2.fetch(keyUrl(manifestKey), {
    method: "PUT",
    body: readFileSync(join(releaseDir, "manifest.json")),
    headers: { "Content-Type": "application/json" },
  });
  if (!put.ok) {
    throw new Error(`PUT ${manifestKey}: ${put.status} ${await put.text()}`);
  }
  console.log(candidate
    ? `candidate uploaded (not yet visible to the deploy service): ${manifestKey}`
    : `release complete: ${manifestKey}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  await uploadRelease({ release: args.release, candidate: args.candidate });
}
