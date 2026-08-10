import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { probePublicEndpoints } from "./operator-probe.mjs";

function fixtureServer({ websocket = true } = {}) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });
  if (websocket) {
    server.on("upgrade", (_request, socket) => {
      socket.write([
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        "\r\n",
      ].join("\r\n"));
      socket.end();
    });
  }
  return server;
}

async function listen(server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("probes the public HTTP and WebSocket endpoints without credentials", async () => {
  const server = fixtureServer();
  const baseUrl = await listen(server);
  try {
    const result = await probePublicEndpoints({ baseUrl, requireHttps: false });
    assert.equal(result.ok, true);
    assert.deepEqual(result.checks.map(check => check.name), ["http", "websocket"]);
    assert.equal(result.checks[0].status, 200);
    assert.equal(result.checks[1].status, 101);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("rejects a public HTTP origin when HTTPS is required", async () => {
  const server = fixtureServer();
  const baseUrl = await listen(server);
  try {
    const result = await probePublicEndpoints({ baseUrl });
    assert.equal(result.ok, false);
    assert.deepEqual(result.checks, [{ name: "https", ok: false, reason: "HTTPS_REQUIRED" }]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("reports a WebSocket upgrade failure separately from HTTP health", async () => {
  const server = fixtureServer({ websocket: false });
  const baseUrl = await listen(server);
  try {
    const result = await probePublicEndpoints({ baseUrl, requireHttps: false, timeoutMs: 500 });
    assert.equal(result.ok, false);
    assert.equal(result.checks[0].ok, true);
    assert.equal(result.checks[1].ok, false);
    assert.equal(result.checks[1].name, "websocket");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
