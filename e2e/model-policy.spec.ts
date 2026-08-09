import { test, expect } from "@playwright/test";
import { setLocale, signUpWithFixtureUser } from "./helpers/softmatrix-fixtures";

test("organization model is visible while personal BYOK controls stay deployment-disabled", async ({ page }) => {
  await setLocale(page, "en");
  await signUpWithFixtureUser(page, "en");
  await page.goto("/providers");
  await expect(page.getByText("Fixture Model", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Add model/i })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("fixture-model-secret");
});
