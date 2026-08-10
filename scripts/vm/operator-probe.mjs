#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";

function loopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function errorCode(error) {
  return error?.code ?? (error instanceof Error ? error.name : "PROBE_FAILED");
}

function websocketHandshake(url, timeoutMs) {
  const secure = url.protocol === "wss:";
  const port = Number(url.port) || (secure ? 443 : 80);
  const path = `${url.pathname || "/"}${url.search}`;
  const key = randomBytes(16).toString("base64");

  return new Promise((resolve) => {
    let settled = false;
    let response = Buffer.alloc(0);
    let timer;
    const socket = secure
      ? tlsConnect({ host: url.hostname, port, servername: url.hostname })
      : netConnect({ host: url.hostname, port });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    timer = setTimeout(() => finish({ ok: false, reason: "TIMEOUT" }), timeoutMs);
    socket.setTimeout(timeoutMs, () => finish({ ok: false, reason: "TIMEOUT" }));
    socket.once("error", error => finish({ ok: false, reason: errorCode(error) }));
    socket.on("data", chunk => {
      response = Buffer.concat([response, chunk]);
      const boundary = response.indexOf("\r\n\r\n");
      if (boundary === -1) return;
      const header = response.subarray(0, boundary).toString("latin1");
      const status = /^HTTP\/\d\.\d\s+(\d{3})/u.exec(header)?.[1];
      finish({ ok: status === "101", status: status ? Number(status) : undefined });
    });
    socket.once(secure ? "secureConnect" : "connect", () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${url.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        "\r\n",
      ].join("\r\n"));
    });
  });
}

/** Probe the public origin and its Cap'n Web RPC WebSocket without sending credentials. */
export async function probePublicEndpoints({
  baseUrl,
  timeoutMs = 5000,
  requireHttps = true,
  fetchImpl = globalThis.fetch,
} = {}) {
  let origin;
  try {
    origin = new URL(baseUrl);
  } catch {
    return { ok: false, checks: [{ name: "https", ok: false, reason: "INVALID_URL" }] };
  }
  if (!origin.hostname || (origin.protocol !== "https:" && origin.protocol !== "http:")) {
    return { ok: false, checks: [{ name: "https", ok: false, reason: "INVALID_URL" }] };
  }
  if (requireHttps && origin.protocol !== "https:") {
    return { ok: false, checks: [{ name: "https", ok: false, reason: "HTTPS_REQUIRED" }] };
  }

  const checks = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(new URL("/", origin), { signal: controller.signal, redirect: "manual" });
    checks.push({ name: "http", ok: response.status >= 200 && response.status < 400, status: response.status });
  } catch (error) {
    checks.push({ name: "http", ok: false, reason: errorCode(error) });
  } finally {
    clearTimeout(timer);
  }

  const websocketUrl = new URL("/api", origin);
  websocketUrl.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
  const websocket = await websocketHandshake(websocketUrl, timeoutMs);
  checks.push({ name: "websocket", ...websocket });
  return { ok: checks.every(check => check.ok), checks };
}

function parseArgs(argv) {
  const args = { baseUrl: undefined, timeoutMs: 5000, requireHttps: true };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--base-url") args.baseUrl = argv[++index];
    else if (argv[index] === "--timeout-ms") args.timeoutMs = Number(argv[++index]);
    else if (argv[index] === "--allow-http-loopback") args.requireHttps = false;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!args.baseUrl) throw new Error("--base-url is required");
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) throw new Error("--timeout-ms must be positive");
  if (!args.requireHttps) {
    const parsed = new URL(args.baseUrl);
    if (parsed.protocol !== "http:" || !loopbackHost(parsed.hostname)) {
      throw new Error("--allow-http-loopback is restricted to http loopback URLs");
    }
  }
  return args;
}

if (process.argv[1]?.endsWith("operator-probe.mjs")) {
  try {
    const result = await probePublicEndpoints(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  }
}
