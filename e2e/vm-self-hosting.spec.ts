import { expect, test } from "@playwright/test";

import {
  createWorkspace,
  localeCopy,
  setLocale,
  signUpWithFixtureUser,
  type FixtureLocale,
} from "./helpers/softmatrix-fixtures";

const controlUrl = `http://127.0.0.1:${process.env.SOFTMATRIX_VM_CONTROL_PORT ?? "9797"}`;

for (const locale of ["en", "zh-CN"] as const satisfies FixtureLocale[]) {
  test(`single-VM ${locale} journey survives workerd restart`, async ({ page, request }) => {
    const labels = localeCopy(locale);
    await setLocale(page, locale);
    await signUpWithFixtureUser(page, locale);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { name: labels.homeTitle })).toBeVisible();

    await page.goto("/providers");
    await expect(page.getByText("Fixture Model", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: locale === "zh-CN" ? "添加模型" : /Add model/i })).toHaveCount(0);
    await page.goto("/gatekeepers");
    await expect(page.getByRole("heading", { name: locale === "zh-CN" ? "连接器" : "Gatekeepers", exact: true }))
      .toBeVisible({ timeout: 30_000 });
    await page.goto("/");

    const restart = await request.post(`${controlUrl}/restart`);
    expect(restart.ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByRole("heading", { name: labels.homeTitle })).toBeVisible({ timeout: 30_000 });

    await createWorkspace(page, locale, locale === "zh-CN" ? "重启后回复：你好" : "Reply after restart: hello");
    await expect(page.locator("body")).not.toContainText("fixture-model-secret");
  });
}
