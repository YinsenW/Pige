import fs from "node:fs";
import path from "node:path";
import type {
  CaptureFilesSubmitResult,
  JobsListRequest,
  JobsListResult,
  SubmitFilesCaptureRequest,
  VaultSummary
} from "@pige/contracts";
import type { JobRecord } from "@pige/schemas";
import type { AgentTurnFilePreservationBinding } from "./capture-service";
import { AgentTurnConversationStore } from "./agent-turn-conversation-store";
import {
  ingressSnapshotService,
  type IngressSnapshotDescriptor,
  type IngressSnapshotService
} from "./ingress-snapshot-service";

interface IngressRecoveryVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

interface IngressRecoveryJobPort {
  list(request: JobsListRequest): JobsListResult;
  readAgentTurnJob(jobId: string): JobRecord | undefined;
  attachAgentTurnSources(jobId: string, sourceIds: readonly string[], attachmentSetHash: string): JobRecord;
}

interface IngressRecoveryCapturePort {
  preserveFilesForAgentTurn(
    request: SubmitFilesCaptureRequest,
    binding: AgentTurnFilePreservationBinding
  ): Promise<CaptureFilesSubmitResult>;
}

export interface AgentFileIngressRecoveryResult {
  readonly recovered: number;
  readonly retained: number;
  readonly failed: number;
}

export class AgentFileIngressRecoveryService {
  readonly #vaults: IngressRecoveryVaultPort;
  readonly #jobs: IngressRecoveryJobPort;
  readonly #capture: IngressRecoveryCapturePort;
  readonly #conversations: AgentTurnConversationStore;
  readonly #snapshots: IngressSnapshotService;

  constructor(
    vaults: IngressRecoveryVaultPort,
    jobs: IngressRecoveryJobPort,
    capture: IngressRecoveryCapturePort,
    conversations: AgentTurnConversationStore,
    snapshots: IngressSnapshotService = ingressSnapshotService
  ) {
    this.#vaults = vaults;
    this.#jobs = jobs;
    this.#capture = capture;
    this.#conversations = conversations;
    this.#snapshots = snapshots;
  }

  async recover(): Promise<AgentFileIngressRecoveryResult> {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vault || !vaultPath) return { recovered: 0, retained: 0, failed: 0 };
    let recovered = 0;
    let retained = 0;
    let failed = 0;
    const candidates = this.#jobs.list({
      classes: ["agent_turn"],
      states: ["waiting_dependency"],
      limit: 100
    }).jobs.filter((job) => job.stage === "capturing_source");
    for (const candidate of candidates) {
      try {
        const job = this.#jobs.readAgentTurnJob(candidate.id);
        if (!job || job.activeVaultId !== vault.vaultId) {
          failed += 1;
          continue;
        }
        const sourceRefs = (job.inputRefs ?? []).filter((ref) => ref.role === "agent_turn_source");
        const attachmentSetHash = job.inputRefs?.find((ref) => ref.role === "agent_turn_attachment_set")?.checksum;
        const conversationRef = job.inputRefs?.find((ref) => ref.role === "agent_turn_user_event");
        if (
          sourceRefs.length === 0 ||
          !attachmentSetHash ||
          !conversationRef?.id ||
          !conversationRef.locator ||
          !conversationRef.checksum
        ) {
          failed += 1;
          continue;
        }
        const descriptors = await this.#snapshots.listForParent(vaultPath, job.id);
        const descriptorsBySource = new Map<string, IngressSnapshotDescriptor>();
        for (const descriptor of descriptors) {
          if (descriptorsBySource.has(descriptor.sourceId)) throw new Error("Duplicate ingress snapshot source identity.");
          descriptorsBySource.set(descriptor.sourceId, descriptor);
        }
        const canRecover = sourceRefs.every((ref) => Boolean(
          ref.id && (descriptorsBySource.has(ref.id) || sourceRecordExists(vaultPath, ref.id))
        ));
        if (!canRecover || descriptors.length === 0) {
          retained += 1;
          continue;
        }
        const turn = this.#conversations.readUserTurn(
          vaultPath,
          conversationRef.locator,
          conversationRef.id,
          conversationRef.checksum
        );
        if (turn.metadata?.inputKind !== "file_drop" && turn.metadata?.inputKind !== "file_picker") {
          throw new Error("Ingress recovery parent is not a file turn.");
        }
        for (const [ordinal, ref] of sourceRefs.entries()) {
          if (!ref.id || sourceRecordExists(vaultPath, ref.id)) continue;
          const descriptor = descriptorsBySource.get(ref.id);
          if (!descriptor || ref.checksum !== descriptor.checksum) throw new Error("Ingress snapshot checksum drifted.");
          const result = await this.#capture.preserveFilesForAgentTurn({
            filePaths: [descriptor.sourceProvenance.originalPath],
            inputKind: turn.metadata.inputKind,
            userIntent: "unknown",
            locale: turn.metadata.locale
          }, {
            jobId: job.id,
            sourceId: ref.id,
            inputChecksum: descriptor.checksum,
            ordinal,
            snapshotOrdinal: descriptor.ordinal,
            attachmentSetHash
          });
          if (result.status === "rejected" || result.sourceIds.length !== 1 || result.sourceIds[0] !== ref.id) {
            throw new Error("Ingress snapshot publication did not adopt its exact source identity.");
          }
        }
        const sourceIds = sourceRefs.map((ref) => ref.id).filter((id): id is string => Boolean(id));
        if (sourceIds.length !== sourceRefs.length) throw new Error("Ingress source identity is missing.");
        this.#jobs.attachAgentTurnSources(job.id, sourceIds, attachmentSetHash);
        recovered += 1;
      } catch {
        failed += 1;
      }
    }
    return { recovered, retained, failed };
  }
}

function sourceRecordExists(vaultPath: string, sourceId: string): boolean {
  const match = /^src_(\d{4})(\d{2})\d{2}_[a-z0-9]{8,}$/u.exec(sourceId);
  if (!match) return false;
  return fs.existsSync(path.join(vaultPath, ".pige", "source-records", match[1]!, match[2]!, `${sourceId}.json`));
}
