import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestDir = path.join(root, "tests/fixtures/manifests");
const files = fs.readdirSync(manifestDir).filter((file) => file.endsWith(".json"));

for (const file of files) {
  const manifest = JSON.parse(fs.readFileSync(path.join(manifestDir, file), "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.fixtures)) {
    console.error(`${file} must use schemaVersion 1 and fixtures array.`);
    process.exit(1);
  }
  if (file === "public-alpha-scenario.manifest.json" && manifest.fixtures.length === 0) {
    console.error(`${file} must bind at least one scripted Public Alpha scenario.`);
    process.exit(1);
  }
  for (const fixture of manifest.fixtures) {
    for (const field of ["id", "path", "kind", "license", "redactionStatus", "sizeClass", "owner", "updatePolicy"]) {
      if (typeof fixture[field] !== "string" || fixture[field].length === 0) {
        console.error(`${file} fixture is missing ${field}.`);
        process.exit(1);
      }
    }
    for (const field of ["expectedOutputRefs", "requiredPlatformCapabilities"]) {
      if (!Array.isArray(fixture[field]) || fixture[field].some((value) => typeof value !== "string" || value.length === 0)) {
        console.error(`${file} fixture must provide a valid ${field} array.`);
        process.exit(1);
      }
    }
    if (fixture.expectedOutputRefs.length === 0) {
      console.error(`${file} fixture must provide at least one expected output reference.`);
      process.exit(1);
    }
    for (const referencedPath of [fixture.path, ...fixture.expectedOutputRefs]) {
      if (!fs.existsSync(path.join(root, referencedPath))) {
        console.error(`${file} fixture references a missing path: ${referencedPath}.`);
        process.exit(1);
      }
    }
  }
}

console.log(`Fixture manifests OK: ${files.length} files.`);
