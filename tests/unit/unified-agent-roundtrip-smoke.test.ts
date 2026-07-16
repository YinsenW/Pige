import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve("apps/desktop/scripts/electron-unified-agent-roundtrip-smoke.mjs"),
  "utf8"
);

const connectRenderer = source.slice(
  source.indexOf("async function runConnectRenderer"),
  source.indexOf("async function runPendingConfirmationRenderer")
);
const pendingConfirmationRenderer = source.slice(
  source.indexOf("async function runPendingConfirmationRenderer"),
  source.indexOf("async function runReopenRenderer")
);
const reopenRenderer = source.slice(
  source.indexOf("async function runReopenRenderer"),
  source.indexOf("async function runPermissionPendingRenderer")
);

describe("unified Agent assembled smoke navigation", () => {
  it("uses the current Settings-owned progressive Models flow", () => {
    expect(source).not.toContain('clickNav("Models")');
    expect(source).not.toContain("details.custom-provider");
    expect(connectRenderer).toContain('openSettingsSection("Models")');
    expect(connectRenderer).toContain('.settings-inline-actions button.settings-button.primary:not(:disabled)');
    expect(connectRenderer).toContain('.model-provider-picker button.model-provider-choice');
    expect(connectRenderer).toContain("!reviewedPresetNames.has(choiceName)");
    expect(connectRenderer).toContain('document.querySelector("button.sidebar-toggle-button")');
    expect(connectRenderer).toContain('document.querySelector("button.settings-return")');
    expect(connectRenderer).toContain('.model-settings-footer-actions button.primary:not(:disabled)');
    expect(connectRenderer).toContain('.settings-row > button.settings-button:not(:disabled)');
    expect(connectRenderer).toContain('document.querySelector(".provider-model-group")');
    expect(pendingConfirmationRenderer).not.toContain("openSettingsSection");
    expect(reopenRenderer).toContain('openSettingsSection("Models")');
    expect(reopenRenderer).toContain('document.querySelector("button.settings-return")');
  });

  it("accepts secret-field removal only after the durable provider binding is ready", () => {
    const readyBinding = source.indexOf('}, "ready provider binding");');
    const clearedSecret = source.indexOf("const secretFieldCleared = await waitFor(");

    expect(readyBinding).toBeGreaterThan(-1);
    expect(clearedSecret).toBeGreaterThan(readyBinding);
    expect(source).toContain('document.querySelector("#provider-key")?.value === ""');
  });
});
