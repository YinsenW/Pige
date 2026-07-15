import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rendererRoot = path.resolve("apps/desktop/src/renderer/src");
const appSource = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
const cssSource = fs.readFileSync(path.join(rendererRoot, "styles/app.css"), "utf8");
const iconSource = fs.readFileSync(path.join(rendererRoot, "components/PigeIcon.tsx"), "utf8");

describe("full production UI renderer contract", () => {
  it("uses the reviewed pane dimensions and corrected resident/overlay breakpoints", () => {
    for (const declaration of [
      "--home-pane-min: 360px;",
      "--home-pane-default: 420px;",
      "--home-pane-max: 420px;",
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

    expect(cssSource).toContain("@media (max-width: 831px)");
    expect(cssSource).toContain("@media (min-width: 832px) and (max-width: 1199px)");
    expect(cssSource).toContain("@media (min-width: 1200px) and (max-width: 1439px)");
    expect(cssSource).toContain("@media (min-width: 1440px)");
    expect(cssSource).toContain("width: min(100%, var(--home-pane-max));");
    expect(cssSource).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(cssSource).toContain("env(titlebar-area-x, 0px)");
    expect(cssSource).toContain("env(titlebar-area-width, 100vw)");
    expect(cssSource).toContain("padding-right: max(10px, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw)))");
    expect(cssSource).not.toContain(".app-window .titlebar { padding-right: 10px; }");
    const homeComposer = cssSource.match(/\.home > \.composer \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(homeComposer).toContain("border-radius: 22px;");
  });

  it("keeps Home-only navigation hidden and exposes one controlled Library tree", () => {
    expect(appSource).toContain('{view !== "home" ? (');
    expect(appSource).toContain('aria-controls="pige-library-sidebar"');
    expect(appSource).toContain('id="pige-library-sidebar"');
    expect(appSource).toContain("<LibrarySidebarTree");
    expect(appSource).toContain('aria-expanded={familyExpanded}');
    expect(appSource).toContain('aria-expanded={typeExpanded}');
    expect(appSource).toContain('!nextSidebarOpen && view === "home" && windowState?.mode === "expanded"');
    expect(appSource).toContain('setMode({ mode: "compact" })');
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
    expect(appSource).toContain('settingsSection === "vault" || settingsSection === "maintenance"');
  });

  it("binds Library filtering and Home composer icons to existing real actions", () => {
    expect(appSource).toContain('type="search"');
    expect(appSource).toContain('aria-pressed={filter === value}');
    expect(appSource).toContain('onClick={() => fileInputRef.current?.click()}');
    expect(appSource).toContain('name="attach"');
    expect(appSource).toContain('? "loading" : "send"');
    expect(appSource).toContain("onKeyDown={handleComposerKeyDown}");
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
      "library.filter",
      "library.knowledge",
      "library.noMatches",
      "library.search"
    ];

    requiredKeys.push(
      "development.state.development",
      "settings.close",
      "settings.navigation",
      "settings.section.maintenance",
      "settings.section.models",
      "settings.section.vault",
      "settings.status.development"
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
