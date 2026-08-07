import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".superpowers",
  ".wrangler",
  "dist",
  "node_modules",
]);

const EXPECTED_UPSTREAM_REFERENCES = new Map([
  ["NOTICE", [
    "This product is derived from Cloudflare OS:",
    "Cloudflare OS is licensed under the Apache License, Version 2.0. Softmatrix OS retains",
  ]],
  ["README.md", [
    "[Cloudflare OS](https://github.com/cloudflare/cloudflare-os). It retains the upstream",
    "The upstream Cloudflare OS project is an \"operating system\" for AI productivity originally",
    "![An upstream Cloudflare OS Q3 planning workspace with an AI-generated slide deck](docs/images/q3-planning-workspace.png)",
    "The underlying architecture originated in Cloudflare OS and was built by the team that built Workers itself. Dynamic Workers, Facets, and several other runtime features were added specifically to support that upstream project. Softmatrix OS preserves this architecture while maintaining a clear, independent product identity.",
    "Cloudflare OS project, not this Softmatrix OS fork. Softmatrix-specific production deployment",
  ]],
  ["README.zh-CN.md", [
    "Softmatrix OS 是基于 [Cloudflare OS](https://github.com/cloudflare/cloudflare-os) 派生的独立发行版。它保留上游的 [Apache License 2.0](LICENSE) 许可证及 [NOTICE](NOTICE) 中记录的归属信息。Softmatrix OS 不隶属于 Cloudflare，也未获得 Cloudflare 的赞助或背书。",
    "上游 Cloudflare OS 项目是一个最初为 Cloudflare 内部开发的 AI 生产力“操作系统”。Softmatrix OS 延续这一架构，作为独立 fork，面向希望自行部署和定制平台的组织。",
    "![上游 Cloudflare OS Q3 规划工作区及 AI 生成的演示文稿](docs/images/q3-planning-workspace.png)",
    "底层架构源自 Cloudflare OS，由构建 Workers 的团队设计。Dynamic Workers、Facets 和其他运行时能力，都是为了支持上游项目而加入的。Softmatrix OS 保留了这套架构，同时维护清晰、独立的产品身份。",
    "Cloudflare 的[托管部署流程](https://os.cloudflare.app/deploy)和[部署启动模板](https://github.com/cloudflare/cloudflare-os-starter)面向上游 Cloudflare OS 项目，而不是本 Softmatrix OS fork。Softmatrix 专属的生产部署说明会在首个正式版本发布前提供。请不要误以为这些上游流程会部署本仓库中的修改。",
  ]],
  ["docs/upstream-sync.md", [
    "# Synchronizing with Cloudflare OS",
    "Softmatrix OS is derived from [Cloudflare OS](https://github.com/cloudflare/cloudflare-os)",
  ]],
]);

const PRODUCTION_SITE_LOGO_FILES = [
  "packages/workshop-frontend/src/AdminPage.tsx",
  "packages/workshop-frontend/src/GadgetEditor.tsx",
  "packages/workshop-frontend/src/GadgetUseView.tsx",
  "packages/workshop-frontend/src/LoginPage.tsx",
  "packages/workshop-frontend/src/OnboardingWizard.tsx",
  "packages/workshop-frontend/src/SignupPage.tsx",
  "packages/workshop-frontend/src/components/AppShell/Sidebar.tsx",
  "packages/workshop-frontend/src/components/Header.tsx",
];

async function repositoryFiles(directory = ROOT) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await repositoryFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function repositoryPath(path) {
  return relative(ROOT, path).replaceAll("\\", "/");
}

test("Cloudflare OS appears only in exact factual attribution", async () => {
  const actual = new Map();
  for (const path of await repositoryFiles()) {
    const name = repositoryPath(path);
    if (name.startsWith("docs/superpowers/") || name.startsWith("scripts/")) continue;
    const content = await readFile(path, "utf8").catch(() => "");
    if (content.includes("\0")) continue;
    const matches = content.split(/\r?\n/).filter(line => line.includes("Cloudflare OS"));
    if (matches.length > 0) actual.set(name, matches);
  }

  assert.deepEqual(actual, EXPECTED_UPSTREAM_REFERENCES);
});

test("runtime product copy consumes centralized metadata", async () => {
  const unexpected = [];
  const packagesRoot = resolve(ROOT, "packages");
  for (const path of await repositoryFiles(packagesRoot)) {
    const name = repositoryPath(path);
    if (!/\.(?:ts|tsx)$/.test(name) || /(?:^|\/)product\.ts$/.test(name) || /\.test\./.test(name)) {
      continue;
    }
    const content = await readFile(path, "utf8");
    if (content.includes("Softmatrix OS")) unexpected.push(name);
  }

  assert.deepEqual(unexpected, []);
});

test("every production SiteLogo call site supplies the Softmatrix mark", async () => {
  for (const name of PRODUCTION_SITE_LOGO_FILES) {
    const source = await readFile(resolve(ROOT, name), "utf8");
    assert.match(source, /import SoftmatrixMark from /, `${name} must import SoftmatrixMark`);
    assert.match(
      source,
      /<SiteLogo\b[^>]*>[\s\S]*?<SoftmatrixMark\b[\s\S]*?<\/SiteLogo>/,
      `${name} must use SoftmatrixMark as the SiteLogo fallback`,
    );
  }
});
