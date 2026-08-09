import { describe, expect, it } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import type { OidcLoginDurableObject } from "../src/auth/oidc-login.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_OIDC_LOGIN: DurableObjectNamespace<OidcLoginDurableObject>;
  }
}

type AttemptState = {
  request: { codeVerifier: string; nonce: string; createdAt: number; state: string };
  completed: boolean;
};

describe("OIDC login attempt durable object", () => {
  it("persists one failure result for the waiting browser", async () => {
    const stub = env.TEST_OIDC_LOGIN.getByName("replay");
    await runInDurableObject(stub, async instance => {
      const durable = instance as unknown as {
        ctx: DurableObjectState;
        complete(callbackUrl: string): Promise<{ ok: boolean; error?: { code: string } }>;
        awaitResult(): Promise<{ ok: boolean; error?: { code: string } }>;
      };
      await durable.ctx.storage.put<AttemptState>("oidc-attempt", {
        request: {
          codeVerifier: "verifier",
          nonce: "nonce",
          createdAt: Date.now(),
          state: durable.ctx.id.toString(),
        },
        completed: false,
      });

      const callback = `https://softmatrix.example/api/auth/oidc/callback?code=x&state=${durable.ctx.id}`;
      await expect(durable.complete(callback)).resolves.toMatchObject({
        ok: false,
        error: { code: "OIDC_PROVIDER_UNAVAILABLE" },
      });
      await expect(durable.awaitResult()).resolves.toMatchObject({
        ok: false,
        error: { code: "OIDC_PROVIDER_UNAVAILABLE" },
      });
    });
  });
});
