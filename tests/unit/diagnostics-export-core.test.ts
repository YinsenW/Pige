import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSafeDiagnosticExportText,
  commitPreparedDiagnosticsExportFile,
  DiagnosticsExportBlockedError,
  prepareDiagnosticsExportFile,
  reconcileDiagnosticsExportFile,
  releasePreparedDiagnosticsExportFile,
  writeDiagnosticsExportFile
} from "../../apps/desktop/src/main/services/diagnostics-export-core";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-diagnostics-export-"));
  roots.push(root);
  return root;
}

function safeBundle(event?: Record<string, unknown>): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    exportedAt: "2026-07-15T00:00:00.000Z",
    localOnly: true,
    preview: {
      previewId: "support_20260715000000",
      generatedAt: "2026-07-15T00:00:00.000Z",
      includedCategories: [
        { id: "app_runtime", label: "App version, platform, and architecture", included: true, reason: "Needed to diagnose platform-specific failures." },
        { id: "diagnostics_health", label: "Diagnostics health summary", included: true, reason: "Redacted operational status only." },
        { id: "recent_errors", label: "Recent redacted diagnostic events", included: true, reason: "Bounded and redacted event summaries." }
      ],
      excludedCategories: [
        { id: "secrets", label: "API keys, tokens, cookies, and credentials", included: false, reason: "Secrets are never exported by default." },
        { id: "content", label: "Full notes, source files, conversations, memory, prompts, and model responses", included: false, reason: "Support bundles must not duplicate private knowledge content by default." },
        { id: "binaries", label: "Local models, parser binaries, packages, and source artifacts", included: false, reason: "Large binaries and artifacts are excluded." }
      ],
      privacyWarnings: [
        "The bundle is created locally and is not uploaded automatically.",
        "Paths, emails, and common secret patterns are redacted by default.",
        "Review the preview before exporting."
      ]
    },
    app: { platform: "synthetic", arch: "arm64", node: "22.1.0", electron: "unknown" },
    diagnosticsHealth: {
      status: "ok",
      checkedAt: "2026-07-15T00:00:00.000Z",
      localOnly: true,
      recentErrorCount: 0,
      checks: [{ id: "diagnostics_store", status: "ok", message: "Local diagnostics store is writable." }]
    },
    recentEvents: event ? [event] : []
  }, null, 2)}\n`;
}

describe("diagnostics export core", () => {
  it("atomically writes a bounded safe bundle with private file permissions", () => {
    const root = makeRoot();
    const outputPath = path.join(root, "support.json");
    const content = safeBundle({
      recordedAt: "2026-07-15T00:00:00.000Z",
      level: "info",
      code: "diagnostics.safe",
      message: "[REDACTED_CONTENT]"
    });

    expect(writeDiagnosticsExportFile(outputPath, content)).toBe(Buffer.byteLength(content));
    expect(fs.readFileSync(outputPath, "utf8")).toBe(content);
    expect(fs.statSync(outputPath).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(root)).toEqual(["support.json"]);
    expect(reconcileDiagnosticsExportFile(outputPath, content)).toEqual({
      bytesWritten: Buffer.byteLength(content)
    });
  });

  it.each([
    ["raw secret", safeBundle({ recordedAt: "2026-07-15T00:00:00.000Z", level: "error", code: "diagnostics.safe", message: "[REDACTED_CONTENT]", apiKey: "opaque-value-123456" })],
    ["absolute path", safeBundle({ recordedAt: "2026-07-15T00:00:00.000Z", level: "error", code: "diagnostics.safe", message: "[REDACTED_CONTENT]", detail: "/private/tmp/private-note.md" })],
    ["opaque nested body", safeBundle({ recordedAt: "2026-07-15T00:00:00.000Z", level: "error", code: "diagnostics.safe", message: "[REDACTED_CONTENT]", payload: "private note body" })],
    ["invalid envelope", `${JSON.stringify({ schemaVersion: 2, localOnly: true })}\n`],
    ["control byte", safeBundle({ detail: "unsafe value" }).replace("unsafe value", "unsafe\u0000value")]
  ])("fails closed for %s", (_label, content) => {
    expect(() => assertSafeDiagnosticExportText(content)).toThrow(DiagnosticsExportBlockedError);
  });

  it("does not reconcile a symbolic link or a non-regular destination", () => {
    const root = makeRoot();
    const target = path.join(root, "target.json");
    const destination = path.join(root, "support.json");
    const content = safeBundle();
    fs.writeFileSync(target, content, "utf8");
    fs.symlinkSync(target, destination);

    expect(reconcileDiagnosticsExportFile(destination, content)).toBeUndefined();
    expect(reconcileDiagnosticsExportFile(root, content)).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")("does not adopt a world-readable export", () => {
    const root = makeRoot();
    const outputPath = path.join(root, "support.json");
    const content = safeBundle();
    fs.writeFileSync(outputPath, content, { encoding: "utf8", mode: 0o644 });
    fs.chmodSync(outputPath, 0o644);

    expect(reconcileDiagnosticsExportFile(outputPath, content)).toBeUndefined();
  });

  it("rejects a symbolic-link destination without changing its target", () => {
    const root = makeRoot();
    const target = path.join(root, "target.json");
    const destination = path.join(root, "support.json");
    fs.writeFileSync(target, "original", "utf8");
    fs.symlinkSync(target, destination);

    expect(() => writeDiagnosticsExportFile(destination, safeBundle())).toThrow(DiagnosticsExportBlockedError);
    expect(fs.readFileSync(target, "utf8")).toBe("original");
  });

  it("fails closed when the temporary pathname is replaced before commit", () => {
    const root = makeRoot();
    const outputPath = path.join(root, "support.json");
    const content = safeBundle();
    const realpathSync = fs.realpathSync.bind(fs);
    let calls = 0;
    vi.spyOn(fs, "realpathSync").mockImplementation((candidate, options) => {
      const resolved = realpathSync(candidate, options as never);
      calls += 1;
      if (calls === 2) {
        const temporary = fs.readdirSync(root).find((entry) => entry.endsWith(".tmp"));
        expect(temporary).toBeDefined();
        const temporaryPath = path.join(root, String(temporary));
        fs.rmSync(temporaryPath);
        fs.writeFileSync(temporaryPath, safeBundle({
          recordedAt: "2026-07-15T00:00:00.000Z",
          level: "warning",
          code: "diagnostics.other",
          message: "[REDACTED_CONTENT]"
        }), { encoding: "utf8", mode: 0o600 });
      }
      return resolved;
    });

    expect(() => writeDiagnosticsExportFile(outputPath, content)).toThrow(DiagnosticsExportBlockedError);
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it("removes only its exact temporary file when writing fails", () => {
    const root = makeRoot();
    const writeSync = fs.writeSync.bind(fs);
    vi.spyOn(fs, "writeSync").mockImplementationOnce(() => {
      throw new Error("synthetic write failure");
    }).mockImplementation(writeSync);

    expect(() => writeDiagnosticsExportFile(path.join(root, "support.json"), safeBundle())).toThrow();
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("fails closed when an existing destination is replaced before commit", () => {
    const root = makeRoot();
    const outputPath = path.join(root, "support.json");
    fs.writeFileSync(outputPath, "original", "utf8");
    const realpathSync = fs.realpathSync.bind(fs);
    let calls = 0;
    vi.spyOn(fs, "realpathSync").mockImplementation((candidate, options) => {
      const resolved = realpathSync(candidate, options as never);
      calls += 1;
      if (calls === 2) {
        fs.rmSync(outputPath);
        fs.writeFileSync(outputPath, "successor", "utf8");
      }
      return resolved;
    });

    expect(() => writeDiagnosticsExportFile(outputPath, safeBundle())).toThrow(DiagnosticsExportBlockedError);
    expect(fs.readFileSync(outputPath, "utf8")).toBe("successor");
  });

  it("closes the held destination descriptor when temporary preparation fails", () => {
    const root = makeRoot();
    const outputPath = path.join(root, "support.json");
    fs.writeFileSync(outputPath, "original", "utf8");
    const openSync = fs.openSync.bind(fs);
    let destinationDescriptor: number | undefined;
    vi.spyOn(fs, "openSync").mockImplementation((candidate, flags, mode) => {
      if (path.basename(String(candidate)) === "support.json") {
        destinationDescriptor = openSync(candidate, flags, mode);
        return destinationDescriptor;
      }
      if (String(candidate).includes(".pige-support-")) {
        throw new Error("synthetic temporary open failure");
      }
      return openSync(candidate, flags, mode);
    });

    expect(() => prepareDiagnosticsExportFile(outputPath, undefined, "darwin"))
      .toThrow("synthetic temporary open failure");
    expect(destinationDescriptor).toBeTypeOf("number");
    expect(() => fs.fstatSync(Number(destinationDescriptor))).toThrow(
      expect.objectContaining({ code: "EBADF" })
    );
    expect(fs.readdirSync(root)).toEqual(["support.json"]);
  });

  it("closes the held destination descriptor when a prepared export is released", () => {
    const root = makeRoot();
    const outputPath = path.join(root, "support.json");
    fs.writeFileSync(outputPath, "original", "utf8");
    const prepared = prepareDiagnosticsExportFile(outputPath, undefined, "darwin");
    const descriptor = prepared.destinationBinding.kind === "held_descriptor"
      ? prepared.destinationBinding.descriptor
      : undefined;
    expect(descriptor).toBeTypeOf("number");

    releasePreparedDiagnosticsExportFile(prepared);

    expect(() => fs.fstatSync(Number(descriptor))).toThrow(expect.objectContaining({ code: "EBADF" }));
    expect(fs.readdirSync(root)).toEqual(["support.json"]);
  });

  it("closes the held destination descriptor when commit fails", () => {
    const root = makeRoot();
    const outputPath = path.join(root, "support.json");
    fs.writeFileSync(outputPath, "original", "utf8");
    const prepared = prepareDiagnosticsExportFile(outputPath, undefined, "darwin");
    const descriptor = prepared.destinationBinding.kind === "held_descriptor"
      ? prepared.destinationBinding.descriptor
      : undefined;
    expect(descriptor).toBeTypeOf("number");
    fs.rmSync(outputPath);
    fs.writeFileSync(outputPath, "successor", "utf8");

    try {
      expect(() => commitPreparedDiagnosticsExportFile(prepared, safeBundle())).toThrow(
        DiagnosticsExportBlockedError
      );
    } finally {
      releasePreparedDiagnosticsExportFile(prepared);
    }

    expect(() => fs.fstatSync(Number(descriptor))).toThrow(expect.objectContaining({ code: "EBADF" }));
  });

  it("uses a bounded digest binding for Windows replacement without holding a descriptor", () => {
    const root = makeRoot();
    const outputPath = path.join(root, "support.json");
    fs.writeFileSync(outputPath, "original", "utf8");
    const prepared = prepareDiagnosticsExportFile(
      outputPath,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "win32"
    );

    expect(prepared.destinationBinding).toMatchObject({
      kind: "content_digest",
      size: Buffer.byteLength("original")
    });
    try {
      expect(commitPreparedDiagnosticsExportFile(prepared, safeBundle()))
        .toBe(Buffer.byteLength(safeBundle()));
    } finally {
      releasePreparedDiagnosticsExportFile(prepared);
    }
    expect(fs.readFileSync(outputPath, "utf8")).toBe(safeBundle());
  });

  it("rejects changed bytes through the Windows digest binding and closes every descriptor", () => {
    const root = makeRoot();
    const outputPath = path.join(root, "support.json");
    fs.writeFileSync(outputPath, "original", "utf8");
    const prepared = prepareDiagnosticsExportFile(
      outputPath,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "win32"
    );
    fs.rmSync(outputPath);
    fs.writeFileSync(outputPath, "successor", "utf8");

    try {
      expect(() => commitPreparedDiagnosticsExportFile(prepared, safeBundle()))
        .toThrow(DiagnosticsExportBlockedError);
    } finally {
      releasePreparedDiagnosticsExportFile(prepared);
    }

    expect(fs.readFileSync(outputPath, "utf8")).toBe("successor");
    expect(fs.readdirSync(root)).toEqual(["support.json"]);
  });

  it("accepts an exact-content Windows successor as the unchanged destination", () => {
    const root = makeRoot();
    const outputPath = path.join(root, "support.json");
    fs.writeFileSync(outputPath, "original", "utf8");
    const prepared = prepareDiagnosticsExportFile(
      outputPath,
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "win32"
    );
    fs.rmSync(outputPath);
    fs.writeFileSync(outputPath, "original", "utf8");

    try {
      expect(commitPreparedDiagnosticsExportFile(prepared, safeBundle()))
        .toBe(Buffer.byteLength(safeBundle()));
    } finally {
      releasePreparedDiagnosticsExportFile(prepared);
    }

    expect(fs.readFileSync(outputPath, "utf8")).toBe(safeBundle());
    expect(fs.readdirSync(root)).toEqual(["support.json"]);
  });

  it("rejects oversized existing destinations through the Windows digest binding", () => {
    const root = makeRoot();
    const outputPath = path.join(root, "support.json");
    fs.writeFileSync(outputPath, Buffer.alloc(2 * 1024 * 1024 + 1));

    expect(() => prepareDiagnosticsExportFile(
      outputPath,
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "win32"
    )).toThrow(DiagnosticsExportBlockedError);
    expect(fs.readdirSync(root)).toEqual(["support.json"]);
  });
});
