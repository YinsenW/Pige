import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { MacOSVisionOcrAdapter } from "../../apps/desktop/src/main/services/macos-vision-ocr-adapter";

const helperPath = path.join(
  process.cwd(),
  "artifacts/native/macos",
  process.arch,
  "pige-vision-ocr"
);
const hasBuiltHelper = process.platform === "darwin" && fs.existsSync(helperPath);

describe.runIf(hasBuiltHelper)("macOS Vision OCR production adapter smoke", () => {
  it("locates the verified helper and recognizes generated text through the production adapter", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-ocr-adapter-smoke-"));
    try {
      const imagePath = path.join(root, "adapter-smoke.png");
      const canvas = createCanvas(1600, 500);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#111111";
      context.font = "bold 128px Helvetica";
      context.fillText("PIGE ADAPTER OCR", 80, 300);
      fs.writeFileSync(imagePath, canvas.toBuffer("image/png"));

      const adapter = new MacOSVisionOcrAdapter();
      expect(adapter.isAvailable()).toBe(true);
      const probe = await adapter.probe();
      expect(probe).toMatchObject({
        available: true,
        helperVersion: "1.0.0",
        protocolVersion: 1,
        platform: "macos"
      });

      const result = await adapter.recognize(imagePath, ["en"]);
      const normalized = result.text.replace(/\s+/gu, " ").toLocaleUpperCase();
      expect(normalized).toContain("PIGE");
      expect(normalized).toContain("OCR");
      expect(result.blocks.length).toBeGreaterThan(0);
      expect(result.image.frameCount).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
