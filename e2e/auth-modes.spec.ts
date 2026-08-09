import { test, expect } from "@playwright/test";
import { setLocale, signUpWithFixtureUser, localeCopy } from "./helpers/softmatrix-fixtures";

test("password authentication remains available when no external identity provider is configured", async ({ page }) => {
  await setLocale(page, "en");
  await page.goto("/");
  await expect(page.getByLabel(localeCopy("en").username)).toBeVisible();
  await expect(page.getByLabel(localeCopy("en").password)).toBeVisible();
  await expect(page.getByRole("button", { name: "Company SSO", exact: true })).toHaveCount(0);
});

test("a disposable password account can sign in and persist its locale", async ({ page }) => {
  await setLocale(page, "zh-CN");
  await signUpWithFixtureUser(page, "zh-CN");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { name: localeCopy("zh-CN").homeTitle })).toBeVisible();
});
