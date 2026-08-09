#!/usr/bin/env node

import { createServer } from "node:http";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = resolve(join(fileURLToPath(import.meta.url), "../.."));
const stateDir = mkdtempSync(join(tmpdir(), "softmatrix-e2e-"));
const fixtureSecret = "fixture-model-secret";
let child;
let provider;
let stopping = false;

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function writeResponsesStream(response, text) {
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
  return new Promise((resolveProvider) => {
    provider = createServer((request, response) => {
      if (request.method === "GET") {
        writeJson(response, 200, { object: "fixture-provider", status: "ok" });
        return;
      }
      if (request.method !== "POST") {
        writeJson(response, 405, { error: { message: "method not allowed" } });
        return;
      }
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = {}; }
        const input = parsed.input?.at(-1);
        const prompt = typeof input === "string"
          ? input
          : input?.content?.find((part) => part.type === "input_text")?.text ?? "hello";
        writeResponsesStream(response, `Fixture response: ${prompt}`);
      });
    });
    provider.listen(0, "127.0.0.1", () => resolveProvider(provider.address().port));
  });
}

function stop() {
  if (stopping) return;
  stopping = true;
  if (child && !child.killed) child.kill("SIGTERM");
  if (provider) provider.close();
  try {
    const resolved = realpathSync(stateDir);
    if (resolved.startsWith(join(tmpdir(), "softmatrix-e2e-"))) rmSync(resolved, { recursive: true, force: true });
  } catch {
    // The temporary directory may already have been removed by the runtime.
  }
}

const providerPort = await startProvider();
const env = {
  ...process.env,
  DEV: "1",
  SOFTMATRIX_E2E: "1",
  PUBLIC_BASE_URL: "http://127.0.0.1:8787",
  ALLOW_USER_BYOK: "false",
  ORG_AI_MODELS: JSON.stringify([{
    id: "fixture-model",
    name: "Fixture Model",
    provider: "openai",
    model: "fixture-model",
    apiUrl: `http://127.0.0.1:${providerPort}/v1`,
    apiToken: fixtureSecret,
    contextWindow: 16_384,
  }]),
};

child = spawn(process.execPath, [join(ROOT, "scripts/run-local.mjs"), `--persist-to=${stateDir}`], {
  cwd: ROOT,
  env,
  stdio: "inherit",
});

process.on("SIGINT", () => { stop(); process.exit(130); });
process.on("SIGTERM", () => { stop(); process.exit(143); });
child.on("exit", (code, signal) => {
  stop();
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
