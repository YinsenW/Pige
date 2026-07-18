import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";

const globalKeys = ["window", "document", "navigator", "Node", "HTMLElement", "Event", "MouseEvent"] as const;
const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();

afterEach(() => {
  for (const key of globalKeys) {
    const descriptor = originalDescriptors.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originalDescriptors.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("Home proposal review safety", () => {
  it("shows only localized unavailable truth for an awaiting-review Job and never reads the unsafe proposal DTO", async () => {
    const dom = createDom();
    const calls = { list: 0, get: 0, approve: 0, reject: 0 };
    const { container, root } = await mountHome(dom, makePigeApi(true, calls));

    expect(container.textContent).toContain("Needs confirmation");
    expect(container.textContent).toContain("Safe preview unavailable");
    expect(container.textContent).toContain(
      "A change is waiting for confirmation. Pige will not show or apply its content until the safe review service is available."
    );
    expect(container.textContent).not.toContain("wiki/private/proposal.md");
    expect(container.textContent).not.toContain("private proposal body");
    expect(calls).toEqual({ list: 0, get: 0, approve: 0, reject: 0 });

    const reviewButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.textContent === "Review unavailable");
    expect(reviewButton?.disabled).toBe(true);
    expect(reviewButton?.getAttribute("aria-describedby")).toBe("proposal-safe-preview-description");
    expect(container.querySelector("#proposal-safe-preview-description")?.textContent).toContain(
      "Pige will not show or apply its content"
    );

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("does not fabricate a proposal state when no Job is awaiting review", async () => {
    const dom = createDom();
    const calls = { list: 0, get: 0, approve: 0, reject: 0 };
    const { container, root } = await mountHome(dom, makePigeApi(false, calls));

    expect(container.querySelector(".proposal-strip")).toBeNull();
    expect(container.textContent).not.toContain("Safe preview unavailable");
    expect(calls).toEqual({ list: 0, get: 0, approve: 0, reject: 0 });

    await act(async () => root.unmount());
    dom.window.close();
  });
});

type ProposalApiCalls = {
  list: number;
  get: number;
  approve: number;
  reject: number;
};

function makePigeApi(awaitingReview: boolean, calls: ProposalApiCalls): object {
  const rejectUnsafeCall = (key: keyof ProposalApiCalls): never => {
    calls[key] += 1;
    throw new Error(`Unsafe proposal API was called: ${key}`);
  };
  return {
    getHealth: async () => ({ status: "ok" }),
    window: {
      current: async () => ({ mode: "compact", sidebarOpen: false, alwaysOnTop: false }),
      currentLayout: async () => ({
        apiVersion: 1,
        revision: 0,
        surface: "home",
        sidebarOpen: false,
        noteAgentOpen: false,
        sidebarPresentation: "closed",
        noteAgentPresentation: "closed",
        autoExpanded: false,
        isMaximized: false,
        isFullScreen: false
      }),
      setLayout: async (request: { readonly surface: "home" | "reader"; readonly sidebarOpen: boolean; readonly noteAgentOpen: boolean }) => ({
        apiVersion: 1,
        revision: 1,
        ...request,
        sidebarPresentation: request.sidebarOpen ? "resident" : "closed",
        noteAgentPresentation: request.noteAgentOpen ? "resident" : "closed",
        autoExpanded: false,
        isMaximized: false,
        isFullScreen: false
      }),
      onLayoutChanged: () => () => undefined
    },
    settings: {
      appearance: async () => ({
        locale: "en",
        availableLocales: ["en"],
        themePreference: "system",
        effectiveTheme: "light",
        revision: 0
      }),
      onAppearanceChanged: () => () => undefined
    },
    system: {
      toolchainHealth: async () => ({ status: "ready" })
    },
    vault: {
      onboardingStatus: async () => ({
        state: "ready",
        hasDefaultModel: false,
        activeVault: { vaultId: "vault_review_fixture", name: "Review Vault" }
      }),
      recent: async () => []
    },
    backup: {
      status: async () => null
    },
    confirmations: {
      pending: async () => ({ apiVersion: 1 as const, status: "none" as const, revision: 0 }),
      resolve: async () => ({ apiVersion: 1 as const, status: "not_found" as const, revision: 0 }),
      onChanged: () => () => undefined
    },
    speech: {
      onAssetInstallEvent: () => () => undefined
    },
    agent: {
      runtimeStatus: async () => null
    },
    jobs: {
      list: async () => ({
        scannedAt: "2026-07-16T08:00:00.000Z",
        activeVaultId: "vault_review_fixture",
        total: awaitingReview ? 1 : 0,
        invalidJobCount: 0,
        jobs: awaitingReview ? [{
          id: "job_20260716_reviewfixture",
          class: "agent_ingest",
          state: "awaiting_review",
          message: "Review ready",
          createdAt: "2026-07-16T08:00:00.000Z",
          updatedAt: "2026-07-16T08:00:00.000Z"
        }] : []
      })
    },
    activity: {
      list: async () => ({
        scannedAt: "2026-07-16T08:00:00.000Z",
        activeVaultId: "vault_review_fixture",
        total: 0,
        invalidOperationCount: 0,
        activities: []
      })
    },
    proposals: {
      list: async () => rejectUnsafeCall("list"),
      get: async () => rejectUnsafeCall("get"),
      approve: async () => rejectUnsafeCall("approve"),
      reject: async () => rejectUnsafeCall("reject")
    }
  };
}

function createDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://pige.test"
  });
  installDom(dom);
  return dom;
}

async function mountHome(dom: JSDOM, api: object): Promise<{
  readonly container: HTMLElement;
  readonly root: { unmount: () => void };
}> {
  Object.defineProperty(dom.window, "pige", { configurable: true, value: api });
  const [{ createRoot }, { App }] = await Promise.all([
    import("react-dom/client"),
    import("../../apps/desktop/src/renderer/src/App")
  ]);
  const container = requireElement(dom.window.document.getElementById("root"));
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(App));
    await settle(dom);
  });
  return { container, root };
}

function installDom(dom: JSDOM): void {
  dom.window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    dom.window.setTimeout(() => callback(Date.now()), 0);
  dom.window.cancelAnimationFrame = (frame: number): void => dom.window.clearTimeout(frame);
  for (const key of globalKeys) originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const values: Record<(typeof globalKeys)[number], unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
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

function requireElement(element: HTMLElement | null): HTMLElement {
  if (!element) throw new Error("Expected test container.");
  return element;
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}
