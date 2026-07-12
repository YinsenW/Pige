import { createHash, randomUUID } from "node:crypto";
import { PigeDomainError } from "@pige/domain";

interface PendingRestorePreview {
  readonly generation: number;
}

export interface ReadyRestorePreview {
  readonly generation: number;
  readonly backupPath: string;
  readonly publicPreviewToken: string;
  readonly archivePreviewToken: string;
}

export interface ApplyingRestorePreview extends ReadyRestorePreview {
  readonly leaseId: string;
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
    preview: { readonly backupPath: string; readonly archivePreviewToken: string }
  ): ReadyRestorePreview {
    const current = this.#states.get(senderId);
    if (!current || current.generation !== generation) {
      throw new PigeDomainError("restore.backup_invalid", "The restore preview was superseded.");
    }
    const ready: ReadyRestorePreview = {
      generation,
      backupPath: preview.backupPath,
      publicPreviewToken: createPublicPreviewToken(),
      archivePreviewToken: preview.archivePreviewToken
    };
    this.#states.set(senderId, ready);
    return ready;
  }

  cancel(senderId: number, generation: number): void {
    if (this.#states.get(senderId)?.generation === generation) this.#states.delete(senderId);
  }

  claim(
    senderId: number,
    request: { readonly backupPath: string; readonly previewToken: string }
  ): ApplyingRestorePreview {
    const current = this.#states.get(senderId);
    if (
      !isReadyRestorePreview(current) ||
      current.backupPath !== request.backupPath ||
      current.publicPreviewToken !== request.previewToken
    ) {
      throw new PigeDomainError("restore.backup_invalid", "Create a current restore preview before applying restore.");
    }
    const applying: ApplyingRestorePreview = {
      ...current,
      leaseId: randomUUID(),
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
  return Boolean(value && "publicPreviewToken" in value && !("leaseId" in value));
}

function isApplyingRestorePreview(value: RestorePreviewState | undefined): value is ApplyingRestorePreview {
  return Boolean(value && "leaseId" in value);
}

function createPublicPreviewToken(): string {
  return `sha256:${createHash("sha256")
    .update("pige.restore.public-preview.v1\0", "utf8")
    .update(randomUUID(), "utf8")
    .digest("hex")}`;
}
