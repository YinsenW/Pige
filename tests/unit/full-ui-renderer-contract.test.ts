import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rendererRoot = path.resolve("apps/desktop/src/renderer/src");
const appSource = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
const cssSource = fs.readFileSync(path.join(rendererRoot, "styles/app.css"), "utf8");
const iconSource = fs.readFileSync(path.join(rendererRoot, "components/PigeIcon.tsx"), "utf8");
const enMessages = JSON.parse(
  fs.readFileSync(path.join(rendererRoot, "locales/en/messages.json"), "utf8")
) as Record<string, string>;

describe("full production UI renderer contract", () => {
  it("uses the reviewed pane dimensions and corrected resident/overlay breakpoints", () => {
    for (const declaration of [
      "--home-pane-min: 360px;",
      "--home-pane-default: 420px;",
      "--home-pane-max: 420px;",
      "--home-pane-wide-max: 1120px;",
      "--home-conversation-max: 960px;",
      "--home-composer-max: 840px;",
      "--library-pane-min: 240px;",
      "--library-pane-default: 280px;",
      "--library-pane-max: 320px;",
      "--reader-pane-min: 560px;",
      "--reader-pane-default: 720px;",
      "--reader-pane-max: 960px;",
      "--reader-prose-max: 720px;",
      "--agent-pane-min: 360px;",
      "--agent-pane-default: 400px;",
      "--agent-pane-max: 440px;",
      "--radius-composer: 22px;"
    ]) {
      expect(cssSource).toContain(declaration);
    }

    expect(cssSource).toContain("@media (max-width: 839px)");
    expect(cssSource).toContain("@media (min-width: 840px) and (max-width: 1199px)");
    expect(cssSource).toContain("@media (min-width: 720px)");
    expect(cssSource).toContain("@media (max-width: 959px)");
    expect(cssSource).toContain("@media (min-width: 960px) and (max-width: 1239px)");
    expect(cssSource).toContain("@media (min-width: 1240px)");
    expect(cssSource).toContain("@media (min-width: 720px) and (max-width: 839px)");
    expect(cssSource).toContain("@media (min-width: 1440px)");
    expect(cssSource).toContain("width: min(100%, var(--home-pane-max));");
    expect(cssSource).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(cssSource).toContain("env(titlebar-area-x, 0px)");
    expect(cssSource).toContain("env(titlebar-area-width, 100vw)");
    expect(appSource).toContain('macosWindowShell ? " platform-macos" : ""');
    expect(cssSource).toContain(".app-window.platform-macos .titlebar {");
    expect(cssSource).toContain("padding-left: 84px;");
    expect(cssSource).toContain(".app-window.platform-macos .titlebar-navigation");
    expect(cssSource).toContain("transform: translateY(-5px);");
    expect(cssSource).toContain("padding-right: max(10px, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw)))");
    expect(cssSource).not.toContain(".app-window .titlebar { padding-right: 10px; }");
    const homeComposer = cssSource.match(/\.home > \.composer \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(homeComposer).toContain("border-radius: 22px;");
    expect(homeComposer).toContain("anchor-name: --home-composer;");
    const processingPanel = cssSource.match(/\.task-panel \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(processingPanel).toContain("position: fixed;");
    expect(processingPanel).toContain("position-anchor: --home-composer;");
    expect(processingPanel).toContain("left: anchor(left);");
    expect(processingPanel).toContain("width: anchor-size(width);");
    expect(processingPanel).toContain("bottom: calc(anchor(top) - 14px);");
    expect(processingPanel).toContain("margin: 0;");
    const wideHome = cssSource.slice(cssSource.indexOf("@media (min-width: 720px)"));
    expect(wideHome).toContain("--home-pane-max: var(--home-pane-wide-max)");
    expect(wideHome).toContain("width: min(100%, var(--home-composer-max));");
    expect(wideHome).toContain("max-width: var(--home-conversation-max);");
    const processingProjection = appSource.slice(
      appSource.indexOf("function isActiveProcessingFileJob"),
      appSource.indexOf("function jobStateMessageKey")
    );
    expect(processingProjection).toContain('job.state === "running"');
    expect(processingProjection).toContain('job.state === "failed_retryable"');
    expect(processingProjection).not.toContain('job.state === "completed"');
    expect(processingProjection).not.toContain('job.state === "failed_final"');
    expect(processingProjection).not.toContain('job.state === "cancelled"');
  });

  it("keeps Home-only navigation hidden and exposes one controlled Library tree", () => {
    expect(appSource).toContain('{view !== "home" ? (');
    expect(appSource).toContain('aria-controls="pige-library-sidebar"');
    expect(appSource).toContain('id="pige-library-sidebar"');
    expect(appSource).toContain("<LibrarySidebarTree");
    expect(appSource).toContain('aria-expanded={familyExpanded}');
    expect(appSource).toContain('aria-expanded={typeExpanded}');
    expect(appSource).toContain("window.pige.window.currentLayout()");
    expect(appSource).toContain("window.pige.window.onLayoutChanged");
    expect(appSource).toContain("window.pige.window.setLayout(request)");
    expect(appSource).toContain("windowLayoutRevisionRef.current");
    expect(appSource).toContain('surface: "home"');
    expect(appSource).toContain('surface: "reader"');
    expect(appSource).not.toContain("window.pige.window.setMode(");
    expect(appSource).not.toContain("window.pige.window.setSidebarOpen(");
    const layoutAdapter = appSource.slice(
      appSource.indexOf("const requestWindowLayout"),
      appSource.indexOf("const updateVoiceAssetInstallOwnership")
    );
    expect(layoutAdapter).not.toMatch(/\b(width|height|workArea|presentation)\s*:/);
    const primaryNavigationStart = appSource.indexOf('<nav className="primary-navigation nav-list"');
    const primaryNavigation = appSource.slice(
      primaryNavigationStart,
      appSource.indexOf("</nav>", primaryNavigationStart)
    );
    expect(primaryNavigation).toContain('t("nav.home")');
    expect(primaryNavigation).toContain('t("nav.knowledgeTree")');
    expect(primaryNavigation.replace('aria-label={t("nav.library")}', "")).not.toContain('t("nav.library")');
    expect(primaryNavigation).not.toContain('t("nav.models")');
    expect(appSource).toContain('className="sidebar-settings-control"');
    expect(appSource).toContain('aria-haspopup="dialog"');
    expect(appSource).toContain('{ id: "maintenance", icon: "database", status: "real" }');
    expect(appSource).toContain('{ id: "history", icon: "activity", status: "real" }');
    expect(appSource).toContain('{ id: "updates", icon: "package", status: "partial" }');
    expect(appSource).toContain("window.pige.updates.onStatusChanged");
    expect(appSource).toContain("window.pige.updates.summary()");
    expect(appSource).toContain("window.pige.updates.check({ apiVersion: 1, requestId })");
    expect(appSource).toContain('{ id: "diagnostics", icon: "wrench", status: "real" }');
    expect(appSource).toContain('settingsSection === "vault" || settingsSection === "maintenance"');
    expect(appSource).toContain('settingsSection === "updates" || settingsSection === "diagnostics"');
  });

  it("binds the approved Library search surface and Home composer icons to existing real actions", () => {
    expect(appSource).toContain('type="search"');
    expect(appSource).toContain('onClick={() => void navigateLibrarySearch()}');
    expect(appSource).toContain('onSearch={(request) => window.pige.retrieval.search(request)}');
    expect(appSource).toContain('role="tablist"');
    expect(appSource).toContain('aria-selected={family === value}');
    expect(appSource).toContain('if (family === "sources") return ["source"]');
    expect(appSource).toContain('family === "tags"');
    expect(appSource).toContain('onInput={(event) => setQuery(event.currentTarget.value)}');
    expect(cssSource).toContain("width: min(100%, 680px);");
    expect(cssSource).toContain("min-height: 42px;");
    expect(cssSource).toContain("min-height: 48px;");
    expect(appSource).toContain('onClick={() => fileInputRef.current?.click()}');
    expect(appSource).toContain('name="attach"');
    expect(appSource).toContain('props.t("home.attachToMessage")');
    expect(appSource).toContain('className={`attachment-chip${isPastedText ? " pasted-text-chip" : ""}');
    expect(appSource).toContain("multiple");
    expect(appSource).toContain('className="attachment-submission-notice"');
    expect(appSource).toContain("attachmentRejectionMessageKey(rejection.reason)");
    expect(appSource).not.toContain('props.t("home.oneFilePerTurn")');
    expect(appSource).toContain('submitHomeFiles(request.files, "file_drop"');
    expect(appSource).toContain('"file_picker"');
    expect(appSource).toContain('className="drop-overlay" role="status" aria-live="polite" aria-atomic="true"');
    expect(enMessages["home.dropToCapture"]).toBe("Release to send these files now");
    expect(enMessages["home.attachToMessage"]).toBe("Attach to this message");
    expect(cssSource).toContain(".attachment-strip.visible");
    expect(cssSource).toContain(".conversation-attachment-list");
    expect(appSource).toContain('? "loading" : "send"');
    expect(appSource).toContain("onKeyDown={handleComposerKeyDown}");
  });

  it("binds the approved Reader actions without inventing edit, selection, or source services", () => {
    expect(appSource).toContain("const copyNoteMarkdown = async (pageId: string): Promise<boolean>");
    expect(appSource).toContain("window.pige.notes.get({ pageId })");
    expect(appSource).toContain("navigator.clipboard.writeText(note.markdownBody)");
    expect(appSource).toContain('data-reader-action="edit"');
    expect(appSource).toContain('data-reader-action="copy"');
    expect(appSource).toContain('data-reader-action="more"');
    expect(appSource).toContain('props.onDevelopment("selection_actions")');
    expect(appSource).toContain('props.onDevelopment("source_reference")');
    expect(appSource).toContain('event.key === "ArrowRight"');
    expect(appSource).toContain('event.key === "ArrowLeft"');
    expect(appSource).toContain('event.key === "Home"');
    expect(appSource).toContain('event.key === "End"');
    expect(appSource).toContain("event.preventDefault()");
    expect(appSource).toContain("const toolbarRect = toolbar.getBoundingClientRect()");
    expect(appSource).toContain('window.addEventListener("scroll", dismissOnScroll, true)');
    expect(appSource).toContain("priorOwner?.isConnected ? priorOwner : readerRef.current");
    expect(appSource).toContain('!firstBlock || firstBlock.tagName !== "H1"');
    expect(appSource).toContain('"reader-duplicate-title"');
    expect(appSource).not.toContain("const toolbarWidth = 244");
    expect(appSource).not.toContain("const toolbarHeight = 42");
    expect(appSource).not.toContain("sourceId}</");
    expect(cssSource).toContain("max-width: calc(100vw - 24px);");
    expect(cssSource).toContain("max-height: calc(100vh - 24px);");
    expect(cssSource).toContain(".markdown-body > .reader-duplicate-title");
    expect(cssSource).toContain("display: none;");
    expect(cssSource).toContain('.reader-toolbar-actions .prototype-action:not([data-reader-action="more"])');
  });

  it("uses one reviewed tree-shaken Lucide family without raw renderer SVG", () => {
    expect(iconSource).toContain('from "lucide-react";');
    expect(iconSource).toContain("TreePine");
    expect(iconSource).toContain("GalleryVerticalEnd");
    expect(iconSource).not.toContain("<svg");
    expect(appSource).not.toContain("<svg");
  });

  it("keeps new Library controls aligned across all six locale catalogs", () => {
    const locales = ["de", "en", "fr", "ja", "ko", "zh-Hans"];
    const requiredKeys = [
      "library.all",
      "library.content",
      "library.family.all",
      "library.family.notes",
      "library.family.sources",
      "library.family.tags",
      "library.family.topics",
      "library.filter",
      "library.knowledge",
      "library.noMatches",
      "library.search",
      "library.searchDegraded",
      "library.searchLoading",
      "library.searchUnavailableDescription",
      "library.searchUnavailableTitle",
      "library.tagsUnavailableDescription",
      "library.tagsUnavailableTitle"
    ];

    requiredKeys.push(
      "development.capability.document_actions",
      "development.capability.source_reference",
      "development.state.development",
      "note.close",
      "note.copy",
      "note.document.copied",
      "note.document.copy_failed",
      "note.document.copying",
      "note.edit",
      "note.moreActions",
      "note.moreSources",
      "note.path",
      "note.preview",
      "note.savedSource",
      "note.selection.explain",
      "note.selection.link",
      "note.selection.more",
      "note.selection.summarize",
      "note.selectionActions",
      "note.sourceReferenceUnavailable",
      "note.sources",
      "settings.close",
      "settings.navigation",
      "settings.section.maintenance",
      "settings.section.models",
      "settings.section.history",
      "settings.section.updates",
      "settings.section.diagnostics",
      "settings.section.vault",
      "settings.status.development",
      "system.localOnlyNote",
      "system.previewSupport",
      "system.updatesTitle",
      "system.diagnosticsTitle"
    );

    for (const locale of locales) {
      const catalog = JSON.parse(fs.readFileSync(path.join(rendererRoot, "locales", locale, "messages.json"), "utf8")) as Record<string, unknown>;
      for (const key of requiredKeys) {
        expect(catalog[key], `${locale}:${key}`).toEqual(expect.any(String));
        expect((catalog[key] as string).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps development entries local and Settings independent of native window sizing", () => {
    const developmentHandler = appSource.match(/const showDevelopmentCapability = \([\s\S]*?\n  };/)?.[0] ?? "";
    expect(developmentHandler).toContain("setDevelopmentNotice");
    expect(developmentHandler).not.toContain("window.pige");
    expect(appSource).toContain('role="dialog"');
    expect(appSource).toContain('aria-modal="true"');
    expect(appSource).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(cssSource).toContain(".settings-overlay {");
    expect(cssSource).toContain("position: fixed;");
    expect(cssSource).toContain("width: min(980px, 100%);");
  });
});
