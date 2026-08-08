// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithLocale } from "../test/renderWithLocale";
import { useTranslation } from "react-i18next";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function ManagementProbe({ providerName, vendorDescription }: { providerName: string; vendorDescription: string }) {
  const { t } = useTranslation();
  return (
    <div>
      <span>{t("management.chat.attachmentsCount", { count: 1 })}</span>
      <span>{t("management.chat.attachmentsCount", { count: 2 })}</span>
      <span>{t("management.connections.connectedCount", { count: 0 })}</span>
      <span>{t("management.connections.connectedCount", { count: 1 })}</span>
      <span>{t("management.providers.title")}</span>
      <span>{providerName}</span>
      <span>{vendorDescription}</span>
    </div>
  );
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("chat and management surface localization", () => {
  it("renders English interpolation and plural boundaries while preserving provider/vendor text", async () => {
    const rendered = renderWithLocale(
      <ManagementProbe providerName="Provider Δ" vendorDescription="Vendor supplied description — keep verbatim" />,
      "en",
    );
    await act(async () => {});
    expect(rendered.container.textContent).toContain("1 attachment");
    expect(rendered.container.textContent).toContain("2 attachments");
    expect(rendered.container.textContent).toContain("No connected resources");
    expect(rendered.container.textContent).toContain("1 connected resource");
    expect(rendered.container.textContent).toContain("Provider Δ");
    expect(rendered.container.textContent).toContain("Vendor supplied description — keep verbatim");
    rendered.unmount();
  });

  it("renders Chinese interpolation and plural boundaries without translating provider/vendor text", async () => {
    const rendered = renderWithLocale(
      <ManagementProbe providerName="模型服务商 / Acme" vendorDescription="供应商描述：原样保留" />,
      "zh-CN",
    );
    await act(async () => {});
    expect(rendered.container.textContent).toContain("1 个附件");
    expect(rendered.container.textContent).toContain("2 个附件");
    expect(rendered.container.textContent).toContain("暂无连接资源");
    expect(rendered.container.textContent).toContain("1 个已连接资源");
    expect(rendered.container.textContent).toContain("模型服务商 / Acme");
    expect(rendered.container.textContent).toContain("供应商描述：原样保留");
    rendered.unmount();
  });
});
