import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  ConversationEventSchema,
  CurrentVaultManifestSchema,
  SourceRecordSchema,
  type VaultManifestV1,
  type VaultMigrationAffectedDomain
} from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import { currentVaultDurableDomainVersions } from "./vault-layout";

const MAX_MIGRATION_FILES = 100_000;
const MAX_MIGRATION_FILE_BYTES = 16 * 1024 * 1024;
const PRIVATE_FILE_MODE = 0o600;

export interface VaultMigrationStagedFile {
  readonly relativePath: string;
  readonly beforeHash: `sha256:${string}`;
  readonly afterHash: `sha256:${string}`;
  readonly afterBytes: Buffer;
}

export interface VaultMigrationStage {
  readonly files: readonly VaultMigrationStagedFile[];
  readonly manifest: VaultMigrationStagedFile;
  readonly counts: Readonly<Record<VaultMigrationAffectedDomain, number>>;
}

export function inspectVaultMigrationCounts(vaultPath: string): Readonly<Record<VaultMigrationAffectedDomain, number>> {
  return {
    vault_manifest: 1,
    source_records: safeFiles(vaultPath, ".pige/source-records", (name) => name.endsWith(".json")).length,
    markdown_pages: migrationMarkdownFiles(vaultPath).length,
    ocr_artifacts: safeFiles(vaultPath, "artifacts/metadata", (name) => name.endsWith(".json")).length,
    conversation_events: safeFiles(vaultPath, ".pige/conversations", (name) => name.endsWith(".jsonl")).length,
    memory: safeFiles(vaultPath, ".pige/memory", (name) => name === "registry.json" || name.endsWith(".md")).length,
    rebuildable_chunks: safeFiles(vaultPath, ".pige/db", () => true).length
  };
}

export function stageVaultMigration(
  vaultPath: string,
  manifest: VaultManifestV1,
  updatedAt: string
): VaultMigrationStage {
  const files: VaultMigrationStagedFile[] = [];
  for (const file of safeFiles(vaultPath, ".pige/source-records", (name) => name.endsWith(".json"))) {
    files.push(stageJson(file, (value) => SourceRecordSchema.parse(value)));
  }
  for (const file of migrationMarkdownFiles(vaultPath)) {
    files.push(stageBytes(file, migrateMarkdownPage(file.bytes.toString("utf8"))));
  }
  for (const file of safeFiles(vaultPath, "artifacts/metadata", (name) => name.endsWith(".json"))) {
    files.push(stageJson(file, migrateOcrArtifact));
  }
  for (const file of safeFiles(vaultPath, ".pige/conversations", (name) => name.endsWith(".jsonl"))) {
    files.push(stageBytes(file, migrateConversationJsonl(file.bytes.toString("utf8"))));
  }
  for (const file of safeFiles(vaultPath, ".pige/memory", (name) => name === "registry.json")) {
    files.push(stageJson(file, migrateMemoryRegistry));
  }
  for (const file of safeFiles(vaultPath, ".pige/memory/atoms", (name) => name.endsWith(".md"))) {
    files.push(stageBytes(file, migrateMemoryAtom(file.bytes.toString("utf8"))));
  }

  const manifestFile = readSafeFile(vaultPath, ".pige/manifest.json");
  const nextManifest = CurrentVaultManifestSchema.parse({
    ...manifest,
    vault_schema_version: 2,
    durable_domain_versions: currentVaultDurableDomainVersions(),
    updated_at: updatedAt
  });
  const stagedManifest = stageBytes(manifestFile, `${JSON.stringify(nextManifest, null, 2)}\n`);
  return {
    files: files.filter((file) => file.beforeHash !== file.afterHash),
    manifest: stagedManifest,
    counts: inspectVaultMigrationCounts(vaultPath)
  };
}

function migrationMarkdownFiles(vaultPath: string): SafeFile[] {
  const nested = safeFiles(vaultPath, "wiki", (name) => name.endsWith(".md"));
  const roots = ["PIGE.md", "index.md", "log.md"]
    .filter((relativePath) => fs.existsSync(resolveMigrationPath(vaultPath, relativePath)))
    .map((relativePath) => readSafeFile(vaultPath, relativePath));
  return [...roots, ...nested].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function validateVaultMigrationStage(stage: VaultMigrationStage): void {
  if (stage.files.length > MAX_MIGRATION_FILES) throw migrationInvalid("Migration file count exceeds the bounded limit.");
  for (const file of [...stage.files, stage.manifest]) {
    if (file.afterBytes.byteLength > MAX_MIGRATION_FILE_BYTES) throw migrationInvalid("A migrated file exceeds its bounded limit.");
    if (hash(file.afterBytes) !== file.afterHash) throw migrationInvalid("Staged migration bytes changed before validation.");
  }
  CurrentVaultManifestSchema.parse(JSON.parse(stage.manifest.afterBytes.toString("utf8")));
}

export function commitVaultMigrationDurableDomains(
  vaultPath: string,
  stage: VaultMigrationStage,
  assertWriterLease: () => void
): void {
  validateVaultMigrationStage(stage);
  for (const file of stage.files) commitFile(vaultPath, file, assertWriterLease);
}

export function commitVaultMigrationManifest(
  vaultPath: string,
  stage: VaultMigrationStage,
  assertWriterLease: () => void
): void {
  validateVaultMigrationStage(stage);
  commitFile(vaultPath, stage.manifest, assertWriterLease);
}

export function ensureVaultMigrationPrivateDirectory(vaultPathInput: string, relativePath: string): string {
  const vaultPath = path.resolve(vaultPathInput);
  const target = resolveMigrationPath(vaultPath, relativePath);
  const vaultStat = fs.lstatSync(vaultPath);
  if (!vaultStat.isDirectory() || vaultStat.isSymbolicLink()) {
    throw migrationInvalid("The active vault is not a safe directory.");
  }
  let current = vaultPath;
  for (const component of path.relative(vaultPath, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw migrationInvalid("A migration write parent is not a safe directory.");
      }
    } catch (caught) {
      if (!isErrno(caught, "ENOENT")) throw caught;
      fs.mkdirSync(current, { mode: 0o700 });
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw migrationInvalid("A migration write parent is not a safe directory.");
      }
    }
  }
  const canonicalVault = fs.realpathSync.native(vaultPath);
  const canonicalTarget = fs.realpathSync.native(target);
  if (!canonicalTarget.startsWith(`${canonicalVault}${path.sep}`)) {
    throw migrationInvalid("A migration write parent escaped the active vault.");
  }
  return target;
}

function commitFile(vaultPath: string, file: VaultMigrationStagedFile, assertWriterLease: () => void): void {
  assertWriterLease();
  const absolutePath = resolveMigrationPath(vaultPath, file.relativePath);
  const current = readExistingRegularFile(absolutePath);
  const currentHash = hash(current);
  if (currentHash === file.afterHash) return;
  if (currentHash !== file.beforeHash) throw migrationStale();
  const parent = path.dirname(absolutePath);
  const temporaryPath = path.join(parent, `.${path.basename(absolutePath)}.migration-${file.afterHash.slice(-16)}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, PRIVATE_FILE_MODE);
    fs.writeFileSync(descriptor, file.afterBytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    assertWriterLease();
    if (hash(readExistingRegularFile(absolutePath)) !== file.beforeHash) throw migrationStale();
    fs.renameSync(temporaryPath, absolutePath);
    flushDirectoryWhereSupported(parent);
    if (hash(readExistingRegularFile(absolutePath)) !== file.afterHash) throw migrationInvalid("Committed migration bytes failed verification.");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best-effort exact staging cleanup */ }
  }
}

interface SafeFile {
  readonly relativePath: string;
  readonly bytes: Buffer;
}

function safeFiles(vaultPathInput: string, rootRelative: string, accept: (name: string) => boolean): SafeFile[] {
  const vaultPath = fs.realpathSync.native(path.resolve(vaultPathInput));
  const root = resolveMigrationPath(vaultPath, rootRelative);
  if (!fs.existsSync(root)) return [];
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw migrationInvalid("A migration root is not a safe directory.");
  const output: SafeFile[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) throw migrationInvalid("Migration does not follow symbolic links.");
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && accept(entry.name)) {
        if (stat.nlink !== 1 || stat.size > MAX_MIGRATION_FILE_BYTES) throw migrationInvalid("A migration input file is unsafe.");
        const canonical = fs.realpathSync.native(absolutePath);
        if (canonical !== absolutePath || !canonical.startsWith(`${vaultPath}${path.sep}`)) throw migrationInvalid("A migration input escaped the vault.");
        output.push({ relativePath: path.relative(vaultPath, absolutePath).split(path.sep).join("/"), bytes: fs.readFileSync(absolutePath) });
        if (output.length > MAX_MIGRATION_FILES) throw migrationInvalid("Migration file count exceeds the bounded limit.");
      } else if (!entry.isFile()) {
        throw migrationInvalid("Migration accepts regular files and directories only.");
      }
    }
  };
  visit(root);
  return output.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function readSafeFile(vaultPath: string, relativePath: string): SafeFile {
  return { relativePath, bytes: readExistingRegularFile(resolveMigrationPath(vaultPath, relativePath)) };
}

function readExistingRegularFile(filePath: string): Buffer {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_MIGRATION_FILE_BYTES) {
    throw migrationInvalid("A migration file is unsafe.");
  }
  return fs.readFileSync(filePath);
}

function resolveMigrationPath(vaultPathInput: string, relativePath: string): string {
  const vaultPath = path.resolve(vaultPathInput);
  const absolutePath = path.resolve(vaultPath, ...relativePath.split("/"));
  if (absolutePath === vaultPath || !absolutePath.startsWith(`${vaultPath}${path.sep}`)) throw migrationInvalid("Migration path escaped the vault.");
  return absolutePath;
}

function isErrno(caught: unknown, code: string): boolean {
  return caught instanceof Error && "code" in caught && caught.code === code;
}

function stageJson(file: SafeFile, transform: (value: unknown) => unknown): VaultMigrationStagedFile {
  let parsed: unknown;
  try { parsed = JSON.parse(file.bytes.toString("utf8")); } catch { throw migrationInvalid("Migration JSON is malformed."); }
  return stageBytes(file, `${JSON.stringify(transform(parsed), null, 2)}\n`);
}

function stageBytes(file: SafeFile, after: string | Buffer): VaultMigrationStagedFile {
  const afterBytes = Buffer.isBuffer(after) ? after : Buffer.from(after, "utf8");
  return { relativePath: file.relativePath, beforeHash: hash(file.bytes), afterHash: hash(afterBytes), afterBytes };
}

function migrateOcrArtifact(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw migrationInvalid("OCR metadata is malformed.");
  const record = value as Record<string, unknown>;
  if (!String(record.kind ?? "").includes("ocr")) return record;
  return {
    ...record,
    language: {
      domain: "ocr_artifact",
      language: "unknown",
      basis: "legacy_missing"
    }
  };
}

function migrateConversationJsonl(input: string): string {
  if (input === "") return input;
  return `${input.trimEnd().split("\n").map((line) => {
    if (!line.trim()) throw migrationInvalid("Conversation JSONL contains an empty record.");
    try { return JSON.stringify(ConversationEventSchema.parse(JSON.parse(line))); }
    catch { throw migrationInvalid("Conversation event is malformed."); }
  }).join("\n")}\n`;
}

function migrateMemoryRegistry(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw migrationInvalid("Memory registry is malformed.");
  const registry = value as Record<string, unknown>;
  const addLanguage = (entry: unknown): unknown => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw migrationInvalid("Memory registry entry is malformed.");
    return { ...(entry as Record<string, unknown>), language: { domain: "memory", language: "unknown", basis: "legacy_missing" } };
  };
  if (!Array.isArray(registry.events) || !Array.isArray(registry.records)) throw migrationInvalid("Memory registry is malformed.");
  return { ...registry, events: registry.events.map(addLanguage), records: registry.records.map(addLanguage) };
}

function migrateMemoryAtom(input: string): string {
  if (!input.startsWith("---\n")) throw migrationInvalid("Memory atom frontmatter is malformed.");
  const end = input.indexOf("\n---\n", 4);
  if (end < 0) throw migrationInvalid("Memory atom frontmatter is malformed.");
  let value: unknown;
  try { value = JSON.parse(input.slice(4, end)); } catch { throw migrationInvalid("Memory atom frontmatter is malformed."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw migrationInvalid("Memory atom frontmatter is malformed.");
  const next = { ...(value as Record<string, unknown>), language: { domain: "memory", language: "unknown", basis: "legacy_missing" } };
  return `---\n${JSON.stringify(next)}\n---\n${input.slice(end + 5)}`;
}

function migrateMarkdownPage(input: string): string {
  if (!input.startsWith("---\n")) return input;
  const end = input.indexOf("\n---\n", 4);
  if (end < 0) throw migrationInvalid("Markdown frontmatter is malformed.");
  const raw = input.slice(4, end);
  if (/^language_basis:/mu.test(raw)) return input;
  const languageMatch = /^language:\s*["']?([^"'\n]+)["']?\s*$/mu.exec(raw);
  const language = canonicalLanguage(languageMatch?.[1]?.trim()) ?? "unknown";
  const languageLine = languageMatch ? "" : "\nlanguage: \"unknown\"";
  const basis = language === "unknown" ? "legacy_missing" : "page_inherited";
  return `${input.slice(0, end)}${languageLine}\nlanguage_basis: \"${basis}\"${input.slice(end)}`;
}

function canonicalLanguage(value: string | undefined): string | undefined {
  if (!value || value === "unknown") return undefined;
  try { return Intl.getCanonicalLocales(value)[0] === value ? value : undefined; } catch { return undefined; }
}

function hash(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function migrationInvalid(message: string): PigeDomainError {
  return new PigeDomainError("vault.migration_invalid", message);
}

function migrationStale(): PigeDomainError {
  return new PigeDomainError("vault.migration_stale", "A durable vault file changed during migration.");
}
