import { describe, expect, it } from "vitest";
import { buildLocaleInstruction } from "../src/agent";
import { defaultChatTitle } from "../src/overseer";

describe("Agent locale instruction", () => {
  it("defaults to English and lets an explicit language request win", () => {
    const instruction = buildLocaleInstruction("en");
    expect(instruction).toContain("Use English as the default response language");
    expect(instruction).toContain("explicitly requests another language");
    expect(instruction).toContain("explicit language request overrides this default");
  });

  it("defaults to Simplified Chinese without translating user data", () => {
    const instruction = buildLocaleInstruction("zh-CN");
    expect(instruction).toContain("默认使用简体中文（zh-CN）回答");
    expect(instruction).toContain("明确的语言要求优先于此默认值");
    expect(instruction).toContain("不要翻译用户内容、源代码、标识符");
  });

  it("does not embed user content or provider data", () => {
    const instruction = buildLocaleInstruction("en");
    expect(instruction).not.toContain("user message");
    expect(instruction).not.toContain("provider name");
  });

  it("uses a localized placeholder when a generated chat title is unavailable", () => {
    expect(defaultChatTitle("en")).toBe("New Chat");
    expect(defaultChatTitle("zh-CN")).toBe("新对话");
  });
});
