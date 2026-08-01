import { PigeDomainError } from "@pige/domain";
import { parsePigeFrontmatter } from "@pige/markdown";
import { openPromise, type Entry } from "yauzl";
import {
  BackupDomainSchemaVersionsSchema,
  type BackupDomainSchemaVersions,
  type BackupManifest,
  type VaultManifest
} from "@pige/schemas";

type BackupDomainName = keyof BackupDomainSchemaVersions;

const DOMAIN_NAMES = [
  "markdownPages",
  "sourceRecords",
  "conversationEvents",
  "jobs",
  "proposals",
  "operations",
  "memory",
  "skills",
  "datasets"
] as const satisfies readonly BackupDomainName[];

const SUPPORTED_DOMAIN_VERSIONS = BackupDomainSchemaVersionsSchema.parse(Object.fromEntries(
  DOMAIN_NAMES.map((domain) => [domain, { min: 1, max: 1 }])
));

export type RestoreSchemaFileBodies = ReadonlyMap<string, string>;

const MAX_LEGACY_SCHEMA_FILE_BYTES = 16 * 1024 * 1024;
const MAX_LEGACY_SCHEMA_TOTAL_BYTES = 256 * 1024 * 1024;

export async function assertRestoreArchiveSchemaCompatibility(
  backupPath: string,
  manifest: BackupManifest,
  archivedVaultManifest: VaultManifest
): Promise<void> {
  const inspectionPaths = restoreSchemaInspectionPaths(manifest);
  const bodies = inspectionPaths.length === 0
    ? new Map<string, string>()
    : await readLegacyRestoreSchemaBodies(backupPath, inspectionPaths);
  assertRestoreSchemaCompatibility(manifest, archivedVaultManifest, bodies);
}

/**
 * Returns the durable files that a legacy format-v1 manifest must inspect instead
 * of inventing schema version 1. Current manifests carry exact ranges and do not
 * need to buffer durable bodies during preview.
 */
export function restoreSchemaInspectionPaths(manifest: BackupManifest): readonly string[] {
  if (manifest.domainSchemaVersions?.datasets) return [];
  const needsAllDomains = manifest.domainSchemaVersions === undefined;
  return manifest.files
    .filter(({ path }) => {
      const domain = backupDomainForPath(path);
      return domain !== undefined && (needsAllDomains || domain === "datasets");
    })
    .map(({ path }) => path)
    .sort((left, right) => left.localeCompare(right, "en-US"));
}

export function assertRestoreSchemaCompatibility(
  manifest: BackupManifest,
  archivedVaultManifest: VaultManifest,
  inspectedBodies: RestoreSchemaFileBodies
): BackupDomainSchemaVersions {
  if (archivedVaultManifest.vault_schema_version !== 1 && archivedVaultManifest.vault_schema_version !== 2) {
    throw schemaUnsupported();
  }

  const derived = deriveMissingDomainVersions(manifest, inspectedBodies);
  const declared = manifest.domainSchemaVersions;
  const actual = BackupDomainSchemaVersionsSchema.parse(Object.fromEntries(DOMAIN_NAMES.map((domain) => [
    domain,
    declared?.[domain] ?? derived[domain] ?? { min: 1, max: 1 }
  ])));

  for (const domain of DOMAIN_NAMES) {
    const supported = SUPPORTED_DOMAIN_VERSIONS[domain]!;
    const present = actual[domain]!;
    if (present.min < supported.min || present.max > supported.max) throw schemaUnsupported();
  }
  return actual;
}

function deriveMissingDomainVersions(
  manifest: BackupManifest,
  bodies: RestoreSchemaFileBodies
): Partial<BackupDomainSchemaVersions> {
  const missing = new Set<BackupDomainName>();
  if (!manifest.domainSchemaVersions) {
    for (const domain of DOMAIN_NAMES) missing.add(domain);
  } else if (!manifest.domainSchemaVersions.datasets) {
    missing.add("datasets");
  }
  if (missing.size === 0) return {};

  const versions = new Map<BackupDomainName, number[]>();
  for (const domain of missing) versions.set(domain, []);
  for (const file of manifest.files) {
    const domain = backupDomainForPath(file.path);
    if (!domain || !missing.has(domain)) continue;
    const body = bodies.get(file.path);
    if (body === undefined) throw restoreInvalid("A legacy durable schema record could not be inspected.");
    versions.get(domain)!.push(...readSchemaVersions(file.path, domain, body));
  }

  return Object.fromEntries([...missing].map((domain) => {
    const present = versions.get(domain)!;
    const normalized = present.length === 0 ? [1] : present.sort((left, right) => left - right);
    return [domain, { min: normalized[0]!, max: normalized[normalized.length - 1]! }];
  }));
}

function backupDomainForPath(relativePath: string): BackupDomainName | undefined {
  if ((relativePath.startsWith("wiki/") || relativePath.startsWith("sources/")) && relativePath.endsWith(".md")) {
    return "markdownPages";
  }
  if (relativePath.startsWith(".pige/source-records/") && relativePath.endsWith(".json")) return "sourceRecords";
  if (relativePath.startsWith(".pige/conversations/") && relativePath.endsWith(".jsonl")) return "conversationEvents";
  if (relativePath.startsWith(".pige/jobs/") && relativePath.endsWith(".json")) return "jobs";
  if (relativePath.startsWith(".pige/proposals/") && relativePath.endsWith(".json")) return "proposals";
  if (relativePath.startsWith(".pige/operations/") && relativePath.endsWith(".json")) return "operations";
  if (relativePath.startsWith(".pige/memory/") && /\.(?:json|md)$/u.test(relativePath)) return "memory";
  if (relativePath.startsWith(".pige/skills/") && /\.(?:json|md)$/u.test(relativePath)) return "skills";
  if (relativePath.startsWith("datasets/") && relativePath.endsWith(".json")) return "datasets";
  return undefined;
}

function readSchemaVersions(relativePath: string, domain: BackupDomainName, body: string): readonly number[] {
  try {
    if (domain === "markdownPages" || relativePath.endsWith(".md")) {
      return [parseVersion(parsePigeFrontmatter(body)?.frontmatter.schema_version ?? 1)];
    }
    if (domain === "conversationEvents") {
      const lines = body.split(/\r?\n/gu).filter((line) => line.trim() !== "");
      return lines.length === 0 ? [1] : lines.map((line) => readJsonVersion(JSON.parse(line) as unknown));
    }
    return [readJsonVersion(JSON.parse(body) as unknown)];
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw restoreInvalid("A legacy durable schema record is malformed.");
  }
}

function readJsonVersion(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw restoreInvalid("A legacy durable schema record is malformed.");
  }
  return parseVersion((value as Record<string, unknown>).schemaVersion ?? 1);
}

function parseVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw restoreInvalid("A legacy durable schema version is invalid.");
  }
  return value;
}

function schemaUnsupported(): PigeDomainError {
  return new PigeDomainError(
    "restore.schema_unsupported",
    "This backup contains a newer durable schema that this version of Pige cannot restore."
  );
}

function restoreInvalid(message: string): PigeDomainError {
  return new PigeDomainError("restore.backup_invalid", message);
}

async function readLegacyRestoreSchemaBodies(
  backupPath: string,
  relativePaths: readonly string[]
): Promise<ReadonlyMap<string, string>> {
  const prefix = "vault/";
  const pending = new Set(relativePaths.map((relativePath) => `${prefix}${relativePath}`));
  const bodies = new Map<string, string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  const zipFile = await openPromise(backupPath, {
    lazyEntries: false,
    validateEntrySizes: true,
    strictFileNames: true
  });
  try {
    for await (const entry of zipFile.eachEntry()) {
      if (!pending.has(entry.fileName)) continue;
      if (entry.uncompressedSize > MAX_LEGACY_SCHEMA_FILE_BYTES) {
        throw restoreInvalid("A legacy durable schema record exceeds the bounded compatibility scan.");
      }
      totalBytes += entry.uncompressedSize;
      if (totalBytes > MAX_LEGACY_SCHEMA_TOTAL_BYTES) {
        throw restoreInvalid("Legacy durable schema records exceed the bounded compatibility scan.");
      }
      try {
        bodies.set(entry.fileName.slice(prefix.length), decoder.decode(await readEntry(zipFile, entry)));
      } catch {
        throw restoreInvalid("A legacy durable schema record is not valid UTF-8.");
      }
      pending.delete(entry.fileName);
    }
  } finally {
    zipFile.close();
  }
  if (pending.size > 0) throw restoreInvalid("A legacy durable schema record is missing.");
  return bodies;
}

async function readEntry(
  zipFile: { openReadStreamPromise: (entry: Entry) => Promise<NodeJS.ReadableStream> },
  entry: Entry
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await zipFile.openReadStreamPromise(entry)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
