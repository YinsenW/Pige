import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AGENT_CONVERSATION_EXPORT_MAX_UTF8_BYTES,
  AgentConversationExportArtifactSchema,
  AgentConversationExportRequestSchema,
  AgentConversationExportResultSchema,
  type AgentConversationExportArtifact,
  type AgentConversationExportEvent,
  type AgentConversationExportRequest,
  type AgentConversationExportResult,
  type ConversationEvent
} from "@pige/schemas";
import { AgentConversationHistory } from "./agent-conversation-history";
import { containsRestrictedModelContent } from "./model-egress-content";

export interface AgentConversationExportVaultBinding {
  readonly vaultId: string;
  readonly vaultPath: string;
}

export class AgentConversationExportService {
  readonly #history: AgentConversationHistory;
  readonly #now: () => Date;
  readonly #randomBytes: (size: number) => Buffer;

  constructor(
    history = new AgentConversationHistory(),
    now: () => Date = () => new Date(),
    random: (size: number) => Buffer = randomBytes
  ) {
    this.#history = history;
    this.#now = now;
    this.#randomBytes = random;
  }

  export(
    binding: AgentConversationExportVaultBinding,
    request: AgentConversationExportRequest,
    destinationPath: string
  ): AgentConversationExportResult {
    const parsed = AgentConversationExportRequestSchema.parse(request);
    const identity = exportIdentity(parsed);
    if (binding.vaultId !== parsed.activeVaultId) {
      return AgentConversationExportResultSchema.parse({ ...identity, status: "failed" });
    }
    try {
      const events = this.#history.readConversationEvents({
        vaultPath: binding.vaultPath,
        conversationId: parsed.conversationId
      });
      if (!events) return AgentConversationExportResultSchema.parse({ ...identity, status: "not_found" });
      const currentTailEventId = visibleTail(events)?.id;
      if (!currentTailEventId) return AgentConversationExportResultSchema.parse({ ...identity, status: "not_found" });
      if (currentTailEventId !== parsed.expectedTailEventId) {
        return AgentConversationExportResultSchema.parse({ ...identity, status: "stale", currentTailEventId });
      }
      const artifact = createArtifact(parsed.conversationId, currentTailEventId, events, this.#now());
      const contents = `${JSON.stringify(artifact, null, 2)}\n`;
      if (Buffer.byteLength(contents, "utf8") > AGENT_CONVERSATION_EXPORT_MAX_UTF8_BYTES ||
          containsRestrictedModelContent(contents)) {
        return AgentConversationExportResultSchema.parse({ ...identity, status: "failed" });
      }
      const reread = this.#history.readConversationEvents({
        vaultPath: binding.vaultPath,
        conversationId: parsed.conversationId
      });
      if (!reread || eventsHash(reread) !== eventsHash(events) || visibleTail(reread)?.id !== currentTailEventId) {
        const latestTail = reread ? visibleTail(reread)?.id : undefined;
        return latestTail
          ? AgentConversationExportResultSchema.parse({ ...identity, status: "stale", currentTailEventId: latestTail })
          : AgentConversationExportResultSchema.parse({ ...identity, status: "not_found" });
      }
      writePrivateExport(destinationPath, contents, this.#randomBytes);
      return AgentConversationExportResultSchema.parse({
        ...identity,
        status: "exported",
        tailEventId: currentTailEventId,
        eventCount: artifact.events.length
      });
    } catch {
      return AgentConversationExportResultSchema.parse({ ...identity, status: "failed" });
    }
  }
}

function createArtifact(
  conversationId: string,
  tailEventId: string,
  events: readonly ConversationEvent[],
  exportedAt: Date
): AgentConversationExportArtifact {
  const projected = events.flatMap((event): AgentConversationExportEvent[] => {
    if (event.type === "user_message" || event.type === "assistant_message") {
      return [{
        kind: "message",
        eventId: event.id,
        role: event.type === "user_message" ? "user" : "assistant",
        createdAt: event.createdAt,
        text: event.text ?? "",
        citations: (event.answerCitations ?? []).map((citation) => {
          const { locator: _privateLocator, ...safe } = citation;
          return "kind" in safe ? safe : { kind: "page" as const, ...safe };
        })
      }];
    }
    if ((event.type === "capture_reference" || event.type === "attachment_reference" ||
        event.type === "source_reference") && event.sourceId) {
      return [{
        kind: "source_reference",
        eventId: event.id,
        eventType: event.type,
        createdAt: event.createdAt,
        ...(event.parentEventId ? { parentEventId: event.parentEventId } : {}),
        sourceId: event.sourceId,
        ...(event.displayName ? { displayName: event.displayName } : {}),
        ...(event.sourceKind ? { sourceKind: event.sourceKind } : {})
      }];
    }
    return [];
  });
  return AgentConversationExportArtifactSchema.parse({
    schemaVersion: 1,
    kind: "pige_conversation",
    conversationId,
    tailEventId,
    exportedAt: exportedAt.toISOString(),
    events: projected
  });
}

function visibleTail(events: readonly ConversationEvent[]): ConversationEvent | undefined {
  return [...events].reverse().find(({ type }) => type === "user_message" || type === "assistant_message");
}

function eventsHash(events: readonly ConversationEvent[]): string {
  return createHash("sha256").update(JSON.stringify(events), "utf8").digest("hex");
}

function exportIdentity(request: AgentConversationExportRequest) {
  return {
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    conversationId: request.conversationId
  };
}

function writePrivateExport(destinationPath: string, contents: string, random: (size: number) => Buffer): void {
  if (!path.isAbsolute(destinationPath)) throw new Error("Conversation export destination must be absolute.");
  const parent = path.dirname(destinationPath);
  const parentStats = fs.lstatSync(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) throw new Error("Conversation export parent is unsafe.");
  const parentReal = fs.realpathSync.native(parent);
  if (parentReal !== parent) throw new Error("Conversation export parent changed.");
  if (fs.existsSync(destinationPath)) {
    const destinationStats = fs.lstatSync(destinationPath);
    if (!destinationStats.isFile() || destinationStats.isSymbolicLink()) throw new Error("Conversation export destination is unsafe.");
  }
  const temporaryPath = path.join(parent, `.${path.basename(destinationPath)}.${process.pid}.${random(8).toString("hex")}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, fs.constants.O_CREAT | fs.constants.O_EXCL |
      fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, contents, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const parentAfter = fs.lstatSync(parent);
    if (parentAfter.dev !== parentStats.dev || parentAfter.ino !== parentStats.ino ||
        fs.realpathSync.native(parent) !== parentReal) throw new Error("Conversation export parent changed.");
    if (fs.existsSync(destinationPath) && fs.lstatSync(destinationPath).isSymbolicLink()) {
      throw new Error("Conversation export destination changed.");
    }
    fs.renameSync(temporaryPath, destinationPath);
    fs.chmodSync(destinationPath, 0o600);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
  }
}
