import path from "node:path";
import type {
  BrowserWindow,
  IpcMain,
  MessageBoxOptions,
  OpenDialogOptions,
  SaveDialogOptions,
  WebContents
} from "electron";
import type {
  BackupCreateResult,
  BackupContinueIncompleteRequest,
  BackupContinueIncompleteResult,
  BackupReconnectDependencyRequest,
  BackupReconnectDependencyResult,
  BackupReconnectDestinationRequest,
  BackupReconnectDestinationResult,
  BackupRestoreStatus,
  RestoreApplyRequest,
  RestoreApplyResult,
  RestoreCancelRequest,
  RestoreCancelResult,
  RestorePreviewResult,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  BACKUP_CONTINUE_INCOMPLETE_CHANNEL,
  BACKUP_CONVERSATION_PREFERENCE_STATUS_CHANNEL,
  BACKUP_MEMORY_PREFERENCE_STATUS_CHANNEL,
  BACKUP_RECONNECT_DESTINATION_CHANNEL,
  BACKUP_SET_CONVERSATION_PREFERENCE_CHANNEL,
  BACKUP_SET_MEMORY_PREFERENCE_CHANNEL,
  BACKUP_TRASH_PREFERENCE_STATUS_CHANNEL,
  BACKUP_SET_TRASH_PREFERENCE_CHANNEL,
  BackupConversationPreferenceSummarySchema,
  BackupConversationPreferenceUpdateRequestSchema,
  BackupConversationPreferenceUpdateResultSchema,
  BackupMemoryPreferenceSummarySchema,
  BackupMemoryPreferenceUpdateRequestSchema,
  BackupMemoryPreferenceUpdateResultSchema,
  BackupTrashPreferenceSummarySchema,
  BackupTrashPreferenceUpdateRequestSchema,
  BackupTrashPreferenceUpdateResultSchema,
  BackupContinueIncompleteRequestSchema,
  BackupContinueIncompleteResultSchema,
  BackupReconnectDependencyRequestSchema,
  BackupReconnectDependencyResultSchema,
  BackupReconnectDestinationRequestSchema,
  BackupReconnectDestinationResultSchema,
  RESTORE_CANCEL_CHANNEL,
  RestoreCancelRequestSchema,
  RestoreCancelResultSchema,
  type Locale
} from "@pige/schemas";
import type { BackupMemoryPreferenceService } from "./services/backup-memory-preference-service";
import type { BackupConversationPreferenceService } from "./services/backup-conversation-preference-service";
import type { BackupTrashPreferenceService } from "./services/backup-trash-preference-service";
import type { BackupCoordinatorService } from "./services/backup-coordinator-service";
import type { BackupRestoreService } from "./services/backup-service";
import { RestorePreviewRegistry } from "./services/restore-preview-registry";
import type { RestoreCoordinatorService } from "./services/restore-coordinator-service";

interface RegisterBackupRestoreIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly getWindow: (sender: WebContents) => BrowserWindow | undefined;
  readonly showSaveDialog: (window: BrowserWindow, options: SaveDialogOptions) => Promise<{
    readonly canceled: boolean;
    readonly filePath?: string;
  }>;
  readonly showOpenDialog: (window: BrowserWindow, options: OpenDialogOptions) => Promise<{
    readonly canceled: boolean;
    readonly filePaths: readonly string[];
  }>;
  readonly showMessageBox: (window: BrowserWindow, options: MessageBoxOptions) => Promise<{ readonly response: number }>;
  readonly getActiveVault: () => VaultSummary | undefined;
  readonly getActiveVaultPath?: () => string | undefined;
  readonly getLastBackupAt: () => string | undefined;
  readonly getLocale: () => Locale;
  readonly getDocumentsPath: () => string;
  readonly getBackupService: () => BackupRestoreService;
  readonly getBackupConversationPreferenceService?: () => BackupConversationPreferenceService;
  readonly getBackupMemoryPreferenceService?: () => BackupMemoryPreferenceService;
  readonly getBackupTrashPreferenceService?: () => BackupTrashPreferenceService;
  readonly getBackupCoordinator: () => BackupCoordinatorService;
  readonly getRestoreCoordinator: () => RestoreCoordinatorService;
  readonly resumeBackgroundJobs: () => void;
}

export function registerBackupRestoreIpc(options: RegisterBackupRestoreIpcOptions): void {
  const previews = new RestorePreviewRegistry();
  const trackedSenders = new Set<number>();
  const trackSender = (sender: WebContents): void => {
    if (trackedSenders.has(sender.id)) return;
    trackedSenders.add(sender.id);
    sender.once("destroyed", () => {
      previews.clear(sender.id);
      trackedSenders.delete(sender.id);
    });
  };

  options.ipcMain.handle("backup.status", (): BackupRestoreStatus => {
    const activeVault = options.getActiveVault();
    if (!activeVault) return options.getBackupService().status(undefined);
    const { lastBackupAt: _lastBackupAt, ...vault } = activeVault;
    const lastBackupAt = options.getLastBackupAt();
    return options.getBackupService().status(
      { ...vault, ...(lastBackupAt ? { lastBackupAt } : {}) },
      options.getActiveVaultPath?.()
    );
  });
  if (options.getBackupConversationPreferenceService) {
    options.ipcMain.handle(BACKUP_CONVERSATION_PREFERENCE_STATUS_CHANNEL, () =>
      BackupConversationPreferenceSummarySchema.parse(options.getBackupConversationPreferenceService!().summary())
    );
    options.ipcMain.handle(BACKUP_SET_CONVERSATION_PREFERENCE_CHANNEL, (_event, request: unknown) => {
      const parsed = BackupConversationPreferenceUpdateRequestSchema.parse(request);
      const result = BackupConversationPreferenceUpdateResultSchema.parse(options.getBackupConversationPreferenceService!().update(parsed));
      if (result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId) {
        throw new Error("Invalid conversation backup preference response identity.");
      }
      return result;
    });
  }
  if (options.getBackupMemoryPreferenceService) {
    options.ipcMain.handle(BACKUP_MEMORY_PREFERENCE_STATUS_CHANNEL, () =>
      BackupMemoryPreferenceSummarySchema.parse(options.getBackupMemoryPreferenceService!().summary())
    );
    options.ipcMain.handle(BACKUP_SET_MEMORY_PREFERENCE_CHANNEL, (_event, request: unknown) => {
      const parsed = BackupMemoryPreferenceUpdateRequestSchema.parse(request);
      const result = BackupMemoryPreferenceUpdateResultSchema.parse(
        options.getBackupMemoryPreferenceService!().update(parsed)
      );
      if (result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId) {
        throw new Error("Invalid Agent memory backup preference response identity.");
      }
      return result;
    });
  }
  if (options.getBackupTrashPreferenceService) {
    options.ipcMain.handle(BACKUP_TRASH_PREFERENCE_STATUS_CHANNEL, () =>
      BackupTrashPreferenceSummarySchema.parse(options.getBackupTrashPreferenceService!().summary())
    );
    options.ipcMain.handle(BACKUP_SET_TRASH_PREFERENCE_CHANNEL, (_event, request: unknown) => {
      const parsed = BackupTrashPreferenceUpdateRequestSchema.parse(request);
      const result = BackupTrashPreferenceUpdateResultSchema.parse(options.getBackupTrashPreferenceService!().update(parsed));
      if (result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId) {
        throw new Error("Invalid trash backup preference response identity.");
      }
      return result;
    });
  }
  options.ipcMain.handle("backup.create", async (event): Promise<BackupCreateResult> => {
    const activeVault = options.getActiveVault();
    if (!activeVault) throw new Error("No active vault for backup creation.");
    const window = options.getWindow(event.sender);
    if (!window) throw new Error("No active window for backup creation.");
    const selection = await options.showSaveDialog(window, {
      title: "Create Pige Backup",
      defaultPath: `${activeVault.name}-${new Date().toISOString().slice(0, 10)}.pige-backup.zip`,
      filters: [{ name: "Pige Backup", extensions: ["zip"] }]
    });
    if (selection.canceled || !selection.filePath) return { status: "canceled" };
    const job = await options.getBackupCoordinator().create(selection.filePath);
    if (job.state === "cancelled") return { status: "canceled" };
    if (job.state === "waiting_dependency") {
      throw new PigeDomainError(
        "backup.dependency_waiting",
        "The durable Backup Job is waiting for a required managed source location."
      );
    }
    if (job.state !== "completed" && job.state !== "completed_with_warnings") {
      throw new PigeDomainError(job.error?.code ?? "backup.execution_failed", "The durable Backup Job did not complete.");
    }
    const archivePath = job.outputRefs?.find((ref) => ref.role === "backup_archive")?.path;
    if (!archivePath) throw new PigeDomainError("backup.job_conflict", "The Backup Job has no archive reference.");
    const inspected = await options.getBackupService().inspectRestoreArchive(archivePath);
    return { status: "created", backupPath: archivePath, manifest: inspected.manifest };
  });
  options.ipcMain.handle("backup.reconnectDependency", async (
    event,
    request: BackupReconnectDependencyRequest
  ): Promise<BackupReconnectDependencyResult> => {
    const parsed = BackupReconnectDependencyRequestSchema.parse(request);
    const result = (status: BackupReconnectDependencyResult["status"]): BackupReconnectDependencyResult =>
      BackupReconnectDependencyResultSchema.parse({ ...parsed, status });
    const inspected = options.getBackupCoordinator().inspectReconnectCandidate(
      parsed.activeVaultId,
      parsed.waitingJobId
    );
    if (inspected.status !== "ready") return result(inspected.status);
    const window = options.getWindow(event.sender);
    if (!window) return result("failed");
    let selection: { readonly canceled: boolean; readonly filePaths: readonly string[] };
    try {
      selection = await options.showOpenDialog(window, {
        title: "Reconnect source location",
        properties: ["openDirectory"]
      });
    } catch {
      return result("failed");
    }
    if (selection.canceled || !selection.filePaths[0]) return result("cancelled");
    return result(options.getBackupCoordinator().reconnectDependency(
      inspected.candidate,
      selection.filePaths[0]
    ));
  });
  options.ipcMain.handle(BACKUP_RECONNECT_DESTINATION_CHANNEL, async (
    event,
    request: BackupReconnectDestinationRequest
  ): Promise<BackupReconnectDestinationResult> => {
    const parsed = BackupReconnectDestinationRequestSchema.parse(request);
    const result = (status: BackupReconnectDestinationResult["status"]): BackupReconnectDestinationResult =>
      BackupReconnectDestinationResultSchema.parse({ ...parsed, status });
    const inspect = () => options.getBackupCoordinator().inspectDestinationReconnectCandidate(
      parsed.activeVaultId,
      parsed.waitingJobId,
      parsed.expectedJobUpdatedAt
    );
    const inspected = inspect();
    if (inspected.status !== "ready") return result(inspected.status);
    const window = options.getWindow(event.sender);
    if (!window) return result("failed");
    let selection: { readonly canceled: boolean; readonly filePaths: readonly string[] };
    try {
      selection = await options.showOpenDialog(window, {
        title: "Reconnect backup destination",
        properties: ["openDirectory", "createDirectory"]
      });
    } catch {
      return result("failed");
    }
    if (selection.canceled || !selection.filePaths[0]) return result("cancelled");
    const current = inspect();
    if (current.status !== "ready") return result(current.status);
    return result(options.getBackupCoordinator().reconnectDestination(
      current.candidate,
      selection.filePaths[0]
    ));
  });
  options.ipcMain.handle(BACKUP_CONTINUE_INCOMPLETE_CHANNEL, async (
    event,
    request: BackupContinueIncompleteRequest
  ): Promise<BackupContinueIncompleteResult> => {
    const parsed = BackupContinueIncompleteRequestSchema.parse(request);
    const result = (status: BackupContinueIncompleteResult["status"]): BackupContinueIncompleteResult =>
      BackupContinueIncompleteResultSchema.parse({ ...parsed, status });
    const inspect = () => options.getBackupCoordinator().inspectIncompleteCandidate(
      parsed.activeVaultId,
      parsed.waitingJobId,
      parsed.expectedJobUpdatedAt
    );
    const inspected = inspect();
    if (inspected.status !== "ready") return result(inspected.status);
    const window = options.getWindow(event.sender);
    if (!window) return result("failed");
    let confirmation: { readonly response: number };
    try {
      confirmation = await options.showMessageBox(window, {
        type: "warning",
        title: "Continue incomplete backup?",
        message: "The unavailable managed source location will be omitted from this backup.",
        detail: "The same backup job will continue and finish with a warning.",
        buttons: ["Continue", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      });
    } catch {
      return result("failed");
    }
    if (confirmation.response !== 0) return result("cancelled");
    const confirmed = inspect();
    if (confirmed.status !== "ready") return result(confirmed.status);
    return result(await options.getBackupCoordinator().continueIncomplete(confirmed.candidate));
  });
  options.ipcMain.handle("restore.preview", async (event): Promise<RestorePreviewResult> => {
    const senderId = event.sender.id;
    trackSender(event.sender);
    const generation = previews.begin(senderId);
    const window = options.getWindow(event.sender);
    if (!window) {
      previews.cancel(senderId, generation);
      throw new Error("No active window for restore preview.");
    }
    const selection = await options.showOpenDialog(window, {
      title: "Choose Pige Backup",
      properties: ["openFile"],
      filters: [{ name: "Pige Backup", extensions: ["zip"] }]
    });
    if (selection.canceled || !selection.filePaths[0]) {
      previews.cancel(senderId, generation);
      return { status: "canceled" };
    }
    try {
      const preview = await options.getBackupService().inspectRestoreArchive(selection.filePaths[0]);
      const accepted = previews.complete(senderId, generation, preview);
      const permittedModes = options.getActiveVault()?.vaultId === preview.sourceVaultId
        ? ["clone_as_new", "replace_existing"] as const
        : ["clone_as_new"] as const;
      return {
        status: "ready",
        previewId: accepted.previewId,
        manifest: preview.manifest,
        invalidFileCount: preview.invalidFileCount,
        warnings: preview.warnings,
        permittedModes,
        defaultMode: "clone_as_new"
      };
    } catch (caught) {
      previews.cancel(senderId, generation);
      if (caught instanceof PigeDomainError && caught.code === "restore.schema_unsupported") {
        return { status: "unsupported", reason: "schema_newer" };
      }
      throw caught;
    }
  });
  options.ipcMain.handle("restore.apply", async (event, request: RestoreApplyRequest): Promise<RestoreApplyResult> => {
    if (!request || typeof request.previewId !== "string") {
      throw new PigeDomainError("restore.backup_invalid", "Create a current restore preview before applying restore.");
    }
    const senderId = event.sender.id;
    const accepted = previews.claim(senderId, request);
    const window = options.getWindow(event.sender);
    if (!window) {
      previews.release(senderId, accepted);
      throw new Error("No active window for restore.");
    }
    const copy = RESTORE_NATIVE_COPY[options.getLocale()];
    let replaceConfirmed = false;
    if (accepted.mode === "replace_existing") {
      if (options.getActiveVault()?.vaultId !== accepted.sourceVaultId) {
        previews.release(senderId, accepted);
        throw new PigeDomainError("restore.replace_unavailable", "The exact source vault is no longer active.");
      }
      const confirmation = await options.showMessageBox(window, {
        type: "warning", buttons: [copy.cancel, copy.confirm], defaultId: 0, cancelId: 0,
        noLink: true, title: copy.title, message: copy.message
      }).catch((caught) => {
        previews.release(senderId, accepted);
        throw caught;
      });
      if (confirmation.response !== 1) {
        previews.release(senderId, accepted);
        return { status: "canceled" };
      }
      replaceConfirmed = true;
    }
    const selection = await options.showOpenDialog(window, {
      title: copy.destinationPickerTitle,
      defaultPath: options.getDocumentsPath(),
      properties: ["openDirectory", "createDirectory"]
    }).catch((caught) => {
      previews.release(senderId, accepted);
      throw caught;
    });
    if (selection.canceled || !selection.filePaths[0]) {
      previews.release(senderId, accepted);
      return { status: "canceled" };
    }
    if (!previews.isCurrent(senderId, accepted)) {
      throw new PigeDomainError("restore.backup_invalid", "The restore preview was superseded before apply.");
    }
    try {
      const result = await options.getRestoreCoordinator().apply({
        preview: accepted,
        destinationPath: createRestoreDestinationPath(selection.filePaths[0], accepted),
        replaceConfirmed
      });
      if (result.status !== "restored") {
        previews.release(senderId, accepted);
        return result;
      }
      previews.consume(senderId, accepted);
      options.resumeBackgroundJobs();
      return result;
    } catch (caught) {
      if (
        caught instanceof PigeDomainError &&
        (caught.code === "restore.backup_invalid" || caught.code === "restore.backup_changed")
      ) previews.consume(senderId, accepted);
      else previews.release(senderId, accepted);
      throw caught;
    }
  });
  options.ipcMain.handle(RESTORE_CANCEL_CHANNEL, (
    event,
    request: RestoreCancelRequest
  ): RestoreCancelResult => {
    const parsed = RestoreCancelRequestSchema.parse(request);
    const result = (status: RestoreCancelResult["status"]): RestoreCancelResult =>
      RestoreCancelResultSchema.parse({ ...parsed, status });
    if (!previews.isApplying(event.sender.id, parsed)) return result("stale");
    return result(options.getRestoreCoordinator().cancel(parsed.previewId, parsed.mode));
  });
}

function createRestoreDestinationPath(
  parentPathInput: string,
  preview: { readonly mode: "clone_as_new" | "replace_existing"; readonly backupId: string; readonly sourceVaultId: string }
): string {
  const parentPath = path.resolve(parentPathInput);
  const sourceSuffix = preview.sourceVaultId.replace(/[^a-z0-9]/giu, "").slice(-8) || "vault";
  const backupSuffix = preview.backupId.replace(/[^a-z0-9]/giu, "").slice(-8) || "backup";
  return path.join(parentPath, `Pige-${preview.mode === "clone_as_new" ? "copy" : "recovered"}-${sourceSuffix}-${backupSuffix}`);
}

const RESTORE_NATIVE_COPY = {
  "de": {
    cancel: "Abbrechen",
    confirm: "Aktuellen Tresor ersetzen",
    destinationPickerTitle: "Zielordner für den wiederhergestellten Tresor auswählen",
    title: "Aktiven Tresor ersetzen?",
    message: "Dadurch wird die Bindung des aktuellen logischen Tresors ersetzt. Dieser Vorgang kann in diesem Ablauf nicht rückgängig gemacht werden. Pige erstellt und prüft zuerst ein Rollback-Backup, stellt dann in einem neuen Ordner wieder her und wechselt die aktive Tresor-Bindung."
  },
  "en": {
    cancel: "Cancel",
    confirm: "Replace Current Vault",
    destinationPickerTitle: "Choose a destination for the restored vault",
    title: "Replace the active vault?",
    message: "This replaces the current logical vault binding and cannot be undone from this flow. Pige will first create and verify a rollback backup, restore into a fresh folder, then switch the active vault binding."
  },
  "fr": {
    cancel: "Annuler",
    confirm: "Remplacer le coffre actuel",
    destinationPickerTitle: "Choisir la destination du coffre restauré",
    title: "Remplacer le coffre actif ?",
    message: "Cette action remplace l’association du coffre logique actuel et ne peut pas être annulée depuis ce parcours. Pige créera et vérifiera d’abord une sauvegarde de retour, restaurera dans un nouveau dossier, puis remplacera l’association du coffre actif."
  },
  "ja": {
    cancel: "キャンセル",
    confirm: "現在の Vault を置き換える",
    destinationPickerTitle: "復元する Vault の保存先を選択",
    title: "現在の Vault を置き換えますか？",
    message: "現在の論理 Vault の関連付けが置き換わり、この操作はこの手順内では取り消せません。Pige は最初にロールバック用バックアップを作成して検証し、新しいフォルダーへ復元してから、アクティブな Vault の関連付けを切り替えます。"
  },
  "ko": {
    cancel: "취소",
    confirm: "현재 Vault 교체",
    destinationPickerTitle: "복원된 Vault의 대상 폴더 선택",
    title: "현재 Vault를 교체하시겠습니까?",
    message: "현재 논리 Vault 연결을 교체하며 이 흐름에서는 실행 취소할 수 없습니다. Pige가 먼저 롤백 백업을 만들고 검증한 뒤 새 폴더에 복원하고 활성 Vault 연결을 전환합니다."
  },
  "zh-Hans": {
    cancel: "取消",
    confirm: "替换当前仓库",
    destinationPickerTitle: "选择恢复仓库的目标文件夹",
    title: "替换当前仓库？",
    message: "这会替换当前逻辑仓库的绑定，且无法在此流程中撤销。Pige 会先创建并验证回滚备份，再恢复到新文件夹，最后切换当前仓库绑定。"
  }
} as const satisfies Record<Locale, {
  readonly cancel: string;
  readonly confirm: string;
  readonly destinationPickerTitle: string;
  readonly title: string;
  readonly message: string;
}>;
