import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function walk(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["dist", "build", "out", "node_modules"].includes(entry.name)) continue;
      files.push(...walk(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const failures = [];
const importPattern = /import\s+(?:type\s+)?(?:[^"']+\s+from\s+)?["']([^"']+)["']/g;
const dynamicImportPattern = /import\(["']([^"']+)["']\)/g;

function importsFor(file) {
  const text = fs.readFileSync(file, "utf8");
  return [...text.matchAll(importPattern), ...text.matchAll(dynamicImportPattern)].map((match) => match[1]);
}

for (const file of walk(path.join(root, "packages"))) {
  const relative = path.relative(root, file);
  for (const specifier of importsFor(file)) {
    if (specifier.startsWith("../../apps") || specifier.startsWith("@pige/desktop")) {
      failures.push(`${relative} imports app code through ${specifier}`);
    }
  }
}

const rendererRoot = path.join(root, "apps/desktop/src/renderer");
for (const file of walk(rendererRoot)) {
  const relative = path.relative(root, file);
  for (const specifier of importsFor(file)) {
    if (
      specifier.startsWith("node:") ||
      specifier.includes("/main/") ||
      specifier.includes("/adapters/") ||
      specifier.includes("better-sqlite3") ||
      specifier.includes("electron")
    ) {
      failures.push(`${relative} violates renderer boundary with ${specifier}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Import boundary violations:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Import boundaries OK.");
