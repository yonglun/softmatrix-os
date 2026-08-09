import { describe, expect, it } from "vitest";
import { isEmailDomainAllowed, normalizeVerifiedEmail } from "../src/auth/email-identity.js";

describe("verified email identity", () => {
  it.each([
    [" Alice@Example.COM ", "alice@example.com"],
    ["用户@例子.公司", "用户@例子.公司"],
  ])("canonicalizes %s", (input, expected) => {
    expect(normalizeVerifiedEmail(input)).toBe(expected);
  });

  it.each(["", "missing-at", "@example.com", "a@", "a@example.com\u0000"]) (
    "rejects malformed email %s",
    input => expect(() => normalizeVerifiedEmail(input)).toThrow(),
  );

  it("matches exact normalized domains and rejects suffix tricks", () => {
    expect(isEmailDomainAllowed("a@example.com", ["EXAMPLE.COM"])).toBe(true);
    expect(isEmailDomainAllowed("a@example.com.evil.test", ["example.com"])).toBe(false);
    expect(isEmailDomainAllowed("a@other.test", ["example.com"])).toBe(false);
    expect(isEmailDomainAllowed("a@other.test", [])).toBe(true);
  });
});
