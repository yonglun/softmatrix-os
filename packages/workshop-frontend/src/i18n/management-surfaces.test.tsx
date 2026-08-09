// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Toasty } from "@cloudflare/kumo";
import { renderWithLocale } from "../test/renderWithLocale";
import { useTranslation } from "react-i18next";
import ConnectAccountModal from "../ConnectAccountModal";
import AdminPage from "../AdminPage";
import { AuthProvider } from "../AuthContext";
import ChatInterface, {
  attachmentPreparationErrorMessage,
  ChatInput,
  getToolCallSummary,
  prepareChatAttachment,
} from "../ChatInterface";
import i18n from "./i18n";
import type { AdminApi, AuthenticatedApi, Overseer } from "@gadgets/workshop-shared/api";
import type { RpcStub } from "capnweb";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver;
}

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
  it("renders the real admin page and chat input in Chinese", async () => {
    const adminApi = {
      getSettings: async () => ({
        signupsEnabled: true,
        siteName: "",
        instanceInstructions: "",
        announcement: "",
        banner: { text: "", color: "info" },
        accentColor: "",
        resourceVendors: [],
        formats: [],
      }),
    } as unknown as RpcStub<AdminApi>;
    const authenticatedApi = {
      getLocale: async () => "zh-CN" as const,
      whoami: async () => ({ type: "user", id: "admin", name: "Admin" }),
      amIAdmin: async () => true,
      getAdminApi: async () => adminApi,
      listGatekeeperVendors: async () => [],
    } as unknown as RpcStub<AuthenticatedApi>;
    const rendered = renderWithLocale(
      <Toasty>
        <AuthProvider authenticatedApi={authenticatedApi} onLogout={() => {}}>
          <AdminPage />
        </AuthProvider>
      </Toasty>,
      "zh-CN",
    );
    await act(async () => {});
    expect(rendered.container.textContent).toContain("站点名称");
    expect(rendered.container.textContent).toContain("顶部导航栏");
    expect(rendered.container.textContent).not.toContain("Shown next to the logo");
    rendered.unmount();

    const chat = renderWithLocale(
      <Toasty>
        <AuthProvider authenticatedApi={authenticatedApi} onLogout={() => {}}>
          <ChatInput
            createCapsuleGatekeeper={async () => null}
            getOverseer={() => ({ } as RpcStub<Overseer>)}
            onSend={() => {}}
            isAgentActive={false}
            models={[]}
            selectedModel={null}
            onModelChange={() => {}}
          />
        </AuthProvider>
      </Toasty>,
      "zh-CN",
    );
    await act(async () => {});
    expect(chat.container.querySelector('[aria-label="选择模型"]')).not.toBeNull();
    expect(chat.container.querySelector('[aria-label="Select model"]')).toBeNull();
    chat.unmount();

    const overseer = {
      subscribeToChat: () => ({ [Symbol.dispose]() {} }),
      subscribeToActions: async () => ({ [Symbol.dispose]() {} }),
      listChats: async () => [],
      listModels: async () => [],
    } as unknown as RpcStub<Overseer>;
    const chatList = renderWithLocale(
      <Toasty>
        <AuthProvider authenticatedApi={authenticatedApi} onLogout={() => {}}>
          <ChatInterface
            overseer={overseer}
            selectedChatId={null}
            onNavigateToChat={() => {}}
            pendingConsoleLogCount={0}
            consoleLogPreview=""
            consoleLogSeverity="info"
            onConsumeConsoleLogs={() => ""}
            onDiscardConsoleLogs={() => {}}
            onOpenGadget={() => {}}
            outputOfWorkpiece={() => undefined}
          />
        </AuthProvider>
      </Toasty>,
      "zh-CN",
    );
    await act(async () => {});
    expect(chatList.container.textContent).toContain("暂无对话");
    expect(chatList.container.querySelector('[aria-label="筛选对话"]')).not.toBeNull();
    expect(chatList.container.textContent).not.toContain("No conversations yet");
    const summary = getToolCallSummary(
      { toolName: "createGadget", input: { title: "Report" } } as never,
      () => ({ noun: "Document" } as never),
    );
    expect(summary.verb).toBe("已创建 Document");
    const attachmentError = await prepareChatAttachment(
      new File([new Uint8Array(1024 * 1024 + 1)], "large.txt", { type: "text/plain" }),
    ).catch((error: unknown) => error);
    expect(attachmentPreparationErrorMessage(attachmentError, (key, options) =>
      i18n.t(key, options),
    )).toContain("附件大小必须不超过 1.0 MB");
    expect(attachmentPreparationErrorMessage(new Error("browser decode text"), (key, options) =>
      i18n.t(key, options),
    )).toBe("处理附件失败");
    chatList.unmount();
  });

  it("renders a real management modal in Chinese with an empty typed API", async () => {
    const authenticatedApi = {
      listGatekeeperVendors: async () => [],
    } as unknown as RpcStub<AuthenticatedApi>;
    const rendered = renderWithLocale(
      <Toasty><ConnectAccountModal
        visible
        onCancel={() => {}}
        onInitiated={() => {}}
        authenticatedApi={authenticatedApi}
      /></Toasty>,
      "zh-CN",
    );
    await act(async () => {});
    expect(document.body.textContent).toContain("暂无可连接的服务");
    expect(document.body.textContent).not.toContain("management.");
    rendered.unmount();
  });

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
