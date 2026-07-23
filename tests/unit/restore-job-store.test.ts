import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JobExecutionCoordinator } from "../../apps/desktop/src/main/services/job-execution-coordinator";
import { JobRecordStore } from "../../apps/desktop/src/main/services/job-record-store";
import { createVaultOnDisk } from "../../apps/desktop/src/main/services/vault-layout";
import {
  RESTORE_CHECKPOINT_IDS,
  RestoreJobStore,
  createPreviousVaultBindingHash,
  createRestoreJobIdentity
} from "../../apps/desktop/src/main/services/restore-job-store";
import { acquireVaultWriterLease } from "../../apps/desktop/src/main/services/vault-writer-lease";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("machine-local Restore Job store", () => {
  it("derives one stable Job and clone identity without binding the transient preview", () => {
    const input = identityInput("clone_as_new");
    const first = createRestoreJobIdentity(input);
    const second = createRestoreJobIdentity(input);

    expect(first).toEqual(second);
    expect(first.jobId).toMatch(/^job_20260714_[a-f0-9]{64}$/u);
    expect(first.resultVaultId).toMatch(/^vault_20260714_[a-f0-9]{64}$/u);
    expect(createRestoreJobIdentity({ ...input, mode: "replace_existing" }).resultVaultId)
      .toBe(input.sourceVaultId);
    expect(createRestoreJobIdentity({
      ...input,
      destinationIdentity: sha("b")
    }).jobId).not.toBe(first.jobId);
  });

  it("creates once, reuses exact bindings, and rejects a conflicting path", () => {
    const root = tempRoot();
    const store = new RestoreJobStore(path.join(root, "user-data"));
    const input = createInput(root);
    try {
      const first = store.create(input);
      const second = store.create(input);
      expect(second.job.id).toBe(first.job.id);
      expect(store.binding(second)).toMatchObject({
        jobId: first.job.id,
        previewId: input.previewId,
        archivePreviewToken: input.archivePreviewToken
      });
      expect(store.findByRestoreAction({
        backupPath: input.backupPath,
        archiveDigest: input.archiveDigest,
        backupId: input.backupId,
        backupIdentitySource: input.backupIdentitySource,
        mode: input.mode,
        sourceVaultId: input.sourceVaultId,
        destinationPath: input.destinationPath,
        destinationIdentity: input.destinationIdentity
      })?.job.id).toBe(first.job.id);

      expect(() => store.create({
        ...input,
        backupPath: path.join(root, "different.pige-backup.zip")
      })).toThrowError(expect.objectContaining({ code: "restore.job_conflict" }));
    } finally {
      store.close();
    }
  });

  it("prepares only retryable failures for one explicit same-Job retry", () => {
    const root = tempRoot();
    const store = new RestoreJobStore(path.join(root, "user-data"));
    const input = createInput(root);
    try {
      let snapshot = store.create(input);
      snapshot = store.markFailed(snapshot, {
        error: restoreFailure(true),
        message: "Synthetic retryable restore failure."
      });

      const retried = store.prepareExplicitRetry(snapshot);

      expect(retried.job).toMatchObject({
        id: snapshot.job.id,
        state: "queued",
        retry: {
          retryCount: 1,
          maxAutomaticRetries: 0,
          requiresUserAction: false,
          lastRetryReason: "explicit_user_retry"
        }
      });
      expect(retried.job.finishedAt).toBeUndefined();

      const final = store.markFailed(retried, {
        error: restoreFailure(false),
        message: "Synthetic final restore failure."
      });
      expect(() => store.prepareExplicitRetry(final)).toThrowError(expect.objectContaining({
        code: "restore.job_conflict"
      }));
    } finally {
      store.close();
    }
  });

  it("advances exact checkpoints monotonically and recovers the same running Job", () => {
    const root = tempRoot();
    const userData = path.join(root, "user-data");
    let store = new RestoreJobStore(userData);
    const input = createInput(root);
    let snapshot = store.create(input);

    expect(() => store.beginCheckpoint(snapshot, "archive_extracted"))
      .toThrowError(expect.objectContaining({ code: "restore.checkpoint_invalid" }));
    snapshot = store.beginCheckpoint(snapshot, "manifest_validated");
    expect(snapshot.job.progress).toEqual({
      completedUnits: 0,
      totalUnits: RESTORE_CHECKPOINT_IDS.length,
      unit: "checkpoint"
    });
    snapshot = store.completeCheckpoint(snapshot, "manifest_validated", {
      checksumAfter: input.archiveDigest
    });
    snapshot = store.beginCheckpoint(snapshot, "destination_reserved");
    expect(snapshot.job.progress?.completedUnits).toBe(1);
    store.close();

    store = new RestoreJobStore(userData);
    try {
      const recovered = store.listRecoverable();
      expect(recovered).toHaveLength(1);
      expect(recovered[0]?.job.id).toBe(snapshot.job.id);
      expect(recovered[0]?.job.progress).toEqual({
        completedUnits: 1,
        totalUnits: RESTORE_CHECKPOINT_IDS.length,
        unit: "checkpoint"
      });
      expect(recovered[0]?.job.checkpoints?.find(({ id }) => id === "destination_reserved")?.state)
        .toBe("running");
    } finally {
      store.close();
    }
  });

  it("writes one exact restore_applied Operation and completes only after all checkpoints", () => {
    const root = tempRoot();
    const userData = path.join(root, "user-data");
    const vaultParent = path.join(root, "vaults");
    fs.mkdirSync(vaultParent, { recursive: true });
    const vault = createVaultOnDisk({
      parentDirectory: vaultParent,
      vaultName: "Restored",
      appDataPath: userData,
      tempPath: path.join(root, "temp")
    });
    const vaultPath = path.join(vaultParent, "Restored");
    const vaultLease = acquireVaultWriterLease(vaultPath);
    const store = new RestoreJobStore(userData);
    const input = {
      ...createInput(root),
      mode: "replace_existing" as const,
      sourceVaultId: vault.vaultId,
      expectedActiveVaultPath: vaultPath,
      expectedActiveVaultId: vault.vaultId,
      previousBindingHash: createPreviousVaultBindingHash(vaultPath, vault.vaultId),
      replaceConfirmed: true
    };
    let snapshot = store.create(input);
    try {
      expect(() => store.markCompleted(
        snapshot,
        {} as never,
        vault.vaultId,
        vaultPath
      )).toThrowError(expect.objectContaining({ code: "restore.checkpoint_invalid" }));

      for (const checkpointId of RESTORE_CHECKPOINT_IDS) {
        snapshot = store.beginCheckpoint(snapshot, checkpointId);
        snapshot = store.completeCheckpoint(snapshot, checkpointId);
      }
      snapshot = store.recoverInterrupted(snapshot);
      expect(snapshot.job.state).toBe("queued");
      const operation = store.writeRestoreAppliedOperation({
        snapshot,
        vaultPath,
        backupId: input.backupId,
        archiveDigest: input.archiveDigest,
        sourceVaultId: vault.vaultId,
        resultVaultId: vault.vaultId,
        mode: input.mode,
        destinationIdentity: input.destinationIdentity,
        assertVaultWriterLease: () => vaultLease.assertHeld()
      });
      const repeated = store.writeRestoreAppliedOperation({
        snapshot,
        vaultPath,
        backupId: input.backupId,
        archiveDigest: input.archiveDigest,
        sourceVaultId: vault.vaultId,
        resultVaultId: vault.vaultId,
        mode: input.mode,
        destinationIdentity: input.destinationIdentity,
        assertVaultWriterLease: () => vaultLease.assertHeld()
      });
      expect(repeated).toEqual(operation);

      const staleSnapshot = snapshot;
      const rawStore = new JobRecordStore({
        rootPath: path.dirname(path.dirname(path.dirname(snapshot.path))),
        unsafeAllowUnfenced: true
      });
      snapshot = new JobExecutionCoordinator(rawStore).requestCancellation(snapshot, {
        requestedBy: "user",
        message: "Cancel raced with committed Restore output."
      });
      expect(store.listRecoverable().map(({ job }) => job.id)).toContain(snapshot.job.id);

      snapshot = store.markCompleted(staleSnapshot, operation, vault.vaultId, vaultPath);
      expect(snapshot.job.state).toBe("completed_with_warnings");
      expect(snapshot.job.operationIds).toEqual([operation.id]);
      expect(snapshot.job.outputRefs).toContainEqual(expect.objectContaining({
        kind: "operation",
        id: operation.id
      }));
      expect(snapshot.job.cancellation).toMatchObject({
        requestedBy: "user",
        durableWritesApplied: true,
        safeCheckpointId: "destination_committed"
      });
    } finally {
      store.close();
      vaultLease.release();
    }
  });

  it("rejects a symlinked coordinator root before any Job write", () => {
    const root = tempRoot();
    const userData = path.join(root, "user-data");
    const external = path.join(root, "external");
    fs.mkdirSync(userData, { recursive: true });
    fs.mkdirSync(external, { recursive: true });
    fs.symlinkSync(external, path.join(userData, "restore-coordinator"));

    expect(() => new RestoreJobStore(userData)).toThrowError(expect.objectContaining({
      code: "restore.path_unsafe"
    }));
    expect(fs.readdirSync(external)).toEqual([]);
  });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-restore-job-store-"));
  roots.push(root);
  return root;
}

function createInput(root: string) {
  return {
    ...identityInput("clone_as_new" as const),
    backupPath: path.join(root, "backup.pige-backup.zip"),
    destinationPath: path.join(root, "vaults", "Restored"),
    archivePreviewToken: sha("d"),
    previewId: sha("e"),
    backupIdentitySource: "manifest" as const,
    replaceConfirmed: false
  };
}

function identityInput(mode: "clone_as_new" | "replace_existing") {
  return {
    createdAt: "2026-07-14T01:02:03.000Z",
    archiveDigest: sha("a"),
    backupId: "backup_20260714_abcdefgh",
    mode,
    sourceVaultId: "vault_20260714_source123",
    destinationIdentity: sha("c"),
    previousBindingHash: createPreviousVaultBindingHash()
  };
}

function restoreFailure(retryable: boolean) {
  return {
    code: retryable ? "restore.execution_failed" : "restore.identity_conflict",
    domain: "restore" as const,
    messageKey: retryable
      ? "errors.restore.execution_failed"
      : "errors.restore.identity_conflict",
    retryable,
    severity: "error" as const,
    userAction: retryable ? "retry" as const : "choose_path" as const
  };
}

function sha(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
