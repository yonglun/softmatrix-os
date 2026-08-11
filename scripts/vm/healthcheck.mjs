#!/usr/bin/env node

function parseHealthcheckArgs(argv) {
  const args = { baseUrl: "http://127.0.0.1:8787", timeoutMs: 5000 };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--") continue;
    if (argv[index] === "--base-url") args.baseUrl = argv[++index];
    else if (argv[index] === "--timeout-ms") args.timeoutMs = Number(argv[++index]);
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return args;
}

export async function healthcheckVm({ baseUrl = "http://127.0.0.1:8787", timeoutMs = 5000 } = {}) {
  const url = new URL("/", baseUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    return {
      ok: response.status >= 200 && response.status < 400,
      checks: [{ name: "http", ok: response.status >= 200 && response.status < 400,
        status: response.status }],
    };
  } catch (error) {
    return {
      ok: false,
      checks: [{ name: "http", ok: false, error: error instanceof Error ? error.message : String(error) }],
    };
  } finally {
    clearTimeout(timer);
  }
}

if (process.argv[1]?.endsWith("healthcheck.mjs")) {
  try {
    const result = await healthcheckVm(parseHealthcheckArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  }
}

export { parseHealthcheckArgs };
