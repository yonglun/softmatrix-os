import type {
  AiChatAuthorInfo,
  AiModelConfig,
  ModelConnectionTestResult,
  ModelErrorCode,
} from "@gadgets/workshop-shared/api";
import { completeText } from "../ai-invoke.js";
import { getModel } from "../ai-models.js";
import { createWorkshopLogger } from "../observability";

const logger = createWorkshopLogger("workshop.model.policy");

function statusFrom(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "statusCode" in error
      && typeof error.statusCode === "number") return error.statusCode;
  let message = error instanceof Error ? error.message : String(error);
  let match = /\b(401|402|403|429|5\d\d)\b/.exec(message);
  return match ? Number(match[1]) : undefined;
}

/** Map provider failures to stable, secret-free client categories. */
export function classifyModelError(error: unknown, explicitStatus?: number): ModelErrorCode {
  let status = explicitStatus ?? statusFrom(error);
  if (status === 401 || status === 403 || status === 400) return "MODEL_CREDENTIAL_INVALID";
  if (status === 402) return "MODEL_BALANCE_EXHAUSTED";
  if (status === 429) return "MODEL_RATE_LIMITED";
  let message = error instanceof Error ? error.message : String(error);
  if (status !== undefined && status >= 500 || /network|fetch|timeout|timed out|aborted|ECONN/i.test(message)) {
    return "MODEL_PROVIDER_UNAVAILABLE";
  }
  return "MODEL_PROVIDER_UNAVAILABLE";
}

function newCorrelationId(): string {
  try { return crypto.randomUUID(); } catch { return "model-test-" + Date.now().toString(36); }
}

/** Test one submitted connection without persisting or returning its credentials. */
export async function testModelConnection(
    env: Cloudflare.Env, profile: AiChatAuthorInfo, config: AiModelConfig): Promise<ModelConnectionTestResult> {
  let correlationId = newCorrelationId();
  let controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), 10_000);
  try {
    let handle = getModel(env, config, profile, { metadata: { source: "chat" } });
    await completeText(handle, { prompt: "Reply with OK.", maxTokens: 1, signal: controller.signal });
    return { ok: true };
  } catch (error) {
    let statusCode = statusFrom(error);
    let code = classifyModelError(error, statusCode);
    logger.warn("model connection test failed", {
      event: "model.connection.test.failed",
      modelId: config.model,
      provider: config.provider,
      ...(statusCode === undefined ? {} : {statusCode}),
      error: new Error(code),
    });
    return { ok: false, error: { code, correlationId } };
  } finally {
    clearTimeout(timer);
  }
}
