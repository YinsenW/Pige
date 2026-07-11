import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { auditPiRuntimeBoundary } from "./pi-runtime-boundary.mjs";

const sourceRoot = process.cwd();
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-pi-boundary-negative-"));

try {
  copyRequiredTree(sourceRoot, root);
  if (auditPiRuntimeBoundary(root).length !== 0) throw new Error("Clean Pi boundary fixture was rejected.");

  const mutations = [
    {
      name: "second production importer",
      file: "apps/desktop/src/main/services/pi-bypass.ts",
      body: 'import { Agent } from "@earendil-works/pi-agent-core";\nexport { Agent };\n'
    },
    {
      name: "compat import",
      file: "apps/desktop/src/main/services/pi-agent-runtime-adapter.ts",
      append: '\nimport "@earendil-works/pi-ai/compat";\n'
    },
    {
      name: "all-provider import",
      file: "apps/desktop/src/main/services/pi-agent-runtime-adapter.ts",
      append: '\nimport "@earendil-works/pi-ai/providers/all";\n'
    },
    {
      name: "ambient credential lookup",
      file: "apps/desktop/src/main/services/pi-agent-runtime-adapter.ts",
      append: "\nvoid process.env.OPENAI_API_KEY;\n"
    }
  ];

  for (const mutation of mutations) {
    const fixture = path.join(root, mutation.file);
    const original = fs.existsSync(fixture) ? fs.readFileSync(fixture, "utf8") : undefined;
    fs.mkdirSync(path.dirname(fixture), { recursive: true });
    fs.writeFileSync(fixture, mutation.body ?? `${original ?? ""}${mutation.append ?? ""}`, "utf8");
    if (auditPiRuntimeBoundary(root).length === 0) throw new Error(`${mutation.name} mutation was not rejected.`);
    if (original === undefined) fs.rmSync(fixture, { force: true });
    else fs.writeFileSync(fixture, original, "utf8");
  }

  console.log(`Pi runtime boundary mutations OK: ${mutations.length} secondary-import, compat, global-provider, and ambient-auth paths rejected.`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function copyRequiredTree(source, destination) {
  const relativeRoot = "apps/desktop/src/main";
  fs.cpSync(path.join(source, relativeRoot), path.join(destination, relativeRoot), { recursive: true });
  fs.mkdirSync(path.join(destination, "apps", "desktop"), { recursive: true });
  fs.copyFileSync(path.join(source, "apps", "desktop", "package.json"), path.join(destination, "apps", "desktop", "package.json"));
  fs.copyFileSync(path.join(source, "package-lock.json"), path.join(destination, "package-lock.json"));
  fs.copyFileSync(path.join(source, "NOTICE"), path.join(destination, "NOTICE"));
  fs.mkdirSync(path.join(destination, "resources", "licenses"), { recursive: true });
  fs.copyFileSync(
    path.join(source, "resources", "licenses", "pi-MIT.txt"),
    path.join(destination, "resources", "licenses", "pi-MIT.txt")
  );
}
