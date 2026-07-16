import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  locateVerifiedMacOSSpeechHelper,
  MacOSSpeechAdapter,
  SpeechProtocolFramer
} from "../../apps/desktop/src/main/services/macos-speech-adapter";

describe("macOS Speech adapter", () => {
  it("uses installed Speech assets and exports only transcript and normalized metering", () => {
    const source = fs.readFileSync(path.resolve("apps/desktop/native/macos-speech/PigeSpeech.swift"), "utf8");
    expect(source).toContain("AssetInventory.status(forModules:");
    expect(source).not.toContain("downloadAndInstall");
    expect(source).toContain("result.resultsFinalizationTime");
    expect(source).toContain("CMTimeRangeGetIntersection");
    expect(source).toContain("AVCaptureDevice.requestAccess(for: .audio)");
    expect(source).toContain("maxTranscriptUTF16Units");
    expect(source).toContain('cjkJoined == "你好世界"');
    expect(source).not.toContain('left + " " + right');
    expect(source).toContain("let rms = sqrt");
    expect(source).toContain('kind: "meter"');
    expect(source).not.toContain("FileHandle.standardError.write");
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
