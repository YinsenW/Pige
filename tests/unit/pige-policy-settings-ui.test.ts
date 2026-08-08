import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PigeDesktopApi } from "@pige/contracts";
import { PigePolicySettingsPanel } from "../../apps/desktop/src/renderer/src/components/PigePolicySettingsPanel";
import enMessages from "../../apps/desktop/src/renderer/src/locales/en/messages.json";

const markdown = `# PIGE

## Vault Identity
## Page Types
## Naming Rules
## Frontmatter Rules
## Link Rules
## Source Handling Rules
## Agent Review Rules
## Prompt Injection Rules
`;
const summary = {
  apiVersion: 1 as const,
  activeVaultId: "vault_20260801_abcdef",
  revision: `pigepolicyrev_${"a".repeat(64)}` as const,
  markdown,
  requiredSections: ["Vault Identity", "Page Types", "Naming Rules", "Frontmatter Rules", "Link Rules", "Source Handling Rules", "Agent Review Rules", "Prompt Injection Rules"],
  canEdit: true as const
};

let dom: JSDOM;
beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://pige.local" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    IS_REACT_ACT_ENVIRONMENT: true
  });
  Object.defineProperty(dom.window, "requestAnimationFrame", { value: (callback: FrameRequestCallback) => { callback(0); return 1; } });
  Object.defineProperty(dom.window.crypto, "randomUUID", { value: () => "12345678-1234-1234-1234-1234567890ab" });
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value(this: HTMLElement, name: string, listener: EventListener) { this.addEventListener(name.replace(/^on/u, ""), listener); } });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value(this: HTMLElement, name: string, listener: EventListener) { this.removeEventListener(name.replace(/^on/u, ""), listener); } });
});
afterEach(() => { dom.window.close(); });

function t(key: string): string { return (enMessages as Record<string, string>)[key] ?? key; }

function api(updateResult?: ReturnType<typeof updatedResult>) {
  return {
    pigePolicy: vi.fn(async () => summary),
    updatePigePolicy: vi.fn(async () => updateResult ?? updatedResult())
  } as unknown as PigeDesktopApi["settings"];
}

function updatedResult() {
  return {
    apiVersion: 1 as const,
    requestId: "pigepolicyreq_123456781234123412341234567890ab",
    activeVaultId: summary.activeVaultId,
    status: "updated" as const,
    summary: { ...summary, revision: `pigepolicyrev_${"b".repeat(64)}`, markdown: `${markdown}\n- concise\n` },
    operationId: `op_20260801_${"a".repeat(48)}`
  };
}

async function flush(): Promise<void> { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

async function inputText(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, value);
    const propertyChange = new dom.window.Event("propertychange", { bubbles: true });
    Object.defineProperty(propertyChange, "propertyName", { value: "value" });
    textarea.dispatchEvent(propertyChange);
    textarea.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    textarea.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}

describe("PigePolicySettingsPanel", () => {
  it("loads the active policy, edits it, and adopts only the authoritative committed summary", async () => {
    const value = api();
    const root = createRoot(document.getElementById("root")!);
    await act(async () => { root.render(createElement(PigePolicySettingsPanel, { activeVaultId: summary.activeVaultId, api: value, t })); });
    await flush();
    expect(document.body.textContent).toContain("Vault Agent policy");
    const edit = [...document.querySelectorAll("button")].find((button) => button.textContent === "Edit policy")!;
    await act(async () => { edit.click(); });
    const textarea = document.querySelector("textarea")!;
    expect(textarea.value).toBe(markdown);
    await inputText(textarea, `${markdown}\n- concise\n`);
    const save = [...document.querySelectorAll("button")].find((button) => button.textContent === "Review and save")!;
    await act(async () => { save.click(); });
    await flush();
    expect((value.updatePigePolicy as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(expect.objectContaining({
      activeVaultId: summary.activeVaultId,
      expectedRevision: summary.revision,
      markdown: `${markdown}\n- concise\n`
    }));
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.body.textContent).toContain("can undo it from Activity");
  });

  it("retains the exact draft and focusable editor on validation, denial, or stale authority", async () => {
    const invalidApi = api({
      apiVersion: 1,
      requestId: "pigepolicyreq_123456781234123412341234567890ab",
      activeVaultId: summary.activeVaultId,
      status: "invalid",
      summary,
      issues: ["missing_required_section"]
    });
    const root = createRoot(document.getElementById("root")!);
    await act(async () => { root.render(createElement(PigePolicySettingsPanel, { activeVaultId: summary.activeVaultId, api: invalidApi, t })); });
    await flush();
    await act(async () => { ([...document.querySelectorAll("button")].find((button) => button.textContent === "Edit policy")!).click(); });
    const textarea = document.querySelector("textarea")!;
    const draft = markdown.replace("## Link Rules", "");
    await inputText(textarea, draft);
    await act(async () => { ([...document.querySelectorAll("button")].find((button) => button.textContent === "Review and save")!).click(); });
    await flush();
    expect(document.querySelector("textarea")?.value).toBe(draft);
    expect(document.body.textContent).toContain("required sections are missing");
  });

  it("fails closed on a mismatched save identity while retaining the draft", async () => {
    const mismatched = {
      ...updatedResult(),
      requestId: "pigepolicyreq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    };
    const pending = deferred<typeof mismatched>();
    const value = {
      pigePolicy: vi.fn(async () => summary),
      updatePigePolicy: vi.fn(async () => pending.promise)
    } as unknown as PigeDesktopApi["settings"];
    const root = createRoot(document.getElementById("root")!);
    await act(async () => { root.render(createElement(PigePolicySettingsPanel, { activeVaultId: summary.activeVaultId, api: value, t })); });
    await flush();
    await act(async () => { ([...document.querySelectorAll("button")].find((button) => button.textContent === "Edit policy")!).click(); });
    const textarea = document.querySelector("textarea")!;
    const draft = `${markdown}\n- keep this draft\n`;
    await inputText(textarea, draft);
    await act(async () => { ([...document.querySelectorAll("button")].find((button) => button.textContent === "Review and save")!).click(); });
    pending.resolve(mismatched);
    await flush();
    expect(document.querySelector("textarea")?.value).toBe(draft);
    expect(document.body.textContent).toContain("Pige could not update PIGE.md. Nothing was changed.");
    expect(document.body.textContent).not.toContain("can undo it from Activity");
  });
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
