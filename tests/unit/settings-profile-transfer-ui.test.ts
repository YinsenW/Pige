import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsProfileTransferPanel } from "../../apps/desktop/src/renderer/src/components/SettingsProfileTransferPanel";

describe("SettingsProfileTransferPanel", () => {
  it("exposes only the bounded export and reviewed import workflow", () => {
    const markup = renderToStaticMarkup(createElement(SettingsProfileTransferPanel, {
      api: {
        exportProfile: vi.fn(),
        previewImport: vi.fn(),
        applyImport: vi.fn()
      },
      t: (key: string) => ({
        "settings.general.profileTransferTitle": "Preferences backup",
        "settings.general.profileTransferExportTitle": "Export preferences",
        "settings.general.profileTransferDescription": "Portable preferences",
        "settings.general.profileTransferExport": "Export",
        "settings.general.profileTransferImportTitle": "Import preferences",
        "settings.general.profileTransferExclusions": "No vaults, credentials, permissions, recent items, or window state",
        "settings.general.profileTransferImport": "Choose file"
      })[key] ?? key
    }));
    expect(markup).toContain("Preferences backup");
    expect(markup).toContain("Export preferences");
    expect(markup).toContain("Choose file");
    expect(markup).toContain("No vaults, credentials, permissions");
    expect(markup).not.toContain("input type=\"file\"");
    expect(markup).not.toContain("provider");
  });
});
