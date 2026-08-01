import { webcrypto } from "node:crypto";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LocalRerankerSettingsPanel,
  type LocalRerankerApi
} from "../../apps/desktop/src/renderer/src/components/LocalRerankerSettingsPanel";

const keys = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLButtonElement", "Event", "MouseEvent"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();

afterEach(() => {
  for (const key of keys) {
    const descriptor = originals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("LocalRerankerSettingsPanel", () => {
  it("keeps install and enable distinct and adopts authoritative lifecycle state", async () => {
    const dom = installDom();
    let revision = 0;
    let state: "not_installed" | "disabled" | "ready" = "not_installed";
    const install = vi.fn(async (request: { requestId: string }) => {
      revision = 1;
      state = "disabled";
      return { apiVersion: 1 as const, requestId: request.requestId, revision, status: "accepted" as const,
        jobId: "job_20260801_abcdefghijkl" };
    });
    const api: LocalRerankerApi = {
      localRerankerStatus: async () => ({
        apiVersion: 1, revision, assetId: "qwen3_reranker_0_6b_q3_k_m", assetState: state,
        downloadSizeBytes: 346_896_352, hybridSearchRemainsAvailable: true
      }),
      installLocalReranker: install,
      enableLocalReranker: async (request) => {
        revision += 1;
        state = "ready";
        return { apiVersion: 1, requestId: request.requestId, revision, status: "committed" };
      },
      disableLocalReranker: async (request) => ({ apiVersion: 1, requestId: request.requestId, revision, status: "committed" }),
      removeLocalReranker: async (request) => ({ apiVersion: 1, requestId: request.requestId, revision, status: "committed" })
    };
    const container = dom.window.document.querySelector("#root")!;
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(LocalRerankerSettingsPanel, { api, t: (key: string) => key }));
      await settle();
    });
    expect(container.querySelector('[data-reranker-action="install"]')).toBeTruthy();
    expect(container.querySelector('[data-reranker-action="enable"]')).toBeNull();

    await act(async () => {
      (container.querySelector('[data-reranker-action="install"]') as HTMLButtonElement).click();
      await settle();
    });
    expect(install).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-reranker-action="enable"]')).toBeTruthy();
    expect(container.textContent).not.toContain("/private/");
    await act(async () => { root.unmount(); });
  });
});

function installDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost" });
  Object.defineProperty(dom.window, "crypto", { configurable: true, value: webcrypto });
  for (const key of keys) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  return dom;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}
