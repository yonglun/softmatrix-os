import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadVmConfig, validateVmConfig } from "./vm-config.mjs";

async function validEnvironment() {
  const root = await mkdtemp(join(tmpdir(), "softmatrix-vm-config-"));
  const dataDir = join(root, "data");
  const objectStoreDir = join(root, "objects");
  await mkdir(dataDir);
  await mkdir(objectStoreDir);
  return {
    root,
    env: {
      PUBLIC_BASE_URL: "https://softmatrix.example",
      SOFTMATRIX_DATA_DIR: dataDir,
      SOFTMATRIX_OBJECT_STORE_DIR: objectStoreDir,
      OIDC_ISSUER: "https://idp.example",
      OIDC_CLIENT_ID: "softmatrix",
      OIDC_CLIENT_SECRET: "oidc-secret",
      OIDC_ALLOWED_EMAIL_DOMAINS: "Example.com, team.example",
      DISABLE_PASSWORD_AUTH: "false",
      ORG_AI_MODELS: "[]",
      ALLOW_USER_BYOK: "false",
      ADMINS: '["admin@softmatrix.example"]',
    },
  };
}

test("loads and normalizes a valid VM profile without exposing secrets in diagnostics", async () => {
  const fixture = await validEnvironment();
  try {
    const config = loadVmConfig(fixture.env);
    validateVmConfig(config);
    assert.deepEqual(config.oidc.allowedEmailDomains, ["example.com", "team.example"]);
    assert.equal(config.allowUserByok, false);
    assert.deepEqual(config.orgAiModels, []);
    assert.equal(config.diagnostics.oidcClientSecret, undefined);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects password-disabled VM without complete OIDC configuration", async () => {
  const fixture = await validEnvironment();
  try {
    delete fixture.env.OIDC_CLIENT_SECRET;
    fixture.env.DISABLE_PASSWORD_AUTH = "true";
    assert.throws(
        () => validateVmConfig(loadVmConfig(fixture.env)),
        error => error.code === "VM_SECRET_MISSING" && error.message.includes("OIDC_CLIENT_SECRET"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects invalid URL, model JSON, and unsafe Cloudflare production bindings", async () => {
  const fixture = await validEnvironment();
  try {
    fixture.env.PUBLIC_BASE_URL = "http://softmatrix.example";
    assert.throws(
        () => loadVmConfig(fixture.env),
        error => error.code === "VM_CONFIG_INVALID" && error.message.includes("PUBLIC_BASE_URL"));

    fixture.env.PUBLIC_BASE_URL = "https://softmatrix.example";
    fixture.env.ORG_AI_MODELS = "not-json";
    assert.throws(
        () => loadVmConfig(fixture.env),
        error => error.code === "VM_CONFIG_INVALID" && error.message.includes("ORG_AI_MODELS"));

    fixture.env.ORG_AI_MODELS = "[]";
    fixture.env.CF_AI_GATEWAY = "enabled";
    assert.throws(
        () => loadVmConfig(fixture.env),
        error => error.code === "VM_CONFIG_INVALID" && error.message.includes("CF_AI_GATEWAY"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects missing, identical, and relative persistent paths", async () => {
  const fixture = await validEnvironment();
  try {
    fixture.env.SOFTMATRIX_DATA_DIR = "relative/data";
    assert.throws(
        () => validateVmConfig(loadVmConfig(fixture.env)),
        error => error.code === "VM_CONFIG_INVALID" && error.message.includes("SOFTMATRIX_DATA_DIR"));

    fixture.env.SOFTMATRIX_DATA_DIR = fixture.env.SOFTMATRIX_OBJECT_STORE_DIR;
    assert.throws(
        () => validateVmConfig(loadVmConfig(fixture.env)),
        error => error.code === "VM_CONFIG_INVALID" && error.message.includes("must differ"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
