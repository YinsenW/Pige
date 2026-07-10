import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DiagnosticsService,
  redactDiagnosticText,
  redactPaths
} from "../../apps/desktop/src/main/services/diagnostics-service";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-diagnostics-test-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("diagnostics service", () => {
  it("redacts obvious secret forms before writing diagnostic events", () => {
    const userDataPath = makeTempRoot();
    const service = new DiagnosticsService(userDataPath);
    service.recordEvent({
      level: "error",
      code: "provider.failure",
      message: "token=secret-value sk-1234567890abcdef"
    });

    const log = fs.readFileSync(path.join(userDataPath, "diagnostics/app-events.jsonl"), "utf8");
    expect(log).toContain("[REDACTED_SECRET]");
    expect(log).not.toContain("secret-value");
    expect(log).not.toContain("sk-1234567890abcdef");
    expect(service.health().recentErrorCount).toBe(1);
  });

  it("redacts standalone diagnostic text", () => {
    expect(redactDiagnosticText("api_key=abc123 token=def456")).toBe(
      "api_key=[REDACTED_SECRET] token=[REDACTED_SECRET]"
    );
  });

  it("previews support bundle categories before export", () => {
    const service = new DiagnosticsService(makeTempRoot());
    const preview = service.previewSupportBundle();

    expect(preview.localOnly).toBe(true);
    expect(preview.includedCategories.map((category) => category.id)).toContain("recent_errors");
    expect(preview.excludedCategories.map((category) => category.id)).toContain("secrets");
    expect(preview.privacyWarnings.join(" ")).toContain("not uploaded automatically");
  });

  it("exports only redacted local support bundle content", () => {
    const userDataPath = makeTempRoot();
    const service = new DiagnosticsService(userDataPath);
    service.recordEvent({
      level: "error",
      code: "provider.failure",
      message: `Authorization: Bearer secret-token-123\n/Users/cherry/Documents/Pige Vault/wiki/rag.md`
    });

    const preview = service.previewSupportBundle();
    const outputPath = path.join(userDataPath, "support.json");
    const result = service.exportSupportBundle(outputPath, preview);
    const exported = fs.readFileSync(outputPath, "utf8");

    expect(result.status).toBe("exported");
    expect(exported).toContain("[REDACTED_SECRET]");
    expect(exported).toContain("<home>");
    expect(exported).not.toContain("secret-token-123");
    expect(exported).not.toContain("/Users/cherry");
    expect(exported).not.toContain("source bodies");
  });

  it("redacts macOS and Windows absolute paths", () => {
    expect(redactPaths(`${os.homedir()}/Documents/Pige Vault/wiki/rag.md`)).toContain("<home>");
    expect(redactPaths("C:\\Users\\Cherry\\Documents\\Pige Vault\\wiki\\rag.md")).toBe(
      "<home>\\Documents\\Pige Vault\\wiki\\rag.md"
    );
  });
});
