import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FRONTEND = resolve(ROOT, "packages/workshop-frontend/src");
const RESOURCE_FILES = {
  en: resolve(FRONTEND, "i18n/resources/en.ts"),
  "zh-CN": resolve(FRONTEND, "i18n/resources/zh-CN.ts"),
};
const BASELINE_FILE = resolve(ROOT, "scripts/i18n-coverage-baseline.json");

// Scan every production TSX surface. Tests, samples, code-editor implementations, and resource
// declarations have their own contracts and are intentionally excluded from this UI-copy guard.
const EXCLUDED_DIRECTORY_NAMES = new Set([
  "__tests__", "test", "tests", "samples", "code-editor", "resources",
]);

// A reviewed baseline is preferable to silently ignoring every literal. Each entry uses the exact
// file/kind/text tuple and includes a reason. Existing entries are migration backlog; any new copy
// must be translated or added through review with an explicit reason.
const JSX_LITERAL_ALLOWLIST = new Map();

function sourceFile(path, text) {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function unwrap(expression) {
  while (expression && (
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  )) {
    expression = expression.expression;
  }
  return expression;
}

function propertyName(property) {
  const name = property.name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function resourceObject(file, variableName) {
  let result;
  function visit(node) {
    if (result) return;
    if (ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) && node.name.text === variableName) {
      result = unwrap(node.initializer);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(result && ts.isObjectLiteralExpression(result), `${variableName} resource object not found`);
  return result;
}

function leafPaths(object) {
  const leaves = new Set();
  function walk(node, prefix) {
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        if (ts.isSpreadAssignment(property)) {
          throw new Error(`Unsupported resource spread at ${property.getSourceFile().fileName}:${property.getStart()}`);
        }
        continue;
      }
      const name = propertyName(property);
      assert.ok(name, `Unsupported resource property at ${property.getStart()}`);
      const path = prefix ? `${prefix}.${name}` : name;
      const value = unwrap(property.initializer);
      if (value && ts.isObjectLiteralExpression(value)) walk(value, path);
      else leaves.add(path);
    }
  }
  walk(object, "");
  return leaves;
}

function sortedPaths(values) {
  let result = [];
  for (const value of values) {
    let index = result.findIndex(existing => existing.localeCompare(value) > 0);
    if (index === -1) result.push(value);
    else result.splice(index, 0, value);
  }
  return result;
}

function lineNumber(file, node) {
  return file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

function staticTextParts(expression) {
  if (!expression) return [];
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return [expression.text];
  }
  if (ts.isTemplateExpression(expression)) {
    return [expression.head.text, ...expression.templateSpans.map(span => span.literal.text)];
  }
  if (ts.isBinaryExpression(expression) &&
      [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(expression.operatorToken.kind)) {
    return [...staticTextParts(expression.left), ...staticTextParts(expression.right)];
  }
  if (ts.isConditionalExpression(expression)) {
    return [...staticTextParts(expression.whenTrue), ...staticTextParts(expression.whenFalse)];
  }
  return [];
}

function isPlatformLiteral(text) {
  return /[\p{L}\p{N}]/u.test(text) && !/^https?:\/\//.test(text);
}

function scanSurfaceLiterals(fileName, text) {
  const file = sourceFile(fileName, text);
  const findings = [];
  function add(node, kind, value) {
    if (!isPlatformLiteral(value)) return;
    const line = lineNumber(file, node);
    const key = `${fileName}|${kind}|${value}`;
    if (!JSX_LITERAL_ALLOWLIST.has(key)) findings.push({ fileName, line, kind, value });
  }
  function visit(node) {
    if (ts.isJsxText(node)) {
      const value = node.getText(file).replace(/\s+/g, " ").trim();
      if (value) add(node, "JSX text", value);
    }
    if (ts.isJsxExpression(node) && node.expression &&
        (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      for (const value of staticTextParts(node.expression)) add(node, "JSX expression", value.trim());
    }
    if (ts.isJsxAttribute(node) && node.name &&
        ["aria-label", "title", "placeholder"].includes(node.name.text)) {
      const expression = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
      for (const value of staticTextParts(expression)) add(node, `JSX ${node.name.text}`, value.trim());
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "add") {
      const object = node.arguments[0];
      if (object && ts.isObjectLiteralExpression(object)) {
        for (const property of object.properties) {
          if (!ts.isPropertyAssignment(property) || propertyName(property) !== "title") continue;
          for (const value of staticTextParts(property.initializer)) {
            add(property, "toast title", value.trim());
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return findings;
}

async function productionSurfaceFiles() {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name)) await visit(resolve(directory, entry.name));
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".tsx") ||
          /\.(test|spec)\.tsx$/.test(entry.name)) continue;
      result.push(relative(FRONTEND, resolve(directory, entry.name)));
    }
  }
  await visit(FRONTEND);
  return sortedPaths(result);
}

test("English and Simplified Chinese resources have identical leaf paths", async () => {
  const englishText = await readFile(RESOURCE_FILES.en, "utf8");
  const chineseText = await readFile(RESOURCE_FILES["zh-CN"], "utf8");
  const english = sourceFile(RESOURCE_FILES.en, englishText);
  const chinese = sourceFile(RESOURCE_FILES["zh-CN"], chineseText);
  const englishLeaves = leafPaths(resourceObject(english, "en"));
  const chineseLeaves = leafPaths(resourceObject(chinese, "zhCN"));
  assert.deepEqual(sortedPaths(chineseLeaves), sortedPaths(englishLeaves));
});

test("migrated production surfaces contain no unreviewed platform literals", async () => {
  const baseline = JSON.parse(await readFile(BASELINE_FILE, "utf8"));
  for (const entry of baseline) {
    assert.equal(typeof entry.fileName, "string");
    assert.equal(typeof entry.kind, "string");
    assert.equal(typeof entry.text, "string");
    assert.equal(typeof entry.reason, "string");
    JSX_LITERAL_ALLOWLIST.set(`${entry.fileName}|${entry.kind}|${entry.text}`, entry.reason);
  }
  const findings = [];
  for (const relativeName of await productionSurfaceFiles()) {
    const path = resolve(FRONTEND, relativeName);
    const text = await readFile(path, "utf8");
    findings.push(...scanSurfaceLiterals(relativeName, text));
  }
  assert.deepEqual(findings, []);
});
