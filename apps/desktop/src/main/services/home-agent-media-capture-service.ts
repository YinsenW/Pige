import { PigeDomainError } from "@pige/domain";
import type { AgentSubmitTurnResult, JobRecord } from "@pige/schemas";
import { readCurrentSourceRecordSnapshot } from "./source-file-access";
import { SourcePageService } from "./source-page-service";
import type {
  HomeAgentJobPort,
  HomeAgentVaultPort,
  PreparedSourceAgentTurn
} from "./home-agent-service";

const WAITING_MESSAGE = "Local media is preserved and waiting for a future transcription capability. It was not sent to a model.";
const MEDIA_TRANSCRIPTION_ERROR = {
  code: "capture.media_transcription_unavailable",
  domain: "capture",
  messageKey: "errors.capture.media_transcription_unavailable",
  retryable: false,
  severity: "info",
  userAction: "none"
} as const;

/**
 * Settles source-bearing Home turns that contain local audio/video without ever
 * constructing an Agent runtime request. A durable queued stage prevents crash
 * recovery from accidentally treating the media turn as a model-ready turn.
 */
export class HomeAgentMediaCaptureService {
  readonly #vaults: HomeAgentVaultPort;
  readonly #jobs: HomeAgentJobPort;
  readonly #sourcePages: SourcePageService;

  constructor(vaults: HomeAgentVaultPort, jobs: HomeAgentJobPort, sourcePages = new SourcePageService()) {
    this.#vaults = vaults;
    this.#jobs = jobs;
    this.#sourcePages = sourcePages;
  }

  defer(prepared: PreparedSourceAgentTurn): AgentSubmitTurnResult {
    const active = this.#requireActiveVault(prepared.activeVaultId);
    const job = this.#requirePreparedJob(prepared);
    const staged = this.#jobs.patchAgentTurnJob(job, {
      stage: "waiting_for_tool",
      message: WAITING_MESSAGE,
      privacy: noEgressPrivacy()
    });
    this.#settle(active.path, active.vaultId, staged, prepared.sourceIds);
    return {
      requestId: prepared.request.clientTurnId ?? prepared.jobId,
      jobId: prepared.jobId,
      conversationEventId: prepared.preservedTurn.event.id,
      conversationId: prepared.preservedTurn.event.conversationId,
      tailEventId: prepared.preservedTurn.event.id,
      state: "waiting",
      modelUsage: "none",
      sourceIds: prepared.sourceIds,
      error: MEDIA_TRANSCRIPTION_ERROR
    };
  }

  recoverPending(): { readonly recovered: number; readonly failed: number } {
    const active = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!active || !vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const job of this.#jobs.listQueuedTextAgentTurns(100)) {
      if (job.stage !== "waiting_for_tool") continue;
      try {
        this.#settle(vaultPath, active.vaultId, job, sourceIdsForJob(job));
        recovered += 1;
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  #requireActiveVault(expectedVaultId: string): { readonly vaultId: string; readonly path: string } {
    const active = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!active || !vaultPath || active.vaultId !== expectedVaultId) {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The prepared local-media vault changed.");
    }
    return { vaultId: active.vaultId, path: vaultPath };
  }

  #requirePreparedJob(prepared: PreparedSourceAgentTurn): JobRecord {
    const job = this.#jobs.readAgentTurnJob(prepared.jobId);
    if (
      !job ||
      job.state !== "queued" ||
      job.activeVaultId !== prepared.activeVaultId ||
      job.conversationEventId !== prepared.preservedTurn.event.id ||
      !sameStrings(sourceIdsForJob(job), prepared.sourceIds) ||
      (prepared.attachmentSetHash !== undefined &&
        job.inputRefs?.find((reference) => reference.role === "agent_turn_attachment_set")?.checksum !==
          prepared.attachmentSetHash)
    ) {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The prepared local-media turn changed before waiting.");
    }
    return job;
  }

  #settle(vaultPath: string, vaultId: string, expected: JobRecord, sourceIds: readonly string[]): void {
    if (expected.activeVaultId !== vaultId || sourceIds.length === 0 || !sameStrings(sourceIdsForJob(expected), sourceIds)) {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The local-media source binding is invalid.");
    }
    const sources = sourceIds.map((sourceId) => readCurrentSourceRecordSnapshot(vaultPath, sourceId));
    if (
      sources.some((source) => !source || source.record.metadata.agentTurnJobId !== expected.id) ||
      !sources.some((source) => source?.record.kind === "audio_file" || source?.record.kind === "video_file")
    ) {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The preserved local-media source changed before waiting.");
    }
    for (const source of sources) {
      const record = source!.record;
      this.#sourcePages.createForSource(
        vaultPath,
        record,
        sourceRecordRelativePath(record.id),
        expected.id,
        record
      );
    }
    const current = this.#jobs.readAgentTurnJob(expected.id);
    if (!current || current.updatedAt !== expected.updatedAt || current.state !== "queued" || current.stage !== "waiting_for_tool") {
      throw new PigeDomainError("job.revision_conflict", "The local-media Job changed before its waiting state was recorded.");
    }
    this.#jobs.settleAgentTurnJob(current, {
      kind: "waiting",
      reason: "dependency",
      dependency: {
        dependencyKind: "runtime_capability",
        dependencyId: "media_transcription",
        requiredAction: "unavailable",
        messageKey: MEDIA_TRANSCRIPTION_ERROR.messageKey
      },
      error: MEDIA_TRANSCRIPTION_ERROR,
      requiresUserAction: false,
      message: WAITING_MESSAGE,
      facts: { stage: "waiting_for_tool", privacy: noEgressPrivacy() }
    });
  }
}

function sourceIdsForJob(job: JobRecord): readonly string[] {
  const sourceIds = (job.inputRefs ?? [])
    .filter((reference) => reference.kind === "source" && reference.role === "agent_turn_source" && reference.id)
    .map((reference) => reference.id!);
  return sourceIds.length > 0 ? sourceIds : (job.sourceId ? [job.sourceId] : []);
}

function sourceRecordRelativePath(sourceId: string): string {
  const date = /^src_(\d{8})_/u.exec(sourceId)?.[1];
  if (!date) throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The local-media source id is invalid.");
  return `.pige/source-records/${date.slice(0, 4)}/${date.slice(4, 6)}/${sourceId}.json`;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function noEgressPrivacy() {
  return { usedCloudModel: false, usedNetwork: false, usedShell: false, accessedExternalFiles: false } as const;
}
