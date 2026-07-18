import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function materializeNotarizationKey(encoded, outputPath) {
  if (typeof encoded !== "string" || encoded.length === 0 || encoded.length > 64 * 1024) {
    throw new Error("Apple notarization API key is absent or unbounded.");
  }
  const decoded = Buffer.from(encoded, "base64");
  const text = decoded.toString("utf8");
  if (
    decoded.length < 64 || decoded.length > 16 * 1024 ||
    !text.startsWith("-----BEGIN PRIVATE KEY-----\n") || !text.trimEnd().endsWith("-----END PRIVATE KEY-----")
  ) throw new Error("Apple notarization API key is malformed.");
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  fs.writeFileSync(resolved, text.endsWith("\n") ? text : `${text}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return resolved;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputOption = process.argv.slice(2).find((argument) => argument.startsWith("--output="));
  if (!outputOption) throw new Error("Notarization key output path is required.");
  materializeNotarizationKey(process.env.PIGE_APPLE_API_KEY_BASE64, outputOption.slice("--output=".length));
}
