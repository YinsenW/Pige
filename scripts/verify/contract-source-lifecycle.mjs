import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const requireAll = (relativePath, values) => {
  const text = read(relativePath);
  for (const value of values) if (!text.includes(value)) failures.push(`${relativePath} is missing ${value}`);
};
const requireOrder = (relativePath, values) => {
  const text = read(relativePath);
  let cursor = -1;
  for (const value of values) {
    const next = text.indexOf(value, cursor + 1);
    if (next < 0) {
      failures.push(`${relativePath} is missing ordered parser-snapshot marker ${value}`);
      return;
    }
    cursor = next;
  }
};

requireAll("packages/schemas/src/index.ts", [
  "export const VaultBindingsFileSchema", "defaults: z.array(DefaultManagedCopyRootSelectionSchema)",
  "Each external managed-copy root ID must be unique", "Each vault may select only one default external managed-copy root",
  "The in-vault managed-copy root must use a vault_relative path", "An external managed-copy root must use a root_relative path",
  "Referenced-original storage must not contain a managedCopy locator", "export const BackupManifestSchema"
]);
requireAll("apps/desktop/src/main/services/capture-service.ts", [
  "const storageStrategy = vault.defaultSourceStorageStrategy", "storageStrategy,",
  "storageStrategy === \"copy_to_source_library\"", "checksumFileWithSize(filePath)"
]);
for (const service of [
  "apps/desktop/src/main/services/pdf-parser-service.ts",
  "apps/desktop/src/main/services/office-parser-service.ts"
]) {
  requireAll(service, [
    "createVerifiedSourceFileSnapshotAsync",
    "const sourceSnapshot = await createVerifiedSourceFileSnapshotAsync",
    "sourceSnapshot.absolutePath",
    "finally {",
    "await sourceSnapshot.dispose()"
  ]);
  requireOrder(service, [
    "if (existing) return existing;",
    "const sourceSnapshot = await createVerifiedSourceFileSnapshotAsync",
    "this.#extractor.extract(sourceSnapshot.absolutePath",
    "finally {",
    "await sourceSnapshot.dispose()"
  ]);
  for (const forbidden of [
    "this.#extractor.extract(sourceFile.absolutePath",
    "this.#extractor.extract(readableSource.absolutePath",
    "verifyReadableSourceFile(vaultPath, parsedSource)"
  ]) {
    if (read(service).includes(forbidden)) failures.push(`${service} passes a live verified source path to the parser: ${forbidden}`);
  }
}
requireAll("apps/desktop/src/main/services/ocr-service.ts", [
  "createVerifiedSourceFileSnapshotAsync", "createVerifiedFileSnapshot", "snapshot.dispose()"
]);
requireAll("apps/desktop/src/main/services/agent-ingest-service.ts", ["EvidenceAssemblyService"]);
requireAll("apps/desktop/src/main/services/evidence-assembly-service.ts", [
  "verifyReadableSourceFileAsync", "referenced_original_preview", "managed_source_preview"
]);
requireAll("apps/desktop/src/main/services/source-file-access.ts", [
  "parsed.storageStrategy === \"copy_to_source_library\" && parsed.managedCopy?.path",
  "parsed.storageStrategy === \"reference_original\"", "createVerifiedSourceFileSnapshotAsync",
  "createVerifiedFileSnapshot"
]);
requireAll("apps/desktop/src/main/services/verified-file-snapshot.ts", [
  "fs.constants.O_NOFOLLOW", "expectedChecksum", "fs.promises.chmod(snapshotPath, 0o400)",
  "dispose: async () =>"
]);
requireAll("docs/SOURCE_STORAGE_STRATEGY.md", [
  "`managedCopyRoot`", "`artifactRoot`", "`sourceAssetRoot` is a compatibility/UI name",
  "`VaultBindingsFileSchema`", "No selection means no usable external default", "explicitly incomplete backup"
]);
requireAll("docs/DATA_ARCHITECTURE.md", ["Existing source records keep their prior `rootId`", "`replace_existing`", "`clone_as_new`"]);
requireAll("tests/unit/capture-service.test.ts", ["honors reference-original storage for new file captures without creating a managed copy"]);
requireAll("tests/unit/referenced-source-pipeline.test.ts", [
  "runs a referenced PDF through parser artifacts and Agent ingest without a managed copy",
  "runs a referenced DOCX through the Office parser and Agent ingest without a managed copy",
  "runs a referenced image through OCR artifacts and Agent ingest without a managed copy",
  "keeps Agent ingest waiting when a referenced text original is disconnected"
]);
requireAll("tests/unit/durable-contract-schemas.test.ts", [
  "keeps external managed-copy roots in a stable machine-local registry",
  "must not contain a managedCopy locator"
]);
requireAll("tests/unit/verified-file-snapshot.test.ts", [
  "copies bytes into a private checksum-bound snapshot and applies POSIX read-only mode",
  "rejects bytes that do not match the recorded checksum"
]);
for (const [relativePath, forbidden] of [
  ["docs/SOURCE_STORAGE_STRATEGY.md", "files are copied into `raw/files"],
  ["docs/PARSER_INGEST_SPEC.md", "Markdown/TXT file capture writes managed copies"],
  ["docs/API_AND_IPC_DESIGN.md", "files as managed copies under `raw/files"]
]) {
  if (read(relativePath).includes(forbidden)) failures.push(`${relativePath} still states a copy-only active contract: ${forbidden}`);
}

if (read("apps/desktop/src/main/services/source-file-access.ts").includes("if (parsed.managedCopy?.path)")) {
  failures.push("Source file access still selects managedCopy independently of storageStrategy.");
}

const integration = spawnSync("npx", ["vitest", "run",
  "tests/unit/capture-service.test.ts",
  "tests/unit/referenced-source-pipeline.test.ts",
  "tests/unit/durable-contract-schemas.test.ts",
  "tests/unit/verified-file-snapshot.test.ts",
  "tests/unit/backup-service.test.ts"
], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024
});
if (integration.status !== 0) failures.push(`referenced-source integration tests failed: ${(integration.stderr || integration.stdout).trim()}`);

if (failures.length) {
  console.error("Source-lifecycle contract errors:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("CON-003 OK: source strategy, verified locators, root selection, backup/restore, and migration semantics are executable.");
