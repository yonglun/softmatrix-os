import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "../..");

async function read(relativePath) {
  return readFile(join(ROOT, relativePath), "utf8");
}

test("systemd workerd service is loopback-only", async () => {
  const service = await read("deploy/vm/softmatrix.service");

  assert.match(service, /--socket-addr http=127\.0\.0\.1:8787/);
  assert.doesNotMatch(service, /--socket-addr\s+[^\n]*0\.0\.0\.0/);
  assert.match(service, /NoNewPrivileges=true/);
});

test("release workerd profile is loopback-only", async () => {
  const capnp = await read("scripts/vm/build-release.mjs");

  assert.match(capnp, /address = "127\.0\.0\.1:8787"/);
  assert.doesNotMatch(capnp, /address = "(?:0\.0\.0\.0|\[::\]):/);
});

test("Caddy template terminates HTTPS and proxies only to loopback", async () => {
  const caddy = await read("deploy/vm/Caddyfile.example");

  assert.match(caddy, /https:\/\/\{\$SOFTMATRIX_DOMAIN\}/);
  assert.match(caddy, /reverse_proxy\s+127\.0\.0\.1:8787/);
  assert.match(caddy, /WebSocket/i);
  assert.doesNotMatch(caddy, /reverse_proxy\s+(?:0\.0\.0\.0|\[::\]):/);
});

test("Nginx template preserves WebSocket upgrades to loopback", async () => {
  const nginx = await read("deploy/vm/nginx.conf.example");

  assert.match(nginx, /listen 443 ssl/);
  assert.match(nginx, /proxy_pass\s+http:\/\/127\.0\.0\.1:8787/);
  assert.match(nginx, /proxy_set_header\s+Upgrade\s+\$http_upgrade/);
  assert.match(nginx, /proxy_set_header\s+Connection\s+\$connection_upgrade/);
  assert.match(nginx, /map\s+\$http_upgrade\s+\$connection_upgrade/);
  assert.doesNotMatch(nginx, /proxy_pass\s+http:\/\/(?:0\.0\.0\.0|\[::\]):/);
});
