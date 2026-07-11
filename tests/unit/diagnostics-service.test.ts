import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DiagnosticsService,
  redactDiagnosticText,
  redactPaths
} from "../../apps/desktop/src/main/services/diagnostics-service";

const DAY_MS = 24 * 60 * 60 * 1_000;
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-diagnostics-test-"));
  tempRoots.push(root);
  return root;
}

function eventFiles(userDataPath: string): string[] {
  const diagnosticsPath = path.join(userDataPath, "diagnostics");
  if (!fs.existsSync(diagnosticsPath)) return [];
  return fs
    .readdirSync(diagnosticsPath)
    .filter((name) => /^app-events\.jsonl(?:\.\d+)?$/.test(name))
    .sort((left, right) => eventFileOrder(right) - eventFileOrder(left))
    .map((name) => path.join(diagnosticsPath, name));
}

function eventFileOrder(name: string): number {
  if (name === "app-events.jsonl") return 0;
  return Number(name.slice("app-events.jsonl.".length));
}

function readEvents(userDataPath: string): Array<Record<string, unknown>> {
  return eventFiles(userDataPath).flatMap((filePath) =>
    fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  );
}

function eventStorageBytes(userDataPath: string): number {
  return eventFiles(userDataPath).reduce((total, filePath) => total + fs.statSync(filePath).size, 0);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("diagnostics service", () => {
  it("redacts and bounds messages and redacted details before local persistence", () => {
    const userDataPath = makeTempRoot();
    const service = new DiagnosticsService(userDataPath, {
      maxStringBytes: 160,
      maxEventBytes: 768,
      maxSegmentBytes: 768,
      maxAppEventBytes: 2_048
    });
    const longPrivateBody = `PRIVATE_NOTE_BODY ${"private sentence ".repeat(100)}`;
    service.recordEvent({
      level: "error",
      code: "provider.failure",
      message: `Contact person@example.com with sk-proj-1234567890abcdefgh at /Users/alice/Private Vault/note.md. ${longPrivateBody}`,
      redactedDetails: {
        apiKey: "opaque-credential-without-a-known-token-shape",
        email: "owner@example.com",
        filePath: "C:\\Users\\Alice\\Documents\\Private Vault\\note.md",
        sourceBody: "short source text that must not be diagnostic data",
        toolOutput: longPrivateBody,
        toolName: "fake-ocr",
        durationMs: 42
      }
    });

    const log = eventFiles(userDataPath).map((filePath) => fs.readFileSync(filePath, "utf8")).join("");
    const [event] = readEvents(userDataPath);
    const details = event.redactedDetails as Record<string, unknown>;

    expect(Buffer.byteLength(log)).toBeLessThanOrEqual(768);
    expect(event.message).toBe("[REDACTED_CONTENT]");
    expect(details.redactedSecretCount).toBe(1);
    expect(details.redactedPrivateCount).toBe(2);
    expect(details.redactedContentCount).toBe(2);
    expect(details.toolName).toBe("fake-ocr");
    expect(details.durationMs).toBe(42);
    expect(log).not.toContain("PRIVATE_NOTE_BODY");
    expect(log).not.toContain("private sentence");
    expect(log).not.toContain("person@example.com");
    expect(log).not.toContain("opaque-credential-without-a-known-token-shape");
    expect(log).not.toContain("/Users/alice");
    expect(service.health().recentErrorCount).toBe(1);
  });

  it("replaces opaque top-level diagnostic messages while preserving safe evidence", () => {
    const userDataPath = makeTempRoot();
    const service = new DiagnosticsService(userDataPath);
    const privateMessages = [
      "totally opaque private memory and credential zebra-frost-91",
      "my private note says the launch date is midnight",
      "source sentence containing a confidential customer name"
    ];

    for (const [index, message] of privateMessages.entries()) {
      service.recordEvent({
        level: "warning",
        code: `diagnostics.opaque_message.${index}`,
        message,
        redactedDetails: { sourceId: `src_0${index}`, durationMs: index + 1 }
      });
    }

    const persisted = eventFiles(userDataPath).map((filePath) => fs.readFileSync(filePath, "utf8")).join("");
    const events = readEvents(userDataPath);

    for (const message of privateMessages) {
      expect(persisted).not.toContain(message);
      for (const fragment of message.split(" ").filter((part) => part.length >= 7)) {
        expect(persisted).not.toContain(fragment);
      }
    }
    expect(events).toHaveLength(privateMessages.length);
    expect(events.every(({ message }) => message === "[REDACTED_CONTENT]")).toBe(true);
    expect(events[0]).toMatchObject({
      code: "diagnostics.opaque_message.0",
      redactedDetails: { sourceId: "src_00", durationMs: 1 }
    });
  });

  it("uses the fixed production summary instead of a dynamic caught.message", () => {
    const userDataPath = makeTempRoot();
    const service = new DiagnosticsService(userDataPath);
    const caught = new Error("totally opaque private memory and credential zebra-frost-91");

    service.recordEvent({
      level: "warning",
      code: "jobs.resume_failed",
      message: caught.message,
      redactedDetails: { retryable: true, errorCode: "jobs.recovery_failed" }
    });

    const persisted = eventFiles(userDataPath).map((filePath) => fs.readFileSync(filePath, "utf8")).join("");
    const [event] = readEvents(userDataPath);

    expect(event).toMatchObject({
      code: "jobs.resume_failed",
      message: "Durable background job recovery failed.",
      redactedDetails: { retryable: true, errorCode: "jobs.recovery_failed" }
    });
    expect(persisted).not.toContain(caught.message);
    expect(persisted).not.toContain("zebra-frost-91");
  });

  it("fails closed for opaque secret, private-knowledge, and unknown text detail fields", () => {
    const userDataPath = makeTempRoot();
    const service = new DiagnosticsService(userDataPath);
    const privateValues = {
      apiKey: "totally-opaque-credential",
      memory: "my private remembered preference",
      conversation: "a private conversation turn",
      noteText: "a private note sentence",
      sourceText: "a private source sentence",
      arbitraryLabel: "untyped text must not pass",
      filePath: "opaque private path",
      email: "opaque private identity"
    } as const;

    service.recordEvent({
      level: "warning",
      code: "diagnostics.adversarial_details",
      message: "Unsafe details were rejected.",
      redactedDetails: {
        ...privateValues,
        sourceId: "src_01HSAFE",
        durationMs: 17,
        retryable: true
      }
    });

    const persisted = eventFiles(userDataPath).map((filePath) => fs.readFileSync(filePath, "utf8")).join("");
    const [event] = readEvents(userDataPath);
    const details = event.redactedDetails as Record<string, unknown>;

    for (const value of Object.values(privateValues)) expect(persisted).not.toContain(value);
    for (const key of Object.keys(privateValues)) expect(details).not.toHaveProperty(key);
    expect(details).toMatchObject({
      sourceId: "src_01HSAFE",
      durationMs: 17,
      retryable: true,
      redactedSecretCount: 1,
      redactedContentCount: 4,
      redactedPrivateCount: 2,
      redactedUnknownCount: 1
    });
  });

  it("redacts realistic standalone secret and identity forms", () => {
    const input = [
      "api_key=abc123",
      "token=def456",
      "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
      "AKIA1234567890ABCDEF",
      "xoxb-1234567890-abcdefghijkl",
      "https://alice:password@example.test/path",
      "person@example.com"
    ].join(" ");
    const redacted = redactDiagnosticText(input);

    expect(redacted).toContain("api_key=[REDACTED_SECRET]");
    expect(redacted).toContain("Bearer [REDACTED_SECRET]");
    expect(redacted).toContain("https://[REDACTED_SECRET]@example.test/path");
    expect(redacted).toContain("[REDACTED_EMAIL]");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("AKIA1234567890ABCDEF");
    expect(redacted).not.toContain("xoxb-1234567890-abcdefghijkl");
  });

  it("previews support bundle categories before export", () => {
    const service = new DiagnosticsService(makeTempRoot());
    const preview = service.previewSupportBundle();

    expect(preview.localOnly).toBe(true);
    expect(preview.includedCategories.map((category) => category.id)).toContain("recent_errors");
    expect(preview.excludedCategories.map((category) => category.id)).toContain("secrets");
    expect(preview.privacyWarnings.join(" ")).toContain("not uploaded automatically");
  });

  it("exports only bounded redacted local support bundle content", () => {
    const userDataPath = makeTempRoot();
    const service = new DiagnosticsService(userDataPath, { maxStringBytes: 256 });
    const opaqueTopLevelMessage = "totally opaque private memory and credential zebra-frost-91";
    service.recordEvent({
      level: "error",
      code: "provider.failure",
      message: opaqueTopLevelMessage,
      redactedDetails: {
        apiKey: "opaque-support-secret",
        memory: "opaque support memory",
        conversation: "opaque support conversation",
        noteText: "opaque support note",
        sourceText: "opaque support source",
        arbitraryText: "opaque support unknown",
        opaqueField: "opaque support untyped field",
        sourceId: "src_01HSAFE"
      }
    });

    const persistedBeforeExport = eventFiles(userDataPath)
      .map((filePath) => fs.readFileSync(filePath, "utf8"))
      .join("");
    const preview = service.previewSupportBundle();
    const outputPath = path.join(userDataPath, "support.json");
    const result = service.exportSupportBundle(outputPath, preview);
    const exported = fs.readFileSync(outputPath, "utf8");

    expect(result.status).toBe("exported");
    expect(exported).toContain('"sourceId": "src_01HSAFE"');
    expect(exported).toContain('"redactedSecretCount": 1');
    expect(exported).toContain('"redactedContentCount": 5');
    expect(exported).toContain('"redactedUnknownCount": 1');
    expect(persistedBeforeExport).toContain('"message":"[REDACTED_CONTENT]"');
    expect(exported).toContain('"message": "[REDACTED_CONTENT]"');
    expect(persistedBeforeExport).not.toContain(opaqueTopLevelMessage);
    expect(exported).not.toContain(opaqueTopLevelMessage);
    expect(persistedBeforeExport).not.toContain("zebra-frost-91");
    expect(exported).not.toContain("zebra-frost-91");
    for (const value of [
      "opaque-support-secret",
      "opaque support memory",
      "opaque support conversation",
      "opaque support note",
      "opaque support source",
      "opaque support unknown",
      "opaque support untyped field"
    ]) {
      expect(persistedBeforeExport).not.toContain(value);
      expect(exported).not.toContain(value);
    }
    for (const key of [
      "apiKey",
      "memory",
      "conversation",
      "noteText",
      "sourceText",
      "arbitraryText",
      "opaqueField"
    ]) {
      expect(persistedBeforeExport).not.toContain(`"${key}"`);
      expect(exported).not.toContain(`"${key}"`);
    }
  });

  it("normalizes legacy top-level messages through the same fixed catalog", () => {
    const userDataPath = makeTempRoot();
    const diagnosticsPath = path.join(userDataPath, "diagnostics");
    const legacyMessage = "legacy private memory and opaque credential lunar-cedar-72";
    fs.mkdirSync(diagnosticsPath, { recursive: true });
    fs.writeFileSync(
      path.join(diagnosticsPath, "app-events.jsonl"),
      `${JSON.stringify({
        recordedAt: "2026-01-01T00:00:00.000Z",
        level: "warning",
        code: "jobs.resume_failed",
        message: legacyMessage,
        redactedDetails: { sourceId: "src_legacy", durationMs: 9 }
      })}\n`,
      "utf8"
    );
    const service = new DiagnosticsService(userDataPath, {
      now: () => new Date("2026-01-02T00:00:00.000Z")
    });

    expect(service.health().status).toBe("ok");
    const persisted = eventFiles(userDataPath).map((filePath) => fs.readFileSync(filePath, "utf8")).join("");
    const [event] = readEvents(userDataPath);

    expect(event).toMatchObject({
      code: "jobs.resume_failed",
      message: "Durable background job recovery failed.",
      redactedDetails: { sourceId: "src_legacy", durationMs: 9 }
    });
    expect(persisted).not.toContain(legacyMessage);
    expect(persisted).not.toContain("lunar-cedar-72");
  });

  it("redacts macOS, Linux, and Windows absolute home paths", () => {
    expect(redactPaths(`${os.homedir()}/Documents/Pige Vault/wiki/rag.md`)).toContain("<home>");
    expect(redactPaths("/home/alice/Documents/Pige Vault/wiki/rag.md")).toBe(
      "<home>/Documents/Pige Vault/wiki/rag.md"
    );
    expect(redactPaths("C:\\Users\\Cherry\\Documents\\Pige Vault\\wiki\\rag.md")).toBe(
      "<home>\\Documents\\Pige Vault\\wiki\\rag.md"
    );
  });

  it("retains non-error events for 14 days and error events for 30 days at exact boundaries", () => {
    const userDataPath = makeTempRoot();
    const epoch = Date.parse("2026-01-01T00:00:00.000Z");
    let nowMs = epoch;
    const service = new DiagnosticsService(userDataPath, { now: () => new Date(nowMs) });
    service.recordEvent({ level: "info", code: "info.original", message: "safe" });
    service.recordEvent({ level: "warning", code: "warning.original", message: "safe" });
    service.recordEvent({ level: "error", code: "error.original", message: "safe" });

    nowMs = epoch + 14 * DAY_MS;
    service.recordEvent({ level: "info", code: "boundary.14d", message: "safe" });
    expect(readEvents(userDataPath).map(({ code }) => code)).toEqual(
      expect.arrayContaining(["info.original", "warning.original", "error.original"])
    );

    nowMs += 1;
    service.recordEvent({ level: "info", code: "after.14d", message: "safe" });
    expect(readEvents(userDataPath).map(({ code }) => code)).not.toContain("info.original");
    expect(readEvents(userDataPath).map(({ code }) => code)).not.toContain("warning.original");
    expect(readEvents(userDataPath).map(({ code }) => code)).toContain("error.original");

    nowMs = epoch + 30 * DAY_MS;
    service.recordEvent({ level: "info", code: "boundary.30d", message: "safe" });
    expect(readEvents(userDataPath).map(({ code }) => code)).toContain("error.original");

    nowMs += 1;
    service.recordEvent({ level: "info", code: "after.30d", message: "safe" });
    expect(readEvents(userDataPath).map(({ code }) => code)).not.toContain("error.original");
  });

  it("repeatedly rotates within one total budget and preserves the newest useful evidence", () => {
    const userDataPath = makeTempRoot();
    const maxAppEventBytes = 1_600;
    const service = new DiagnosticsService(userDataPath, {
      maxAppEventBytes,
      maxSegmentBytes: 420,
      maxEventBytes: 400,
      maxStringBytes: 180
    });

    for (let index = 0; index < 80; index += 1) {
      service.recordEvent({
        level: index % 7 === 0 ? "error" : "info",
        code: `rotation.${index}`,
        message: `bounded operational evidence ${index} ${"x".repeat(60)}`
      });
      expect(eventStorageBytes(userDataPath)).toBeLessThanOrEqual(maxAppEventBytes);
    }

    const filesAfterFirstPass = eventFiles(userDataPath);
    expect(filesAfterFirstPass.length).toBeGreaterThan(1);
    expect(readEvents(userDataPath).map(({ code }) => code)).toContain("rotation.79");
    expect(readEvents(userDataPath).map(({ code }) => code)).not.toContain("rotation.0");

    for (let index = 80; index < 140; index += 1) {
      service.recordEvent({
        level: "warning",
        code: `rotation.${index}`,
        message: `newest bounded evidence ${index} ${"y".repeat(60)}`
      });
    }

    const records = readEvents(userDataPath);
    expect(eventStorageBytes(userDataPath)).toBeLessThanOrEqual(maxAppEventBytes);
    expect(records.at(-1)?.code).toBe("rotation.139");
    expect(records.every((record) => Buffer.byteLength(`${JSON.stringify(record)}\n`) <= 400)).toBe(true);
    expect(service.health().status).toBe("ok");
    expect(eventStorageBytes(userDataPath)).toBeLessThanOrEqual(maxAppEventBytes);
  });

  it("drops an oversized legacy body instead of loading or re-persisting it", () => {
    const userDataPath = makeTempRoot();
    const diagnosticsPath = path.join(userDataPath, "diagnostics");
    fs.mkdirSync(diagnosticsPath, { recursive: true });
    fs.writeFileSync(
      path.join(diagnosticsPath, "app-events.jsonl"),
      `${JSON.stringify({
        recordedAt: "2026-01-01T00:00:00.000Z",
        level: "error",
        code: "legacy.private",
        message: `LEGACY_PRIVATE_BODY ${"z".repeat(8_000)}`
      })}\n`,
      "utf8"
    );
    const service = new DiagnosticsService(userDataPath, {
      now: () => new Date("2026-01-02T00:00:00.000Z"),
      maxAppEventBytes: 1_024,
      maxSegmentBytes: 512,
      maxEventBytes: 512,
      maxStringBytes: 128
    });

    service.recordEvent({ level: "info", code: "current.safe", message: "safe" });
    const stored = eventFiles(userDataPath).map((filePath) => fs.readFileSync(filePath, "utf8")).join("");

    expect(stored).toContain("current.safe");
    expect(stored).not.toContain("LEGACY_PRIVATE_BODY");
    expect(stored).not.toContain("zzz");
    expect(eventStorageBytes(userDataPath)).toBeLessThanOrEqual(1_024);
  });
});
