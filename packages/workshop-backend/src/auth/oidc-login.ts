import { DurableObject } from "cloudflare:workers";
import type { OidcLoginErrorCode, OidcLoginResult } from "@gadgets/workshop-shared/api";
import { readAdminConfig } from "../admin-config.js";
import { getOidcConfig } from "./config.js";
import { isEmailDomainAllowed } from "./email-identity.js";
import {
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  OIDC_ATTEMPT_TTL_MS,
  OidcProtocolError,
  type VerifiedOidcIdentity,
  type StoredOidcRequest,
} from "./oidc-protocol.js";
import type { UserDurableObject } from "../user.js";

type OidcAttemptState = {
  request: StoredOidcRequest;
  completed: boolean;
  result?: OidcLoginResult;
};

const STORAGE_KEY = "oidc-attempt";

function correlationId(): string {
  return crypto.randomUUID();
}

function failure(code: OidcLoginErrorCode): OidcLoginResult {
  return { ok: false, error: { code, correlationId: correlationId() } };
}

export function sessionTokenForIdentity(identity: VerifiedOidcIdentity, secret: string): string {
  return `${identity.accountKey}:${secret}`;
}

/** Durable rendezvous for one browser-owned OIDC authorization-code attempt. */
export class OidcLoginDurableObject extends DurableObject<Cloudflare.Env> {
  #waiters: Array<(result: OidcLoginResult) => void> = [];

  async begin(): Promise<{ url: string }> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const existing = await this.ctx.storage.get<OidcAttemptState>(STORAGE_KEY);
      if (existing) throw new Error("OIDC login attempt already started.");

      const config = getOidcConfig(this.env);
      if (!config) throw new Error("OIDC sign-in is not enabled on this deployment.");
      const { url, stored } = await createAuthorizationRequest(config, this.ctx.id.toString());
      await this.ctx.storage.put<OidcAttemptState>(STORAGE_KEY, {
        request: stored,
        completed: false,
      });
      await this.ctx.storage.setAlarm(stored.createdAt + OIDC_ATTEMPT_TTL_MS);
      return { url: url.toString() };
    });
  }

  async awaitResult(): Promise<OidcLoginResult> {
    const state = await this.ctx.storage.get<OidcAttemptState>(STORAGE_KEY);
    if (state?.result) return state.result;
    if (!state) return failure("OIDC_STATE_INVALID");
    return await new Promise<OidcLoginResult>(resolve => {
      this.#waiters.push(resolve);
    });
  }

  async complete(callbackUrl: string): Promise<OidcLoginResult> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const state = await this.ctx.storage.get<OidcAttemptState>(STORAGE_KEY);
      if (!state) {
        throw new Error("OIDC login attempt has not started.");
      }
      if (state.completed) {
        throw new Error("OIDC login attempt already completed.");
      }

      // Mark the attempt before any network or user-DO call. Durable Object serialization makes
      // callback replay fail closed even when two callback requests arrive concurrently.
      const processingState: OidcAttemptState = { ...state, completed: true };
      await this.ctx.storage.put(STORAGE_KEY, processingState);

      let result: OidcLoginResult;
      try {
        const config = getOidcConfig(this.env);
        if (!config) {
          result = failure("OIDC_PROVIDER_UNAVAILABLE");
        } else {
          const identity = await exchangeAuthorizationCode(config, state.request, callbackUrl);
          if (!isEmailDomainAllowed(identity.profileId, config.allowedEmailDomains)) {
            result = failure("EMAIL_DOMAIN_NOT_ALLOWED");
          } else {
            const signupsEnabled = (await readAdminConfig(this.env)).signupsEnabled;
            const users = this.ctx.exports.UserDurableObject as DurableObjectNamespace<UserDurableObject>;
            const user = users.get(users.idFromName(identity.accountKey));
            const token = await user.loginOrCreateViaOidc(
              identity.accountKey,
              identity.profileId,
              signupsEnabled,
            );
            result = token === null
              ? failure("SIGNUP_NOT_ALLOWED")
              : { ok: true, token: sessionTokenForIdentity(identity, token) };
          }
        }
      } catch (error) {
        if (error instanceof OidcProtocolError) {
          result = failure(error.code);
        } else {
          result = failure("OIDC_PROVIDER_UNAVAILABLE");
        }
      }

      const completedState: OidcAttemptState = { ...processingState, result };
      await this.ctx.storage.put(STORAGE_KEY, completedState);
      const waiters = this.#waiters;
      this.#waiters = [];
      for (const resolve of waiters) resolve(result);
      return result;
    });
  }

  async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<OidcAttemptState>(STORAGE_KEY);
    if (state && !state.result) {
      const result = failure("OIDC_STATE_INVALID");
      const waiters = this.#waiters;
      this.#waiters = [];
      for (const resolve of waiters) resolve(result);
    }
    await this.ctx.storage.deleteAll();
  }
}
