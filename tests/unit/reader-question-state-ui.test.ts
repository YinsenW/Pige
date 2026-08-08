import { createElement } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteRenderResult, NoteSetQuestionStateResult } from "@pige/contracts";
import { ReaderQuestionStateControl } from "../../apps/desktop/src/renderer/src/components/ReaderQuestionStateControl";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "Event"] as const;
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

describe("ReaderQuestionStateControl", () => {
  it("submits one exact immutable change and adopts only an authoritative question render", async () => {
    const pending = deferred<NoteSetQuestionStateResult>();
    const onSetState = vi.fn(async () => pending.promise);
    const onCommitted = vi.fn();
    const harness = await mount(questionRender(), onSetState, onCommitted);
    const select = harness.container.querySelector("select")!;
    await act(async () => {
      choose(harness.dom, select, "partially_answered");
      choose(harness.dom, select, "answered");
      await settle(harness.dom);
    });
    expect(onSetState).toHaveBeenCalledTimes(1);
    const request = onSetState.mock.calls[0]![0];
    expect(request).toMatchObject({
      activeVaultId: "vault_20260801_question", currentPageId: "page_20260801_question1",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      expectedRevision: `noteeditrev_${"a".repeat(64)}`, state: "partially_answered"
    });
    await act(async () => {
      pending.resolve({ ...request, status: "committed", operationId: "op_20260801_questionstate1",
        render: questionRender("partially_answered", "b") });
      await pending.promise;
      await settle(harness.dom);
    });
    expect(onCommitted).toHaveBeenCalledWith(questionRender("partially_answered", "b"));
    expect(harness.dom.window.document.activeElement).toBe(select);
    await harness.unmount();
  });

  it("retains the attempted state and focus after stale or failed results", async () => {
    for (const status of ["stale", "failed"] as const) {
      const onSetState = vi.fn(async (request) => ({ ...request, status } as const));
      const harness = await mount(questionRender(), onSetState, vi.fn());
      const select = harness.container.querySelector("select")!;
      select.focus();
      await act(async () => { choose(harness.dom, select, "answered"); await settle(harness.dom); });
      expect((select as HTMLSelectElement).value).toBe("answered");
      expect(harness.container.querySelector(status === "failed" ? '[role="alert"]' : '[role="status"]')).not.toBeNull();
      expect(harness.dom.window.document.activeElement).toBe(select);
      await harness.unmount();
    }
  });

  it("fences a late result after the Reader owner changes", async () => {
    const pending = deferred<NoteSetQuestionStateResult>();
    const onSetState = vi.fn(async () => pending.promise);
    const onCommitted = vi.fn();
    const harness = await mount(questionRender(), onSetState, onCommitted);
    const oldSelect = harness.container.querySelector("select")!;
    harness.dom.window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      harness.dom.window.setTimeout(() => callback(0), 0);
      return 1;
    };
    await act(async () => {
      choose(harness.dom, oldSelect, "answered");
      await settle(harness.dom);
      harness.root.render(createElement(ReaderQuestionStateControl, props(
        questionRender("open", "c", "page_20260801_question2"), onSetState, onCommitted
      )));
    });
    for (let i = 0; i < 5; i += 1) {
      await act(async () => { await settle(harness.dom); });
    }
    const replacementSelect = harness.container.querySelector("select")! as HTMLSelectElement;
    expect(replacementSelect.value).toBe("open");
    expect(replacementSelect.disabled).toBe(false);
    expect(harness.dom.window.document.activeElement).toBe(replacementSelect);
    const request = onSetState.mock.calls[0]![0];
    await act(async () => {
      pending.resolve({ ...request, status: "committed", operationId: "op_20260801_questionstate1",
        render: questionRender("answered", "b") });
      await pending.promise;
      await settle(harness.dom);
    });
    expect(onCommitted).not.toHaveBeenCalled();
    expect(replacementSelect.value).toBe("open");
    expect(replacementSelect.disabled).toBe(false);
    expect(harness.dom.window.document.activeElement).toBe(replacementSelect);
    await harness.unmount();
  });
});

function props(note: NoteRenderResult, onSetState: Parameters<typeof ReaderQuestionStateControl>[0]["onSetState"],
  onCommitted: Parameters<typeof ReaderQuestionStateControl>[0]["onCommitted"]) {
  return { activeVaultId: "vault_20260801_question", note, onSetState, onCommitted, t: (key: string) => key };
}

async function mount(note: NoteRenderResult, onSetState: Parameters<typeof ReaderQuestionStateControl>[0]["onSetState"],
  onCommitted: Parameters<typeof ReaderQuestionStateControl>[0]["onCommitted"]) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  installDom(dom);
  Object.defineProperty(dom.window, "crypto", { value: { randomUUID: () => "01234567-89ab-cdef-0123-456789abcdef" } });
  dom.window.requestAnimationFrame = (callback: FrameRequestCallback) => { callback(0); return 1; };
  const root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => { root.render(createElement(ReaderQuestionStateControl, props(note, onSetState, onCommitted))); });
  return { dom, root, container: dom.window.document.querySelector("#root")!, unmount: async () => act(async () => root.unmount()) };
}

function questionRender(state: "open" | "partially_answered" | "answered" | "stale" = "open",
  revision = "a", pageId = "page_20260801_question1"): NoteRenderResult {
  return {
    summary: { pageId, title: "Question", pageType: "question", status: "active", pagePath: "questions/question.md",
      createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z", sourceIds: [] },
    html: "<h1>Question</h1>", byteSize: 64,
    renderContextId: revision === "a" ? "notectx_0123456789abcdef0123456789abcdef" : `notectx_${revision.repeat(32)}`,
    questionState: { state, canChange: true, revision: `noteeditrev_${revision.repeat(64)}` }
  };
}

function choose(dom: JSDOM, select: Element, value: string): void {
  (select as HTMLSelectElement).value = value;
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

function installDom(dom: JSDOM): void {
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
}
