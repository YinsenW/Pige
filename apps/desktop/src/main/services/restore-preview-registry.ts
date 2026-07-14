import { createHash, randomUUID } from "node:crypto";
import { PigeDomainError } from "@pige/domain";
import { BackupIdSchema, VaultIdSchema } from "@pige/schemas";
import type { RestoreBackupIdSource, RestoreIdentityMode } from "./backup-service";

interface PendingRestorePreview {
  readonly generation: number;
}

export interface ReadyRestorePreview {
  readonly generation: number;
  readonly backupPath: string;
  readonly previewId: string;
  readonly archivePreviewToken: string;
  readonly archiveDigest: string;
  readonly backupId: string;
  readonly backupIdSource: RestoreBackupIdSource;
  readonly sourceVaultId: string;
}

export interface ApplyingRestorePreview extends ReadyRestorePreview {
  readonly leaseId: string;
  readonly mode: RestoreIdentityMode;
  readonly readyIdentity: ReadyRestorePreview;
}

type RestorePreviewState = PendingRestorePreview | ReadyRestorePreview | ApplyingRestorePreview;

export class RestorePreviewRegistry {
  readonly #states = new Map<number, RestorePreviewState>();
  #nextGeneration = 0;

  begin(senderId: number): number {
    if (isApplyingRestorePreview(this.#states.get(senderId))) {
      throw new PigeDomainError("restore.backup_invalid", "A restore apply is already in progress.");
    }
    const generation = ++this.#nextGeneration;
    this.#states.set(senderId, { generation });
    return generation;
  }

  complete(
    senderId: number,
    generation: number,
    preview: {
      readonly backupPath: string;
      readonly archivePreviewToken: string;
      readonly archiveDigest: string;
      readonly backupId: string;
      readonly backupIdSource: RestoreBackupIdSource;
      readonly sourceVaultId: string;
    }
  ): ReadyRestorePreview {
    const current = this.#states.get(senderId);
    if (!current || current.generation !== generation) {
      throw new PigeDomainError("restore.backup_invalid", "The restore preview was superseded.");
    }
    assertReadyPreviewInput(preview);
    const ready: ReadyRestorePreview = {
      generation,
      backupPath: preview.backupPath,
      previewId: createPublicPreviewId(),
      archivePreviewToken: preview.archivePreviewToken,
      archiveDigest: preview.archiveDigest,
      backupId: preview.backupId,
      backupIdSource: preview.backupIdSource,
      sourceVaultId: preview.sourceVaultId
    };
    this.#states.set(senderId, ready);
    return ready;
  }

  cancel(senderId: number, generation: number): void {
    if (this.#states.get(senderId)?.generation === generation) this.#states.delete(senderId);
  }

  claim(
    senderId: number,
    request: { readonly previewId: string; readonly mode: RestoreIdentityMode }
  ): ApplyingRestorePreview {
    const current = this.#states.get(senderId);
    if (
      !isReadyRestorePreview(current) ||
      current.previewId !== request.previewId ||
      (request.mode !== "clone_as_new" && request.mode !== "replace_existing")
    ) {
      throw new PigeDomainError("restore.backup_invalid", "Create a current restore preview before applying restore.");
    }
    const applying: ApplyingRestorePreview = {
      ...current,
      leaseId: randomUUID(),
      mode: request.mode,
      readyIdentity: current
    };
    this.#states.set(senderId, applying);
    return applying;
  }

  isCurrent(senderId: number, preview: RestorePreviewState): boolean {
    return this.#states.get(senderId) === preview;
  }

  release(senderId: number, preview: ApplyingRestorePreview): void {
    if (this.isCurrent(senderId, preview)) this.#states.set(senderId, preview.readyIdentity);
  }

  consume(senderId: number, preview: RestorePreviewState): void {
    if (this.isCurrent(senderId, preview)) this.#states.delete(senderId);
  }

  clear(senderId: number): void {
    this.#states.delete(senderId);
  }
}

function isReadyRestorePreview(value: RestorePreviewState | undefined): value is ReadyRestorePreview {
  return Boolean(value && "previewId" in value && !("leaseId" in value));
}

function isApplyingRestorePreview(value: RestorePreviewState | undefined): value is ApplyingRestorePreview {
  return Boolean(value && "leaseId" in value);
}

function createPublicPreviewId(): string {
  return `sha256:${createHash("sha256")
    .update("pige.restore.public-preview.v1\0", "utf8")
    .update(randomUUID(), "utf8")
    .digest("hex")}`;
}

function assertReadyPreviewInput(preview: {
  readonly archivePreviewToken: string;
  readonly archiveDigest: string;
  readonly backupId: string;
  readonly backupIdSource: RestoreBackupIdSource;
  readonly sourceVaultId: string;
}): void {
  const digestPattern = /^sha256:[a-f0-9]{64}$/u;
  if (
    !digestPattern.test(preview.archivePreviewToken) ||
    !digestPattern.test(preview.archiveDigest) ||
    !BackupIdSchema.safeParse(preview.backupId).success ||
    (preview.backupIdSource !== "manifest" && preview.backupIdSource !== "derived_legacy") ||
    !VaultIdSchema.safeParse(preview.sourceVaultId).success
  ) {
    throw new PigeDomainError("restore.backup_invalid", "Restore preview identity is not valid.");
  }
}
