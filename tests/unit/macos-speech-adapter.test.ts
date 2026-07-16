import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  locateVerifiedMacOSSpeechHelper,
  MacOSSpeechAdapter,
  SpeechProtocolFramer
} from "../../apps/desktop/src/main/services/macos-speech-adapter";

describe("macOS Speech adapter", () => {
  it("installs Speech assets only through the explicit helper command and exports no audio", () => {
    const source = fs.readFileSync(path.resolve("apps/desktop/native/macos-speech/PigeSpeech.swift"), "utf8");
    expect(source).toContain("AssetInventory.status(forModules:");
    expect(source).toContain('arguments[0] == "--install"');
    expect(source).toContain("AssetInventory.assetInstallationRequest(supporting:");
    expect(source).toContain("installation.downloadAndInstall()");
    expect(source).not.toContain("installation.progress.cancel()");
    expect(source).toContain('kind: "asset_install_progress"');
    expect(source).toContain('kind: "asset_installed"');
    expect(source).toContain("result.resultsFinalizationTime");
    expect(source).toContain("CMTimeRangeGetIntersection");
    expect(source).toContain("AVCaptureDevice.requestAccess(for: .audio)");
    expect(source).toContain("maxTranscriptUTF16Units");
    expect(source).toContain('cjkJoined == "你好世界"');
    expect(source).not.toContain('left + " " + right');
    expect(source).toContain("let rms = sqrt");
    expect(source).toContain('kind: "meter"');
    expect(source).not.toContain("FileHandle.standardError.write");
    const probeBody = source.slice(source.indexOf("private static func probe"), source.indexOf("private static func installLanguageAsset"));
    const sessionBody = source.slice(source.indexOf("private static func runSession"), source.indexOf("private static func writeProbe"));
    expect(probeBody).not.toContain("downloadAndInstall");
    expect(sessionBody).not.toContain("downloadAndInstall");
  });

  it.runIf(process.platform === "darwin")("validates native install identity and waits for terminal helper exit", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pige-speech-install-"));
    const helper = path.join(directory, "helper");
    fs.writeFileSync(helper, `#!/bin/sh
printf '{"protocolVersion":1,"kind":"asset_install_progress","installationId":"%s","completedFraction":0.25}\\n' "$2"
printf '{"protocolVersion":1,"kind":"asset_installed","installationId":"%s"}\\n' "$2"
`, { mode: 0o755 });
    const adapter = new MacOSSpeechAdapter(() => ({ binaryPath: helper, binarySha256: `sha256:${"0".repeat(64)}` }));
    const progress: number[] = [];
    try {
      await expect(adapter.installLanguageAsset({
        installationId: `speechinstall_${"a".repeat(16)}`,
        languageTag: "en-US",
        onProgress: (value) => progress.push(value)
      })).resolves.toBeUndefined();
      expect(progress).toEqual([0.25]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "darwin")("abandons and awaits the exact helper without claiming system cancellation", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pige-speech-cancel-"));
    const helper = path.join(directory, "helper");
    fs.writeFileSync(helper, "#!/bin/sh\nsleep 30\n", { mode: 0o755 });
    const adapter = new MacOSSpeechAdapter(() => ({ binaryPath: helper, binarySha256: `sha256:${"0".repeat(64)}` }));
    const installationId = `speechinstall_${"b".repeat(16)}`;
    const installing = adapter.installLanguageAsset({
      installationId,
      languageTag: "en-US",
      onProgress: () => undefined
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await expect(Promise.all([
        adapter.abandonLanguageAssetInstall(installationId),
        adapter.abandonLanguageAssetInstall(installationId)
      ])).resolves.toEqual([undefined, undefined]);
      await expect(installing).rejects.toMatchObject({ code: "speech.asset_install_failed" });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("decodes split multibyte protocol lines without replacement characters", () => {
    const line = JSON.stringify({
      protocolVersion: 1,
      kind: "transcript",
      sessionId: "speech_1234567890abcdef",
      transcript: "你好🙂世界"
    });
    const bytes = Buffer.from(`${line}\n`, "utf8");
    const emojiOffset = bytes.indexOf(Buffer.from("🙂", "utf8"));
    const framer = new SpeechProtocolFramer();
    expect(framer.push(bytes.subarray(0, emojiOffset + 2))).toEqual([]);
    expect(framer.push(bytes.subarray(emojiOffset + 2))).toEqual([line]);
    expect(() => framer.end()).not.toThrow();
  });

  it("fails closed on oversized or incomplete protocol lines", () => {
    const oversized = new SpeechProtocolFramer();
    expect(() => oversized.push(Buffer.alloc(128 * 1024 + 1, 0x61))).toThrow("speech_protocol_line_too_large");

    const incomplete = new SpeechProtocolFramer();
    incomplete.push(Buffer.from("{\"kind\":\"transcript\"}", "utf8"));
    expect(() => incomplete.end()).toThrow("speech_protocol_incomplete_line");
  });

  it.runIf(process.platform === "darwin")("locates and probes only the integrity-bound helper", async () => {
    const helper = locateVerifiedMacOSSpeechHelper();
    expect(helper).toMatchObject({ binarySha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u) });
    const probe = await new MacOSSpeechAdapter().probe("en-US");
    expect(probe.status).toMatch(/^(?:supported|unsupported)$/u);
    expect(probe.permission).toMatch(/^(?:not-determined|granted|denied|restricted)$/u);
    if (probe.status === "unsupported") {
      expect(probe.reason).toMatch(/^(?:language_unavailable|assets_unavailable|service_unavailable)$/u);
    }
  });

  it.runIf(process.platform === "darwin")("fails closed when helper integrity is unavailable", async () => {
    await expect(new MacOSSpeechAdapter(() => undefined).probe("en-US")).rejects.toMatchObject({
      code: "speech.helper_unavailable"
    });
  });
});
