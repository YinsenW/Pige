import fs from "node:fs";
import path from "node:path";
import type { VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { ConversationEventSchema, type JobRecord, type SourceRecord } from "@pige/schemas";

const MAX_CONVERSATION_FILE_BYTES = 16 * 1024 * 1024;

export interface AgentIngestPublicationAuthorityInput {
  readonly vaultPath: string;
  readonly activeVaultPath: string | undefined;
  readonly activeVault: VaultSummary | undefined;
  readonly expectedJob: JobRecord;
  readonly currentJob: JobRecord | undefined;
  readonly sourceRecord: SourceRecord;
}

export function assertAgentIngestPublicationAuthorityCurrent(
  input: AgentIngestPublicationAuthorityInput
): void {
  const expected = input.expectedJob;
  const current = input.currentJob;
  if (
    !input.activeVault ||
    input.activeVaultPath !== input.vaultPath ||
    !expected.activeVaultId ||
    input.activeVault.vaultId !== expected.activeVaultId ||
    !current ||
    current.state !== "running" ||
    !sameImmutableJobAuthority(current, expected) ||
    !expected.captureId ||
    !expected.conversationEventId ||
    input.sourceRecord.id !== expected.sourceId ||
    input.sourceRecord.metadata.captureId !== expected.captureId ||
    !hasExactCaptureReference(input.vaultPath, expected)
  ) {
    throw new PigeDomainError(
      "agent_runtime.turn_binding_invalid",
      "The active Vault, Agent Job, source, or capture turn changed before publication."
    );
  }
}

function sameImmutableJobAuthority(current: JobRecord, expected: JobRecord): boolean {
  return current.id === expected.id &&
    current.class === expected.class &&
    current.parentJobId === expected.parentJobId &&
    current.activeVaultId === expected.activeVaultId &&
    current.sourceId === expected.sourceId &&
    current.captureId === expected.captureId &&
    current.conversationEventId === expected.conversationEventId &&
    current.createdAt === expected.createdAt;
}

function hasExactCaptureReference(vaultPath: string, job: JobRecord): boolean {
  const match = /^(?:evt|event)_(\d{8})_[a-z0-9]{8,}$/u.exec(job.conversationEventId ?? "");
  if (!match?.[1] || !job.sourceId || !job.captureId) return false;
  const dateKey = match[1];
  const conversationRoot = path.join(
    vaultPath,
    ".pige",
    "conversations",
    dateKey.slice(0, 4),
    dateKey.slice(4, 6)
  );
  let candidates: string[];
  try {
    assertSafeParents(path.resolve(vaultPath), conversationRoot);
    const entries = fs.readdirSync(conversationRoot, { withFileTypes: true });
    if (entries.length > 1_000) return false;
    candidates = entries
      .filter((entry) => entry.isFile() && new RegExp(`^conv_${dateKey}(?:_[a-z0-9]{4,})?\\.jsonl$`, "u").test(entry.name))
      .map((entry) => path.join(conversationRoot, entry.name));
  } catch {
    return false;
  }
  const matchingEvents = candidates.flatMap((conversationPath) => {
    const content = readBoundedRegularFile(vaultPath, conversationPath);
    if (content === undefined) return [];
    return content.split(/\r?\n/u).flatMap((line) => {
      if (!line.trim()) return [];
      try {
        const parsed = ConversationEventSchema.safeParse(JSON.parse(line));
        return parsed.success && parsed.data.id === job.conversationEventId ? [parsed.data] : [];
      } catch {
        return [];
      }
    });
  });
  const event = matchingEvents.length === 1 ? matchingEvents[0] : undefined;
  return event?.type === "capture_reference" &&
    event.sourceId === job.sourceId &&
    event.captureId === job.captureId;
}

function readBoundedRegularFile(vaultPath: string, filePath: string): string | undefined {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(`${resolvedVault}${path.sep}`)) return undefined;
  try {
    assertSafeParents(resolvedVault, path.dirname(resolvedFile));
    const before = fs.lstatSync(resolvedFile);
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1 || before.size > MAX_CONVERSATION_FILE_BYTES) {
      return undefined;
    }
    const descriptor = fs.openSync(resolvedFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const opened = fs.fstatSync(descriptor);
      if (!sameFile(before, opened)) return undefined;
      const content = fs.readFileSync(descriptor, "utf8");
      const after = fs.lstatSync(resolvedFile);
      return sameFile(opened, after) && !after.isSymbolicLink() ? content : undefined;
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return undefined;
  }
}

function assertSafeParents(vaultPath: string, parentPath: string): void {
  const relative = path.relative(vaultPath, parentPath);
  let cursor = vaultPath;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("unsafe conversation parent");
  }
}

function sameFile(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}
