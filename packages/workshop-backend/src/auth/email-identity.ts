/** Canonical identity boundary shared by every verified external login. */
export function normalizeVerifiedEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1 || normalized.includes("\0")) {
    throw new Error("Verified identity did not contain a valid email address.");
  }
  return normalized;
}

/** Match an exact domain after canonicalization; suffixes such as example.com.evil.test never match. */
export function isEmailDomainAllowed(email: string, domains: readonly string[]): boolean {
  if (domains.length === 0) return true;
  const normalized = normalizeVerifiedEmail(email);
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  return domains.some(allowed => domain === allowed.trim().toLowerCase());
}
