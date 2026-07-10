import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["vitest", "run", "tests/unit/parser-manifest-alignment.test.ts", "tests/unit/macos-vision-ocr-manifest.test.ts"], {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "Parser manifest alignment verification failed.\n");
  process.exit(result.status ?? 1);
}

console.log("Parser manifest alignment OK: indexes, engine versions, executable limits, paths, and placeholder reclamation match the current implementation.");
