import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LibraryListResult,
  LibraryBrowseRequest,
  LibraryBrowseResult,
  LibraryMergeTagRequest,
  LibraryMergeTagResult,
  LibraryRemoveTagRequest,
  LibraryRemoveTagResult,
  LibraryRemovePageTagRequest,
  LibraryRemovePageTagResult,
  LibraryRenameTagRequest,
  LibraryRenameTagResult,
  LibraryTagsRequest,
  LibraryTagsResult,
  NoteArchiveCurrentRequest,
  NoteArchiveCurrentResult,
  NoteEditTaxonomyRequest,
  NoteEditTaxonomyResult,
  NoteRenameRequest,
  NoteRenameResult,
  NoteAliasChangeRequest,
  NoteAliasChangeResult,
  NoteRestoreArchivedRequest,
  NoteRestoreArchivedResult,
  NoteRenderResult,
  NoteMergeRequest,
  NoteMergeResult,
  NoteRelateRequest,
  NoteRelateResult,
  NoteOpenSourceReferenceRequest,
  NoteOpenSourceReferenceResult,
  NoteReconnectOriginalSourceRequest,
  NoteRevealSourceRequest,
  NoteEditorOpenRequest,
  NoteEditorSaveRequest,
  NoteTrashCurrentRequest,
  NoteTrashCurrentResult,
  ReaderSelectionActionRequest,
  ReaderSelectionActionResult,
  ReaderSelectionCreateNoteRequest,
  ReaderSelectionCreateNoteResult,
  ReaderSelectionLinkRequest,
  ReaderSelectionLinkResult,
  ReaderSelectionResolveRequest,
  ReaderSelectionResolveResult,
  ReaderSelectionTransformRequest,
  ReaderSelectionTransformResult,
  RetrievalSearchRequest,
  RetrievalSearchResult
} from "@pige/contracts";
import type { CollectionListResult } from "@pige/schemas";
import { filterLibraryPages, LibraryPanel } from "../../apps/desktop/src/renderer/src/App";
import { useLibraryBrowse } from "../../apps/desktop/src/renderer/src/components/useLibraryBrowse";
import {
  LibraryTagsBrowser,
  type LibraryTagsBrowserLabels,
} from "../../apps/desktop/src/renderer/src/components/LibraryTagsBrowser";
import { NoteReader } from "../../apps/desktop/src/renderer/src/components/NoteReader";
import {
  ReaderDocumentActions,
  submitReaderNoteArchive,
  submitReaderNoteRestore,
} from "../../apps/desktop/src/renderer/src/components/ReaderDocumentActions";
import { submitReaderNoteRelation } from "../../apps/desktop/src/renderer/src/components/ReaderNoteRelateDialog";
import type { ReaderInlineReferenceActivation } from "../../apps/desktop/src/renderer/src/components/ReaderInlineReferenceSurface";
import enMessages from "../../apps/desktop/src/renderer/src/locales/en/messages.json";

const globalKeys = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "InputEvent",
  "Event",
  "MouseEvent",
  "KeyboardEvent"
] as const;
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

describe("full UI Library", () => {
  it("starts only one continuation request when load more is triggered twice in one render", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    let refresh: (() => Promise<void>) | undefined;
    let loadMore: (() => Promise<void>) | undefined;
    let resolveContinuation: ((result: LibraryBrowseResult) => void) | undefined;
    const browse = vi.fn((request: LibraryBrowseRequest): Promise<LibraryBrowseResult> => {
      if (!request.cursor) {
        return Promise.resolve({
          ...request,
          status: "ready",
          snapshotId: `library_browse_snapshot_${"a".repeat(64)}`,
          scannedAt: "2026-07-31T08:00:00.000Z",
          total: 2,
          invalidPageCount: 0,
          pages: [libraryPage("page_library_browse_first", "First", "2026-07-31T08:00:00.000Z")],
          nextCursor: `library_browse_cursor_${"b".repeat(64)}`
        });
      }
      return new Promise((resolve) => { resolveContinuation = resolve; });
    });
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { library: { browse } }
    });
    function Harness(): React.JSX.Element {
      const state = useLibraryBrowse("vault_20260731_librarybrowse", () => undefined, "Library unavailable");
      refresh = state.refresh;
      loadMore = state.loadMore;
      return createElement("output", null, state.libraryList?.pages.length ?? 0);
    }
    await act(async () => { root.render(createElement(Harness)); await settle(dom); });
    await act(async () => { await refresh?.(); await settle(dom); });
    await act(async () => {
      void loadMore?.();
      void loadMore?.();
      await Promise.resolve();
    });
    expect(browse).toHaveBeenCalledTimes(2);
    const request = browse.mock.calls[1]![0];
    resolveContinuation?.({
      ...request,
      status: "ready",
      snapshotId: `library_browse_snapshot_${"a".repeat(64)}`,
      scannedAt: "2026-07-31T08:01:00.000Z",
      total: 2,
      invalidPageCount: 0,
      pages: [libraryPage("page_library_browse_second", "Second", "2026-07-31T07:00:00.000Z")]
    });
    await act(async () => { await settle(dom); });
    expect(dom.window.document.querySelector("output")?.textContent).toBe("2");
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("confirms one archive at a time, retains focus on failure, and adopts only a committed render", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    let mode: "retained" | "committed" = "retained";
    let calls = 0;
    const adopted: NoteRenderResult[] = [];
    const archived = {
      ...readerNote(),
      summary: { ...readerNote().summary, status: "archived" as const }
    };
    await act(async () => {
      root.render(createElement(ReaderDocumentActions, {
        ownerIdentity: "vault_1:page_1:render_1:revision_1",
        canMoveToTrash: false,
        canMerge: false,
        canArchive: true,
        currentTitle: "Reader note",
        labels: {
          more: "More note actions", menu: "Note actions", moveToTrash: "Move to Trash",
          title: "Move this note to Trash?", description: "Trash description", cancel: "Cancel",
          confirm: "Move to Trash", pending: "Moving…", failed: "Trash failed"
        },
        archiveLabels: {
          action: "Archive", title: "Archive this note?", description: "Archive description",
          cancel: "Cancel", confirm: "Archive", pending: "Archiving…", failed: "Archive failed"
        },
        mergeLabels: {
          title: "Merge", description: "Merge description", survivor: "Keep", target: "Target",
          loading: "Loading", empty: "Empty", cancel: "Cancel", confirm: "Merge",
          pending: "Merging", failed: "Merge failed"
        },
        onMoveToTrash: async () => "retained",
        onLoadMergeTargets: async () => [],
        onMerge: async () => ({ status: "retained" }),
        onArchive: async () => {
          calls += 1;
          return mode === "committed"
            ? { status: "committed", render: archived }
            : { status: "retained" };
        },
        onCommitted: () => undefined,
        onMergeCommitted: () => undefined,
        onArchiveCommitted: (render) => adopted.push(render)
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await act(async () => {
      buttonWithLabel(container, "More note actions").click();
      await settle(dom);
      buttonNamed(container, "Archive").click();
      await settle(dom);
    });
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Cancel"));
    await act(async () => {
      buttonNamed(container, "Archive").click();
      buttonNamed(container, "Archive").click();
      await settle(dom);
    });
    expect(calls).toBe(1);
    expect(container.textContent).toContain("Archive failed");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Cancel"));
    mode = "committed";
    await act(async () => {
      buttonNamed(container, "Archive").click();
      await settle(dom);
    });
    expect(calls).toBe(2);
    expect(adopted).toEqual([archived]);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("restores an archived note once, retains the dialog on failure, and adopts only the authoritative active render", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const revision = `noteeditrev_${"b".repeat(32)}`;
    const note = {
      ...readerNote(),
      summary: { ...readerNote().summary, status: "archived" as const },
      restoreEligibility: { canRestore: true, revision }
    };
    const active = {
      ...readerNote(),
      html: "<p>Restored body.</p>",
      restoreEligibility: { canRestore: false, revision: `noteeditrev_${"c".repeat(32)}` }
    };
    let mode: "stale" | "committed" = "stale";
    const requests: NoteRestoreArchivedRequest[] = [];
    const adopted: NoteRenderResult[] = [];
    const submit = async (request: NoteRestoreArchivedRequest): Promise<NoteRestoreArchivedResult> => {
      requests.push(request);
      return mode === "committed"
        ? { ...request, status: "committed", operationId: "operation_restore_note", render: active }
        : { ...request, status: "stale" };
    };
    await act(async () => {
      root.render(createElement(ReaderDocumentActions, {
        ownerIdentity: `vault_1:${note.summary.pageId}:${note.renderContextId}:${revision}`,
        canMoveToTrash: false,
        canMerge: false,
        canRestore: true,
        currentTitle: note.summary.title,
        labels: {
          more: "More note actions", menu: "Note actions", moveToTrash: "Move to Trash",
          title: "Move this note to Trash?", description: "Trash description", cancel: "Cancel",
          confirm: "Move to Trash", pending: "Moving…", failed: "Trash failed"
        },
        restoreLabels: {
          action: "Restore", title: "Restore this note?", description: "Restore description",
          cancel: "Cancel", confirm: "Restore", pending: "Restoring…", failed: "Restore failed"
        },
        mergeLabels: {
          title: "Merge", description: "Merge description", survivor: "Keep", target: "Target",
          loading: "Loading", empty: "Empty", cancel: "Cancel", confirm: "Merge",
          pending: "Merging", failed: "Merge failed"
        },
        onMoveToTrash: async () => "retained",
        onLoadMergeTargets: async () => [],
        onMerge: async () => ({ status: "retained" }),
        onRestore: () => submitReaderNoteRestore({ note, activeVaultId: "vault_1", submit, currentNote: () => note }),
        onCommitted: () => undefined,
        onMergeCommitted: () => undefined,
        onRestoreCommitted: (render) => adopted.push(render)
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await act(async () => {
      buttonWithLabel(container, "More note actions").click();
      await settle(dom);
      buttonNamed(container, "Restore").click();
      await settle(dom);
      buttonNamed(container, "Restore").click();
      buttonNamed(container, "Restore").click();
      await settle(dom);
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_1",
      currentPageId: note.summary.pageId,
      renderContextId: note.renderContextId,
      expectedRevision: revision
    });
    expect(Object.keys(requests[0]!)).toEqual([
      "apiVersion", "requestId", "activeVaultId", "currentPageId", "renderContextId", "expectedRevision"
    ]);
    expect(container.textContent).toContain("Restore failed");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Cancel"));
    mode = "committed";
    await act(async () => {
      buttonNamed(container, "Restore").click();
      await settle(dom);
    });
    expect(requests).toHaveLength(2);
    expect(adopted).toEqual([active]);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("retains the current typed Reader when archive or restore returns a different page type", async () => {
    const dom = createDom();
    const revision = `noteeditrev_${"d".repeat(32)}`;
    const activeClaim: NoteRenderResult = {
      ...readerNote(), summary: { ...readerNote().summary, pageType: "claim", status: "active" },
      archiveEligibility: { canArchive: true, revision }
    };
    const archivedClaim: NoteRenderResult = {
      ...activeClaim, summary: { ...activeClaim.summary, status: "archived" },
      archiveEligibility: { canArchive: false, revision }, restoreEligibility: { canRestore: true, revision }
    };
    const wrongArchived = { ...archivedClaim, summary: { ...archivedClaim.summary, pageType: "question" as const } };
    const wrongActive = { ...activeClaim, summary: { ...activeClaim.summary, pageType: "question" as const } };
    expect(await submitReaderNoteArchive({
      note: activeClaim, activeVaultId: "vault_1",
      submit: async (request) => ({ ...request, status: "committed", operationId: "op_archive_type_drift", render: wrongArchived })
    })).toEqual({ status: "retained" });
    expect(await submitReaderNoteRestore({
      note: archivedClaim, activeVaultId: "vault_1",
      submit: async (request) => ({ ...request, status: "committed", operationId: "op_restore_type_drift", render: wrongActive })
    })).toEqual({ status: "retained" });
    dom.window.close();
  });

  it("lets the selection menu escape its toolbar while the menu owns internal scrolling", () => {
    const styles = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/styles/app.css"),
      "utf8"
    );
    const toolbarRule = styles.match(/\.selection-toolbar\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
    const menuRule = styles.match(/\.selection-more-menu\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
    expect(toolbarRule).toContain("overflow: visible");
    expect(menuRule).toContain("overflow: auto");
  });

  it("keeps inline-reference feedback out of the Reader document flow", () => {
    const styles = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/styles/app.css"),
      "utf8"
    );
    const feedbackRule = styles.match(/\.reader-inline-reference-feedback\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
    expect(feedbackRule).toContain("position: fixed");
    expect(feedbackRule).toContain("top: calc(var(--titlebar-height) + 12px)");
    expect(feedbackRule).toContain("transform: translateX(-50%)");
    expect(feedbackRule).toContain("pointer-events: none");
    expect(feedbackRule).toContain("margin: 0");
    expect(feedbackRule).not.toContain("margin: 0 0");
  });

  it("filters real page summaries by title", () => {
    const pages = libraryList().pages;
    expect(filterLibraryPages(pages, "all", " interface ").map((page) => page.title)).toEqual([
      "Interface design"
    ]);
    expect(filterLibraryPages(pages, "all", "missing")).toEqual([]);
  });

  it("imports one Markdown note at a time and retains Library state and focus on closed outcomes", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: Array<{ apiVersion: 1; requestId: `noteimport_${string}`; activeVaultId: string }> = [];
    const adopted: NoteRenderResult[] = [];
    let resolveFirst: ((result: {
      apiVersion: 1;
      requestId: `noteimport_${string}`;
      activeVaultId: string;
      status: "cancelled";
    }) => void) | null = null;
    let mode: "cancelled" | "stale" | "invalid" | "failed" | "imported" = "cancelled";
    const imported = {
      ...readerNote(),
      summary: {
        ...readerNote().summary,
        pageId: "page_20260730_import01",
        title: "Imported field notes",
        pageType: "note" as const,
        status: "active" as const,
      },
    };
    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: libraryList(),
        activeVaultId: "vault_20260715_fullui01",
        selectedNote: null,
        selectedNoteRelated: null,
        noteLoadingPageId: null,
        error: null,
        onGoHome: () => undefined,
        onImportMarkdown: async (request) => {
          requests.push(request);
          if (requests.length === 1) {
            return new Promise((resolve) => {
              resolveFirst = resolve;
            });
          }
          return mode === "imported"
            ? { ...request, status: "imported", operationId: "op_20260730_import01", render: imported }
            : { ...request, status: mode };
        },
        onNoteImported: (render) => adopted.push(render),
        onRefresh: async () => undefined,
        onSearch: async () => searchResult("unused", []),
        searchFocusRequest: 0,
        onOpenNote: async () => undefined,
        onCloseNote: () => undefined,
        noteAgentOpen: false,
        onToggleNoteAgent: () => undefined,
        noteAgentToggleRef: { current: null },
        developmentNotice: null,
        onDevelopment: () => undefined,
        t,
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const trigger = buttonWithLabel(container, "Import Markdown note");
    await act(async () => {
      trigger.click();
      trigger.click();
      await Promise.resolve();
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ apiVersion: 1, activeVaultId: "vault_20260715_fullui01" });
    expect(requests[0]?.requestId).toMatch(/^noteimport_[a-z0-9]{16,64}$/u);
    resolveFirst?.({ ...requests[0]!, status: "cancelled" });
    await act(async () => settle(dom));
    expect(dom.window.document.activeElement).toBe(trigger);
    expect(container.textContent).toContain("Alpha plan");

    for (const closedStatus of ["stale", "invalid", "failed"] as const) {
      mode = closedStatus;
      await clickButton(dom, trigger);
      expect(dom.window.document.activeElement).toBe(trigger);
      expect(container.textContent).toContain(enMessages[`library.importMarkdown${closedStatus[0]!.toUpperCase()}${closedStatus.slice(1)}` as keyof typeof enMessages]);
      expect(container.textContent).toContain("Alpha plan");
    }

    mode = "imported";
    await clickButton(dom, trigger);
    expect(adopted).toEqual([imported]);
    expect(requests).toHaveLength(5);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("filters every typed Knowledge family by durable page type", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: libraryList(),
        selectedNote: null,
        selectedNoteRelated: null,
        noteLoadingPageId: null,
        error: null,
        onGoHome: () => undefined,
        onRefresh: async () => undefined,
        onSearch: async () => searchResult("unused", []),
        searchFocusRequest: 0,
        onOpenNote: async () => undefined,
        onCloseNote: () => undefined,
        noteAgentOpen: false,
        onToggleNoteAgent: () => undefined,
        noteAgentToggleRef: { current: null },
        developmentNotice: null,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });

    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("Alpha plan");
    expect(container.textContent).toContain("Interface design");
    expect(container.textContent).toContain("Navigation concept");
    expect(container.textContent).toContain("Ada Lovelace");
    expect(container.textContent).toContain("Local-first claim");
    expect(container.textContent).toContain("Open question");

    for (const [label, visible, hidden] of [
      ["Topics", "Interface design", "Navigation concept"],
      ["Concepts", "Navigation concept", "Ada Lovelace"],
      ["Entities", "Ada Lovelace", "Local-first claim"],
      ["Claims", "Local-first claim", "Open question"],
      ["Questions", "Open question", "Interface design"]
    ] as const) {
      await act(async () => {
        buttonNamed(container, label).click();
        await settle(dom);
      });
      expect(buttonNamed(container, label).getAttribute("aria-selected")).toBe("true");
      expect(container.textContent).toContain(visible);
      expect(container.textContent).not.toContain(hidden);
      expect(container.textContent).not.toContain("Alpha plan");
    }

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("discovers datasets inside Library while summaries only select an exact table", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const opened: Array<{ datasetId: string; tableId: string }> = [];
    const catalog: CollectionListResult = {
      apiVersion: 1,
      activeVaultId: "vault_20260715_fullui01",
      status: "ready",
      datasets: [{
        datasetId: "dataset_20260729_library01",
        title: "Customer research",
        activeRevisionId: "dataset_rev_20260729_library01",
        tableCount: 1,
        tables: [{ tableId: "table_customers01", tableName: "Customers", columnCount: 3, rowCount: 72, canOpen: true }],
        tablesTruncated: false
      }],
      totalDatasetCount: 1,
      hasMore: false
    };
    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: libraryList(),
        collectionCatalog: catalog,
        collectionCatalogLoading: false,
        onRefreshCollectionCatalog: async () => undefined,
        onLoadMoreCollections: async () => undefined,
        onOpenCollection: async (datasetId, tableId) => {
          opened.push({ datasetId, tableId });
          return true;
        },
        selectedNote: null,
        selectedNoteRelated: null,
        noteLoadingPageId: null,
        error: null,
        onGoHome: () => undefined,
        onRefresh: async () => undefined,
        onSearch: async () => searchResult("unused", []),
        searchFocusRequest: 0,
        onOpenNote: async () => undefined,
        onCloseNote: () => undefined,
        noteAgentOpen: false,
        onToggleNoteAgent: () => undefined,
        noteAgentToggleRef: { current: null },
        developmentNotice: null,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("Customer research");
    expect(container.textContent).toContain("Rows: 72");
    await act(async () => {
      requireElement(container.querySelector<HTMLButtonElement>('[aria-label="Open collection: Customers"]')).click();
      await settle(dom);
    });
    expect(opened).toEqual([{ datasetId: "dataset_20260729_library01", tableId: "table_customers01" }]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("runs typed local search by family, opens stable page identity, and ignores stale results", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: RetrievalSearchRequest[] = [];
    const resolvers = new Map<string, (result: RetrievalSearchResult) => void>();
    const opened: string[] = [];
    const focused: Array<{ readonly pageId: string; readonly query: string }> = [];
    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: libraryList(),
        selectedNote: null,
        selectedNoteRelated: null,
        noteLoadingPageId: null,
        error: null,
        onGoHome: () => undefined,
        onRefresh: async () => undefined,
        onSearch: (request) => {
          requests.push(request);
          return new Promise((resolve) => resolvers.set(request.query, resolve));
        },
        searchFocusRequest: 0,
        onOpenNote: async (pageId) => { opened.push(pageId); },
        onOpenSearchMatch: async (pageId, query) => { focused.push({ pageId, query }); },
        onCloseNote: () => undefined,
        noteAgentOpen: false,
        onToggleNoteAgent: () => undefined,
        noteAgentToggleRef: { current: null },
        developmentNotice: null,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const search = requireElement(container.querySelector<HTMLInputElement>("#librarySearchInput"));
    expect(search.maxLength).toBe(320);

    await act(async () => {
      buttonNamed(container, "Sources").click();
      await settle(dom);
    });
    await inputText(dom, search, "alpha");
    await act(async () => {
      await delay(dom, 150);
    });
    expect(requests).toEqual([{
      query: "alpha",
      limit: 20,
      pageTypes: ["source"],
      scope: { kind: "active_vault", vaultId: "vault_20260715_fullui01" }
    }]);

    await inputText(dom, search, "beta");
    await act(async () => {
      await delay(dom, 150);
    });
    expect(requests.at(-1)).toEqual({
      query: "beta",
      limit: 20,
      pageTypes: ["source"],
      scope: { kind: "active_vault", vaultId: "vault_20260715_fullui01" }
    });

    await act(async () => {
      resolvers.get("beta")?.(searchResult("beta", [{
        summary: sourcePage("page_20260715_beta2222", "Beta source"),
        score: 8,
        snippets: ["A current local result"],
        matchReasons: ["body"]
      }]));
      await settle(dom);
    });
    expect(container.textContent).toContain("Beta source");
    expect(container.textContent).toContain("Content match");
    expect(container.textContent).not.toContain("100%");
    expect(container.textContent).not.toContain("Alpha source");

    await act(async () => {
      resolvers.get("alpha")?.(searchResult("alpha", [{
        summary: sourcePage("page_20260715_alpha1111", "Alpha source"),
        score: 9,
        snippets: ["A stale local result"],
        matchReasons: ["title"]
      }]));
      await settle(dom);
    });
    expect(container.textContent).toContain("Beta source");
    expect(container.textContent).not.toContain("Alpha source");

    await act(async () => {
      buttonContaining(container, "Beta source").click();
      await settle(dom);
    });
    expect(opened).toEqual([]);
    expect(focused).toEqual([{ pageId: "page_20260715_beta2222", query: "beta" }]);

    await act(async () => {
      buttonNamed(container, "Claims").click();
      await settle(dom);
    });
    await inputText(dom, search, "grounded");
    await act(async () => { await delay(dom, 150); });
    expect(requests.at(-1)).toEqual({
      query: "grounded",
      limit: 20,
      pageTypes: ["claim"],
      scope: { kind: "active_vault", vaultId: "vault_20260715_fullui01" }
    });

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("does not search without an active vault", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: RetrievalSearchRequest[] = [];
    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: null,
        selectedNote: null,
        selectedNoteRelated: null,
        noteLoadingPageId: null,
        error: null,
        onGoHome: () => undefined,
        onRefresh: async () => undefined,
        onSearch: async (request) => {
          requests.push(request);
          return searchResult(request.query, []);
        },
        searchFocusRequest: 0,
        onOpenNote: async () => undefined,
        onCloseNote: () => undefined,
        noteAgentOpen: false,
        onToggleNoteAgent: () => undefined,
        noteAgentToggleRef: { current: null },
        developmentNotice: null,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });

    const container = dom.window.document.querySelector("#root")!;
    const search = requireElement(container.querySelector<HTMLInputElement>("#librarySearchInput"));
    await inputText(dom, search, "alpha");
    await act(async () => {
      await delay(dom, 150);
    });
    expect(requests).toEqual([]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps bounded Tag rows, exact page opens, one-flight paging, and failure focus", async () => {
    const dom = createDom();
    Object.defineProperty(dom.window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) =>
        dom.window.setTimeout(() => callback(0), 0),
    });
    const labels: LibraryTagsBrowserLabels = {
      title: "Tags",
      loading: "Loading tags",
      empty: "No tags",
      failed: "Tags unavailable",
      retry: "Try again",
      notesLoading: "Loading tagged notes",
      notesEmpty: "No tagged notes",
      notesFailed: "Tagged notes unavailable",
      loadMore: "Load more",
      loadingMore: "Loading more",
      open: "Open",
      rename: "Rename",
      renameTitle: "Rename tag",
      renameDescription: "Rename description",
      renameCurrent: "Current tag:",
      renameReplacement: "New tag",
      renameCancel: "Cancel",
      renameConfirm: "Rename tag",
      renamePending: "Renaming",
      renameFailed: "Rename failed",
      merge: "Merge",
      mergeTitle: "Merge tag",
      mergeDescription: "Merge description",
      mergeSource: "Source tag:",
      mergeTarget: "Merge into",
      mergeCancel: "Cancel",
      mergeConfirm: "Merge tag",
      mergePending: "Merging",
      mergeFailed: "Merge failed",
      remove: "Remove from all pages",
      removeTitle: "Remove tag from all pages?",
      removeDescription: "Remove description",
      removeCurrent: "Tag:",
      removePageCount: "Current pages:",
      removeCancel: "Cancel",
      removeConfirm: "Remove from all pages",
      removePending: "Removing",
      removeFailed: "Remove failed",
      removePage: "Remove tag",
      removePageTitle: "Remove tag from this page?",
      removePageDescription: "Remove from one page",
      removePageCurrentTag: "Tag:",
      removePageCurrentPage: "Page:",
      removePageConfirm: "Remove tag",
      removePagePending: "Removing",
      removePageFailed: "Page remove failed",
      noteCount: (count) => `${count} notes`,
    };
    const opened: string[] = [];
    const requests: LibraryTagsRequest[] = [];
    let resolveLoadMore!: (result: LibraryTagsResult) => void;
    let pagesContinuationAttempt = 0;
    const snapshotId = `library_tags_snapshot_${"a".repeat(64)}`;
    const cursor = `library_tags_cursor_${"b".repeat(64)}`;
    const api = {
      tags: vi.fn((request: LibraryTagsRequest): Promise<LibraryTagsResult> => {
        requests.push(request);
        if (request.mode === "list_tags") {
          return Promise.resolve({
            apiVersion: 1,
            requestId: request.requestId,
            activeVaultId: request.activeVaultId,
            mode: "list_tags",
            status: "ready",
            snapshotId,
            tags: [{ tag: "research", pageCount: 2 }],
            total: 1,
          });
        }
        if (!request.cursor) {
          return Promise.resolve({
            apiVersion: 1,
            requestId: request.requestId,
            activeVaultId: request.activeVaultId,
            mode: "list_pages_for_tag",
            tag: request.tag,
            status: "ready",
            snapshotId,
            pages: [{
              pageId: "page_20260730_research01",
              title: "Research brief",
              pageType: "note",
              status: "active",
              updatedAt: "2026-07-30T08:00:00.000Z",
            }],
            total: 2,
            nextCursor: cursor,
          });
        }
        pagesContinuationAttempt += 1;
        if (pagesContinuationAttempt === 1) {
          return new Promise<LibraryTagsResult>((resolve) => {
            resolveLoadMore = resolve;
          });
        }
        return Promise.resolve({
          apiVersion: 1,
          requestId: request.requestId,
          activeVaultId: request.activeVaultId,
          mode: "list_pages_for_tag",
          tag: request.tag,
          status: "ready",
          snapshotId,
          pages: [{
            pageId: "page_20260730_research02",
            title: "Source review",
            pageType: "source",
            status: "active",
            updatedAt: "2026-07-30T08:01:00.000Z",
          }],
          total: 2,
        });
      }),
      renameTag: vi.fn(async (request: LibraryRenameTagRequest): Promise<LibraryRenameTagResult> => ({
        ...request,
        status: "failed",
      })),
      mergeTag: vi.fn(async (request: LibraryMergeTagRequest): Promise<LibraryMergeTagResult> => ({
        ...request,
        status: "failed",
      })),
      removeTag: vi.fn(async (request: LibraryRemoveTagRequest): Promise<LibraryRemoveTagResult> => ({
        ...request,
        status: "failed",
      })),
      removePageTag: vi.fn(async (request: LibraryRemovePageTagRequest): Promise<LibraryRemovePageTagResult> => ({
        ...request,
        status: "failed",
      })),
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LibraryTagsBrowser, {
        activeVaultId: "vault_20260730_librarytags",
        api,
        labels,
        onOpenNote: async (pageId) => { opened.push(pageId); },
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await act(async () => {
      buttonNamed(container, "research2 notes").click();
      await settle(dom);
    });
    expect(requests[1]).toMatchObject({
      mode: "list_pages_for_tag",
      tag: "research",
      activeVaultId: "vault_20260730_librarytags",
      limit: 50,
    });
    const firstNote = Array.from(container.querySelectorAll<HTMLButtonElement>("button.search-result"))
      .find((button) => button.textContent?.includes("Research brief"));
    expect(firstNote).toBeTruthy();
    await act(async () => {
      firstNote!.click();
      await settle(dom);
    });
    expect(opened).toEqual(["page_20260730_research01"]);

    const loadMoreButton = buttonNamed(container, "Load more");
    await act(async () => {
      loadMoreButton.click();
      loadMoreButton.click();
      await settle(dom);
    });
    expect(requests).toHaveLength(3);
    expect(requests[2]).toMatchObject({
      mode: "list_pages_for_tag",
      tag: "research",
      snapshotId,
      cursor,
    });
    expect(container.textContent).toContain("Research brief");
    const continuationRequest = requests[2]!;
    resolveLoadMore({
      apiVersion: 1,
      requestId: continuationRequest.requestId,
      activeVaultId: continuationRequest.activeVaultId,
      mode: "list_pages_for_tag",
      tag: "research",
      status: "stale",
    });
    await act(async () => {
      await settle(dom);
      await settle(dom);
    });
    expect(dom.window.document.activeElement).toBe(loadMoreButton);
    expect(container.textContent).toContain("Research brief");
    expect(container.textContent).toContain("Tagged notes unavailable");

    await act(async () => {
      loadMoreButton.click();
      await settle(dom);
    });
    expect(requests).toHaveLength(4);
    expect(container.textContent).toContain("Source review");
    expect(new Set(Array.from(container.querySelectorAll("button.search-result strong"))
      .map((element) => element.textContent))).toEqual(
        new Set(["research", "Research brief", "Source review"]),
      );

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("renames one exact tag with snapshot CAS and reloads before focusing the authoritative row", async () => {
    const dom = createDom();
    Object.defineProperty(dom.window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0),
    });
    const labels: LibraryTagsBrowserLabels = {
      title: "Tags", loading: "Loading tags", empty: "No tags", failed: "Tags unavailable", retry: "Try again",
      notesLoading: "Loading tagged notes", notesEmpty: "No tagged notes", notesFailed: "Tagged notes unavailable",
      loadMore: "Load more", loadingMore: "Loading more", open: "Open", rename: "Rename",
      renameTitle: "Rename tag", renameDescription: "Rename description", renameCurrent: "Current tag:",
      renameReplacement: "New tag", renameCancel: "Cancel", renameConfirm: "Rename tag",
      renamePending: "Renaming", renameFailed: "Rename failed", noteCount: (count) => `${count} notes`,
      merge: "Merge", mergeTitle: "Merge tag", mergeDescription: "Merge description",
      mergeSource: "Source tag:", mergeTarget: "Merge into", mergeCancel: "Cancel",
      mergeConfirm: "Merge tag", mergePending: "Merging", mergeFailed: "Merge failed",
      remove: "Remove from all pages", removeTitle: "Remove tag from all pages?", removeDescription: "Remove description",
      removeCurrent: "Tag:", removePageCount: "Current pages:", removeCancel: "Cancel",
      removeConfirm: "Remove from all pages", removePending: "Removing", removeFailed: "Remove failed",
      removePage: "Remove tag", removePageTitle: "Remove tag from this page?", removePageDescription: "Remove from one page",
      removePageCurrentTag: "Tag:", removePageCurrentPage: "Page:", removePageConfirm: "Remove tag",
      removePagePending: "Removing", removePageFailed: "Page remove failed",
    };
    const snapshotId = `library_tags_snapshot_${"a".repeat(64)}`;
    const renameRequests: LibraryRenameTagRequest[] = [];
    let committed = false;
    let resolveStale!: (result: LibraryRenameTagResult) => void;
    const api = {
      tags: vi.fn(async (request: LibraryTagsRequest): Promise<LibraryTagsResult> => ({
        apiVersion: 1,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        mode: "list_tags",
        status: "ready",
        snapshotId,
        tags: [{ tag: committed ? "field research" : "research", pageCount: 2 }],
        total: 1,
      })),
      renameTag: vi.fn((request: LibraryRenameTagRequest): Promise<LibraryRenameTagResult> => {
        renameRequests.push(request);
        if (renameRequests.length === 1) {
          return new Promise((resolve) => { resolveStale = resolve; });
        }
        committed = true;
        return Promise.resolve({
          ...request,
          status: "committed",
          operationId: "operation_library_tag_rename",
          renamedPageCount: 2,
        });
      }),
      mergeTag: vi.fn(async (request: LibraryMergeTagRequest): Promise<LibraryMergeTagResult> => ({
        ...request,
        status: "failed",
      })),
      removeTag: vi.fn(async (request: LibraryRemoveTagRequest): Promise<LibraryRemoveTagResult> => ({
        ...request,
        status: "failed",
      })),
      removePageTag: vi.fn(async (request: LibraryRemovePageTagRequest): Promise<LibraryRemovePageTagResult> => ({
        ...request,
        status: "failed",
      })),
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LibraryTagsBrowser, {
        activeVaultId: "vault_20260730_librarytags",
        api,
        labels,
        onOpenNote: async () => undefined,
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const trigger = buttonWithLabel(container, "Rename: research");
    await clickButton(dom, trigger);
    const input = requireElement(container.querySelector<HTMLInputElement>("input"));
    expect(input.value).toBe("research");
    await inputText(dom, input, "  field   research  ");
    const confirm = buttonNamed(container, "Rename tag");
    expect(confirm.disabled).toBe(false);
    await act(async () => {
      confirm.click();
      confirm.click();
      await settle(dom);
    });
    expect(renameRequests).toHaveLength(1);
    expect(renameRequests[0]).toMatchObject({
      activeVaultId: "vault_20260730_librarytags",
      tag: "research",
      replacementTag: "field research",
      expectedSnapshotId: snapshotId,
      expectedPageCount: 2,
    });
    expect(renameRequests[0]?.requestId).toMatch(/^library_tag_rename_request_[a-z0-9]{16,64}$/u);
    expect(JSON.stringify(renameRequests[0])).not.toMatch(/pageId|path|body/u);
    resolveStale({ ...renameRequests[0]!, status: "stale" });
    await waitFor(dom, () => container.textContent?.includes("Rename failed") === true);
    expect(container.textContent).toContain("research");
    expect(input.value).toBe("  field   research  ");
    await waitFor(dom, () => dom.window.document.activeElement === input);

    await clickButton(dom, buttonNamed(container, "Rename tag"));
    await waitFor(dom, () => container.textContent?.includes("field research") === true && container.querySelector("input") === null);
    expect(renameRequests).toHaveLength(2);
    expect(api.tags).toHaveBeenCalledTimes(2);
    const renamedRow = Array.from(container.querySelectorAll<HTMLButtonElement>("button.search-result"))
      .find((button) => button.textContent?.includes("field research"));
    await waitFor(dom, () => dom.window.document.activeElement === renamedRow);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("merges one exact loaded tag into another with snapshot CAS and focuses the authoritative target", async () => {
    const dom = createDom();
    Object.defineProperty(dom.window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0),
    });
    const labels: LibraryTagsBrowserLabels = {
      title: "Tags", loading: "Loading tags", empty: "No tags", failed: "Tags unavailable", retry: "Try again",
      notesLoading: "Loading tagged notes", notesEmpty: "No tagged notes", notesFailed: "Tagged notes unavailable",
      loadMore: "Load more", loadingMore: "Loading more", open: "Open", rename: "Rename",
      renameTitle: "Rename tag", renameDescription: "Rename description", renameCurrent: "Current tag:",
      renameReplacement: "New tag", renameCancel: "Cancel", renameConfirm: "Rename tag",
      renamePending: "Renaming", renameFailed: "Rename failed",
      merge: "Merge", mergeTitle: "Merge tag", mergeDescription: "Merge description",
      mergeSource: "Source tag:", mergeTarget: "Merge into", mergeCancel: "Cancel",
      mergeConfirm: "Merge tag", mergePending: "Merging", mergeFailed: "Merge failed",
      remove: "Remove from all pages", removeTitle: "Remove tag from all pages?", removeDescription: "Remove description",
      removeCurrent: "Tag:", removePageCount: "Current pages:", removeCancel: "Cancel",
      removeConfirm: "Remove from all pages", removePending: "Removing", removeFailed: "Remove failed",
      removePage: "Remove tag", removePageTitle: "Remove tag from this page?", removePageDescription: "Remove from one page",
      removePageCurrentTag: "Tag:", removePageCurrentPage: "Page:", removePageConfirm: "Remove tag",
      removePagePending: "Removing", removePageFailed: "Page remove failed",
      noteCount: (count) => `${count} notes`,
    };
    const snapshotId = `library_tags_snapshot_${"a".repeat(64)}`;
    const mergeRequests: LibraryMergeTagRequest[] = [];
    let committed = false;
    let resolveStale!: (result: LibraryMergeTagResult) => void;
    const api = {
      tags: vi.fn(async (request: LibraryTagsRequest): Promise<LibraryTagsResult> => ({
        apiVersion: 1,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        mode: "list_tags",
        status: "ready",
        snapshotId,
        tags: committed
          ? [{ tag: "archive", pageCount: 3 }, { tag: "notes", pageCount: 7 }]
          : [{ tag: "research", pageCount: 2 }, { tag: "archive", pageCount: 3 }, { tag: "notes", pageCount: 5 }],
        total: committed ? 2 : 3,
      })),
      renameTag: vi.fn(async (request: LibraryRenameTagRequest): Promise<LibraryRenameTagResult> => ({
        ...request,
        status: "failed",
      })),
      mergeTag: vi.fn((request: LibraryMergeTagRequest): Promise<LibraryMergeTagResult> => {
        mergeRequests.push(request);
        if (mergeRequests.length === 1) {
          return new Promise((resolve) => { resolveStale = resolve; });
        }
        committed = true;
        return Promise.resolve({
          ...request,
          status: "committed",
          operationId: "operation_library_tag_merge",
          mergedPageCount: 2,
        });
      }),
      removeTag: vi.fn(async (request: LibraryRemoveTagRequest): Promise<LibraryRemoveTagResult> => ({
        ...request,
        status: "failed",
      })),
      removePageTag: vi.fn(async (request: LibraryRemovePageTagRequest): Promise<LibraryRemovePageTagResult> => ({
        ...request,
        status: "failed",
      })),
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LibraryTagsBrowser, {
        activeVaultId: "vault_20260730_librarytags",
        api,
        labels,
        onOpenNote: async () => undefined,
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const trigger = buttonWithLabel(container, "Merge: research");
    await clickButton(dom, trigger);
    const select = requireElement(container.querySelector<HTMLSelectElement>("select"));
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["archive", "notes"]);
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")?.set?.call(select, "notes");
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await settle(dom);
    });
    const confirm = buttonNamed(container, "Merge tag");
    await act(async () => {
      confirm.click();
      confirm.click();
      await settle(dom);
    });
    expect(mergeRequests).toHaveLength(1);
    expect(mergeRequests[0]).toMatchObject({
      activeVaultId: "vault_20260730_librarytags",
      sourceTag: "research",
      targetTag: "notes",
      expectedSnapshotId: snapshotId,
      expectedSourcePageCount: 2,
      expectedTargetPageCount: 5,
    });
    expect(mergeRequests[0]?.requestId).toMatch(/^library_tag_merge_request_[a-z0-9]{16,64}$/u);
    expect(JSON.stringify(mergeRequests[0])).not.toMatch(/pageId|path|body/u);
    resolveStale({ ...mergeRequests[0]!, status: "stale" });
    await waitFor(dom, () => container.textContent?.includes("Merge failed") === true);
    expect(select.value).toBe("notes");
    await waitFor(dom, () => dom.window.document.activeElement === select);

    await clickButton(dom, buttonNamed(container, "Merge tag"));
    await waitFor(dom, () => container.textContent?.includes("research") === false && container.querySelector("select") === null);
    expect(mergeRequests).toHaveLength(2);
    expect(api.tags).toHaveBeenCalledTimes(2);
    await waitFor(dom, () =>
      dom.window.document.activeElement?.matches("button.search-result") === true &&
      dom.window.document.activeElement.textContent?.includes("notes") === true,
    );

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("removes one exact tag from all pages with reversible confirmation and authoritative focus", async () => {
    const dom = createDom();
    Object.defineProperty(dom.window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0),
    });
    const labels: LibraryTagsBrowserLabels = {
      title: "Tags", loading: "Loading tags", empty: "No tags", failed: "Tags unavailable", retry: "Try again",
      notesLoading: "Loading tagged notes", notesEmpty: "No tagged notes", notesFailed: "Tagged notes unavailable",
      loadMore: "Load more", loadingMore: "Loading more", open: "Open", rename: "Rename",
      renameTitle: "Rename tag", renameDescription: "Rename description", renameCurrent: "Current tag:",
      renameReplacement: "New tag", renameCancel: "Cancel", renameConfirm: "Rename tag",
      renamePending: "Renaming", renameFailed: "Rename failed",
      merge: "Merge", mergeTitle: "Merge tag", mergeDescription: "Merge description",
      mergeSource: "Source tag:", mergeTarget: "Merge into", mergeCancel: "Cancel",
      mergeConfirm: "Merge tag", mergePending: "Merging", mergeFailed: "Merge failed",
      remove: "Remove from all pages", removeTitle: "Remove tag from all pages?", removeDescription: "Undo in Activity.",
      removeCurrent: "Tag:", removePageCount: "Current pages:", removeCancel: "Cancel",
      removeConfirm: "Remove from all pages", removePending: "Removing", removeFailed: "Remove failed",
      removePage: "Remove tag", removePageTitle: "Remove tag from this page?", removePageDescription: "Remove from one page",
      removePageCurrentTag: "Tag:", removePageCurrentPage: "Page:", removePageConfirm: "Remove tag",
      removePagePending: "Removing", removePageFailed: "Page remove failed",
      noteCount: (count) => `${count} notes`,
    };
    const snapshotId = `library_tags_snapshot_${"a".repeat(64)}`;
    const removeRequests: LibraryRemoveTagRequest[] = [];
    let committed = false;
    let resolveStale!: (result: LibraryRemoveTagResult) => void;
    const api = {
      tags: vi.fn(async (request: LibraryTagsRequest): Promise<LibraryTagsResult> => ({
        apiVersion: 1,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        mode: "list_tags",
        status: "ready",
        snapshotId,
        tags: committed
          ? [{ tag: "notes", pageCount: 3 }]
          : [{ tag: "research", pageCount: 2 }, { tag: "notes", pageCount: 3 }],
        total: committed ? 1 : 2,
      })),
      renameTag: vi.fn(async (request: LibraryRenameTagRequest): Promise<LibraryRenameTagResult> => ({
        ...request,
        status: "failed",
      })),
      mergeTag: vi.fn(async (request: LibraryMergeTagRequest): Promise<LibraryMergeTagResult> => ({
        ...request,
        status: "failed",
      })),
      removeTag: vi.fn((request: LibraryRemoveTagRequest): Promise<LibraryRemoveTagResult> => {
        removeRequests.push(request);
        if (removeRequests.length === 1) {
          return new Promise((resolve) => { resolveStale = resolve; });
        }
        committed = true;
        return Promise.resolve({
          ...request,
          status: "committed",
          operationId: "operation_library_tag_remove",
          removedPageCount: 2,
        });
      }),
      removePageTag: vi.fn(async (request: LibraryRemovePageTagRequest): Promise<LibraryRemovePageTagResult> => ({
        ...request,
        status: "failed",
      })),
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LibraryTagsBrowser, {
        activeVaultId: "vault_20260730_librarytags",
        api,
        labels,
        onOpenNote: async () => undefined,
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await clickButton(dom, buttonWithLabel(container, "Remove from all pages: research"));
    expect(container.textContent).toContain("research");
    expect(container.textContent).toContain("2 notes");
    expect(container.textContent).toContain("Undo in Activity.");
    const confirm = requireElement(container.querySelector<HTMLButtonElement>(".confirmation-dialog .primary.danger"));
    await act(async () => {
      confirm.click();
      confirm.click();
      await settle(dom);
    });
    expect(removeRequests).toHaveLength(1);
    expect(removeRequests[0]).toMatchObject({
      activeVaultId: "vault_20260730_librarytags",
      tag: "research",
      expectedSnapshotId: snapshotId,
      expectedPageCount: 2,
    });
    expect(removeRequests[0]?.requestId).toMatch(/^library_tag_remove_request_[a-z0-9]{16,64}$/u);
    expect(JSON.stringify(removeRequests[0])).not.toMatch(/pageId|path|body/u);
    resolveStale({ ...removeRequests[0]!, status: "stale" });
    await waitFor(dom, () => container.textContent?.includes("Remove failed") === true);
    expect(container.textContent).toContain("research");
    await waitFor(dom, () => dom.window.document.activeElement?.textContent?.trim() === "Cancel");

    await clickButton(dom, requireElement(container.querySelector<HTMLButtonElement>(".confirmation-dialog .primary.danger")));
    await waitFor(dom, () => container.textContent?.includes("research") === false && container.querySelector(".confirmation-dialog") === null);
    expect(removeRequests).toHaveLength(2);
    expect(api.tags).toHaveBeenCalledTimes(2);
    await waitFor(dom, () =>
      dom.window.document.activeElement?.matches("button.search-result") === true &&
      dom.window.document.activeElement.textContent?.includes("notes") === true,
    );

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("removes one exact tag from one listed page and reloads the authoritative tag pages", async () => {
    const dom = createDom();
    Object.defineProperty(dom.window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0),
    });
    const labels: LibraryTagsBrowserLabels = {
      title: "Tags", loading: "Loading tags", empty: "No tags", failed: "Tags unavailable", retry: "Try again",
      notesLoading: "Loading tagged notes", notesEmpty: "No tagged notes", notesFailed: "Tagged notes unavailable",
      loadMore: "Load more", loadingMore: "Loading more", open: "Open", rename: "Rename",
      renameTitle: "Rename tag", renameDescription: "Rename description", renameCurrent: "Current tag:",
      renameReplacement: "New tag", renameCancel: "Cancel", renameConfirm: "Rename tag",
      renamePending: "Renaming", renameFailed: "Rename failed",
      merge: "Merge", mergeTitle: "Merge tag", mergeDescription: "Merge description",
      mergeSource: "Source tag:", mergeTarget: "Merge into", mergeCancel: "Cancel",
      mergeConfirm: "Merge tag", mergePending: "Merging", mergeFailed: "Merge failed",
      remove: "Remove from all pages", removeTitle: "Remove tag from all pages?", removeDescription: "Undo in Activity.",
      removeCurrent: "Tag:", removePageCount: "Current pages:", removeCancel: "Cancel",
      removeConfirm: "Remove from all pages", removePending: "Removing", removeFailed: "Remove failed",
      removePage: "Remove tag", removePageTitle: "Remove tag from this page?", removePageDescription: "Remove from one page",
      removePageCurrentTag: "Tag:", removePageCurrentPage: "Page:", removePageConfirm: "Remove tag",
      removePagePending: "Removing", removePageFailed: "Page remove failed",
      noteCount: (count) => `${count} notes`,
    };
    const snapshotId = `library_tags_snapshot_${"a".repeat(64)}`;
    const firstPage = { pageId: "page_20260730_research01", title: "Research brief", pageType: "note" as const,
      status: "active" as const, updatedAt: "2026-07-30T08:00:00.000Z" };
    const secondPage = { pageId: "page_20260730_research02", title: "Second note", pageType: "note" as const,
      status: "active" as const, updatedAt: "2026-07-30T08:01:00.000Z" };
    const removeRequests: LibraryRemovePageTagRequest[] = [];
    let committed = false;
    let resolveStale!: (result: LibraryRemovePageTagResult) => void;
    const api = {
      tags: vi.fn(async (request: LibraryTagsRequest): Promise<LibraryTagsResult> => request.mode === "list_tags" ? ({
        apiVersion: 1, requestId: request.requestId, activeVaultId: request.activeVaultId, mode: "list_tags",
        status: "ready", snapshotId, tags: [{ tag: "research", pageCount: committed ? 1 : 2 }], total: 1,
      }) : ({
        apiVersion: 1, requestId: request.requestId, activeVaultId: request.activeVaultId,
        mode: "list_pages_for_tag", tag: request.tag, status: "ready", snapshotId,
        pages: committed ? [secondPage] : [firstPage, secondPage], total: committed ? 1 : 2,
      })),
      renameTag: vi.fn(async (request: LibraryRenameTagRequest): Promise<LibraryRenameTagResult> => ({ ...request, status: "failed" })),
      mergeTag: vi.fn(async (request: LibraryMergeTagRequest): Promise<LibraryMergeTagResult> => ({ ...request, status: "failed" })),
      removeTag: vi.fn(async (request: LibraryRemoveTagRequest): Promise<LibraryRemoveTagResult> => ({ ...request, status: "failed" })),
      removePageTag: vi.fn((request: LibraryRemovePageTagRequest): Promise<LibraryRemovePageTagResult> => {
        removeRequests.push(request);
        if (removeRequests.length === 1) return new Promise((resolve) => { resolveStale = resolve; });
        committed = true;
        return Promise.resolve({ ...request, status: "committed", operationId: "operation_library_page_tag_remove" });
      }),
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LibraryTagsBrowser, { activeVaultId: "vault_20260730_librarytags", api, labels,
        onOpenNote: async () => undefined }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await clickButton(dom, buttonNamed(container, "research2 notes"));
    await waitFor(dom, () => container.textContent?.includes("Research brief") === true);
    await clickButton(dom, buttonWithLabel(container, "Remove tag: Research brief"));
    expect(container.textContent).toContain("research");
    expect(container.textContent).toContain("Research brief");
    const confirm = requireElement(container.querySelector<HTMLButtonElement>(".confirmation-dialog .primary.danger"));
    await act(async () => { confirm.click(); confirm.click(); await settle(dom); });
    expect(removeRequests).toHaveLength(1);
    expect(removeRequests[0]).toMatchObject({ activeVaultId: "vault_20260730_librarytags", tag: "research",
      pageId: firstPage.pageId, expectedSnapshotId: snapshotId, expectedPageUpdatedAt: firstPage.updatedAt });
    expect(removeRequests[0]?.requestId).toMatch(/^library_page_tag_remove_request_[a-z0-9]{16,64}$/u);
    expect(JSON.stringify(removeRequests[0])).not.toMatch(/path|body/u);
    resolveStale({ ...removeRequests[0]!, status: "stale" });
    await waitFor(dom, () => container.textContent?.includes("Page remove failed") === true);
    expect(container.textContent).toContain("Research brief");
    await waitFor(dom, () => dom.window.document.activeElement?.textContent?.trim() === "Cancel");

    await clickButton(dom, requireElement(container.querySelector<HTMLButtonElement>(".confirmation-dialog .primary.danger")));
    await waitFor(dom, () => container.textContent?.includes("Research brief") === false && container.textContent?.includes("Second note") === true);
    expect(removeRequests).toHaveLength(2);
    expect(api.tags).toHaveBeenCalledTimes(3);
    await waitFor(dom, () => dom.window.document.activeElement?.textContent?.includes("Second note") === true);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps errors body-free, retries with focus return, and marks Tags honestly unavailable", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    let attempts = 0;
    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: libraryList(),
        selectedNote: null,
        selectedNoteRelated: null,
        noteLoadingPageId: null,
        error: null,
        onGoHome: () => undefined,
        onRefresh: async () => undefined,
        onSearch: async (request) => {
          attempts += 1;
          if (attempts === 1) throw new Error("raw vault path and database error");
          return searchResult(request.query, []);
        },
        searchFocusRequest: 0,
        onOpenNote: async () => undefined,
        onCloseNote: () => undefined,
        noteAgentOpen: false,
        onToggleNoteAgent: () => undefined,
        noteAgentToggleRef: { current: null },
        developmentNotice: null,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const search = requireElement(container.querySelector<HTMLInputElement>("#librarySearchInput"));
    await inputText(dom, search, "missing");
    await act(async () => {
      await delay(dom, 150);
    });
    await waitFor(dom, () => container.textContent?.includes("Search is temporarily unavailable") === true);
    expect(container.textContent).not.toContain("raw vault path and database error");

    await act(async () => {
      buttonNamed(container, "Refresh").click();
      await settle(dom);
    });
    await act(async () => {
      await delay(dom, 150);
    });
    expect(attempts).toBe(2);
    await waitFor(dom, () => container.textContent?.includes("No matching pages.") === true);
    await waitFor(dom, () => dom.window.document.activeElement === search);

    const beforeTags = attempts;
    await act(async () => {
      buttonNamed(container, "Tags").focus();
      buttonNamed(container, "Tags").dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "Home",
        bubbles: true
      }));
      await settle(dom);
    });
    expect(buttonNamed(container, "All").getAttribute("aria-selected")).toBe("true");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "All"));

    await act(async () => {
      buttonNamed(container, "Tags").click();
      await settle(dom);
    });
    expect(container.textContent).toContain("Tag search is in development");
    expect(attempts).toBe(beforeTags);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("binds the approved Reader toolbar to real copy and keeps unowned actions honest", async () => {
    const dom = createDom();
    Object.defineProperty(dom.window, "pige", { configurable: true, value: { notes: { unlinkRelation: vi.fn() } } });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const copied: string[] = [];
    const opened: string[] = [];
    const sourceRequests: NoteOpenSourceReferenceRequest[] = [];
    const sourceRevealRequests: NoteRevealSourceRequest[] = [];
    const sourceReconnectRequests: NoteReconnectOriginalSourceRequest[] = [];
    const reconnectedNotes: NoteRenderResult[] = [];
    const editorOpenRequests: NoteEditorOpenRequest[] = [];
    const editorSaveRequests: NoteEditorSaveRequest[] = [];
    const committedNotes: NoteRenderResult[] = [];
    const unavailable: string[] = [];
    let cleared = 0;
    const reconnectProof = {
      sourceId: readerNote().summary.sourceIds[0]!,
      sourceKind: "plain_text_file" as const,
      sourceRevision: `sourcerev_${"a".repeat(64)}`,
      expectedAvailability: "unavailable" as const,
      expectedChecksum: `sha256:${"b".repeat(64)}`,
      expectedSize: 12,
      formatIdentity: `sourcefmt_${"c".repeat(64)}`,
      displayName: "Saved source 1"
    };
    const note: NoteRenderResult = {
      ...readerNote(),
      summary: {
        ...readerNote().summary,
        pagePath: "wiki/generated/reader-actions.md"
      },
      reconnectOriginalSourceIds: [readerNote().summary.sourceIds[0]!],
      reconnectOriginalSources: [reconnectProof],
      sourceMetadata: {
        items: [
          { sourceId: readerNote().summary.sourceIds[0]!, status: "current", displayName: "receipt.png",
            category: "image", storage: "reference_original", extraction: "ocr" },
          { sourceId: readerNote().summary.sourceIds[1]!, status: "unavailable" },
        ],
        remainingCount: 0,
      }
    };
    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: libraryList(),
        selectedNote: note,
        selectedNoteRelated: null,
        noteLoadingPageId: null,
        error: null,
        onGoHome: () => undefined,
        onRefresh: async () => undefined,
        onSearch: async () => searchResult("unused", []),
        searchFocusRequest: 0,
        onOpenNote: async (pageId) => { opened.push(pageId); },
        onCloseNote: () => undefined,
        noteAgentOpen: false,
        onToggleNoteAgent: () => undefined,
        noteAgentToggleRef: { current: null },
        developmentNotice: null,
        onClearDevelopment: () => { cleared += 1; },
        onCopyNote: async (pageId) => { copied.push(pageId); return true; },
        onOpenNoteEditor: async (request) => {
          editorOpenRequests.push(request);
          return {
            apiVersion: 1,
            requestId: request.requestId,
            activeVaultId: request.activeVaultId,
            pageId: request.pageId,
            status: "ready",
            renderContextId: request.renderContextId,
            revision: `noteeditrev_${"a".repeat(32)}`,
            markdown: "# Reader actions\n\nOriginal body\n"
          };
        },
        onSaveNoteEditor: async (request) => {
          editorSaveRequests.push(request);
          return {
            apiVersion: 1,
            requestId: request.requestId,
            activeVaultId: request.activeVaultId,
            pageId: request.pageId,
            status: "committed",
            revision: `noteeditrev_${"b".repeat(32)}`,
            operationId: "operation_library_editor",
            render: { ...note, html: "<p>Edited body</p>", byteSize: 25, renderContextId: `notectx_${"d".repeat(32)}` }
          };
        },
        onReloadNoteEditor: async (request) => ({
          apiVersion: 1,
          requestId: request.requestId,
          activeVaultId: request.activeVaultId,
          pageId: request.pageId,
          status: "failed"
        }),
        onNoteEditorCommitted: (result) => committedNotes.push(result.render),
        activeVaultId: "vault_20260715_fullui01",
        onOpenSourceReference: async (request) => {
          sourceRequests.push(request);
          return {
            apiVersion: 1,
            requestId: request.requestId,
            status: "resolved",
            target: { pageId: "page_20260715_source111" }
          };
        },
        onRevealSource: async (request) => {
          sourceRevealRequests.push(request);
          return { ...request, status: "revealed" };
        },
        onReconnectOriginalSource: async (request) => ({ ...request, status: "cancelled" }),
        onCurrentNoteSourceReconnected: (render) => reconnectedNotes.push(render),
        onDevelopment: (capability) => unavailable.push(capability),
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;

    await act(async () => {
      buttonWithLabel(container, "Copy Markdown").click();
      await settle(dom);
    });
    expect(copied).toEqual([note.summary.pageId]);
    expect(container.textContent).toContain("Markdown copied.");
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);

    await act(async () => {
      buttonWithLabel(container, "Edit note").click();
      await settle(dom);
    });
    expect(editorOpenRequests).toHaveLength(1);
    expect(editorOpenRequests[0]).toMatchObject({
      activeVaultId: "vault_20260715_fullui01",
      pageId: note.summary.pageId,
      renderContextId: note.renderContextId
    });
    expect(container.textContent).toContain("Edit Markdown");
    const markdown = requireElement(container.querySelector<HTMLTextAreaElement>("textarea"));
    await inputText(dom, markdown, "# Edited\n");
    await act(async () => {
      buttonNamed(container, "Save").click();
      await settle(dom);
    });
    expect(editorSaveRequests[0]).toMatchObject({
      activeVaultId: "vault_20260715_fullui01",
      pageId: note.summary.pageId,
      renderContextId: note.renderContextId,
      expectedRevision: `noteeditrev_${"a".repeat(32)}`,
      markdown: "# Edited\n"
    });
    expect(committedNotes[0]?.renderContextId).toBe(`notectx_${"d".repeat(32)}`);

    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: libraryList(), selectedNote: note, selectedNoteRelated: null,
        noteLoadingPageId: null, error: null, onGoHome: () => undefined,
        onRefresh: async () => undefined, onSearch: async () => searchResult("unused", []), searchFocusRequest: 0,
        onOpenNote: async (pageId) => { opened.push(pageId); }, onCloseNote: () => undefined,
        noteAgentOpen: false, onToggleNoteAgent: () => undefined, noteAgentToggleRef: { current: null },
        developmentNotice: null, onClearDevelopment: () => { cleared += 1; },
        onCopyNote: async (pageId) => { copied.push(pageId); return true; }, activeVaultId: "vault_20260715_fullui01",
        onOpenSourceReference: async (request) => {
          sourceRequests.push(request);
          return { apiVersion: 1, requestId: request.requestId, status: "resolved", target: { pageId: "page_20260715_source111" } };
        },
        onRevealSource: async (request) => {
          sourceRevealRequests.push(request);
          return { ...request, status: "revealed" };
        },
        onReconnectOriginalSource: async (request) => {
          sourceReconnectRequests.push(request);
          return {
            ...request,
            status: "reconnected",
            render: {
              ...note,
              renderContextId: `notectx_${"e".repeat(32)}`,
              reconnectOriginalSourceIds: [],
              reconnectOriginalSources: []
            },
            operationId: "op_20260715_readerreconnect",
            resumedJobCount: 0
          };
        },
        onCurrentNoteSourceReconnected: (render) => reconnectedNotes.push(render),
        onDevelopment: (capability) => unavailable.push(capability), t
      }));
      await settle(dom);
    });

    const sourceButtons = container.querySelectorAll<HTMLButtonElement>(".reader-source");
    expect(sourceButtons).toHaveLength(2);
    expect(container.textContent).toContain("receipt.png");
    expect(container.textContent).toContain("Image · Referenced original · OCR text");
    expect(container.textContent).toContain("Source details unavailable");
    expect(container.textContent).not.toContain("source_private_0001");
    expect(container.textContent).not.toContain("/Users/example/private.md");
    const revealSource = requireElement(container.querySelector<HTMLButtonElement>(
      `[data-reader-source-reveal="${note.summary.sourceIds[0]}"]`
    ));
    revealSource.focus();
    await act(async () => {
      revealSource.click();
      await settle(dom);
    });
    expect(sourceRevealRequests[0]).toMatchObject({
      activeVaultId: "vault_20260715_fullui01",
      currentPageId: note.summary.pageId,
      renderContextId: note.renderContextId,
      sourceId: note.summary.sourceIds[0]
    });
    expect(container.textContent).toContain("Original opened.");
    expect(dom.window.document.activeElement).toBe(revealSource);
    const reconnectSource = requireElement(container.querySelector<HTMLButtonElement>(
      `[data-reader-source-reconnect="${note.summary.sourceIds[0]}"]`
    ));
    reconnectSource.focus();
    await act(async () => {
      reconnectSource.click();
      await settle(dom);
    });
    expect(sourceReconnectRequests[0]).toMatchObject({
      activeVaultId: "vault_20260715_fullui01",
      currentPageId: note.summary.pageId,
      renderContextId: note.renderContextId,
      sourceId: note.summary.sourceIds[0]
    });
    expect(reconnectedNotes.at(-1)?.renderContextId).toBe(`notectx_${"e".repeat(32)}`);
    expect(container.textContent).toContain("Original reconnected.");
    await act(async () => {
      sourceButtons[0]!.click();
      await settle(dom);
    });
    expect(sourceRequests).toHaveLength(1);
    expect(sourceRequests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_20260715_fullui01",
      currentPageId: note.summary.pageId,
      renderContextId: note.renderContextId,
      sourceId: note.summary.sourceIds[0]
    });
    expect(opened).toEqual(["page_20260715_source111"]);
    expect(unavailable).toEqual([]);

    for (const pageType of ["source", "claim", "question", "concept", "entity", "topic"] as const) {
      const readOnlyPage: NoteRenderResult = {
        ...note,
        summary: {
          ...note.summary,
          pageId: `page_20260715_${pageType}readonly`,
          pageType,
          pagePath: pageType === "source" ? "sources/read-only.md" : "wiki/topics/read-only.md"
        }
      };
      await act(async () => {
        root.render(createElement(LibraryPanel, {
          libraryList: libraryList(), selectedNote: readOnlyPage, selectedNoteRelated: null,
          noteLoadingPageId: null, error: null, onGoHome: () => undefined,
          onRefresh: async () => undefined, onSearch: async () => searchResult("unused", []), searchFocusRequest: 0,
          onOpenNote: async () => undefined, onCloseNote: () => undefined,
          noteAgentOpen: false, onToggleNoteAgent: () => undefined, noteAgentToggleRef: { current: null },
          developmentNotice: null, onClearDevelopment: () => undefined,
          onCopyNote: async () => true,
          onOpenNoteEditor: async (request) => {
            editorOpenRequests.push(request);
            return {
              apiVersion: 1, requestId: request.requestId, activeVaultId: request.activeVaultId,
              pageId: request.pageId, status: "failed"
            };
          },
          activeVaultId: "vault_20260715_fullui01",
          onDevelopment: (capability) => unavailable.push(capability), t
        }));
        await settle(dom);
      });
      if (pageType !== "topic") {
        const sourceEdit = buttonWithLabel(container, pageType === "source" ? "Edit Markdown" : "Edit note");
        await act(async () => {
          sourceEdit.click();
          await settle(dom);
        });
        expect(editorOpenRequests.at(-1)).toMatchObject({
          activeVaultId: "vault_20260715_fullui01",
          pageId: readOnlyPage.summary.pageId,
          renderContextId: readOnlyPage.renderContextId
        });
        expect(container.querySelector(".note-reader h1")?.textContent).toBe(readOnlyPage.summary.title);
        expect(buttonWithLabel(container, pageType === "source" ? "Edit Markdown" : "Edit note").disabled).toBe(false);
      } else {
        expect(container.querySelectorAll<HTMLButtonElement>('button[aria-label="Edit note"]')).toHaveLength(0);
        expect(container.querySelectorAll<HTMLButtonElement>('button[aria-label="Edit Markdown"]')).toHaveLength(0);
      }
    }
    expect(editorOpenRequests).toHaveLength(6);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("moves an eligible generated knowledge page to recoverable Trash and retains the Reader on stale", async () => {
    const dom = createDom();
    Object.defineProperty(dom.window, "pige", { configurable: true, value: { notes: {} } });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: NoteTrashCurrentRequest[] = [];
    let committed = 0;
    let mode: "stale" | "committed" = "stale";
    const note: NoteRenderResult = {
      ...readerNote(),
      summary: { ...readerNote().summary, pageType: "claim", title: "Generated claim" },
      trashEligibility: { canTrash: true, revision: `noteeditrev_${"a".repeat(32)}` }
    };
    const onTrashCurrentNote = async (request: NoteTrashCurrentRequest): Promise<NoteTrashCurrentResult> => {
      requests.push(request);
      return mode === "committed"
        ? {
            ...request,
            status: "committed",
            operationId: "operation_note_trash_library",
            authority: {
              pageId: request.currentPageId,
              pageState: "trashed",
              readerState: "closed",
              libraryPresence: "absent",
              canTrash: false
            }
          }
        : {
            ...request,
            status: "stale",
            authority: {
              pageId: request.currentPageId,
              pageState: "present",
              readerState: "refresh_required",
              libraryPresence: "present",
              canTrash: false
            }
          };
    };
    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: libraryList(), selectedNote: note, selectedNoteRelated: null,
        noteLoadingPageId: null, error: null, onGoHome: () => undefined,
        onRefresh: async () => undefined, onSearch: async () => searchResult("unused", []), searchFocusRequest: 0,
        onOpenNote: async () => undefined, onCloseNote: () => undefined,
        noteAgentOpen: false, onToggleNoteAgent: () => undefined, noteAgentToggleRef: { current: null },
        developmentNotice: null, onClearDevelopment: () => undefined, onCopyNote: async () => true,
        activeVaultId: "vault_20260715_fullui01", onTrashCurrentNote,
        onCurrentNoteTrashed: () => { committed += 1; }, onDevelopment: () => undefined, t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await act(async () => {
      buttonWithLabel(container, "More note actions").click();
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(container, "Move to Trash").click();
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(container, "Move to Trash").click();
      await settle(dom);
    });
    expect(requests[0]).toMatchObject({
      activeVaultId: "vault_20260715_fullui01",
      currentPageId: note.summary.pageId,
      renderContextId: note.renderContextId,
      expectedRevision: note.trashEligibility?.revision
    });
    expect(requests[0]?.requestId).toMatch(/^notetrashreq_[a-z0-9]{16,64}$/u);
    expect(container.querySelector(".note-reader")).not.toBeNull();
    expect(container.textContent).toContain("The knowledge page remains open.");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Cancel"));
    expect(committed).toBe(0);

    mode = "committed";
    await act(async () => {
      buttonNamed(container, "Move to Trash").click();
      await settle(dom);
    });
    expect(requests).toHaveLength(2);
    expect(committed).toBe(1);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("archives only the exact eligible Reader topic and adopts the authoritative read-only render", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: NoteArchiveCurrentRequest[] = [];
    const adopted: NoteRenderResult[] = [];
    let mode: "stale" | "committed" = "stale";
    let selected: NoteRenderResult = {
      ...readerNote(),
      summary: { ...readerNote().summary, pageType: "topic" },
      archiveEligibility: { canArchive: true, revision: `noteeditrev_${"a".repeat(32)}` }
    };
    const onArchiveCurrentNote = async (
      request: NoteArchiveCurrentRequest
    ): Promise<NoteArchiveCurrentResult> => {
      requests.push(request);
      return mode === "committed"
        ? {
            ...request,
            status: "committed",
            operationId: "operation_note_archive_library",
            render: {
              ...selected,
              summary: { ...selected.summary, status: "archived" },
              renderContextId: `notectx_${"b".repeat(32)}`,
              archiveEligibility: { canArchive: false, revision: `noteeditrev_${"b".repeat(32)}` }
            }
          }
        : { ...request, status: "stale" };
    };
    const renderPanel = (): void => {
      root.render(createElement(LibraryPanel, {
        libraryList: libraryList(), selectedNote: selected, selectedNoteRelated: null,
        noteLoadingPageId: null, error: null, onGoHome: () => undefined,
        onRefresh: async () => undefined, onSearch: async () => searchResult("unused", []), searchFocusRequest: 0,
        onOpenNote: async () => undefined, onCloseNote: () => undefined,
        noteAgentOpen: false, onToggleNoteAgent: () => undefined, noteAgentToggleRef: { current: null },
        developmentNotice: null, onClearDevelopment: () => undefined, onCopyNote: async () => true,
        activeVaultId: "vault_20260715_fullui01", onArchiveCurrentNote,
        onCurrentNoteArchived: (render) => {
          adopted.push(render);
          selected = render;
          renderPanel();
        },
        onDevelopment: () => undefined, t
      }));
    };
    await act(async () => {
      renderPanel();
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await clickButton(dom, buttonWithLabel(container, "More note actions"));
    await clickButton(dom, buttonNamed(container, "Archive"));
    await clickButton(dom, buttonNamed(container, "Archive"));
    expect(requests[0]).toMatchObject({
      activeVaultId: "vault_20260715_fullui01",
      currentPageId: selected.summary.pageId,
      renderContextId: `notectx_${"c".repeat(32)}`,
      expectedRevision: `noteeditrev_${"a".repeat(32)}`
    });
    expect(requests[0]?.requestId).toMatch(/^notearchivereq_[a-z0-9]{16,64}$/u);
    expect(container.querySelector(".note-reader")).not.toBeNull();
    expect(container.textContent).toContain("The note remains active. Review it and try again.");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Cancel"));
    mode = "committed";
    await clickButton(dom, buttonNamed(container, "Archive"));
    await waitFor(dom, () => adopted.length === 1);
    expect(adopted[0]?.summary.status).toBe("archived");
    expect(container.querySelector(".note-reader")).not.toBeNull();
    expect(container.querySelector('[data-reader-action="edit"]')).toBeNull();
    expect(container.querySelector('[data-reader-action="more"]')).toBeNull();
    await act(async () => root.unmount());
    dom.window.close();
  });

  it.each(["note", "claim", "question", "concept", "entity"] as const)(
    "corrects tags and topics on the exact Library Reader %s and retains both drafts on stale", async (pageType) => {
    const dom = createDom(); const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: NoteEditTaxonomyRequest[] = []; const adopted: NoteRenderResult[] = []; let mode: "stale" | "committed" = "stale";
    const initial = readerNote();
    let selected: NoteRenderResult = { ...initial, summary: { ...initial.summary, pageType },
      tagging: { tags: ["research"], topics: ["PKM"], canAdd: true, canEdit: true, revision: `noteeditrev_${"a".repeat(32)}` } };
    const onAddNoteTag = async (request: NoteEditTaxonomyRequest): Promise<NoteEditTaxonomyResult> => {
      requests.push(request); return mode === "committed"
        ? { ...request, status: "committed", operationId: "operation_note_taxonomy_library", render: {
            ...selected, tagging: { tags: [...request.tags], topics: [...request.topics], canAdd: true, canEdit: true, revision: `noteeditrev_${"b".repeat(32)}` } } }
        : { ...request, status: "stale" };
    };
    const renderPanel = (): void => root.render(createElement(LibraryPanel, {
      libraryList: libraryList(), selectedNote: selected, selectedNoteRelated: null, noteLoadingPageId: null, error: null,
      onGoHome: () => undefined, onRefresh: async () => undefined, onSearch: async () => searchResult("unused", []), searchFocusRequest: 0,
      onOpenNote: async () => undefined, onCloseNote: () => undefined, noteAgentOpen: false, onToggleNoteAgent: () => undefined,
      noteAgentToggleRef: { current: null }, developmentNotice: null, onClearDevelopment: () => undefined, onCopyNote: async () => true,
      activeVaultId: "vault_20260715_fullui01", onAddNoteTag, onCurrentNoteTagged: (render) => { adopted.push(render); selected = render; renderPanel(); },
      onDevelopment: () => undefined, t
    }));
    await act(async () => { renderPanel(); await settle(dom); });
    const container = dom.window.document.querySelector("#root")!;
    await clickButton(dom, buttonWithLabel(container, "More note actions")); await clickButton(dom, buttonNamed(container, "Edit tags and topics"));
    const topicsInput = container.querySelector<HTMLInputElement>('input[placeholder="Knowledge management"]')!;
    const tagsInput = container.querySelector<HTMLInputElement>('input[placeholder="research, reading"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(tagsInput, "  field   notes , research  ");
      tagsInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      setter?.call(topicsInput, "PKM, Knowledge   management");
      topicsInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await settle(dom);
    });
    await clickButton(dom, buttonNamed(container, "Save categories"));
    expect(requests[0]).toMatchObject({ apiVersion: 1, activeVaultId: "vault_20260715_fullui01", currentPageId: selected.summary.pageId,
      renderContextId: selected.renderContextId, expectedRevision: `noteeditrev_${"a".repeat(32)}`,
      tags: ["field notes", "research"], topics: ["PKM", "Knowledge management"] });
    expect(requests[0]?.requestId).toMatch(/^notetaxonomyreq_[a-z0-9]{16,64}$/u);
    expect(container.textContent).toContain("The categories were not changed. Your edits are preserved; review them and try again.");
    expect(tagsInput.value).toBe("  field   notes , research  "); expect(topicsInput.value).toBe("PKM, Knowledge   management");
    expect(dom.window.document.activeElement).toBe(tagsInput); expect(adopted).toHaveLength(0);
    mode = "committed"; await clickButton(dom, buttonNamed(container, "Save categories")); await waitFor(dom, () => adopted.length === 1);
    expect(adopted[0]?.tagging?.tags).toContain("field notes"); expect(adopted[0]?.tagging?.topics).toContain("Knowledge management"); expect(container.querySelector(".note-reader")).not.toBeNull();
    await act(async () => root.unmount()); dom.window.close();
  });

  it.each(["note", "claim", "question", "concept", "entity"] as const)(
    "renames the exact Library Reader %s and retains the draft on conflict",
    async (pageType) => {
    const dom = createDom(), root = createRoot(dom.window.document.querySelector("#root")!);
    Object.defineProperty(dom.window, "pige", { configurable: true, value: { notes: { unlinkRelation: vi.fn() } } });
    const requests: NoteRenameRequest[] = [], adopted: NoteRenderResult[] = []; let mode: "conflict" | "committed" = "conflict";
    const initial = readerNote();
    let selected: NoteRenderResult = { ...initial, summary: { ...initial.summary, pageType },
      renameEligibility: { canRename: true, revision: `noteeditrev_${"a".repeat(32)}` } };
    const onRenameCurrentNote = async (request: NoteRenameRequest): Promise<NoteRenameResult> => {
      requests.push(request); return mode === "committed"
        ? { ...request, status: "committed", operationId: "op_20260731_libraryrename123", render: {
            ...selected, summary: { ...selected.summary, title: request.title, pagePath: "wiki/renamed-library-note--reader1111.md" },
            renderContextId: `notectx_${"d".repeat(32)}`, renameEligibility: { canRename: true, revision: `noteeditrev_${"b".repeat(32)}` } } }
        : { ...request, status: "conflict" };
    };
    const renderPanel = (): void => root.render(createElement(LibraryPanel, {
      libraryList: libraryList(), selectedNote: selected, selectedNoteRelated: null, noteLoadingPageId: null, error: null,
      onGoHome: () => undefined, onRefresh: async () => undefined, onSearch: async () => searchResult("unused", []), searchFocusRequest: 0,
      onOpenNote: async () => undefined, onCloseNote: () => undefined, noteAgentOpen: false, onToggleNoteAgent: () => undefined,
      noteAgentToggleRef: { current: null }, developmentNotice: null, onClearDevelopment: () => undefined, onCopyNote: async () => true,
      activeVaultId: "vault_20260715_fullui01", onRenameCurrentNote, onCurrentNoteRenamed: (render) => { adopted.push(render); selected = render; renderPanel(); },
      onDevelopment: () => undefined, t
    }));
    await act(async () => { renderPanel(); await settle(dom); });
    const container = dom.window.document.querySelector("#root")!;
    await clickButton(dom, buttonWithLabel(container, "More note actions")); await clickButton(dom, buttonNamed(container, "Rename page"));
    const input = requireElement(container.querySelector<HTMLInputElement>(".confirmation-dialog input"));
    await inputText(dom, input, "  Renamed   Library Note  "); await clickButton(dom, buttonNamed(container, "Rename"));
    expect(requests[0]).toMatchObject({ apiVersion: 1, activeVaultId: "vault_20260715_fullui01",
      currentPageId: selected.summary.pageId, renderContextId: selected.renderContextId,
      expectedRevision: `noteeditrev_${"a".repeat(32)}`, title: "Renamed Library Note" });
    expect(JSON.stringify(requests[0])).not.toMatch(/path|markdown|contentHash/iu);
    expect(container.textContent).toContain("The page was not renamed. Your title is preserved; review it and try again.");
    expect(input.value).toBe("  Renamed   Library Note  ");
    mode = "committed"; await clickButton(dom, buttonNamed(container, "Rename")); await waitFor(dom, () => adopted.length === 1);
    expect(adopted[0]?.summary.title).toBe("Renamed Library Note"); expect(container.querySelector(".note-reader")).not.toBeNull();
    await act(async () => root.unmount()); dom.window.close();
  });

  it.each(["note", "claim", "question", "concept", "entity"] as const)(
    "adds and removes one exact Library Reader %s alias while retaining an ambiguous draft", async (pageType) => {
    const dom = createDom(), root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: NoteAliasChangeRequest[] = [], adopted: NoteRenderResult[] = []; let mode: "conflict" | "committed" = "conflict";
    const initial = readerNote();
    let selected: NoteRenderResult = { ...initial, summary: { ...initial.summary, pageType }, aliasing: { aliases: [], canAdd: true, canRemove: false,
      revision: `noteeditrev_${"a".repeat(32)}` } };
    const onChangeNoteAlias = async (request: NoteAliasChangeRequest): Promise<NoteAliasChangeResult> => {
      requests.push(request); if (mode === "conflict") return { ...request, status: "conflict" };
      const aliases = request.action === "add" ? [request.alias] : [];
      return { ...request, status: "committed", operationId: `op_20260731_aliasui${requests.length}12345`, render: { ...selected,
        renderContextId: `notectx_${(requests.length === 2 ? "b" : "c").repeat(32)}`,
        aliasing: { aliases, canAdd: true, canRemove: aliases.length > 0, revision: `noteeditrev_${"b".repeat(32)}` } } };
    };
    const renderPanel = (): void => root.render(createElement(LibraryPanel, { libraryList: libraryList(), selectedNote: selected,
      selectedNoteRelated: null, noteLoadingPageId: null, error: null, onGoHome: () => undefined, onRefresh: async () => undefined,
      onSearch: async () => searchResult("unused", []), searchFocusRequest: 0, onOpenNote: async () => undefined, onCloseNote: () => undefined,
      noteAgentOpen: false, onToggleNoteAgent: () => undefined, noteAgentToggleRef: { current: null }, developmentNotice: null,
      onClearDevelopment: () => undefined, onCopyNote: async () => true, activeVaultId: "vault_20260715_fullui01", onChangeNoteAlias,
      onCurrentNoteAliasChanged: (render) => { adopted.push(render); selected = render; renderPanel(); }, onDevelopment: () => undefined, t }));
    await act(async () => { renderPanel(); await settle(dom); }); const container = dom.window.document.querySelector("#root")!;
    await clickButton(dom, buttonWithLabel(container, "More note actions")); await clickButton(dom, buttonNamed(container, "Manage aliases"));
    const input = requireElement(container.querySelector<HTMLInputElement>(".confirmation-dialog input"));
    await inputText(dom, input, "  Second   Name  ");
    await waitFor(dom, () => !buttonNamed(container, "Add alias").disabled);
    await clickButton(dom, buttonNamed(container, "Add alias"));
    expect(requests[0]).toMatchObject({ action: "add", alias: "Second Name", expectedRevision: `noteeditrev_${"a".repeat(32)}` });
    expect(JSON.stringify(requests[0])).not.toMatch(/path|markdown|contentHash/iu);
    expect(container.textContent).toContain("The alias was not changed. Your entry is preserved; review it and try again.");
    expect(input.value).toBe("  Second   Name  "); mode = "committed";
    await clickButton(dom, buttonNamed(container, "Add alias")); await waitFor(dom, () => adopted.length === 1);
    expect(adopted[0]?.aliasing?.aliases).toEqual(["Second Name"]);
    await clickButton(dom, buttonWithLabel(container, "More note actions")); await clickButton(dom, buttonNamed(container, "Manage aliases"));
    await clickButton(dom, buttonNamed(container, "Remove")); await waitFor(dom, () => adopted.length === 2);
    expect(requests.at(-1)).toMatchObject({ action: "remove", alias: "Second Name" });
    expect(adopted[1]?.aliasing?.aliases).toEqual([]);
    selected = { ...selected, aliasing: { aliases: Array.from({ length: 64 }, (_, index) => `Alias ${index + 1}`),
      canAdd: false, canRemove: true, revision: `noteeditrev_${"d".repeat(32)}` } };
    await act(async () => { renderPanel(); await settle(dom); });
    await clickButton(dom, buttonWithLabel(container, "More note actions")); await clickButton(dom, buttonNamed(container, "Manage aliases"));
    expect(requireElement(container.querySelector<HTMLInputElement>(".confirmation-dialog input")).disabled).toBe(true);
    expect(buttonNamed(container, "Add alias").disabled).toBe(true);
    expect(buttonNamed(container, "Remove").disabled).toBe(false);
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Remove"));
    await act(async () => root.unmount()); dom.window.close();
  });

  it("merges one selected ordinary note into the current Reader and adopts only the authoritative render", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: NoteMergeRequest[] = [];
    const adopted: NoteRenderResult[] = [];
    let mode: "stale" | "committed" = "stale";
    const note: NoteRenderResult = {
      ...readerNote(),
      trashEligibility: { canTrash: true, revision: `noteeditrev_${"a".repeat(32)}` }
    };
    const target = libraryList().pages.find((page) => page.pageId !== note.summary.pageId && page.pageType === "note")!;
    const committedRender: NoteRenderResult = {
      ...note,
      html: "<p>Merged authoritative body</p>",
      trashEligibility: { canTrash: true, revision: `noteeditrev_${"b".repeat(32)}` }
    };
    const onMergeCurrentNote = async (request: NoteMergeRequest): Promise<NoteMergeResult> => {
      requests.push(request);
      return mode === "committed"
        ? { ...request, status: "committed", operationId: "operation_note_merge_library", render: committedRender }
        : { ...request, status: "stale" };
    };
    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: libraryList(), selectedNote: note, selectedNoteRelated: null,
        noteLoadingPageId: null, error: null, onGoHome: () => undefined,
        onRefresh: async () => undefined, onSearch: async () => searchResult("unused", []), searchFocusRequest: 0,
        onOpenNote: async () => undefined, onCloseNote: () => undefined,
        noteAgentOpen: false, onToggleNoteAgent: () => undefined, noteAgentToggleRef: { current: null },
        developmentNotice: null, onClearDevelopment: () => undefined, onCopyNote: async () => true,
        activeVaultId: "vault_20260715_fullui01",
        onLoadNoteMergeTargets: async () => [{ pageId: target.pageId, title: target.title, updatedAt: target.updatedAt }],
        onLoadNoteRelateTargets: async () => [{ pageId: target.pageId, title: target.title, updatedAt: target.updatedAt }],
        onMergeCurrentNote,
        onCurrentNoteMerged: (render) => adopted.push(render),
        onDevelopment: () => undefined, t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const trigger = buttonWithLabel(container, "More note actions");
    trigger.focus();
    await act(async () => {
      trigger.click();
      await settle(dom);
      buttonNamed(container, "Merge notes").click();
      await settle(dom);
    });
    expect(container.querySelector("select")?.value).toBe(target.pageId);
    await act(async () => {
      buttonNamed(container, "Merge notes").click();
      await settle(dom);
    });
    expect(requests[0]).toMatchObject({
      activeVaultId: "vault_20260715_fullui01",
      currentPageId: note.summary.pageId,
      renderContextId: note.renderContextId,
      expectedRevision: note.trashEligibility?.revision,
      targetPageId: target.pageId,
      expectedTargetUpdatedAt: target.updatedAt
    });
    expect(requests[0]?.requestId).toMatch(/^notemergereq_[a-z0-9]{16,64}$/u);
    expect(adopted).toHaveLength(0);
    expect(container.querySelector(".note-reader")).not.toBeNull();
    expect(container.querySelector("select")?.value).toBe(target.pageId);

    mode = "committed";
    await act(async () => {
      buttonNamed(container, "Merge notes").click();
      await settle(dom);
    });
    expect(requests).toHaveLength(2);
    expect(adopted).toEqual([committedRender]);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("offers an explicit Entity merge and keeps the Reader on stale", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: NoteMergeRequest[] = [];
    const targetTypes: Array<"note" | "entity"> = [];
    const entity: NoteRenderResult = {
      ...readerNote(),
      summary: { ...readerNote().summary, pageId: "page_20260802_entityreader01", title: "Ada Lovelace",
        pageType: "entity", sourceIds: [] },
      entityType: { entityType: "person", canChange: true, revision: `noteeditrev_${"e".repeat(32)}` },
      trashEligibility: { canTrash: true, revision: `noteeditrev_${"a".repeat(32)}` }
    };
    const target = { pageId: "page_20260802_entitytarget01", title: "Augusta Ada King",
      updatedAt: "2026-08-02T10:01:00.000Z" };
    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: libraryList(), selectedNote: entity, selectedNoteRelated: null,
        noteLoadingPageId: null, error: null, onGoHome: () => undefined,
        onRefresh: async () => undefined, onSearch: async () => searchResult("unused", []), searchFocusRequest: 0,
        onOpenNote: async () => undefined, onCloseNote: () => undefined,
        noteAgentOpen: false, onToggleNoteAgent: () => undefined, noteAgentToggleRef: { current: null },
        developmentNotice: null, onClearDevelopment: () => undefined, onCopyNote: async () => true,
        activeVaultId: "vault_20260715_fullui01",
        onLoadNoteMergeTargets: async (_pageId, pageType) => { targetTypes.push(pageType); return [target]; },
        onMergeCurrentNote: async (request) => { requests.push(request); return { ...request, status: "stale" }; },
        onCurrentNoteMerged: () => { throw new Error("stale Entity merge must not be adopted"); },
        onDevelopment: () => undefined, t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await clickButton(dom, buttonWithLabel(container, "More note actions"));
    await clickButton(dom, buttonNamed(container, enMessages["entity.merge.title"]));
    await waitFor(dom, () => container.querySelector("select")?.value === target.pageId);
    await clickButton(dom, buttonNamed(container, enMessages["entity.merge.confirm"]));
    expect(targetTypes).toEqual(["entity"]);
    expect(requests[0]).toMatchObject({ currentPageId: entity.summary.pageId, targetPageId: target.pageId,
      expectedTargetUpdatedAt: target.updatedAt });
    expect(container.querySelector(".note-reader")).not.toBeNull();
    expect(container.querySelector("select")?.value).toBe(target.pageId);
    expect(dom.window.document.activeElement).toBe(container.querySelector("select"));
    await act(async () => root.unmount()); dom.window.close();
  });

  it("relates one selected note to the current typed Reader and retains the exact target on stale", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    Object.defineProperty(dom.window, "pige", { configurable: true, value: { notes: { unlinkRelation: vi.fn() } } });
    const requests: NoteRelateRequest[] = [];
    const adopted: NoteRenderResult[] = [];
    let mode: "stale" | "committed" = "stale";
    const note: NoteRenderResult = {
      ...readerNote(),
      summary: { ...readerNote().summary, pageType: "claim" },
      trashEligibility: { canTrash: true, revision: `noteeditrev_${"a".repeat(32)}` },
    };
    const target = {
      ...libraryPage("page_20260715_question1", "Open design question", "2026-07-15T10:05:00.000Z"),
      pageType: "question" as const,
    };
    const committedRender: NoteRenderResult = {
      ...note,
      html: "<p>Authoritative body with related note.</p>",
      trashEligibility: { canTrash: true, revision: `noteeditrev_${"b".repeat(32)}` },
    };
    const onRelateCurrentNote = async (request: NoteRelateRequest): Promise<NoteRelateResult> => {
      requests.push(request);
      return mode === "committed"
        ? { ...request, status: "committed", render: committedRender }
        : { ...request, status: "stale" };
    };
    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: libraryList(), selectedNote: note, selectedNoteRelated: null,
        noteLoadingPageId: null, error: null, onGoHome: () => undefined,
        onRefresh: async () => undefined, onSearch: async () => searchResult("unused", []), searchFocusRequest: 0,
        onOpenNote: async () => undefined, onCloseNote: () => undefined,
        noteAgentOpen: false, onToggleNoteAgent: () => undefined, noteAgentToggleRef: { current: null },
        developmentNotice: null, onClearDevelopment: () => undefined, onCopyNote: async () => true,
        activeVaultId: "vault_20260715_fullui01",
        onLoadNoteMergeTargets: async () => [{ pageId: target.pageId, title: target.title, updatedAt: target.updatedAt }],
        onLoadNoteRelateTargets: async () => [{ pageId: target.pageId, title: target.title, updatedAt: target.updatedAt }],
        onRelateCurrentNote,
        onCurrentNoteRelated: (render) => adopted.push(render),
        onDevelopment: () => undefined, t,
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const trigger = buttonWithLabel(container, "More note actions");
    trigger.focus();
    await clickButton(dom, trigger);
    await clickButton(dom, buttonNamed(container, "Relate knowledge page"));
    expect(container.querySelector("select")?.value).toBe(target.pageId);
    await clickButton(dom, buttonNamed(container, "Add relation"));
    expect(requests[0]).toMatchObject({
      activeVaultId: "vault_20260715_fullui01",
      currentPageId: note.summary.pageId,
      renderContextId: note.renderContextId,
      expectedRevision: note.trashEligibility?.revision,
      targetPageId: target.pageId,
      expectedTargetUpdatedAt: target.updatedAt,
    });
    expect(requests[0]?.requestId).toMatch(/^noterelatereq_[a-z0-9]{16,64}$/u);
    expect(adopted).toHaveLength(0);
    expect(container.querySelector(".note-reader")).not.toBeNull();
    expect(container.querySelector("select")?.value).toBe(target.pageId);
    await waitFor(dom, () => dom.window.document.activeElement === container.querySelector("select"));

    mode = "committed";
    await clickButton(dom, buttonNamed(container, "Add relation"));
    expect(requests).toHaveLength(2);
    expect(adopted).toEqual([committedRender]);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("retains a typed Reader relation when Main returns a different page type", async () => {
    const dom = createDom();
    const initial = readerNote();
    const note: NoteRenderResult = { ...initial, summary: { ...initial.summary, pageType: "question" },
      trashEligibility: { canTrash: true, revision: `noteeditrev_${"a".repeat(32)}` } };
    const target = libraryList().pages.find((page) => page.pageId !== note.summary.pageId && page.pageType === "note")!;
    const outcome = await submitReaderNoteRelation({
      activeVaultId: "vault_20260715_fullui01", currentPageId: note.summary.pageId,
      renderContextId: note.renderContextId!, expectedRevision: note.trashEligibility!.revision,
      expectedPageType: note.summary.pageType,
      execute: async (request) => ({ ...request, status: "committed", render: initial }),
    }, { pageId: target.pageId, title: target.title, updatedAt: target.updatedAt });
    expect(outcome).toEqual({ status: "retained" });
    dom.window.close();
  });

  it("renders one page title when Markdown repeats the exact frontmatter title", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const matchingTitleNote = {
      ...readerNote(),
      html: "<h1>  Reader <em>actions</em> </h1><p>Selected note body</p>"
    };
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: matchingTitleNote,
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.querySelector(".note-header h1")?.textContent).toBe("Reader actions");
    expect(container.querySelector(".markdown-body > h1")?.classList.contains("reader-duplicate-title")).toBe(true);

    await act(async () => {
      root.render(createElement(NoteReader, {
        note: matchingTitleNote,
        related: "unavailable",
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    expect(container.querySelector(".markdown-body > h1")?.classList.contains("reader-duplicate-title")).toBe(true);

    const distinctHeadingNote = {
      ...matchingTitleNote,
      html: "<h1>Implementation details</h1><p>Selected note body</p>"
    };
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: distinctHeadingNote,
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    expect(container.querySelector(".markdown-body > h1")?.classList.contains("reader-duplicate-title")).toBe(false);
    expect(container.querySelector(".markdown-body > h1")?.textContent).toBe("Implementation details");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps optional Reader metadata controls on distinct React identities", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: readerNote(),
        activeVaultId: "vault_20260715_fullui01",
        onSetQuestionState: async () => { throw new Error("question state action should not run"); },
        onQuestionStateChanged: () => undefined,
        onSetClaimConfidence: async () => { throw new Error("claim confidence action should not run"); },
        onClaimConfidenceChanged: () => undefined,
        onSetEntityType: async () => { throw new Error("entity type action should not run"); },
        onEntityTypeChanged: () => undefined,
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
    consoleError.mockRestore();
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps every saved-source closed result body-free in the current Reader", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const opened: string[] = [];
    const outcomes = [
      ["unresolved", "This reference could not be opened. Try again."],
      ["not_found", "The linked local item could not be found."],
      ["stale", "The note changed while this reference was checked. Try again."],
      ["mismatch", "This reference could not be opened. Try again."],
      ["changed", "The note changed while this reference was checked. Try again."]
    ] as const;
    let status: NoteOpenSourceReferenceResult["status"] = "unresolved";
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: readerNote(),
        activeVaultId: "vault_20260715_fullui01",
        onOpenSourceReference: async (request): Promise<NoteOpenSourceReferenceResult> => status === "resolved"
          ? { apiVersion: 1, requestId: request.requestId, status, target: { pageId: "page_20260715_source111" } }
          : { apiVersion: 1, requestId: request.requestId, status },
        onOpenSourcePage: async (pageId) => { opened.push(pageId); },
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const source = requireElement(container.querySelector<HTMLButtonElement>(".reader-source"));
    for (const [nextStatus, message] of outcomes) {
      status = nextStatus;
      source.focus();
      await act(async () => {
        source.click();
        await settle(dom);
      });
      expect(container.textContent).toContain(message);
      expect(container.textContent).toContain("Reader actions");
      expect(dom.window.document.activeElement).toBe(source);
      expect(opened).toEqual([]);
    }
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("makes every saved source reachable through one focus-stable Reader disclosure", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const baseNote = readerNote();
    const sourceIds = Array.from({ length: 7 }, (_, index) => `source_private_${String(index + 1).padStart(4, "0")}`);
    const note: NoteRenderResult = {
      ...baseNote,
      summary: { ...baseNote.summary, sourceIds },
      refreshableSourceIds: sourceIds
    };
    const openRequests: NoteOpenSourceReferenceRequest[] = [];
    const revealRequests: NoteRevealSourceRequest[] = [];
    const sourceRefreshPreview = vi.fn(async (request: {
      readonly apiVersion: 1;
      readonly requestId: string;
      readonly activeVaultId: string;
      readonly currentPageId: string;
      readonly renderContextId: string;
      readonly sourceId: string;
    }) => ({ ...request, status: "unchanged" as const }));
    const opened: string[] = [];
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        sourceRefresh: {
          preview: sourceRefreshPreview,
          confirm: vi.fn()
        }
      }
    });
    await act(async () => {
      root.render(createElement(NoteReader, {
        note,
        activeVaultId: "vault_20260715_fullui01",
        onOpenSourceReference: async (request): Promise<NoteOpenSourceReferenceResult> => {
          openRequests.push(request);
          return { apiVersion: 1, requestId: request.requestId, status: "unresolved" };
        },
        onOpenSourcePage: async (pageId) => { opened.push(pageId); },
        onRevealSource: async (request) => {
          revealRequests.push(request);
          return { ...request, status: "failed" };
        },
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const disclosure = requireElement(container.querySelector<HTMLButtonElement>("[data-reader-source-disclosure]"));
    expect(container.querySelectorAll(".reader-source")).toHaveLength(5);
    expect(container.querySelector(`[data-reader-source-open="${sourceIds[5]}"]`)).toBeNull();
    expect(disclosure.textContent).toBe("Show 2 more saved sources");
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(dom.window.document.getElementById(disclosure.getAttribute("aria-controls") ?? "")).not.toBeNull();

    disclosure.focus();
    await act(async () => {
      disclosure.click();
      await settle(dom);
    });
    expect(container.querySelectorAll(".reader-source")).toHaveLength(7);
    expect(disclosure.textContent).toBe("Show fewer saved sources");
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(dom.window.document.activeElement).toBe(disclosure);

    const sixthOpen = requireElement(container.querySelector<HTMLButtonElement>(
      `[data-reader-source-open="${sourceIds[5]}"]`
    ));
    sixthOpen.focus();
    await act(async () => {
      sixthOpen.click();
      await settle(dom);
    });
    expect(openRequests).toHaveLength(1);
    expect(openRequests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_20260715_fullui01",
      currentPageId: note.summary.pageId,
      renderContextId: note.renderContextId,
      sourceId: sourceIds[5]
    });
    expect(opened).toEqual([]);
    expect(container.querySelectorAll(".reader-source")).toHaveLength(7);
    expect(container.textContent).toContain("This reference could not be opened. Try again.");
    expect(dom.window.document.activeElement).toBe(sixthOpen);

    const sixthReveal = requireElement(container.querySelector<HTMLButtonElement>(
      `[data-reader-source-reveal="${sourceIds[5]}"]`
    ));
    sixthReveal.focus();
    await act(async () => {
      sixthReveal.click();
      await settle(dom);
      await settle(dom);
    });
    expect(revealRequests).toHaveLength(1);
    expect(revealRequests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_20260715_fullui01",
      currentPageId: note.summary.pageId,
      renderContextId: note.renderContextId,
      sourceId: sourceIds[5]
    });
    expect(container.querySelectorAll(".reader-source")).toHaveLength(7);
    expect(dom.window.document.activeElement).toBe(sixthReveal);

    const sixthRefresh = requireElement(container.querySelector<HTMLButtonElement>(
      `[data-reader-source-refresh="${sourceIds[5]}"]`
    ));
    sixthRefresh.focus();
    await act(async () => {
      sixthRefresh.click();
      await settle(dom);
    });
    expect(sourceRefreshPreview).toHaveBeenCalledTimes(1);
    expect(sourceRefreshPreview.mock.calls[0]?.[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_20260715_fullui01",
      currentPageId: note.summary.pageId,
      renderContextId: note.renderContextId,
      sourceId: sourceIds[5]
    });
    expect(container.querySelectorAll(".reader-source")).toHaveLength(7);
    expect(container.textContent).toContain("This source is current.");

    disclosure.focus();
    await act(async () => {
      disclosure.click();
      await settle(dom);
    });
    expect(container.querySelectorAll(".reader-source")).toHaveLength(5);
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(dom.window.document.activeElement).toBe(disclosure);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("restores saved-source actions when resolved navigation leaves the current Reader", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    let rejectNavigation = false;
    let resolveCount = 0;
    let navigationCount = 0;
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: readerNote(),
        activeVaultId: "vault_20260715_fullui01",
        onOpenSourceReference: async (request): Promise<NoteOpenSourceReferenceResult> => {
          resolveCount += 1;
          return {
            apiVersion: 1,
            requestId: request.requestId,
            status: "resolved",
            target: { pageId: "page_20260715_source111" }
          };
        },
        onOpenSourcePage: async () => {
          navigationCount += 1;
          if (rejectNavigation) throw new Error("synthetic body must remain private");
        },
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const source = requireElement(container.querySelector<HTMLButtonElement>(".reader-source"));

    await act(async () => {
      source.click();
      await settle(dom);
    });
    expect(resolveCount).toBe(1);
    expect(navigationCount).toBe(1);
    expect(source.disabled).toBe(false);
    expect(container.textContent).toContain("Open this linked local note or source.");
    expect(container.textContent).toContain("Reader actions");

    rejectNavigation = true;
    await act(async () => {
      source.click();
      await settle(dom);
    });
    expect(resolveCount).toBe(2);
    expect(navigationCount).toBe(2);
    expect(source.disabled).toBe(false);
    expect(container.textContent).toContain("This reference could not be opened. Try again.");
    expect(container.textContent).not.toContain("synthetic body must remain private");

    rejectNavigation = false;
    await act(async () => {
      source.click();
      await settle(dom);
    });
    expect(resolveCount).toBe(3);
    expect(navigationCount).toBe(3);
    expect(source.disabled).toBe(false);
    expect(container.textContent).toContain("Open this linked local note or source.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fences an old saved-source result after the render context changes", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    let resolveOld!: (result: NoteOpenSourceReferenceResult) => void;
    let oldRequestId = "";
    const opened: string[] = [];
    const first = readerNote();
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: first,
        activeVaultId: "vault_20260715_fullui01",
        onOpenSourceReference: (request) => new Promise((resolve) => {
          oldRequestId = request.requestId;
          resolveOld = resolve;
        }),
        onOpenSourcePage: async (pageId) => { opened.push(pageId); },
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await act(async () => {
      requireElement(container.querySelector<HTMLButtonElement>(".reader-source")).click();
      await settle(dom);
    });
    expect(container.textContent).toContain("Checking this local reference…");

    const next = { ...first, renderContextId: `notectx_${"d".repeat(32)}` };
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: next,
        activeVaultId: "vault_20260715_fullui01",
        onOpenSourceReference: () => Promise.reject(new Error("unused")),
        onOpenSourcePage: async (pageId) => { opened.push(pageId); },
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    await act(async () => {
      resolveOld({
        apiVersion: 1,
        requestId: oldRequestId,
        status: "resolved",
        target: { pageId: "page_20260715_source111" }
      });
      await settle(dom);
    });
    expect(opened).toEqual([]);
    expect(container.textContent).toContain("Open this linked local note or source.");
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fails closed for unresolved internal Reader links without mutating the window hash", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const unavailable: string[] = [];
    const linkedNote = {
      ...readerNote(),
      html: [
        '<p><a href="#wiki:page_20260715_link1111"><em>Linked note</em></a></p>',
        '<p><a href="#source:src_20260715_link2222#source">Saved source</a></p>',
        '<p><a href="#section">Local section</a></p>'
      ].join("")
    };
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: linkedNote,
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: (capability) => unavailable.push(capability),
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const internalLinks = Array.from(container.querySelectorAll<HTMLAnchorElement>(
      '.markdown-body a[data-reader-link-state="unavailable"]'
    ));
    expect(internalLinks).toHaveLength(2);
    const descriptionId = internalLinks[0]!.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(internalLinks[1]!.getAttribute("aria-describedby")).toBe(descriptionId);
    const description = dom.window.document.getElementById(descriptionId!);
    expect(description?.hidden).toBe(true);
    expect(description?.textContent).toContain(
      "Opening linked notes and sources is temporarily unavailable"
    );

    const originalUrl = dom.window.location.href;
    const wikiClick = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      requireElement(internalLinks[0]!.querySelector("em")).dispatchEvent(wikiClick);
      await settle(dom);
    });
    expect(wikiClick.defaultPrevented).toBe(true);
    expect(dom.window.location.href).toBe(originalUrl);
    expect(unavailable).toEqual(["reader_link"]);

    internalLinks[1]!.focus();
    const keyboardClick = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 });
    await act(async () => {
      internalLinks[1]!.dispatchEvent(keyboardClick);
      await settle(dom);
    });
    expect(keyboardClick.defaultPrevented).toBe(true);
    expect(dom.window.document.activeElement).toBe(internalLinks[1]);
    expect(dom.window.location.href).toBe(originalUrl);
    expect(unavailable).toEqual(["reader_link", "reader_link"]);

    const sourceAuxClick = new dom.window.MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
    await act(async () => {
      internalLinks[1]!.dispatchEvent(sourceAuxClick);
      await settle(dom);
    });
    expect(sourceAuxClick.defaultPrevented).toBe(true);
    expect(dom.window.location.href).toBe(originalUrl);
    expect(unavailable).toEqual(["reader_link", "reader_link", "reader_link"]);

    const localSection = requireElement(container.querySelector<HTMLAnchorElement>('a[href="#section"]'));
    expect(localSection.hasAttribute("data-reader-link-state")).toBe(false);
    expect(localSection.hasAttribute("aria-describedby")).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("serializes typed inline-reference activation and keeps one body-free status owner", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const linkedNote = {
      ...readerNote(),
      html: [
        '<p><a href="#wiki:page_20260715_link1111"><em>Linked note</em></a></p>',
        '<p><a href="#source:src_20260715_link2222#source">Saved source</a></p>',
        '<p><a href="#section">Local section</a></p>'
      ].join("")
    };
    const pending = deferred<ReaderInlineReferenceActivation>();
    const calls: string[] = [];
    let next: Promise<ReaderInlineReferenceActivation> = pending.promise;
    const onActivate = (href: string): Promise<ReaderInlineReferenceActivation> => {
      calls.push(href);
      return next;
    };
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: linkedNote,
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        onActivateInlineReference: onActivate,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>(
      '.markdown-body a[data-reader-link-state="ready"]'
    ));
    expect(links).toHaveLength(2);
    expect(dom.window.document.getElementById(links[0]!.getAttribute("aria-describedby")!)?.textContent)
      .toBe("Open this linked local note or source.");

    links[0]!.focus();
    const firstClick = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      requireElement(links[0]!.querySelector("em")).dispatchEvent(firstClick);
      await settle(dom);
    });
    expect(firstClick.defaultPrevented).toBe(true);
    expect(calls).toEqual(["#wiki:page_20260715_link1111"]);
    expect(links[0]!.dataset.readerLinkState).toBe("resolving");
    expect(links[0]!.getAttribute("aria-busy")).toBe("true");
    expect(links[0]!.getAttribute("aria-disabled")).toBe("true");
    expect(container.querySelectorAll('[data-reader-reference-feedback="resolving"]')).toHaveLength(1);

    await act(async () => {
      links[0]!.click();
      links[1]!.click();
      await settle(dom);
    });
    expect(calls).toHaveLength(1);
    expect(links[1]!.dataset.readerLinkState).toBe("resolving");
    expect(links[1]!.getAttribute("aria-disabled")).toBe("true");
    expect(links[1]!.hasAttribute("aria-busy")).toBe(false);

    await act(async () => {
      pending.resolve("ambiguous");
      await pending.promise;
      await settle(dom);
    });
    const ambiguous = requireElement(container.querySelector<HTMLElement>(
      '[data-reader-reference-feedback="ambiguous"]'
    ));
    expect(ambiguous.textContent).toBe("More than one local item matches this reference. Nothing was opened.");
    expect(ambiguous.textContent).not.toContain("page_20260715_link1111");
    expect(ambiguous.textContent).not.toContain("#wiki:");
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(links[0]!.dataset.readerLinkState).toBe("ambiguous");
    expect(links[0]!.hasAttribute("aria-busy")).toBe(false);
    expect(dom.window.document.activeElement).toBe(links[0]);

    for (const [outcome, message] of [
      ["not_found", "The linked local item could not be found."],
      ["stale", "The note changed while this reference was checked. Try again."],
      ["failed", "This reference could not be opened. Try again."]
    ] as const) {
      next = Promise.resolve(outcome);
      await act(async () => {
        links[0]!.click();
        await settle(dom);
      });
      const status = requireElement(container.querySelector<HTMLElement>(
        `[data-reader-reference-feedback="${outcome}"]`
      ));
      expect(status.textContent).toBe(message);
      expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
      expect(links[0]!.dataset.readerLinkState).toBe(outcome);
    }

    next = Promise.reject(new Error("private resolver body"));
    await act(async () => {
      links[0]!.click();
      await settle(dom);
    });
    expect(container.textContent).not.toContain("private resolver body");
    expect(container.querySelectorAll('[data-reader-reference-feedback="failed"]')).toHaveLength(1);

    next = Promise.resolve("opened_source");
    await act(async () => {
      links[1]!.click();
      await settle(dom);
    });
    expect(calls.at(-1)).toBe("#source:src_20260715_link2222#source");
    expect(container.querySelector('[data-reader-reference-feedback]')).toBeNull();
    expect(links[0]!.dataset.readerLinkState).toBe("ready");
    expect(links[1]!.dataset.readerLinkState).toBe("ready");
    expect(container.querySelector<HTMLAnchorElement>('a[href="#section"]')?.dataset.readerLinkState).toBeUndefined();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("drops an old inline-reference result after the Reader render context changes", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const oldResult = deferred<ReaderInlineReferenceActivation>();
    const calls: string[] = [];
    const onActivate = (href: string): Promise<ReaderInlineReferenceActivation> => {
      calls.push(href);
      return oldResult.promise;
    };
    const oldNote = {
      ...readerNote(),
      renderContextId: `notectx_${"a".repeat(32)}`,
      html: '<p><a href="#wiki:page_20260715_old11111">Old note</a></p>'
    };
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: oldNote,
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        onActivateInlineReference: onActivate,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const oldLink = requireElement(container.querySelector<HTMLAnchorElement>('a[href="#wiki:page_20260715_old11111"]'));
    await act(async () => {
      oldLink.click();
      await settle(dom);
    });
    expect(calls).toEqual(["#wiki:page_20260715_old11111"]);
    expect(requireElement(container.querySelector<HTMLAnchorElement>('a[href="#wiki:page_20260715_old11111"]'))
      .dataset.readerLinkState).toBe("resolving");

    const nextNote = {
      ...readerNote(),
      renderContextId: `notectx_${"b".repeat(32)}`,
      html: '<p><a href="#wiki:page_20260715_new22222">New note</a></p>'
    };
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: nextNote,
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        onActivateInlineReference: onActivate,
        t
      }));
      await settle(dom);
    });
    const newLink = requireElement(container.querySelector<HTMLAnchorElement>('a[href="#wiki:page_20260715_new22222"]'));
    expect(newLink.dataset.readerLinkState).toBe("ready");
    expect(container.querySelector('[data-reader-reference-feedback]')).toBeNull();

    await act(async () => {
      oldResult.resolve("not_found");
      await oldResult.promise;
      await settle(dom);
    });
    expect(calls).toEqual(["#wiki:page_20260715_old11111"]);
    expect(newLink.dataset.readerLinkState).toBe("ready");
    expect(container.querySelector('[data-reader-reference-feedback]')).toBeNull();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("rejects an invalid internal href locally without navigation or resolver IPC", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const href = `#wiki:${"x".repeat(1_024)}`;
    const calls: string[] = [];
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: { ...readerNote(), html: `<p><a href="${href}">Invalid local reference</a></p>` },
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        onActivateInlineReference: async (value) => {
          calls.push(value);
          return "opened_page";
        },
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const link = requireElement(container.querySelector<HTMLAnchorElement>('a[href^="#wiki:"]'));
    const originalUrl = dom.window.location.href;
    const click = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      link.dispatchEvent(click);
      await settle(dom);
    });
    expect(click.defaultPrevented).toBe(true);
    expect(calls).toEqual([]);
    expect(dom.window.location.href).toBe(originalUrl);
    expect(link.dataset.readerLinkState).toBe("failed");
    expect(container.textContent).toContain("This reference could not be opened. Try again.");
    expect(container.textContent).not.toContain(href);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("marks the Main-derived search segment when Reader opens a matching result", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: readerNote(),
        focusSegmentId: "readerseg_aaaaaaaaaaaaaaaa",
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });

    const focused = dom.window.document.querySelector<HTMLElement>(
      '[data-pige-selection-segment="readerseg_aaaaaaaaaaaaaaaa"]'
    );
    expect(focused?.dataset.pigeSearchFocus).toBe("true");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("submits only exact render identity and keeps unresolved or stale selections copy-only", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const first = deferred<ReaderSelectionResolveResult>();
    const requests: ReaderSelectionResolveRequest[] = [];
    const actionRequests: ReaderSelectionActionRequest[] = [];
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: readerNote(),
        activeVaultId: "vault_20260715_fullui01",
        onResolveSelection: async (request) => {
          requests.push(request);
          if (requests.length === 1) return first.promise;
          if (requests.length === 2) return {
            apiVersion: 1,
            requestId: request.requestId,
            status: "invalid",
            reason: "unsupported_content"
          };
          return {
            apiVersion: 1,
            requestId: request.requestId,
            status: "resolved",
            selection: {
              pageId: request.currentPageId,
              pageContentHash: `sha256:${"a".repeat(64)}`,
              span: { unit: "utf8_bytes", start: 1, endExclusive: 9 },
              selectedContentHash: `sha256:${"b".repeat(64)}`
            }
          };
        },
        onSubmitSelectionAction: async (request) => {
          actionRequests.push(request);
          return {
            apiVersion: 1,
            requestId: request.requestId,
            status: "completed",
            jobId: "job_20260718_selection01",
            conversationEventId: "evt_20260718_selection01",
            conversationId: "conv_20260718_selection01",
            tailEventId: "evt_20260718_selection02"
          };
        },
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const paragraph = requireElement(container.querySelector(".markdown-body p"));
    const selectionNode = requireElement(paragraph.querySelector("[data-pige-selection-segment]")).firstChild!;
    let revision = 1;
    Object.defineProperty(dom.window, "getSelection", {
      configurable: true,
      value: () => ({
        isCollapsed: false,
        rangeCount: 1,
        anchorNode: selectionNode,
        anchorOffset: revision - 1,
        focusNode: selectionNode,
        focusOffset: revision + 7,
        toString: () => `private selected body ${revision}`,
        getRangeAt: () => ({
          commonAncestorContainer: paragraph,
          startContainer: selectionNode,
          startOffset: revision - 1,
          endContainer: selectionNode,
          endOffset: revision + 7,
          getBoundingClientRect: () => ({
            left: 80 + revision,
            top: 90,
            width: 120,
            height: 18,
            right: 200 + revision,
            bottom: 108
          })
        })
      })
    });

    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => requests.length === 1);
    expect(requests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_20260715_fullui01",
      currentPageId: "page_20260715_reader1111",
      renderContextId: `notectx_${"c".repeat(32)}`,
      anchor: { segmentId: "readerseg_aaaaaaaaaaaaaaaa", utf16Offset: 0 },
      focus: { segmentId: "readerseg_aaaaaaaaaaaaaaaa", utf16Offset: 8 }
    });
    expect(JSON.stringify(requests[0])).not.toContain("private selected body");
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('[role="toolbar"] > button')).map((button) => button.dataset.selectionAction))
      .toEqual(["copy", "copyAsQuote"]);

    revision = 2;
    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => requests.length === 2);
    await waitFor(dom, () => container.querySelector('[data-selection-action="more"]') === null);
    await act(async () => {
      first.resolve({
        apiVersion: 1,
        requestId: requests[0]!.requestId,
        status: "resolved",
        selection: {
          pageId: requests[0]!.currentPageId,
          pageContentHash: `sha256:${"a".repeat(64)}`,
          span: { unit: "utf8_bytes", start: 0, endExclusive: 8 },
          selectedContentHash: `sha256:${"b".repeat(64)}`
        }
      });
      await first.promise;
      await settle(dom);
    });
    expect(container.querySelector('[data-selection-action="more"]')).toBeNull();

    revision = 3;
    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => requests.length === 3);
    await waitFor(dom, () => container.querySelector('[data-selection-action="more"]') !== null);
    await act(async () => {
      requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="explain"]')).click();
      await settle(dom);
    });
    expect(actionRequests).toHaveLength(1);
    expect(actionRequests[0]).toMatchObject({
      apiVersion: 1,
      action: "explain",
      locale: "en",
      selection: {
        pageId: "page_20260715_reader1111",
        span: { unit: "utf8_bytes", start: 1, endExclusive: 9 }
      }
    });
    expect(actionRequests[0]!.requestId).toMatch(/^readerselaction_[a-z0-9]{8,64}$/u);
    expect(actionRequests[0]!.clientTurnId).toMatch(/^turn_\d{8}_[a-z0-9]{12,64}$/u);
    expect(JSON.stringify(actionRequests[0])).not.toContain("private selected body");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("asks from the Library Reader and retains the exact question and focus after a closed result", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const actionRequests: ReaderSelectionActionRequest[] = [];
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: readerNote(),
        ...resolvedSelectionProps(),
        onSubmitSelectionAction: async (request) => {
          actionRequests.push(request);
          return actionRequests.length === 1
            ? { apiVersion: 1, requestId: request.requestId, status: "invalid", reason: "selection_changed" }
            : {
                apiVersion: 1,
                requestId: request.requestId,
                status: "completed",
                jobId: "job_20260730_readerask01",
                conversationEventId: "evt_20260730_readerask01",
                conversationId: "conv_20260730_readerask01",
                tailEventId: "evt_20260730_readerask02"
              };
        },
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const paragraph = requireElement(container.querySelector(".markdown-body p"));
    const selectionNode = requireElement(paragraph.querySelector("[data-pige-selection-segment]")).firstChild!;
    Object.defineProperty(dom.window, "getSelection", { configurable: true, value: () => ({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: selectionNode,
      anchorOffset: 0,
      focusNode: selectionNode,
      focusOffset: 8,
      toString: () => "private selected body",
      getRangeAt: () => ({
        commonAncestorContainer: paragraph,
        startContainer: selectionNode,
        startOffset: 0,
        endContainer: selectionNode,
        endOffset: 8,
        getBoundingClientRect: () => ({ left: 80, top: 90, width: 120, height: 18, right: 200, bottom: 108 })
      })
    }) });
    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[data-selection-action="more"]') !== null);
    await act(async () => {
      requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="more"]')).click();
      await settle(dom);
      requireElement(container.querySelector<HTMLButtonElement>('[data-selection-more-action="ask"]')).click();
      await settle(dom);
    });
    const question = requireElement(container.querySelector<HTMLInputElement>("#reader-selection-ask-question"));
    await waitFor(dom, () => dom.window.document.activeElement === question);
    await inputText(dom, question, "  Why does this matter?  ");
    await act(async () => {
      requireElement(question.closest("form")?.querySelector<HTMLButtonElement>('button[type="submit"]')).click();
      await settle(dom);
    });
    expect(actionRequests[0]).toMatchObject({ action: "ask", question: "Why does this matter?" });
    expect(JSON.stringify(actionRequests[0])).not.toContain("private selected body");
    await waitFor(dom, () => dom.window.document.activeElement === question);
    expect(question.value).toBe("  Why does this matter?  ");
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("links an exact resolved selection, preserves it on a closed result, and refreshes only after apply", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const linkRequests: ReaderSelectionLinkRequest[] = [];
    const appliedResults: Array<Extract<ReaderSelectionLinkResult, { status: "applied" }>> = [];
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: readerNote(),
        ...resolvedSelectionProps(),
        onSubmitSelectionLink: async (request) => {
          linkRequests.push(request);
          if (linkRequests.length === 1) {
            return {
              apiVersion: 1,
              requestId: request.requestId,
              status: "invalid",
              reason: "target_ambiguous"
            };
          }
          return {
            apiVersion: 1,
            requestId: request.requestId,
            status: "applied",
            jobId: "job_20260728_link0001",
            conversationEventId: "evt_20260728_link0001",
            conversationId: "conv_20260728_link01",
            tailEventId: "evt_20260728_link0002",
            operationId: "op_20260728_link0001",
            currentPageId: request.selection.pageId,
            targetPageId: "page_20260728_linktarget"
          };
        },
        onSelectionLinkApplied: async (result) => {
          appliedResults.push(result);
          return true;
        },
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const reader = requireElement(container.querySelector<HTMLElement>(".note-reader"));
    const paragraph = requireElement(container.querySelector(".markdown-body p"));
    const selectionNode = requireElement(paragraph.querySelector("[data-pige-selection-segment]")).firstChild!;
    reader.focus();
    Object.defineProperty(dom.window, "getSelection", {
      configurable: true,
      value: () => ({
        isCollapsed: false,
        rangeCount: 1,
        anchorNode: selectionNode,
        anchorOffset: 0,
        focusNode: selectionNode,
        focusOffset: 8,
        toString: () => "private selected body",
        getRangeAt: () => ({
          commonAncestorContainer: paragraph,
          startContainer: selectionNode,
          startOffset: 0,
          endContainer: selectionNode,
          endOffset: 8,
          getBoundingClientRect: () => ({
            left: 80,
            top: 90,
            width: 120,
            height: 18,
            right: 200,
            bottom: 108
          })
        })
      })
    });

    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[data-selection-action="link"]') !== null);
    const linkButton = requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="link"]'));
    await act(async () => {
      linkButton.click();
      linkButton.click();
      await settle(dom);
    });
    expect(linkRequests).toHaveLength(1);
    expect(linkRequests[0]).toMatchObject({
      apiVersion: 1,
      action: "link",
      activeVaultId: "vault_20260715_fullui01",
      renderContextId: `notectx_${"c".repeat(32)}`,
      locale: "en",
      selection: {
        pageId: "page_20260715_reader1111",
        span: { unit: "utf8_bytes", start: 0, endExclusive: 8 }
      }
    });
    expect(linkRequests[0]!.requestId).toMatch(/^readerselaction_[a-z0-9]{8,64}$/u);
    expect(linkRequests[0]!.clientTurnId).toMatch(/^turn_\d{8}_[a-z0-9]{12,64}$/u);
    expect(JSON.stringify(linkRequests[0])).not.toMatch(/private selected body|targetPageId|targetPath/u);
    expect(appliedResults).toEqual([]);
    expect(container.querySelector('[data-selection-action="link"]')).not.toBeNull();
    expect(container.textContent).toContain("Reader actions");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "This selection action could not be started. Select the passage again and retry."
    );

    await act(async () => {
      linkButton.click();
      await settle(dom);
    });
    expect(linkRequests).toHaveLength(2);
    expect(appliedResults).toHaveLength(1);
    expect(appliedResults[0]).toMatchObject({
      currentPageId: "page_20260715_reader1111",
      targetPageId: "page_20260728_linktarget"
    });
    expect(container.querySelector(".selection-toolbar")).toBeNull();
    await act(async () => settle(dom));
    expect(dom.window.document.activeElement).toBe(reader);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("The selected passage was updated.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("submits exact create-page selections and retains the Reader on closed or review results", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: ReaderSelectionCreateNoteRequest[] = [];
    const results: ReaderSelectionCreateNoteResult[] = [];
    let resolveCreate!: (result: ReaderSelectionCreateNoteResult) => void;
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: readerNote(),
        ...resolvedSelectionProps(),
        onSubmitSelectionCreateNote: (request) => {
          requests.push(request);
          return new Promise((resolve) => { resolveCreate = resolve; });
        },
        onSelectionCreateNoteResult: (result) => results.push(result),
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const paragraph = requireElement(container.querySelector(".markdown-body p"));
    const selectionNode = requireElement(paragraph.querySelector("[data-pige-selection-segment]")).firstChild!;
    Object.defineProperty(dom.window, "getSelection", { configurable: true, value: () => ({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: selectionNode,
      anchorOffset: 0,
      focusNode: selectionNode,
      focusOffset: 8,
      toString: () => "private selected body",
      getRangeAt: () => ({
        commonAncestorContainer: paragraph,
        startContainer: selectionNode,
        startOffset: 0,
        endContainer: selectionNode,
        endOffset: 8,
        getBoundingClientRect: () => ({ left: 80, top: 90, width: 120, height: 18, right: 200, bottom: 108 })
      })
    }) });
    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[data-selection-action="more"]') !== null);
    await act(async () => {
      requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="more"]')).click();
      await settle(dom);
    });
    await clickButton(dom, requireElement(container.querySelector<HTMLButtonElement>('[data-selection-more-action="createNote"]')));
    const createNote = requireElement(container.querySelector<HTMLButtonElement>('[data-selection-create-action="create_note"]'));
    await act(async () => { createNote.click(); createNote.click(); await settle(dom); });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      apiVersion: 1,
      action: "create_note",
      activeVaultId: "vault_20260715_fullui01",
      renderContextId: `notectx_${"c".repeat(32)}`,
      locale: "en",
      selection: { pageId: "page_20260715_reader1111", span: { unit: "utf8_bytes", start: 0, endExclusive: 8 } }
    });
    expect(JSON.stringify(requests[0])).not.toContain("private selected body");
    await act(async () => {
      resolveCreate({ apiVersion: 1, requestId: requests[0]!.requestId, status: "invalid", reason: "selection_changed" });
      await settle(dom);
    });
    expect(results).toHaveLength(1);
    expect(container.querySelector('[data-selection-action="more"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(enMessages["note.selection.actionFailed"]);
    expect(dom.window.document.activeElement).toBe(container.querySelector('[data-selection-action="more"]'));

    await clickButton(dom, requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="more"]')));
    await clickButton(dom, requireElement(container.querySelector<HTMLButtonElement>('[data-selection-more-action="createNote"]')));
    expect(Array.from(container.querySelectorAll<HTMLElement>("[data-selection-create-action]")).map((item) =>
      item.dataset.selectionCreateAction)).toEqual([
      "create_note", "create_claim", "create_question", "create_concept", "create_entity", "create_topic"
    ]);
    await clickButton(dom, requireElement(container.querySelector<HTMLButtonElement>('[data-selection-create-action="create_concept"]')));
    const secondRequest = requests[1]!;
    expect(secondRequest.action).toBe("create_concept");
    await act(async () => {
      resolveCreate({
        apiVersion: 1,
        requestId: secondRequest.requestId,
        status: "review_required",
        jobId: "job_20260729_createnote",
        conversationEventId: "evt_20260729_createnote1",
        conversationId: "conv_20260729_createnote",
        tailEventId: "evt_20260729_createnote2",
        proposal: {
          proposalId: "proposal_20260729_createnote",
          action: "create_concept",
          state: "ready",
          revision: 1,
          lines: [{ kind: "added", text: "Create a durable note" }]
        }
      });
      await settle(dom);
    });
    expect(results.at(-1)?.status).toBe("review_required");
    expect(container.querySelector('[data-selection-action="more"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(enMessages["note.selection.reviewReady"]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("measures compact selection actions, dismisses on scroll, and restores exact focus ownership", async () => {
    const dom = createDom();
    Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: 360 });
    Object.defineProperty(dom.window, "innerHeight", { configurable: true, value: 240 });
    let resizeToolbar: (() => void) | null = null;
    Object.defineProperty(dom.window, "ResizeObserver", {
      configurable: true,
      value: class TestResizeObserver {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(target: Element): void {
          if (target.classList.contains("selection-toolbar")) {
            resizeToolbar = () => this.callback([], this as unknown as ResizeObserver);
          }
        }
        disconnect(): void {}
      }
    });
    const focusOwner = dom.window.document.createElement("button");
    focusOwner.textContent = "Reader focus owner";
    dom.window.document.body.prepend(focusOwner);
    focusOwner.focus();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const unavailable: string[] = [];
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: readerNote(),
        ...resolvedSelectionProps(),
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: (capability) => unavailable.push(capability),
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const paragraph = requireElement(container.querySelector(".markdown-body p"));
    const selectionNode = requireElement(paragraph.querySelector("[data-pige-selection-segment]")).firstChild!;
    const originalBoundingClientRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
    let toolbarHeight = 84;
    dom.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
      if ((this as HTMLElement).classList.contains("selection-toolbar")) {
        return {
          left: 0,
          top: 0,
          width: 330,
          height: toolbarHeight,
          right: 330,
          bottom: toolbarHeight,
          x: 0,
          y: 0,
          toJSON: () => ({})
        } as DOMRect;
      }
      return originalBoundingClientRect.call(this);
    };
    let selectionCollapsed = false;
    let selectionLeft = 330;
    let selectionRight = 350;
    let selectionTop = 15;
    let selectionBottom = 33;
    Object.defineProperty(dom.window, "getSelection", {
      configurable: true,
      value: () => ({
        isCollapsed: selectionCollapsed,
        rangeCount: selectionCollapsed ? 0 : 1,
        anchorNode: selectionNode,
        anchorOffset: 0,
        focusNode: selectionNode,
        focusOffset: 8,
        getRangeAt: () => ({
          commonAncestorContainer: paragraph,
          startContainer: selectionNode,
          startOffset: 0,
          endContainer: selectionNode,
          endOffset: 8,
          getBoundingClientRect: () => ({
            left: selectionLeft,
            top: selectionTop,
            width: 20,
            height: 18,
            right: selectionRight,
            bottom: selectionBottom
          })
        })
      })
    });
    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector<HTMLElement>('[role="toolbar"]')?.style.left === "18px");

    let toolbar = requireElement(container.querySelector<HTMLElement>('[role="toolbar"]'));
    let actions = Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button"));
    expect(toolbar.style.left).toBe("18px");
    expect(toolbar.style.top).toBe("41px");
    expect(actions.map((button) => button.textContent)).toEqual(["Explain", "Summarize", "Link", "More"]);
    expect(actions.map((button) => button.tabIndex)).toEqual([0, -1, -1, -1]);

    Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: 600 });
    await act(async () => {
      dom.window.dispatchEvent(new dom.window.Event("resize"));
      selectionLeft = 300;
      selectionRight = 320;
      selectionTop = 130;
      selectionBottom = 148;
      await settle(dom);
    });
    await waitFor(dom, () => toolbar.style.top === "38px");
    expect(toolbar.style.left).toBe("145px");

    toolbarHeight = 110;
    await act(async () => {
      resizeToolbar?.();
      await settle(dom);
    });
    await waitFor(dom, () => toolbar.style.top === "12px");
    expect(Number.parseFloat(toolbar.style.top) + toolbarHeight).toBeLessThanOrEqual(selectionTop - 8);

    toolbar = requireElement(container.querySelector<HTMLElement>('[role="toolbar"]'));
    actions = Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button"));
    actions[0]!.focus();
    await act(async () => {
      toolbar.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await settle(dom);
    });
    expect(dom.window.document.activeElement).toBe(actions[1]);
    expect(actions.map((button) => button.tabIndex)).toEqual([-1, 0, -1, -1]);

    await act(async () => {
      toolbar.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[role="toolbar"]') === null);
    await waitFor(dom, () => dom.window.document.activeElement === focusOwner);

    focusOwner.focus();
    await act(async () => {
      selectionCollapsed = true;
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      selectionCollapsed = false;
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector<HTMLElement>('[role="toolbar"]')?.style.left === "145px");
    toolbar = requireElement(container.querySelector<HTMLElement>('[role="toolbar"]'));
    actions = Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button"));
    const pointerDown = new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    await act(async () => {
      actions[1]!.dispatchEvent(pointerDown);
      actions[1]!.click();
      await settle(dom);
    });
    expect(pointerDown.defaultPrevented).toBe(true);
    await waitFor(dom, () => dom.window.document.activeElement === focusOwner);
    expect(unavailable).toEqual([]);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Opened in Note Agent.");
    expect(container.querySelector('[role="toolbar"]')).toBeNull();

    focusOwner.focus();
    await act(async () => {
      selectionCollapsed = true;
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      selectionCollapsed = false;
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[role="toolbar"]') !== null);
    await act(async () => {
      dom.window.dispatchEvent(new dom.window.Event("scroll"));
      await settle(dom);
    });
    expect(container.querySelector('[role="toolbar"]')).toBeNull();

    focusOwner.remove();
    await act(async () => {
      selectionCollapsed = true;
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      selectionCollapsed = false;
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    toolbar = requireElement(container.querySelector<HTMLElement>('[role="toolbar"]'));
    await act(async () => {
      toolbar.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
    });
    await waitFor(dom, () => dom.window.document.activeElement === container.querySelector(".note-reader"));

    await act(async () => root.unmount());
    dom.window.HTMLElement.prototype.getBoundingClientRect = originalBoundingClientRect;
    dom.window.close();
  });

  it("keeps Copy local and sends an exact resolved quote to the capture owner", async () => {
    const dom = createDom();
    const clipboardWrites: string[] = [];
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          clipboardWrites.push(value);
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const unavailable: string[] = [];
    const transformRequests: ReaderSelectionTransformRequest[] = [];
    const transformResults: ReaderSelectionTransformResult[] = [];
    const captureQuotes: unknown[] = [];
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: readerNote(),
        ...resolvedSelectionProps(),
        onSubmitSelectionTransform: async (request) => {
          transformRequests.push(request);
          return {
            apiVersion: 1,
            requestId: request.requestId,
            status: "review_required",
            jobId: "job_20260718_transform01",
            conversationEventId: "evt_20260718_transform01",
            conversationId: "conv_20260718_transform01",
            tailEventId: "evt_20260718_transform01",
            proposal: {
              proposalId: "proposal_20260718_transform01",
              action: request.action,
              state: "ready",
              revision: 1,
              lines: [{ kind: "added", text: "Reviewed replacement" }]
            }
          };
        },
        onSelectionTransformResult: (result) => transformResults.push(result),
        onQuoteIntoCapture: (quote) => { captureQuotes.push(quote); return true; },
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: (capability) => unavailable.push(capability),
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const paragraph = requireElement(container.querySelector(".markdown-body p"));
    const selectionNode = requireElement(paragraph.querySelector("[data-pige-selection-segment]")).firstChild!;
    const originalBoundingClientRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
    dom.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
      if ((this as HTMLElement).classList.contains("selection-toolbar")) {
        return {
          left: 40, top: 40, width: 220, height: 34, right: 260, bottom: 74,
          x: 40, y: 40, toJSON: () => ({})
        } as DOMRect;
      }
      if ((this as HTMLElement).classList.contains("selection-more-menu")) {
        return {
          left: 84, top: 80, width: 176, height: 172, right: 260, bottom: 252,
          x: 84, y: 80, toJSON: () => ({})
        } as DOMRect;
      }
      return originalBoundingClientRect.call(this);
    };
    let collapsed = false;
    Object.defineProperty(dom.window, "getSelection", {
      configurable: true,
      value: () => ({
        isCollapsed: collapsed,
        rangeCount: collapsed ? 0 : 1,
        anchorNode: selectionNode,
        anchorOffset: 0,
        focusNode: selectionNode,
        focusOffset: 8,
        toString: () => "Selected first line\nSelected second line",
        getRangeAt: () => ({
          commonAncestorContainer: paragraph,
          startContainer: selectionNode,
          startOffset: 0,
          endContainer: selectionNode,
          endOffset: 8,
          getBoundingClientRect: () => ({ left: 90, top: 100, width: 120, height: 18, right: 210, bottom: 118 })
        })
      })
    });

    const showSelection = async (): Promise<void> => {
      await act(async () => {
        collapsed = true;
        dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
        collapsed = false;
        dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
        await settle(dom);
      });
      await waitFor(dom, () => container.querySelector('[role="toolbar"]') !== null);
    };

    await showSelection();
    let more = requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="more"]'));
    await act(async () => {
      more.click();
      collapsed = true;
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      collapsed = false;
      await settle(dom);
    });
    let menu = requireElement(container.querySelector<HTMLElement>('[role="menu"]'));
    const menuItems = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(menuItems.map((item) => item.dataset.selectionMoreAction)).toEqual([
      "ask", "createNote", "quoteIntoCapture", "copy", "copyAsQuote", "translate", "polish", "expand", "shorten"
    ]);
    expect(dom.window.document.activeElement).toBe(menuItems[0]);
    await act(async () => {
      menu.dispatchEvent(new dom.window.Event("scroll"));
      await settle(dom);
    });
    expect(container.querySelector('[role="menu"]')).toBe(menu);
    await act(async () => {
      menu.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await settle(dom);
    });
    expect(dom.window.document.activeElement).toBe(menuItems[1]);
    await act(async () => {
      menu.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    await waitFor(dom, () => dom.window.document.activeElement === container.querySelector('[data-selection-action="more"]'));
    more = requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="more"]'));

    await act(async () => {
      more.click();
      await settle(dom);
      requireElement(container.querySelector<HTMLButtonElement>('[data-selection-more-action="quoteIntoCapture"]')).click();
      await settle(dom);
    });
    expect(captureQuotes).toEqual([expect.objectContaining({
      activeVaultId: "vault_20260715_fullui01",
      pageId: "page_20260715_reader1111",
      title: "Reader actions",
      selectedText: "Selected first line\nSelected second line",
      selection: expect.objectContaining({ selectedContentHash: `sha256:${"b".repeat(64)}` })
    })]);
    expect(clipboardWrites).toEqual([]);
    expect(container.querySelector('[role="toolbar"]')).toBeNull();

    await showSelection();
    more = requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="more"]'));

    await act(async () => {
      more.click();
      await settle(dom);
    });
    menu = requireElement(container.querySelector<HTMLElement>('[role="menu"]'));
    await act(async () => {
      requireElement(menu.querySelector<HTMLButtonElement>('[data-selection-more-action="copy"]')).click();
      await settle(dom);
    });
    expect(clipboardWrites).toEqual(["Selected first line\nSelected second line"]);
    expect(unavailable).toEqual([]);
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Copied.");

    await showSelection();
    more = requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="more"]'));
    await act(async () => {
      more.click();
      await settle(dom);
      requireElement(container.querySelector<HTMLButtonElement>('[data-selection-more-action="copyAsQuote"]')).click();
      await settle(dom);
    });
    expect(clipboardWrites).toEqual([
      "Selected first line\nSelected second line",
      "> Selected first line\n> Selected second line"
    ]);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Quote copied.");

    await showSelection();
    more = requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="more"]'));
    await act(async () => {
      more.click();
      await settle(dom);
      requireElement(container.querySelector<HTMLButtonElement>('[data-selection-more-action="translate"]')).click();
      await settle(dom);
    });
    expect(transformRequests).toHaveLength(1);
    expect(transformRequests[0]).toMatchObject({
      apiVersion: 1,
      action: "translate",
      locale: "en",
      selection: {
        pageId: "page_20260715_reader1111",
        span: { unit: "utf8_bytes", start: 0, endExclusive: 8 }
      }
    });
    expect(transformResults[0]?.status).toBe("review_required");
    expect(unavailable).toEqual([]);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Review the proposed change in Note Agent.");

    await act(async () => root.unmount());
    dom.window.HTMLElement.prototype.getBoundingClientRect = originalBoundingClientRect;
    dom.window.close();
  });
});

function readerNote(): NoteRenderResult {
  return {
    summary: {
      pageId: "page_20260715_reader1111",
      title: "Reader actions",
      pageType: "note",
      status: "active",
      pagePath: "wiki/reader-actions.md",
      createdAt: "2026-07-15T10:00:00.000Z",
      updatedAt: "2026-07-15T10:00:00.000Z",
      language: "en",
      sourceIds: ["source_private_0001", "source_private_0002"]
    },
    html: '<p><span data-pige-selection-segment="readerseg_aaaaaaaaaaaaaaaa">Selected note body</span></p>',
    renderContextId: `notectx_${"c".repeat(32)}`,
    byteSize: 256
  };
}

function resolvedSelectionProps(): {
  readonly activeVaultId: string;
  readonly onResolveSelection: (request: ReaderSelectionResolveRequest) => Promise<ReaderSelectionResolveResult>;
  readonly onSubmitSelectionAction: (request: ReaderSelectionActionRequest) => Promise<ReaderSelectionActionResult>;
} {
  return {
    activeVaultId: "vault_20260715_fullui01",
    onResolveSelection: async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: "resolved",
      selection: {
        pageId: request.currentPageId,
        pageContentHash: `sha256:${"a".repeat(64)}`,
        span: { unit: "utf8_bytes", start: 0, endExclusive: 8 },
        selectedContentHash: `sha256:${"b".repeat(64)}`
      }
    }),
    onSubmitSelectionAction: async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: "completed",
      jobId: "job_20260718_selection01",
      conversationEventId: "evt_20260718_selection01",
      conversationId: "conv_20260718_selection01",
      tailEventId: "evt_20260718_selection02"
    })
  };
}

function libraryList(): LibraryListResult {
  return {
    scannedAt: "2026-07-15T10:00:00.000Z",
    activeVaultId: "vault_20260715_fullui01",
    total: 6,
    invalidPageCount: 0,
    pages: [{
      pageId: "page_20260715_aaaa1111",
      title: "Alpha plan",
      pageType: "note",
      status: "active",
      pagePath: "wiki/alpha-plan.md",
      createdAt: "2026-07-15T10:00:00.000Z",
      updatedAt: "2026-07-15T10:00:00.000Z",
      language: "en",
      sourceIds: []
    }, {
      pageId: "page_20260715_bbbb2222",
      title: "Interface design",
      pageType: "topic",
      status: "active",
      pagePath: "wiki/interface-design.md",
      createdAt: "2026-07-15T10:00:00.000Z",
      updatedAt: "2026-07-15T10:00:00.000Z",
      language: "en",
      sourceIds: []
    }, typedLibraryPage("page_20260802_concept01", "Navigation concept", "concept"),
    typedLibraryPage("page_20260802_entity001", "Ada Lovelace", "entity"),
    typedLibraryPage("page_20260802_claim0001", "Local-first claim", "claim"),
    typedLibraryPage("page_20260802_question1", "Open question", "question")]
  };
}

function typedLibraryPage(
  pageId: string,
  title: string,
  pageType: "concept" | "entity" | "claim" | "question"
): LibraryListResult["pages"][number] {
  return {
    pageId,
    title,
    pageType,
    status: "active",
    pagePath: `wiki/${pageType}/${pageId}.md`,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    language: "en",
    sourceIds: []
  };
}

function libraryPage(
  pageId: string,
  title: string,
  updatedAt: string
): LibraryListResult["pages"][number] {
  return {
    pageId,
    title,
    pageType: "note",
    status: "active",
    pagePath: `wiki/${pageId}.md`,
    createdAt: updatedAt,
    updatedAt,
    sourceIds: []
  };
}

function sourcePage(pageId: string, title: string): LibraryListResult["pages"][number] {
  return {
    pageId,
    title,
    pageType: "source",
    status: "active",
    pagePath: `sources/${pageId}.md`,
    createdAt: "2026-07-15T10:00:00.000Z",
    updatedAt: "2026-07-15T10:00:00.000Z",
    language: "en",
    sourceIds: []
  };
}

function searchResult(
  query: string,
  results: RetrievalSearchResult["results"]
): RetrievalSearchResult {
  return {
    searchedAt: "2026-07-15T10:00:00.000Z",
    activeVaultId: "vault_20260715_fullui01",
    query,
    mode: "lexical_sqlite_fts",
    total: results.length,
    invalidPageCount: 0,
    degraded: false,
    results
  };
}

function createDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://localhost"
  });
  for (const key of globalKeys) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: dom.window[key]
    });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
    configurable: true,
    value(this: HTMLElement, name: string, listener: EventListener) {
      this.addEventListener(name.replace(/^on/u, ""), listener);
    }
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
    configurable: true,
    value(this: HTMLElement, name: string, listener: EventListener) {
      this.removeEventListener(name.replace(/^on/u, ""), listener);
    }
  });
  Object.defineProperty(dom.window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(Date.now()), 0)
  });
  Object.defineProperty(dom.window, "cancelAnimationFrame", {
    configurable: true,
    value: (handle: number) => dom.window.clearTimeout(handle)
  });
  Object.defineProperty(dom.window, "pige", { configurable: true, value: {
    notes: {
      unlinkRelation: vi.fn(), setQuestionState: vi.fn(), searchQuestionAnswers: vi.fn(),
      changeQuestionAnswer: vi.fn(), searchClaimContradictions: vi.fn(), changeClaimContradiction: vi.fn(),
      searchConceptParents: vi.fn(), changeConceptParent: vi.fn(), revealGenerated: vi.fn(),
      readEntityIdentifiers: vi.fn((request: {
        readonly apiVersion: 1; readonly requestId: string; readonly activeVaultId: string;
        readonly currentPageId: string; readonly renderContextId: string; readonly expectedRevision: string;
      }) => Promise.resolve({ ...request, status: "failed" as const })),
      listSourceDerived: vi.fn((request: { readonly apiVersion: 1; readonly requestId: string }) =>
        Promise.resolve({ apiVersion: 1 as const, requestId: request.requestId, status: "failed" as const }))
    },
    sources: {
      listTrash: vi.fn((request: { readonly apiVersion: 1; readonly requestId: string; readonly activeVaultId: string }) =>
        Promise.resolve({ ...request, status: "ready" as const, sources: [] }))
    }
  } });
  return dom;
}

function buttonNamed(container: ParentNode, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === name);
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}

function buttonContaining(container: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`Missing button containing: ${text}`);
  return button;
}

function buttonWithLabel(container: ParentNode, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.getAttribute("aria-label") === label);
  if (!button) throw new Error(`Missing button with label: ${label}`);
  return button;
}

async function clickButton(dom: JSDOM, button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
    await settle(dom);
  });
}

async function inputText(dom: JSDOM, input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const prototype = input instanceof dom.window.HTMLTextAreaElement
      ? dom.window.HTMLTextAreaElement.prototype
      : dom.window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(input, value);
    const propertyChange = new dom.window.Event("propertychange", { bubbles: true });
    Object.defineProperty(propertyChange, "propertyName", { value: "value" });
    input.dispatchEvent(propertyChange);
    input.dispatchEvent(new dom.window.InputEvent("input", {
      bubbles: true,
      data: value,
      inputType: "insertText"
    }));
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await settle(dom);
  });
}

function requireElement<T>(value: T | null): T {
  if (!value) throw new Error("Required element not found.");
  return value;
}

async function delay(dom: JSDOM, milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, milliseconds));
}

async function waitFor(dom: JSDOM, predicate: () => boolean, timeoutMs = 1_500): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for Library state.");
    await act(async () => delay(dom, 10));
  }
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function t(key: string): string {
  return (enMessages as Record<string, string>)[key] ?? key;
}
