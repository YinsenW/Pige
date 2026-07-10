import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";

const root = process.cwd();
if (process.platform !== "darwin") {
  console.log("macOS Vision OCR helper smoke skipped on this platform.");
  process.exit(0);
}

const binaryPath = path.join(root, "artifacts/native/macos", process.arch, "pige-vision-ocr");
if (!fs.existsSync(binaryPath)) {
  console.error("Missing macOS Vision OCR helper. Run npm run build:native:macos-ocr first.");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(`${binaryPath}.manifest.json`, "utf8"));
const binary = fs.readFileSync(binaryPath);
if (
  manifest.schemaVersion !== 1 ||
  manifest.helperVersion !== "1.0.0" ||
  manifest.protocolVersion !== 1 ||
  manifest.arch !== process.arch ||
  manifest.binarySize !== binary.byteLength ||
  manifest.binarySha256 !== `sha256:${createHash("sha256").update(binary).digest("hex")}`
) {
  console.error("macOS Vision OCR helper manifest or checksum is invalid.");
  process.exit(1);
}

const fixtureRoot = path.join(root, "artifacts/test-fixtures/ocr");
const imagePath = path.join(fixtureRoot, "macos-vision-smoke.png");
fs.mkdirSync(fixtureRoot, { recursive: true });
const canvas = createCanvas(1600, 500);
const context = canvas.getContext("2d");
context.fillStyle = "#ffffff";
context.fillRect(0, 0, canvas.width, canvas.height);
context.fillStyle = "#111111";
context.font = "bold 128px Helvetica";
context.fillText("PIGE OCR 2026", 120, 300);
fs.writeFileSync(imagePath, canvas.toBuffer("image/png"));

const probeRequest = {
  schemaVersion: 1,
  requestId: "ocr_macos_helper_probe",
  operation: "probe"
};
const probe = runHelper(probeRequest);
if (
  probe?.schemaVersion !== 1 ||
  probe?.requestId !== probeRequest.requestId ||
  probe?.ok !== true ||
  probe?.probe?.available !== true ||
  probe?.probe?.helperVersion !== "1.0.0" ||
  !Array.isArray(probe?.probe?.engines) ||
  !probe.probe.engines.some((engine) => engine.id === "macos_vision_document")
) {
  console.error(`Unexpected macOS Vision OCR probe response: ${JSON.stringify(probe)}`);
  process.exit(1);
}

const recognizeRequest = {
  schemaVersion: 1,
  requestId: "ocr_macos_helper_smoke",
  operation: "recognize",
  inputPath: imagePath,
  preferredLanguages: ["en"],
  limits: {
    maxFileBytes: 50 * 1024 * 1024,
    maxSourcePixels: 40_000_000,
    maxSourceDimension: 20_000,
    maxDecodedDimension: 4_096,
    maxFrames: 1,
    maxBlocks: 10_000,
    maxOutputCharacters: 1_000_000
  }
};
const response = runHelper(recognizeRequest);
const normalizedText = String(response?.result?.text ?? "").replace(/\s+/gu, " ").toLocaleUpperCase();
if (
  response?.schemaVersion !== 1 ||
  response?.requestId !== recognizeRequest.requestId ||
  response?.ok !== true ||
  !["macos_vision_document", "macos_vision_text"].includes(response?.result?.engine) ||
  !normalizedText.includes("PIGE") ||
  !normalizedText.includes("OCR") ||
  !Array.isArray(response?.result?.blocks) ||
  response.result.blocks.length === 0
) {
  console.error(`Unexpected macOS Vision OCR response: ${JSON.stringify(response)}`);
  process.exit(1);
}

const invalidImagePath = path.join(fixtureRoot, "not-an-image.png");
fs.writeFileSync(invalidImagePath, "not an image", "utf8");
const invalidResponse = runHelper({
  ...recognizeRequest,
  requestId: "ocr_macos_helper_invalid_image",
  inputPath: invalidImagePath
});
if (
  invalidResponse?.schemaVersion !== 1 ||
  invalidResponse?.requestId !== "ocr_macos_helper_invalid_image" ||
  invalidResponse?.ok !== false ||
  invalidResponse?.error?.code !== "ocr.image.unsupported_format" ||
  JSON.stringify(invalidResponse).includes(invalidImagePath)
) {
  console.error(`Unexpected invalid-image response: ${JSON.stringify(invalidResponse)}`);
  process.exit(1);
}

console.log(`macOS Vision OCR helper probe, recognition, integrity, and invalid-image smoke passed with ${response.result.engine}.`);

function runHelper(request) {
  const run = spawnSync(binaryPath, [], {
    cwd: path.parse(binaryPath).root,
    input: JSON.stringify(request),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: Object.fromEntries(Object.entries({
      HOME: process.env.HOME,
      LANG: process.env.LANG ?? "en_US.UTF-8",
      TMPDIR: process.env.TMPDIR
    }).filter((entry) => typeof entry[1] === "string"))
  });
  if (run.error || run.status !== 0) {
    console.error("macOS Vision OCR helper failed to execute.");
    process.exit(1);
  }
  try {
    return JSON.parse(run.stdout);
  } catch {
    console.error("macOS Vision OCR helper returned invalid JSON.");
    process.exit(1);
  }
}
