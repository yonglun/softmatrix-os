import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_NAME } from "@gadgets/workshop-shared/api";
import {
  PRODUCT_NAME,
  UPSTREAM_REPOSITORY_URL,
} from "@gadgets/workshop-shared/product";

describe("Softmatrix product metadata", () => {
  it("uses Softmatrix OS while preserving factual upstream attribution", () => {
    expect(PRODUCT_NAME).toBe("Softmatrix OS");
    expect(DEFAULT_SITE_NAME).toBe(PRODUCT_NAME);
    expect(UPSTREAM_REPOSITORY_URL).toBe(
      "https://github.com/cloudflare/cloudflare-os",
    );
  });
});
