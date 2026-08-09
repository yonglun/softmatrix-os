import { describe, expect, it } from "vitest";
import { classifyModelError, testModelConnection } from "../src/model-policy/test-connection.js";

describe("model credential testing", () => {
  it.each([
    [401, "MODEL_CREDENTIAL_INVALID"],
    [403, "MODEL_CREDENTIAL_INVALID"],
    [402, "MODEL_BALANCE_EXHAUSTED"],
    [429, "MODEL_RATE_LIMITED"],
    [503, "MODEL_PROVIDER_UNAVAILABLE"],
  ] as const)("classifies HTTP %s", (status, code) => {
    expect(classifyModelError(new Error(String(status)))).toBe(code);
  });

  it("returns only a stable redacted result when model setup fails", async () => {
    let result = await testModelConnection({} as Cloudflare.Env,
      { type: "agent", id: "mine", name: "Mine" },
      { provider: "cloudflare", model: "@cf/test", accountId: "account", apiToken: "top-secret" });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("top-secret");
    if (!result.ok) expect(result.error.correlationId).toBeTruthy();
  });
});
