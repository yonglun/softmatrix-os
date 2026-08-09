import type {
  AiChatAuthorInfo,
  AiModelCatalogItem,
  AiModelConfig,
  AiModelProvider,
  AiModelSource,
  ModelErrorCode,
} from "@gadgets/workshop-shared/api";

/** Secret-bearing model record used only inside the backend. */
export type CatalogModelRecord = {
  profile: AiChatAuthorInfo;
  config: AiModelConfig;
  source?: AiModelSource;
};

/** Construct a secret-free catalog row without spreading the backing record. */
export function toCatalogItem(
    record: CatalogModelRecord, enabled: boolean, isDefault: boolean,
    source: AiModelSource = record.source ?? "organization"): AiModelCatalogItem {
  const item = {
    id: record.profile.id,
    name: record.profile.name,
    provider: record.config.provider as AiModelProvider,
    source,
    enabled,
    isDefault,
    canDelete: source === "personal",
  } satisfies AiModelCatalogItem;
  return item;
}

/** Backend-only error crossing an RPC or stream boundary. */
export class ModelPolicyError extends Error {
  constructor(readonly code: ModelErrorCode, readonly correlationId: string) {
    super(code);
    this.name = "ModelPolicyError";
  }
}
