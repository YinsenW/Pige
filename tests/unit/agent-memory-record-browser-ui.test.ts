import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryRecordSummary } from "@pige/schemas";
import { AgentMemoryRecordBrowser } from "../../apps/desktop/src/renderer/src/components/AgentMemoryRecordBrowser";

const globals = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "Event",
] as const;
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

describe("Agent Memory record browser", () => {
  it("filters safe summaries, preserves a pinned record, and resets on owner drift", async () => {
    const dom = installDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const render = (ownerIdentity: string, pinnedRecordId?: string) =>
      createElement(
        AgentMemoryRecordBrowser,
        {
          ownerIdentity,
          records,
          ...(pinnedRecordId ? { pinnedRecordId } : {}),
          t,
        },
        (visibleRecords) =>
          createElement(
            "ol",
            null,
            visibleRecords.map((record) =>
              createElement("li", { key: record.id }, record.title),
            ),
          ),
      );

    await act(async () => root.render(render("vault_1:browse")));
    expect(dom.window.document.body.textContent).toContain("3 of 3 memories");

    const search = inputNamed(dom, "Search memories");
    await act(async () => {
      setInputValue(dom, search, "focus");
    });
    expect(dom.window.document.body.textContent).toContain("Ｆｏｃｕｓ mode");
    expect(dom.window.document.body.textContent).not.toContain("Old workflow");

    const status = selectNamed(dom, "Filter by status");
    await act(async () => setSelectValue(dom, status, "disabled"));
    expect(
      dom.window.document.querySelector("[data-memory-filter-empty]"),
    ).not.toBeNull();

    await act(async () =>
      root.render(render("vault_1:browse", records[1]!.id)),
    );
    expect(dom.window.document.body.textContent).toContain("Old workflow");
    expect(dom.window.document.body.textContent).toContain("1 of 3 memories");

    await act(async () => root.render(render("vault_2:activity_1")));
    expect(inputNamed(dom, "Search memories").value).toBe("");
    expect(selectNamed(dom, "Filter by status").value).toBe("all");
    expect(dom.window.document.body.textContent).toContain("3 of 3 memories");

    await act(async () => root.unmount());
    dom.window.close();
  });
});

const records: readonly MemoryRecordSummary[] = [
  memoryRecord(
    "memory_20260802_focusmode",
    "Ｆｏｃｕｓ mode",
    "Keep summaries concise",
    "active",
  ),
  memoryRecord(
    "memory_20260802_oldworkflow",
    "Old workflow",
    "Use the retired sequence",
    "disabled",
  ),
  memoryRecord(
    "memory_20260802_citations",
    "Citation style",
    "Include exact references",
    "active",
  ),
];

function memoryRecord(
  id: string,
  title: string,
  body: string,
  status: MemoryRecordSummary["status"],
): MemoryRecordSummary {
  return {
    id,
    kind: "preference",
    title,
    body,
    status,
    provenance: {
      kind: "explicit_user_request",
      occurredAt: "2026-08-02T01:00:00.000Z",
    },
    createdAt: "2026-08-02T01:00:00.000Z",
    updatedAt: "2026-08-02T01:00:00.000Z",
  };
}

function t(key: string): string {
  return (
    (
      {
        "memory.filter.title": "Filter saved memories",
        "memory.filter.search": "Search memories",
        "memory.filter.status": "Filter by status",
        "memory.filter.all": "All statuses",
        "memory.filter.count": "{visible} of {total} memories",
        "memory.filter.empty": "No memories match this filter.",
        "memory.status.active": "Active",
        "memory.status.disabled": "Disabled",
      } as Record<string, string>
    )[key] ?? key
  );
}

function installDom(): JSDOM {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    {
      url: "https://pige.local",
    },
  );
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: dom.window[key],
    });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  return dom;
}

function inputNamed(dom: JSDOM, name: string): HTMLInputElement {
  const input = [
    ...dom.window.document.querySelectorAll<HTMLInputElement>("input"),
  ].find((candidate) => candidate.getAttribute("aria-label") === name);
  if (!input) throw new Error(`Missing input ${name}`);
  return input;
}

function selectNamed(dom: JSDOM, name: string): HTMLSelectElement {
  const select = [
    ...dom.window.document.querySelectorAll<HTMLSelectElement>("select"),
  ].find((candidate) => candidate.getAttribute("aria-label") === name);
  if (!select) throw new Error(`Missing select ${name}`);
  return select;
}

function setInputValue(
  dom: JSDOM,
  input: HTMLInputElement,
  value: string,
): void {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function setSelectValue(
  dom: JSDOM,
  select: HTMLSelectElement,
  value: string,
): void {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLSelectElement.prototype,
    "value",
  )?.set;
  setter?.call(select, value);
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
