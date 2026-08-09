import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GENERATED_DATA_PREFIX = "softmatrix-workerd-smoke-";

function findWorkerd() {
  if (process.env.WORKERD_BIN) return process.env.WORKERD_BIN;
  const linked = join(ROOT, "node_modules", ".pnpm", "node_modules", "workerd", "bin", "workerd");
  if (existsSync(linked)) return linked;
  const pnpmDir = join(ROOT, "node_modules", ".pnpm");
  for (const entry of readdirSync(pnpmDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("workerd@")) continue;
    const candidate = join(pnpmDir, entry.name, "node_modules", "workerd", "bin", "workerd");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("WORKERD_NOT_FOUND");
}

function assertGeneratedDataDir(dataDir) {
  const resolved = resolve(dataDir);
  if (!resolved.split("/").at(-1)?.startsWith(GENERATED_DATA_PREFIX)) {
    throw new Error("WORKERD_SMOKE_DATA_PATH_UNSAFE");
  }
  return resolved;
}

function startWorkerd({ configPath, dataDir, port }) {
  const child = spawn(findWorkerd(), [
    "serve", configPath, "config",
    "--directory-path", `data=${dataDir}`,
    "--socket-addr", `http=127.0.0.1:${port}`,
  ], {
    cwd: dirname(configPath),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  return { child, getOutput: () => output };
}

async function waitForResponse(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      return response;
    } catch (error) {
      lastError = error;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
    }
  }
  throw new Error(`WORKERD_START_TIMEOUT: ${lastError?.message ?? "no response"}`);
}

async function stopWorkerd(running) {
  if (running.child.exitCode !== null) return;
  running.child.kill("SIGTERM");
  await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      running.child.kill("SIGKILL");
      reject(new Error(`WORKERD_STOP_TIMEOUT: ${running.getOutput()}`));
    }, 5_000);
    running.child.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}

/** Start a real standalone workerd twice against one persistent directory. */
export async function runWorkerdSmoke({ configPath, dataDir, port }) {
  const safeDataDir = assertGeneratedDataDir(dataDir);
  const url = `http://127.0.0.1:${port}/`;
  let running = startWorkerd({ configPath, dataDir: safeDataDir, port });
  try {
    const initial = await waitForResponse(url);
    if (!initial.ok) throw new Error(`WORKERD_READINESS_FAILED: ${initial.status}`);
    const first = await fetch(url, { method: "POST" });
    if (!first.ok) throw new Error(`WORKERD_WRITE_FAILED: ${first.status}`);
    const firstBody = await first.text();
    if (firstBody !== "counter=1") throw new Error(`WORKERD_FIRST_WRITE_FAILED: ${firstBody}`);
    await stopWorkerd(running);

    running = startWorkerd({ configPath, dataDir: safeDataDir, port });
    const second = await waitForResponse(url);
    const persistedBody = await second.text();
    if (persistedBody !== "counter=1") {
      throw new Error(`WORKERD_PERSISTENCE_FAILED: ${persistedBody}`);
    }
    const final = await fetch(url, { method: "POST" });
    const body = await final.text();
    return { status: final.status, body, persisted: persistedBody === "counter=1" };
  } finally {
    await stopWorkerd(running).catch(() => {});
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [configPath, dataDir, port = "8788"] = process.argv.slice(2);
  if (!configPath || !dataDir) {
    console.error("Usage: node scripts/vm/workerd-smoke.mjs <config.capnp> <data-dir> [port]");
    process.exitCode = 2;
  } else {
    runWorkerdSmoke({ configPath, dataDir, port: Number(port) })
        .then(result => console.log(JSON.stringify(result)))
        .catch(error => {
          console.error(error.stack ?? error);
          process.exitCode = 1;
        });
  }
}
