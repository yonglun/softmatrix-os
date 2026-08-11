import { test } from "node:test";
import assert from "node:assert/strict";

import { parseHealthcheckArgs } from "./healthcheck.mjs";

test("accepts pnpm's argument separator before healthcheck options", () => {
  assert.deepEqual(
      parseHealthcheckArgs(["--", "--base-url", "https://os.softmatrix.io"]),
      { baseUrl: "https://os.softmatrix.io", timeoutMs: 5000 },
  );
});
