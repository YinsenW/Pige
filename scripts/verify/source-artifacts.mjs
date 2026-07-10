import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const generatedSourcePatterns = [/\.d\.ts$/, /\.d\.ts\.map$/, /\.js$/, /\.js\.map$/];
const failures = [];

function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["dist", "build", "out", "node_modules"].includes(entry.name)) continue;
      walk(full);
    } else if (entry.isFile() && generatedSourcePatterns.some((pattern) => pattern.test(entry.name))) {
      failures.push(path.relative(root, full));
    }
  }
}

walk(path.join(root, "packages"));

if (failures.length > 0) {
  console.error("Generated artifacts found in package source folders:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Package source folders contain no generated JS/declaration artifacts.");
