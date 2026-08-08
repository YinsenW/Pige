import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeHealthClaimSourceRepair } from
  "../../apps/desktop/src/renderer/src/components/KnowledgeHealthClaimSourceRepair";

const globals = ["window", "document", "navigator", "HTMLElement", "Event", "MouseEvent"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();

afterEach(() => {
  for (const key of globals) {
    const descriptor = originals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("Knowledge Health claim source repair", () => {
  it("requires an explicit current Source choice and adopts only a committed repair", async () => {
    const dom = installDom();
    const trigger = dom.window.document.createElement("button");
    dom.window.document.body.append(trigger);
    const searchKnowledgeHealthClaimSources = vi.fn(async (request) => ({
      ...request,
      status: "ready" as const,
      sources: [{ sourceContextId: `knowledge_health_claim_source_context_${"d".repeat(64)}`,
        page: { pageId: "page_20260731_sourcechoice", title: "Evidence source" } },
        { sourceContextId: `knowledge_health_claim_source_context_${"f".repeat(64)}`,
          page: { pageId: "page_20260731_secondsource", title: "Second source" } }],
      truncated: false
    }));
    let repairAttempts = 0;
    const repairKnowledgeHealthUnsourcedClaim = vi.fn(async (request) => {
      repairAttempts += 1;
      return repairAttempts === 1
        ? { ...request, status: "stale" as const }
        : { ...request, status: "committed" as const,
            revision: `noteeditrev_${"e".repeat(64)}`, operationId: "op_20260731_claimsource123" };
    });
    Object.defineProperty(dom.window, "pige", { configurable: true, value: { maintenance: {
      searchKnowledgeHealthClaimSources, repairKnowledgeHealthUnsourcedClaim
    } } });
    const onClose = vi.fn();
    const onCommitted = vi.fn(async () => undefined);
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(KnowledgeHealthClaimSourceRepair, {
        activeVaultId: "vault_20260731_claimsource",
        issue: { kind: "unsourced_claim", page: { pageId: "page_20260731_claimsource", title: "Claim" },
          repairContextId: `knowledge_health_repair_context_${"a".repeat(64)}`,
          claimRevision: `noteeditrev_${"b".repeat(64)}`,
          claimRenderProof: `knowledge_health_render_${"c".repeat(64)}`,
          reportEpoch: 1,
          reportRequestId: "knowledge_health_request_claimsourceabcdef",
          indexGeneration: "2026-07-31T12:00:00.000Z#claimsource" },
        returnFocus: trigger, t: (key) => key, onClose, onCommitted
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).not.toContain("src_20260731_sourcechoice");
    await act(async () => { button(container, "maintenance.knowledgeHealth.searchClaimSources").click(); await settle(dom); });
    expect(searchKnowledgeHealthClaimSources).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("maintenance.knowledgeHealth.claimSourceAmbiguous");
    expect(repairKnowledgeHealthUnsourcedClaim).not.toHaveBeenCalled();
    await act(async () => { button(container, "Evidence source").click(); await settle(dom); });
    expect(repairKnowledgeHealthUnsourcedClaim).not.toHaveBeenCalled();
    await act(async () => { button(container, "maintenance.knowledgeHealth.claimSourceConfirm").click(); await settle(dom); });
    expect(repairKnowledgeHealthUnsourcedClaim).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("maintenance.knowledgeHealth.repairStale");
    expect(dom.window.document.activeElement?.textContent).toBe("maintenance.knowledgeHealth.claimSourceConfirm");
    expect(container.textContent).toContain("Evidence source");
    await act(async () => { button(container, "maintenance.knowledgeHealth.claimSourceConfirm").click(); await settle(dom); });
    expect(repairKnowledgeHealthUnsourcedClaim).toHaveBeenCalledWith(expect.objectContaining({
      action: "bind_claim_source", sourceContextId: `knowledge_health_claim_source_context_${"d".repeat(64)}`
    }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onCommitted).toHaveBeenCalledOnce();
    expect(dom.window.document.activeElement).toBe(trigger);
    await act(async () => root.unmount());
    dom.window.close();
  });
});

function installDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true });
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(dom.window, "crypto", { configurable: true, value: { randomUUID: () => "12345678-1234-4123-8123-123456789abc" } });
  return dom;
}

function button(container: Element, label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!(result instanceof window.HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return result;
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}
