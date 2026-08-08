import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentConversationExportRequest,
  AgentConversationExportResult,
  AgentConversationHistoryCursor,
  AgentConversationHistoryListRequest,
  AgentConversationHistoryListResult
} from "@pige/contracts";
import { ConversationHistoryPanel } from "../../apps/desktop/src/renderer/src/components/ConversationHistoryPanel";
import enMessages from "../../apps/desktop/src/renderer/src/locales/en/messages.json";

const globalKeys = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLButtonElement",
  "Event",
  "MouseEvent"
] as const;
const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
const activeVaultId = "vault_20260731_export01";
const conversation = {
  conversationId: "conv_20260731_export01",
  updatedAt: "2026-07-31T10:00:00.000Z",
  safePreview: "Summarize this source.",
  tailEventId: "evt_20260731_assistant01"
} as const;

afterEach(() => {
  for (const key of globalKeys) {
    const descriptor = originalDescriptors.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originalDescriptors.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("ConversationHistoryPanel durable export", () => {
  it("exports the exact selected conversation tail and renders only a pathless success", async () => {
    const requests: AgentConversationExportRequest[] = [];
    const opened = vi.fn(async () => true);
    const { dom, container, root } = await mount(async (request) => {
      requests.push(request);
      return { ...identity(request), status: "exported", tailEventId: request.expectedTailEventId, eventCount: 3 };
    }, opened);

    await click(dom, button(container, enMessages["conversation.history"]));
    await click(dom, button(container, enMessages["conversation.export"]));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId,
      conversationId: conversation.conversationId,
      expectedTailEventId: conversation.tailEventId
    });
    expect(requests[0]?.requestId).toMatch(/^conversation_export_request_[a-z0-9]{16,64}$/u);
    expect(Object.keys(requests[0] ?? {}).sort()).toEqual([
      "activeVaultId", "apiVersion", "conversationId", "expectedTailEventId", "requestId"
    ]);
    expect(container.querySelector('[role="status"]')?.textContent)
      .toBe(enMessages["conversation.export_exported"]);
    expect(container.textContent).not.toMatch(/\/private\/|\.json/iu);

    await click(dom, buttonContaining(container, conversation.safePreview));
    expect(opened).toHaveBeenCalledWith(conversation.conversationId, "history", conversation.tailEventId, undefined);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps history intact for stale results and keeps cancellation quiet", async () => {
    let outcome: "stale" | "cancelled" = "stale";
    let resolveExport!: () => void;
    const opened = vi.fn(async () => true);
    const { dom, container, root } = await mount((request) => new Promise((resolve) => {
      resolveExport = () => resolve(outcome === "stale"
        ? { ...identity(request), status: "stale", currentTailEventId: "evt_20260731_newtail01" }
        : { ...identity(request), status: "cancelled", tailEventId: request.expectedTailEventId });
    }), opened);

    await click(dom, button(container, enMessages["conversation.history"]));
    const exportButton = button(container, enMessages["conversation.export"]);
    await click(dom, exportButton);
    const outside = dom.window.document.createElement("button");
    outside.textContent = "Other control";
    container.append(outside);
    outside.focus();
    await act(async () => { resolveExport(); await settle(dom); });
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe(enMessages["conversation.export_stale"]);
    expect(container.textContent).toContain(conversation.safePreview);
    await act(async () => {
      await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => resolve()));
    });
    expect(dom.window.document.activeElement).toBe(exportButton);
    await click(dom, buttonContaining(container, conversation.safePreview));
    expect(opened).toHaveBeenCalledTimes(1);

    outcome = "cancelled";
    const cancelButton = button(container, enMessages["conversation.export"]);
    await click(dom, cancelButton);
    await act(async () => { resolveExport(); await settle(dom); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain(conversation.safePreview);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("returns focus to the history trigger when the final page removes Load more", async () => {
    const firstPage = conversation;
    const secondPage = {
      conversationId: "conv_20260731_export02",
      updatedAt: "2026-07-30T10:00:00.000Z",
      safePreview: "A second durable conversation.",
      tailEventId: "evt_20260730_assistant01"
    } as const;
    const cursor = `conversation_history_cursor_${"a".repeat(32)}` as AgentConversationHistoryCursor;
    let page = 0;
    const history = async (request: AgentConversationHistoryListRequest): Promise<AgentConversationHistoryListResult> => {
      page += 1;
      return {
        apiVersion: 1,
        activeVaultId: request.activeVaultId,
        status: "ready",
        conversations: page === 1 ? [firstPage] : [secondPage],
        hasMore: page === 1,
        ...(page === 1 ? { nextCursor: cursor } : {})
      };
    };
    const { dom, container, root } = await mount(async (request) => ({
      ...identity(request), status: "cancelled", tailEventId: request.expectedTailEventId
    }), vi.fn(async () => true), history);

    await click(dom, button(container, enMessages["conversation.history"]));
    await click(dom, button(container, enMessages["conversation.historyMore"]));
    await act(async () => { await settle(dom); });
    await act(async () => {
      await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => resolve()));
    });
    expect(container.textContent).toContain(secondPage.safePreview);
    expect(container.querySelector("[data-conversation-history-more='true']")).toBeNull();
    expect(dom.window.document.activeElement).toBe(button(container, enMessages["conversation.history"]));

    await act(async () => root.unmount());
    dom.window.close();
  });
});

async function mount(
  exportConversation: (request: AgentConversationExportRequest) => Promise<AgentConversationExportResult>,
  onOpenConversation: (conversationId: string, view: "current" | "history") => Promise<boolean>,
  historyLoader?: (request: AgentConversationHistoryListRequest) => Promise<AgentConversationHistoryListResult>
) {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://pige.test"
  });
  installDom(dom);
  Object.defineProperty(dom.window.crypto, "randomUUID", {
    configurable: true,
    value: () => "01234567-89ab-cdef-0123-456789abcdef"
  });
  Object.defineProperty(dom.window, "pige", {
    configurable: true,
    value: {
      agent: {
        conversationHistory: historyLoader ?? (async (request: AgentConversationHistoryListRequest) => ({
          apiVersion: 1,
          activeVaultId: request.activeVaultId,
          status: "ready" as const,
          currentConversationId: conversation.conversationId,
          conversations: [conversation],
          hasMore: false
        })),
        exportConversation
      }
    }
  });
  const container = dom.window.document.querySelector<HTMLElement>("#root")!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(ConversationHistoryPanel, {
      activeVaultId,
      locale: "en",
      selectedConversationId: null,
      onOpenConversation,
      t
    }));
    await settle(dom);
  });
  return { dom, container, root };
}

function identity(request: AgentConversationExportRequest) {
  return {
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    conversationId: request.conversationId
  };
}

function t(key: string): string {
  return (enMessages as Record<string, string>)[key] ?? key;
}

function installDom(dom: JSDOM): void {
  for (const key of globalKeys) originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const values: Record<(typeof globalKeys)[number], unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent
  };
  for (const key of globalKeys) {
    Object.defineProperty(globalThis, key, { configurable: true, value: values[key], writable: true });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true
  });
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

function buttonContaining(container: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.includes(label));
  if (!match) throw new Error(`Button not found containing: ${label}`);
  return match;
}

async function click(dom: JSDOM, element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await settle(dom);
  });
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}
