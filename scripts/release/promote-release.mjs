#!/usr/bin/env node

// Promotes an e2e-verified candidate release: copies candidates/<id>/manifest.json to
// releases/<id>/manifest.json. The blobs are already in place — content-addressed and uploaded
// by upload-release.mjs before its manifest PUT — so publishing is this single manifest copy.
// The copy is all-or-nothing (manifest-last protocol: the deploy service scans only releases/),
// but NOT isolated: the newer-release guard below is check-then-act, so concurrent promotions
// could still interleave between its LIST and the copy. The caller must serialize runs of this
// script — gadgets-internal's CI runs it in a resource group — and the guard then catches the
// remaining hazard, a promote that starts after a newer release has already published.
//
// Exit-0 guards (benign races must not fail the pipeline):
//   - already promoted: releases/<id>/manifest.json exists (idempotent re-runs)
//   - superseded: a CI-format id (r<run#>-<sha>) with a HIGHER run number already exists under
//     releases/. "Latest" is decided by manifest upload time (deploy's release.ts), so promoting
//     an older candidate after a newer one shipped would ROLL PRODUCTION BACK — the stale PUT
//     would carry the newest timestamp.
//
// A missing candidate manifest is a hard error: the caller asked to promote something that was
// never uploaded (or was cleaned up), and silently succeeding would report a phantom publish.
//
// Env: R2_ENDPOINT (https://<account>.r2.cloudflarestorage.com), R2_BUCKET,
//      R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
// Usage: node scripts/release/promote-release.mjs --release-id <id>

import { pathToFileURL } from "node:url";
import { AwsClient } from "aws4fetch";
import { LEGAL_FILENAMES, LEGAL_MANIFEST_FILENAME, assertLegalManifest } from "./legal-artifacts.mjs";

/** The CI run number of an `r<run#>-<sha>` release id, or null for any other id shape
 *  (dev-<ts> releases carry no ordering claim). */
export function ciRunNumber(releaseId) {
  const match = /^r(\d+)-/.exec(releaseId);
  return match ? Number(match[1]) : null;
}

/** The already-published CI release id that supersedes this candidate, or null. Non-CI ids
 *  (either side) never participate: only run numbers are comparable. */
export function supersededBy(candidateId, publishedIds) {
  const candidateRun = ciRunNumber(candidateId);
  if (candidateRun === null) return null;
  for (const id of publishedIds) {
    const run = ciRunNumber(id);
    if (run !== null && run > candidateRun) return id;
  }
  return null;
}

async function getObjectBytes(client, keyUrl, key) {
  const response = await client.fetch(keyUrl(key), { method: "GET" });
  if (response.status === 404) throw new Error(`required candidate object not found: ${key}`);
  if (!response.ok) throw new Error(`GET ${key}: ${response.status} ${await response.text()}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function copyOrPut(client, keyUrl, bucket, sourceKey, targetKey, body, contentType) {
  const copy = await client.fetch(keyUrl(targetKey), {
    method: "PUT",
    headers: {
      "x-amz-copy-source": `/${bucket}/${sourceKey}`,
      "Content-Type": contentType,
    },
  });
  if (copy.ok && (await copy.text()).includes("<CopyObjectResult")) return "copy";
  const put = await client.fetch(keyUrl(targetKey), {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType },
  });
  if (!put.ok) throw new Error(`PUT ${targetKey}: ${put.status} ${await put.text()}`);
  return "put";
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function parseArgs(argv) {
  const args = { releaseId: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--release-id") args.releaseId = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!args.releaseId) throw new Error("--release-id <id> is required");
  return args;
}

// Key names only (paginated ListObjectsV2, 1000 keys per round trip); manifest bodies are
// never fetched.
async function listPublishedReleaseIds(client, keyUrl) {
  const ids = [];
  let token;
  do {
    const params = new URLSearchParams({ "list-type": "2", prefix: "releases/" });
    if (token) params.set("continuation-token", token);
    const response = await client.fetch(`${keyUrl("")}?${params}`, { method: "GET" });
    if (!response.ok) {
      throw new Error(`ListObjectsV2: ${response.status} ${await response.text()}`);
    }
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>releases\/([^<]+)\/manifest\.json<\/Key>/g)) {
      ids.push(match[1]);
    }
    token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1];
  } while (token);
  return ids;
}

export async function promoteRelease({ releaseId, client, endpoint, bucket }) {
  const targetEndpoint = (endpoint ?? requireEnv("R2_ENDPOINT")).replace(/\/$/, "");
  const targetBucket = bucket ?? requireEnv("R2_BUCKET");
  const r2 = client ?? new AwsClient({
    accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    service: "s3",
    region: "auto",
  });
  const keyUrl = (key) => `${targetEndpoint}/${targetBucket}/${key}`;

  const publishedKey = `releases/${releaseId}/manifest.json`;
  const candidateKey = `candidates/${releaseId}/manifest.json`;

  const publishedHead = await r2.fetch(keyUrl(publishedKey), { method: "HEAD" });
  if (publishedHead.status === 200) {
    console.log(`already promoted: ${publishedKey}`);
    return;
  }
  if (publishedHead.status !== 404) {
    throw new Error(`HEAD ${publishedKey}: unexpected status ${publishedHead.status}`);
  }

  const candidate = await r2.fetch(keyUrl(candidateKey), { method: "GET" });
  if (candidate.status === 404) {
    throw new Error(`candidate not found: ${candidateKey} — was the release uploaded ` +
      "with --candidate?");
  }
  if (!candidate.ok) {
    throw new Error(`GET ${candidateKey}: ${candidate.status} ${await candidate.text()}`);
  }
  const manifestBody = new Uint8Array(await candidate.arrayBuffer());

  const candidatePrefix = `candidates/${releaseId}`;
  const legalManifestKey = `${candidatePrefix}/${LEGAL_MANIFEST_FILENAME}`;
  const legalManifestBody = await getObjectBytes(r2, keyUrl, legalManifestKey);
  let legalManifest;
  try {
    legalManifest = JSON.parse(new TextDecoder().decode(legalManifestBody));
  } catch {
    throw new Error(`invalid candidate legal manifest: ${legalManifestKey}`);
  }
  const legalBodies = new Map();
  for (const name of LEGAL_FILENAMES) {
    legalBodies.set(name, await getObjectBytes(r2, keyUrl, `${candidatePrefix}/legal/${name}`));
  }
  assertLegalManifest(legalManifest, legalBodies);

  const superseder = supersededBy(releaseId, await listPublishedReleaseIds(r2, keyUrl));
  if (superseder) {
    console.warn(`WARNING: not promoting ${releaseId} — a newer release ` +
      `(${superseder}) is already published; promoting now would roll the deploy ` +
      "service back to this older candidate.");
    return;
  }

  let mode = "copy";
  for (const name of LEGAL_FILENAMES) {
    mode = await copyOrPut(
      r2,
      keyUrl,
      targetBucket,
      `${candidatePrefix}/legal/${name}`,
      `releases/${releaseId}/legal/${name}`,
      legalBodies.get(name),
      "text/plain",
    );
  }
  mode = await copyOrPut(
    r2,
    keyUrl,
    targetBucket,
    legalManifestKey,
    `releases/${releaseId}/${LEGAL_MANIFEST_FILENAME}`,
    legalManifestBody,
    "application/json",
  );
  mode = await copyOrPut(
    r2,
    keyUrl,
    targetBucket,
    candidateKey,
    publishedKey,
    manifestBody,
    "application/json",
  );
  console.log(`promoted (${mode}): ${candidateKey} -> ${publishedKey}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  await promoteRelease({ releaseId: args.releaseId });
}
