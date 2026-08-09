import { test, expect } from "@playwright/test";
import { assertNoFixtureSecrets, createWorkspace, setLocale, signUpWithFixtureUser, localeCopy, type FixtureLocale } from "./helpers/softmatrix-fixtures";

for (const locale of ["en", "zh-CN"] as const satisfies FixtureLocale[]) {
  test(`bilingual core Agent journey in ${locale}`, async ({ page }) => {
    await setLocale(page, locale);
    await signUpWithFixtureUser(page, locale);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await createWorkspace(page, locale, locale === "zh-CN" ? "回复：你好" : "Reply: hello");
    await assertNoFixtureSecrets(page);
    await expect(page.getByRole("button", { name: localeCopy(locale).send, exact: true })).toBeVisible();
  });
}
