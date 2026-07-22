import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve("apps/desktop/scripts/electron-unified-agent-roundtrip-smoke.mjs"),
  "utf8"
);

describe("unified Agent assembled smoke navigation", () => {
  it("uses the current Settings-owned progressive Models flow", () => {
    expect(source).not.toContain('clickNav("Models")');
    expect(source).not.toContain("details.custom-provider");
    expect(source).toContain('openSettingsSection("Models")');
    expect(source).toContain('.settings-inline-actions button.settings-button.primary:not(:disabled)');
    expect(source).toContain('.model-provider-picker button.model-provider-choice');
    expect(source).toContain("!reviewedPresetNames.has(choiceName)");
    expect(source).toContain('document.querySelector("button.sidebar-toggle-button")');
    expect(source).toContain('document.querySelector("button.settings-return")');
    expect(source).toContain('.model-settings-footer-actions button.primary:not(:disabled)');
    expect(source).toContain('.settings-row > button.settings-button:not(:disabled)');
    expect(source).toContain('document.querySelector(".provider-model-group")');
  });

  it("accepts secret-field removal only after the durable provider binding is ready", () => {
    const readyBinding = source.indexOf('}, "ready provider binding");');
    const clearedSecret = source.indexOf("const secretFieldCleared = await waitFor(");

    expect(readyBinding).toBeGreaterThan(-1);
    expect(clearedSecret).toBeGreaterThan(readyBinding);
    expect(source).toContain('document.querySelector("#provider-key")?.value === ""');
  });

  it("provides an isolated canonical high-risk denial route with zero command execution", () => {
    expect(source).toContain('process.argv.includes("--high-risk-only")');
    expect(source).toContain("runHighRiskDenyRenderer(browserWindow)");
    expect(source).toContain('document.querySelector(\'.confirmation-dialog[role="dialog"][aria-modal="true"]\')');
    expect(source).toContain("document.activeElement === denyButton");
    expect(source).toContain('document.querySelector(".permission-prompt, .model-egress-prompt")');
    expect(source).toContain("denied-command-must-not-exist.txt");
    expect(source).toContain('request.body.includes("function_call_output")');
  });

  it("proves unified durable conversation, citation navigation, and source results", () => {
    expect(source).not.toContain('writeToolCallResponse(response, "pige_finish_home_turn"');
    expect(source).not.toContain('writeStreamingToolCallResponse(');
    expect(source).not.toContain("terminal-answer");
    expect(source).toContain("writeTextResponse(response, GROUNDED_ANSWER");
    expect(source).toContain("writeTextResponse(response, DATASET_ANSWER");
    expect(source).toContain('document.querySelectorAll(".conversation-message.role-assistant:not(.provisional)")');
    expect(source).toContain('document.querySelector(".retrieval-citations button:not(:disabled)")');
    expect(source).toContain('await waitFor(() => document.querySelector(".note-reader"), "citation Reader")');
    expect(source).toContain('document.querySelector(".home-reader .back-button")');
    expect(source).toContain("directStillVisibleAfterGrounded");
    expect(source).toContain("groundedRetrievalVisible");
    expect(source).toContain("noProvisionalAnswerDuplicates");
    expect(source).toContain('textContent?.includes("Activity History")');
    expect(source).toContain('section.settings-page.settings-history-page[aria-labelledby="settings-history-title"]');
    expect(source).toContain('\'"call_id":"call_dataset_materialize"\'');
  });
});
