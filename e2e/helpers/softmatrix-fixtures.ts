import { expect, type Page } from "@playwright/test";

export type FixtureLocale = "en" | "zh-CN";

const copy = {
  en: {
    signUp: "Create account",
    signIn: "Sign in",
    username: "Username",
    password: "Password",
    confirmPassword: "Confirm password",
    send: "Send message",
    selectModel: "Select model",
    createWorkspace: "Create workspace",
    next: "Next",
    finish: "Let's build",
    homeTitle: "What are we working on?",
    composer: "Start a new conversation…",
  },
  "zh-CN": {
    signUp: "创建账户",
    signIn: "登录",
    username: "用户名",
    password: "密码",
    confirmPassword: "确认密码",
    send: "发送消息",
    selectModel: "选择模型",
    createWorkspace: "创建工作区",
    next: "下一步",
    finish: "开始构建",
    homeTitle: "我们要一起做什么？",
    composer: "开始新对话…",
  },
} as const;

export function localeCopy(locale: FixtureLocale) {
  return copy[locale];
}

export async function setLocale(page: Page, locale: FixtureLocale): Promise<void> {
  await page.addInitScript((selected) => {
    window.localStorage.setItem("softmatrix.locale", selected);
  }, locale);
}

export async function finishOnboarding(page: Page, locale: FixtureLocale): Promise<void> {
  const labels = localeCopy(locale);
  await expect(
    page.getByRole("button", { name: labels.next, exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  // The wizard keeps the same footer button while the slide transition runs.
  // Wait for each state update instead of issuing several clicks against the
  // initial slide (which React can coalesce before the next slide is mounted).
  for (let i = 0; i < 5; i++) {
    const finish = page.getByRole("button", { name: labels.finish, exact: true });
    if (await finish.count() > 0) break;
    const next = page.getByRole("button", { name: labels.next, exact: true });
    if (await next.count() === 0) break;
    await next.click();
    await page.waitForTimeout(250);
  }
  await page.getByRole("button", { name: labels.finish, exact: true }).click();
  await expect(page.getByRole("heading", { name: labels.homeTitle })).toBeVisible({ timeout: 30_000 });
}

export async function signUpWithFixtureUser(page: Page, locale: FixtureLocale): Promise<string> {
  const username = `e2e_${locale.replace("-", "").toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const labels = localeCopy(locale);
  await page.goto("/signup");
  await page.getByRole("textbox", { name: labels.username, exact: true }).fill(username);
  await page.getByRole("textbox", { name: labels.password, exact: true }).fill("fixture-password-123");
  await page.getByRole("textbox", { name: labels.confirmPassword, exact: true }).fill("fixture-password-123");
  await page.getByRole("button", { name: labels.signUp, exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await finishOnboarding(page, locale);
  return username;
}

export async function selectModelIfAvailable(page: Page, locale: FixtureLocale): Promise<void> {
  const labels = localeCopy(locale);
  const picker = page.getByRole("button", { name: labels.selectModel, exact: true });
  if (await picker.count() === 0) return;
  const selected = await picker.innerText();
  if (selected === "Fixture Model") return;
  await picker.click();
  const model = page.getByRole("menuitem", { name: "Fixture Model", exact: true });
  if (await model.count() > 0) await model.click();
  await page.keyboard.press("Escape");
}

export async function createWorkspace(page: Page, locale: FixtureLocale, prompt: string): Promise<void> {
  const labels = localeCopy(locale);
  await selectModelIfAvailable(page, locale);
  await page.getByRole("combobox", { name: labels.composer, exact: true }).fill(prompt);
  await page.getByRole("button", { name: labels.send, exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
  await expect(page.getByText(prompt, { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Fixture response: ${prompt}`, { exact: true })).toBeVisible({ timeout: 30_000 });
}

export async function assertNoFixtureSecrets(page: Page): Promise<void> {
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("fixture-model-secret");
  expect(body).not.toContain("fixture-oidc-secret");
}
