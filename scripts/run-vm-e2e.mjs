#!/usr/bin/env node

import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { buildVmRelease } from "./vm/build-release.mjs";

const ROOT = resolve(join(fileURLToPath(import.meta.url), "../.."));
const baseUrl = process.env.SOFTMATRIX_E2E_BASE_URL ?? "http://127.0.0.1:8787";
const port = Number(new URL(baseUrl).port || 8787);
const controlPort = Number(process.env.SOFTMATRIX_VM_CONTROL_PORT ?? 9797);
const fixtureSecret = "fixture-model-secret";
const stateDir = resolve(process.env.SOFTMATRIX_VM_STATE_DIR ?? mkdtempSync(join(tmpdir(), "softmatrix-vm-e2e-")));
const ownsState = !process.env.SOFTMATRIX_VM_STATE_DIR;
const releaseDir = resolve(process.env.SOFTMATRIX_VM_RELEASE_DIR ?? join(stateDir, "release"));
function defaultWorkerdBinary() {
  const pnpmDirectory = join(ROOT, "node_modules", ".pnpm");
  const nativePackage = readdirSync(pnpmDirectory).find(name => name.startsWith("@cloudflare+workerd-"));
  if (nativePackage) {
    const packageName = nativePackage.slice("@cloudflare+".length).split("@")[0];
    const native = join(pnpmDirectory, nativePackage, "node_modules", "@cloudflare", packageName, "bin", "workerd");
    if (existsSync(native)) return native;
  }
  return join(ROOT, "node_modules", ".pnpm", "workerd@1.20260801.1", "node_modules", "workerd", "bin", "workerd");
}

const workerd = process.env.WORKERD_BIN ?? defaultWorkerdBinary();

let provider;
let child;
const runtimeProcesses = new Set();
let stopping = false;
let restarting = false;

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function responseStream(response, text) {
  const message = {
    id: "fixture-message",
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  const completed = {
    id: "fixture-response",
    status: "completed",
    output: [message],
    usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
  };
  const events = [
    { type: "response.created", response: { id: completed.id, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...message, content: [] } },
    { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text },
    { type: "response.output_item.done", output_index: 0, item: message },
    { type: "response.completed", response: completed },
  ];
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
  response.end();
}

function startProvider() {
  return new Promise((resolvePort) => {
    provider = createServer((request, response) => {
      if (request.method === "GET") return json(response, 200, { object: "fixture-provider", status: "ok" });
      if (request.method !== "POST") return json(response, 405, { error: { message: "method not allowed" } });
      let body = "";
      request.setEncoding("utf8");
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = {}; }
        const input = parsed.input?.at(-1);
        const prompt = typeof input === "string"
          ? input
          : input?.content?.find(part => part.type === "input_text")?.text ?? "hello";
        responseStream(response, `Fixture response: ${prompt}`);
      });
    });
    provider.listen(0, "127.0.0.1", () => resolvePort(provider.address().port));
  });
}

function sanitize(value) {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
}

function ensureState() {
  mkdirSync(join(stateDir, "data", "kv"), { recursive: true });
  mkdirSync(join(stateDir, "objects", "r2"), { recursive: true });
}

async function ensureRelease() {
  if (process.env.SOFTMATRIX_VM_RELEASE_DIR) return;
  await buildVmRelease({
    outDir: releaseDir,
    releaseId: `e2e-${Date.now().toString(36)}`,
    allowDirty: true,
  });
}

function runtimeEnvironment(providerPort) {
  const manifest = JSON.parse(readFileSync(join(releaseDir, "manifest.json"), "utf8"));
  const environment = {
    ...process.env,
    DEV: "1",
    SOFTMATRIX_E2E: "1",
    PUBLIC_BASE_URL: baseUrl,
    ADMINS: "[]",
    ORG_AI_MODELS: JSON.stringify([{
      id: "fixture-model",
      name: "Fixture Model",
      provider: "openai",
      model: "fixture-model",
      apiUrl: `http://127.0.0.1:${providerPort}/v1`,
      apiToken: fixtureSecret,
      contextWindow: 16_384,
    }]),
    ALLOW_USER_BYOK: "false",
    DISABLE_PASSWORD_AUTH: "false",
  };
  for (const [pkgName, worker] of Object.entries(manifest.workers ?? {})) {
    for (const value of Object.values(worker.vars ?? {})) {
      if (value?.fromEnvironment === "PUBLIC_BASE_URL" && value.suffix) {
        environment[`SOFTMATRIX_BASE_URL_${sanitize(pkgName)}`] = `${baseUrl}${value.suffix}`;
      }
    }
  }
  return { environment, manifest };
}

function runtimeArgs(manifest) {
  const args = [
    "serve", "--experimental", join(releaseDir, manifest.runtime.configPath), "config",
    "--directory-path", `data=${join(stateDir, "data")}`,
    "--directory-path", `objects=${join(stateDir, "objects")}`,
    "--directory-path", `softmatrix-assets=${join(releaseDir, manifest.runtime.assetsDirectory)}`,
  ];
  const adapters = manifest.runtime.storageAdapters?.miniflareLocal;
  if (adapters?.kvDirectory) args.push("--directory-path", `softmatrix-kv-storage=${join(stateDir, adapters.kvDirectory)}`);
  if (adapters?.r2Directory) args.push("--directory-path", `softmatrix-r2-storage=${join(stateDir, adapters.r2Directory)}`);
  args.push("--socket-addr", `http=127.0.0.1:${port}`);
  return args;
}

function spawnRuntime(providerPort) {
  const { environment, manifest } = runtimeEnvironment(providerPort);
  const runtime = spawn(workerd, runtimeArgs(manifest), {
    cwd: releaseDir,
    env: environment,
    stdio: "inherit",
  });
  child = runtime;
  runtimeProcesses.add(runtime);
  runtime.on("exit", (code, signal) => {
    runtimeProcesses.delete(runtime);
    if (child === runtime) child = undefined;
    if (!stopping && !restarting) {
      console.error(`VM workerd exited unexpectedly (${code ?? signal})`);
      void stop().finally(() => process.exit(1));
    }
  });
}

async function waitForRuntime(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidate = child;
    if (!candidate || candidate.exitCode !== null) {
      throw new Error("workerd exited before becoming ready");
    }
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) });
      await response.body?.cancel();
      if (response.status < 500) {
        // A previous runtime may still answer during a restart. Require the newly spawned
        // child to remain alive for one scheduling turn before declaring readiness.
        await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
        if (child === candidate && candidate.exitCode === null) return;
      }
    } catch {
      // Runtime is still starting.
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 150));
  }
  throw new Error(`workerd did not become ready at ${baseUrl}`);
}

async function waitForRuntimeUnavailable(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(500) });
      await response.body?.cancel();
    } catch {
      return;
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  return false;
}

async function stopRuntime() {
  const processesToStop = [...runtimeProcesses];
  await Promise.all(processesToStop.map(processToStop => new Promise(resolvePromise => {
    if (processToStop.exitCode !== null) {
      resolvePromise();
      return;
    }
    const timer = setTimeout(() => {
      processToStop.kill("SIGKILL");
      resolvePromise();
    }, 5_000);
    processToStop.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
    processToStop.kill("SIGTERM");
  })));
  await waitForRuntimeUnavailable();
}

async function startRuntime(providerPort) {
  const previousTransition = restarting;
  restarting = true;
  let lastError;
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      spawnRuntime(providerPort);
      try {
        await waitForRuntime();
        return;
      } catch (error) {
        lastError = error;
        await stopRuntime();
        await new Promise(resolvePromise => setTimeout(resolvePromise, 250 * (attempt + 1)));
      }
    }
    throw lastError ?? new Error("workerd failed to start");
  } finally {
    restarting = previousTransition;
  }
}

async function restartRuntime(providerPort) {
  restarting = true;
  try {
    await stopRuntime();
    await startRuntime(providerPort);
  } finally {
    restarting = false;
  }
}

function startControlServer(providerPort) {
  const control = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") return json(response, 200, { ok: Boolean(child) });
    if (request.method === "POST" && request.url === "/restart") {
      try {
        await restartRuntime(providerPort);
        return json(response, 200, { ok: true });
      } catch (error) {
        return json(response, 500, { ok: false, error: String(error?.message ?? error) });
      }
    }
    return json(response, 404, { error: "not found" });
  });
  control.listen(controlPort, "127.0.0.1");
  return control;
}

const providerPort = await startProvider();
ensureState();
await ensureRelease();
const control = startControlServer(providerPort);
await startRuntime(providerPort);

async function stop() {
  if (stopping) return;
  stopping = true;
  control.close();
  await stopRuntime();
  provider.close();
  if (ownsState) rmSync(stateDir, { recursive: true, force: true });
}

process.on("SIGINT", async () => { await stop(); process.exit(130); });
process.on("SIGTERM", async () => { await stop(); process.exit(143); });
