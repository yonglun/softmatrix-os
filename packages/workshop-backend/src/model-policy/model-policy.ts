import type { AiModelCatalogItem, AiModelSource } from "@gadgets/workshop-shared/api";
import type { UserAiModelRecord } from "../user.js";
import { ModelPolicyError, toCatalogItem, type CatalogModelRecord } from "./types.js";

export type ResolvedModel = {
  source: AiModelSource;
  record: UserAiModelRecord;
};

export type ModelPolicyOptions = {
  disabledOrganizationModelIds?: Iterable<string>;
  defaultModelId?: string | null;
  allowUserByok?: boolean;
};

function correlationId(): string {
  try { return crypto.randomUUID(); } catch { return "model-" + Date.now().toString(36); }
}

function fail(code: ConstructorParameters<typeof ModelPolicyError>[0]): never {
  throw new ModelPolicyError(code, correlationId());
}

function asRecord(record: CatalogModelRecord): UserAiModelRecord {
  return { profile: record.profile, config: record.config };
}

/** Compose organization and personal models and enforce one deterministic selection policy. */
export class ModelPolicy {
  readonly #organization: Map<string, CatalogModelRecord>;
  readonly #personal: Map<string, CatalogModelRecord>;
  readonly #disabled: Set<string>;
  readonly #defaultModelId: string | null;
  readonly #allowUserByok: boolean;

  constructor(organization: Iterable<CatalogModelRecord>, personal: Iterable<CatalogModelRecord>,
      options: ModelPolicyOptions = {}) {
    this.#organization = new Map();
    this.#personal = new Map();
    for (let record of organization) {
      if (this.#organization.has(record.profile.id)) throw new Error(`Duplicate model id: ${record.profile.id}`);
      this.#organization.set(record.profile.id, {...record, source: "organization"});
    }
    for (let record of personal) {
      if (this.#personal.has(record.profile.id) || this.#organization.has(record.profile.id)) {
        throw new Error(`Duplicate model id: ${record.profile.id}`);
      }
      this.#personal.set(record.profile.id, {...record, source: "personal"});
    }
    this.#disabled = new Set(options.disabledOrganizationModelIds ?? []);
    this.#defaultModelId = options.defaultModelId || null;
    this.#allowUserByok = options.allowUserByok !== false;
  }

  #resolved(id: string): ResolvedModel | undefined {
    let org = this.#organization.get(id);
    if (org) return { source: "organization", record: asRecord(org) };
    let personal = this.#personal.get(id);
    if (personal) return { source: "personal", record: asRecord(personal) };
    return undefined;
  }

  /** Resolve exactly the requested ID. Disabled or missing models never fall back. */
  resolve(id: string): ResolvedModel {
    if (this.#organization.has(id) && this.#disabled.has(id)) fail("MODEL_DISABLED");
    let resolved = this.#resolved(id);
    if (!resolved) fail("MODEL_PROVIDER_UNAVAILABLE");
    if (resolved.source === "personal" && !this.#allowUserByok) fail("BYOK_DISABLED");
    return resolved;
  }

  /** Return active records in organization-then-personal order. */
  listActiveModels(): ResolvedModel[] {
    let result: ResolvedModel[] = [];
    for (let [id, record] of this.#organization) {
      if (!this.#disabled.has(id)) result.push({ source: "organization", record: asRecord(record) });
    }
    if (this.#allowUserByok) {
      for (let record of this.#personal.values()) result.push({ source: "personal", record: asRecord(record) });
    }
    return result;
  }

  listModels(): UserAiModelRecord[] {
    return this.listActiveModels().map(entry => entry.record);
  }

  listCatalog(): AiModelCatalogItem[] {
    let result: AiModelCatalogItem[] = [];
    for (let [id, record] of this.#organization) {
      result.push(toCatalogItem(record, !this.#disabled.has(id), id === this.#defaultModelId));
    }
    for (let [id, record] of this.#personal) {
      result.push(toCatalogItem(record, this.#allowUserByok, id === this.#defaultModelId, "personal"));
    }
    return result;
  }

  /** Select a valid preference, then admin default, then first active model; never use disabled IDs. */
  effectiveDefault(userPreference: string | null | undefined): string | null {
    for (let id of [userPreference, this.#defaultModelId]) {
      if (id && this.#resolved(id) && !(this.#organization.has(id) && this.#disabled.has(id))
          && (this.#allowUserByok || this.#organization.has(id))) return id;
    }
    return this.listActiveModels()[0]?.record.profile.id ?? null;
  }
}
