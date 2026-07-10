import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "node_modules", "artifacts", "dist", "build", "out", "coverage"].includes(entry.name)) continue;
      files.push(...walk(full));
    } else if (entry.isFile() && textExtensions.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

const offenders = [];

for (const file of walk(root)) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line)) {
      offenders.push(`${path.relative(root, file)}:${index + 1}`);
    }
  });
}

if (offenders.length > 0) {
  console.error("Trailing whitespace found:");
  for (const offender of offenders) console.error(`- ${offender}`);
  process.exit(1);
}

console.log("Trailing whitespace OK.");
