import { app, BrowserWindow, dialog, ipcMain, safeStorage, screen, shell, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PigeDomainError } from "@pige/domain";
import type {
  AddPresetProviderRequest,
  AddManualProviderRequest,
  AddManualModelRequest,
  AgentConversationRequest,
  AgentSubmitTurnRequest,
  AppHealth,
  BackupCreateResult,
  CreateVaultRequest,
  CancelSupportBundleExportRequest,
  CancelSupportBundleExportResult,
  ExportSupportBundleRequest,
  HomeAgentAskRequest,
  JobActionRequest,
  JobActionResult,
  JobsListRequest,
  KnowledgeActivityListRequest,
  KnowledgeActivityUndoRequest,
  LibraryListRequest,
  LibraryRelatedRequest,
  ModelEgressPendingRequestQuery,
  ModelEgressResolveRequest,
  PermissionPendingRequestQuery,
  PermissionResolveRequest,
  PermissionSetDefaultModeRequest,
  PermissionPrepareYoloEnableRequest,
  PermissionPrepareYoloEnableResult,
  PermissionEnableYoloRequest,
  PermissionDisableYoloRequest,
  PermissionRevokeSavedGrantRequest,
  PermissionRevokeAllSavedGrantsRequest,
  NoteGetRequest,
  NoteResolveInlineReferenceRequest,
  NoteRenderRequest,
  ReaderSelectionActionRequest,
  ReaderSelectionResolveRequest,
  OpenRecentVaultRequest,
  ProviderConnectResult,
  RetrievalAskRequest,
  RestoreApplyRequest,
  RestoreApplyResult,
  RestorePreviewResult,
  RefreshProviderModelsRequest,
  UpdateProviderCredentialRequest,
  DeleteProviderRequest,
  SetAlwaysOnTopRequest,
  SetDefaultModelRequest,
  UpdateModelRequest,
  SetLocaleRequest,
  SetSidebarOpenRequest,
  SetWindowModeRequest,
  SpeechAvailabilityRequest,
  SpeechAssetInstallRequest,
  SpeechCancelRequest,
  SpeechSessionRequest,
  SpeechStartRequest,
  SupportBundlePreview,
  UpdateSourceStoragePolicyRequest,
  WindowLayoutRequest
} from "@pige/contracts";
import {
  AddManualProviderRequestSchema,
  AddPresetProviderRequestSchema,
  AddManualModelRequestSchema,
  RefreshProviderModelsRequestSchema,
  UpdateProviderCredentialRequestSchema,
  DeleteProviderRequestSchema,
  ModelEgressPendingRequestQuerySchema,
  ModelEgressPendingRequestSchema,
  ModelEgressResolveRequestSchema,
  ModelEgressResolveResultSchema,
  PermissionPendingRequestQuerySchema,
  PermissionPendingRequestSchema,
  PermissionResolveRequestSchema,
  PermissionResolveResultSchema,
  PermissionSetDefaultModeRequestSchema,
  PermissionPrepareYoloEnableRequestSchema,
  PermissionPrepareYoloEnableResultSchema,
  PermissionEnableYoloRequestSchema,
  PermissionDisableYoloRequestSchema,
  PermissionRevokeSavedGrantRequestSchema,
  PermissionRevokeAllSavedGrantsRequestSchema,
  PermissionSettingsMutationResultSchema,
  PermissionSettingsSummarySchema,
  NoteResolveInlineReferenceRequestSchema,
  NoteResolveInlineReferenceResultSchema,
  ReaderSelectionActionRequestSchema,
  ReaderSelectionActionResultSchema,
  ReaderSelectionResolveRequestSchema,
  ReaderSelectionResolveResultSchema,
  OpenRecentVaultRequestSchema,
  type Locale,
  UpdateModelRequestSchema,
  SetDefaultModelRequestSchema,
  SpeechAvailabilityRequestSchema,
  SpeechAssetInstallEventSchema,
  SpeechAssetInstallRequestSchema,
  SpeechCancelRequestSchema,
  SpeechSessionEventSchema,
  SpeechSessionRequestSchema,
  SpeechStartRequestSchema,
  WindowLayoutRequestSchema,
  WindowLayoutStateSchema,
  VaultActionResultSchema
} from "@pige/schemas";
import { PRELOAD_ENTRY_FILENAME } from "../shared/preload-entry";
import {
  AgentIngestService,
  type AgentIngestCapabilitySnapshot,
  type AgentIngestProposalPort,
  type AgentIngestRetrievalPort
} from "./services/agent-ingest-service";
import { AgentRuntimeService } from "./services/agent-runtime-service";
import { AgentTurnDraftPublisher } from "./services/agent-turn-draft-publisher";
import { AppearanceService } from "./services/appearance-service";
import { BackupCoordinatorService } from "./services/backup-coordinator-service";
import { BackupRestoreService } from "./services/backup-service";
import { CoalescedBatchDrainer } from "./services/background-job-drainer";
import { CaptureService } from "./services/capture-service";
import { DiagnosticsService } from "./services/diagnostics-service";
import { DatasetIngestWorkerService } from "./services/dataset-ingest-worker-service";
import { DatasetQueryService } from "./services/dataset-query-service";
import { DatasetService } from "./services/dataset-service";
import { DocumentParserService } from "./services/document-parser-service";
import {
  JobsService,
  type ProcessQueuedCapturesResult,
  type ProcessQueuedIndexRebuildResult,
  type ProcessQueuedOcrResult,
  type ProcessQueuedParsesResult
} from "./services/jobs-service";
import { LibraryService } from "./services/library-service";
import { KnowledgeActivityService } from "./services/knowledge-activity-service";
import {
  AgentSubmitTurnRequestSchema,
  HomeAgentService,
  type HomeAgentDraftSnapshot
} from "./services/home-agent-service";
import { HomeAgentUrlService } from "./services/home-agent-url-service";
import { LocalDatabaseRebuildWorkerService } from "./services/local-database-rebuild-worker-service";
import { LocalDatabaseService } from "./services/local-database-service";
import { listMarkdownTagCatalog } from "./services/markdown-page-index";
import { LocalSettingsStore } from "./services/local-settings";
import { ModelProviderRegistry } from "./services/model-provider-registry";
import { ModelEgressApprovalService } from "./services/model-egress-approval-service";
import { PermissionBrokerService } from "./services/permission-broker-service";
import { PermissionSettingsService } from "./services/permission-settings-service";
import { PermissionYoloConfirmationRegistry } from "./services/permission-yolo-confirmation-registry";
import { ReaderSelectionActionService } from "./services/reader-selection-action-service";
import {
  createPermissionedExternalCapabilityRegistry,
  PermissionedExternalCapabilityRegistry,
  registerPermissionedExternalCapabilityAdapter
} from "./services/permissioned-external-capability-service";
import { createFirstPartyReadonlyNodeOsCapabilityAdapters } from "./services/readonly-node-os/first-party-readonly-node-os-capability-adapters";
import { NotesService } from "./services/notes-service";
import { OcrService } from "./services/ocr-service";
import { MacOSSpeechAdapter } from "./services/macos-speech-adapter";
import { ProposalService } from "./services/proposal-service";
import { installRendererNavigationGuard } from "./services/renderer-navigation-guard";
import { RestorePreviewRegistry } from "./services/restore-preview-registry";
import { RestoreCoordinatorService } from "./services/restore-coordinator-service";
import { writeBackupCreatedOperation } from "./services/restore-job-store";
import { handleRetrievalSearchIpc } from "./services/retrieval-search-ipc";
import { RetrievalService } from "./services/retrieval-service";
import { JsonSecretStore } from "./services/secret-store";
import { guardSettingAction, type SettingActionConfirmation } from "./services/setting-action-guard";
import { getSettingsRegistry } from "./services/settings-registry";
import { ToolchainService } from "./services/toolchain-service";
import { SpeechService } from "./services/speech-service";
import { VaultService } from "./services/vault-service";
import { WindowModeService } from "./services/window-mode-service";
import { getWindowShellOptions } from "./window-shell-options";

let vaultService: VaultService | undefined;
let localSettingsStore: LocalSettingsStore | undefined;
let diagnosticsService: DiagnosticsService | undefined;
let localDatabaseService: LocalDatabaseService | undefined;
let modelProviderRegistry: ModelProviderRegistry | undefined;
let modelEgressApprovalService: ModelEgressApprovalService | undefined;
let permissionBrokerService: PermissionBrokerService | undefined;
let permissionSettingsService: PermissionSettingsService | undefined;
const permissionYoloConfirmationRegistry = new PermissionYoloConfirmationRegistry();
const permissionYoloTrackedSenders = new Set<number>();
let permissionedExternalCapabilityRegistry: PermissionedExternalCapabilityRegistry | undefined;
let firstPartyReadonlyNodeOsCapabilitiesRegistered = false;
let windowModeService: WindowModeService | undefined;
let backupRestoreService: BackupRestoreService | undefined;
let backupCoordinatorService: BackupCoordinatorService | undefined;
let restoreCoordinatorService: RestoreCoordinatorService | undefined;
let agentRuntimeService: AgentRuntimeService | undefined;
let agentIngestService: AgentIngestService | undefined;
let homeAgentService: HomeAgentService | undefined;
let homeAgentUrlService: HomeAgentUrlService | undefined;
let appearanceService: AppearanceService | undefined;
let toolchainService: ToolchainService | undefined;
let captureService: CaptureService | undefined;
let jobsService: JobsService | undefined;
let knowledgeActivityService: KnowledgeActivityService | undefined;
let libraryService: LibraryService | undefined;
let notesService: NotesService | undefined;
let readerSelectionActionService: ReaderSelectionActionService | undefined;
let proposalService: ProposalService | undefined;
let retrievalService: RetrievalService | undefined;
let documentParserService: DocumentParserService | undefined;
let datasetQueryService: DatasetQueryService | undefined;
let datasetService: DatasetService | undefined;
let ocrService: OcrService | undefined;
let speechService: SpeechService | undefined;
let latestSupportBundlePreview: SupportBundlePreview | undefined;
const activeSupportBundleExports = new Map<string, {
  readonly senderId: number;
  readonly controller: AbortController;
}>();
const restorePreviewRegistry = new RestorePreviewRegistry();
const restorePreviewTrackedSenders = new Set<number>();
const speechTrackedSenders = new Set<number>();
const PACKAGED_RUNTIME_SMOKE_ARGUMENT = "--pige-packaged-runtime-smoke-report=";

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

async function confirmSettingAction(
  sender: WebContents,
  settingKeys: readonly string[],
  confirmation: SettingActionConfirmation
): Promise<void> {
  const parentWindow = BrowserWindow.fromWebContents(sender);
  if (!parentWindow) throw new Error("No active window for setting confirmation.");
  await guardSettingAction(settingKeys, confirmation, async (prompt) => {
    const result = await dialog.showMessageBox(parentWindow, {
      type: "warning",
      buttons: ["Cancel", prompt.confirmLabel],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: prompt.title,
      message: prompt.message
    });
    return result.response === 1;
  });
}

const YOLO_CONFIRMATION_COPY = {
  de: {
    title: "Vollzugriff für Agent-Aktionen aktivieren?",
    message: "Pige darf geeignete lokale Datei-, Netzwerk- und Shell-Aktionen ohne einzelne Freigabe ausführen. Eingeschränkte Inhalte, Betriebssystemrechte und destruktive oder gesondert bestätigungspflichtige Aktionen bleiben blockiert oder bestätigungspflichtig.",
    confirm: "Vollzugriff aktivieren",
    cancel: "Abbrechen"
  },
  en: {
    title: "Enable full access for Agent actions?",
    message: "Pige may run eligible local file, network, and shell actions without asking each time. Restricted content, operating-system permissions, and destructive or separately confirmed actions remain blocked or require confirmation.",
    confirm: "Enable full access",
    cancel: "Cancel"
  },
  fr: {
    title: "Activer l'accès complet pour les actions de l'Agent ?",
    message: "Pige pourra exécuter les actions locales éligibles sur les fichiers, le réseau et le shell sans confirmation individuelle. Le contenu restreint, les autorisations du système et les actions destructrices ou soumises à une confirmation distincte restent bloqués ou à confirmer.",
    confirm: "Activer l'accès complet",
    cancel: "Annuler"
  },
  ja: {
    title: "Agent アクションのフルアクセスを有効にしますか？",
    message: "Pige は対象となるローカルファイル、ネットワーク、シェルのアクションを毎回確認せずに実行できます。制限対象のコンテンツ、OS 権限、破壊的なアクション、個別の確認が必要なアクションの制約は変わりません。",
    confirm: "フルアクセスを有効にする",
    cancel: "キャンセル"
  },
  ko: {
    title: "Agent 작업의 전체 접근 권한을 활성화할까요?",
    message: "Pige가 허용 대상인 로컬 파일, 네트워크, 셸 작업을 매번 묻지 않고 실행할 수 있습니다. 제한된 콘텐츠, 운영체제 권한, 파괴적 작업과 별도 확인이 필요한 작업은 계속 차단되거나 확인을 요구합니다.",
    confirm: "전체 접근 활성화",
    cancel: "취소"
  },
  "zh-Hans": {
    title: "启用 Agent 完整访问权限？",
    message: "Pige 可不再逐次询问，直接执行符合条件的本地文件、网络和 Shell 动作。受限内容、操作系统权限、破坏性动作以及必须单独确认的动作仍会被阻止或要求确认。",
    confirm: "启用完整访问",
    cancel: "取消"
  }
} as const;

function getYoloConfirmationCopy(): (typeof YOLO_CONFIRMATION_COPY)[keyof typeof YOLO_CONFIRMATION_COPY] {
  const locale = app.getLocale().toLowerCase();
  if (locale.startsWith("zh")) return YOLO_CONFIRMATION_COPY["zh-Hans"];
  if (locale.startsWith("de")) return YOLO_CONFIRMATION_COPY.de;
  if (locale.startsWith("fr")) return YOLO_CONFIRMATION_COPY.fr;
  if (locale.startsWith("ja")) return YOLO_CONFIRMATION_COPY.ja;
  if (locale.startsWith("ko")) return YOLO_CONFIRMATION_COPY.ko;
  return YOLO_CONFIRMATION_COPY.en;
}

function trackPermissionYoloSender(sender: WebContents): void {
  if (permissionYoloTrackedSenders.has(sender.id)) return;
  permissionYoloTrackedSenders.add(sender.id);
  sender.once("destroyed", () => {
    permissionYoloConfirmationRegistry.clearSender(sender.id);
    permissionYoloTrackedSenders.delete(sender.id);
  });
}

function trackRestorePreviewSender(sender: WebContents): void {
  const senderId = sender.id;
  if (restorePreviewTrackedSenders.has(senderId)) return;
  restorePreviewTrackedSenders.add(senderId);
  sender.once("destroyed", () => {
    restorePreviewRegistry.clear(senderId);
    restorePreviewTrackedSenders.delete(senderId);
  });
}

const mainWindows = new Set<BrowserWindow>();
let captureDrainer: CoalescedBatchDrainer<ProcessQueuedCapturesResult> | undefined;
let parseDrainer: CoalescedBatchDrainer<ProcessQueuedParsesResult> | undefined;
let ocrDrainer: CoalescedBatchDrainer<ProcessQueuedOcrResult> | undefined;
let agentIngestDrainer: CoalescedBatchDrainer<ProcessQueuedCapturesResult> | undefined;
let agentTurnDrainer: CoalescedBatchDrainer<Awaited<ReturnType<HomeAgentService["resumeWaitingTurns"]>>> | undefined;
let indexRebuildDrainer: CoalescedBatchDrainer<ProcessQueuedIndexRebuildResult> | undefined;

type PackagedRuntimeSmokeStage =
  | "runtime_import"
  | "pi_runtime"
  | "home_runtime"
  | "renderer_window"
  | "renderer_load"
  | "renderer_probe"
  | "report_write";

interface PackagedRuntimeSmokeFailure {
  readonly stage: PackagedRuntimeSmokeStage;
  readonly checks?: {
    readonly titleReady: boolean;
    readonly rootReady: boolean;
    readonly preloadReady: boolean;
    readonly healthReady: boolean;
    readonly requiredRuntimeModulesReady: boolean;
    readonly missingRequiredRuntimeModuleIds: readonly string[];
  };
}

class PackagedRuntimeSmokeError extends Error {
  readonly failure: PackagedRuntimeSmokeFailure;

  constructor(failure: PackagedRuntimeSmokeFailure) {
    super(`Packaged runtime smoke failed at ${failure.stage}.`);
    this.failure = failure;
  }
}

const createMainWindow = (loadRenderer = true): BrowserWindow => {
  const browserWindow = new BrowserWindow({
    width: 420,
    height: 760,
    minWidth: 360,
    minHeight: 560,
    title: "Pige",
    backgroundColor: "#f8f8f5",
    ...getWindowShellOptions(process.platform),
    webPreferences: {
      preload: join(__dirname, "../preload", PRELOAD_ENTRY_FILENAME),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  installRendererNavigationGuard(browserWindow.webContents);
  mainWindows.add(browserWindow);
  browserWindow.once("closed", () => mainWindows.delete(browserWindow));

  getWindowModeService().applyStoredState(browserWindow);
  const publishLayoutChange = (): void => {
    const state = getWindowModeService().handleNativeLayoutChanged(browserWindow);
    if (state && !browserWindow.webContents.isDestroyed()) {
      browserWindow.webContents.send("window.layoutChanged", WindowLayoutStateSchema.parse(state));
    }
  };
  const publishDisplayLayoutChange = (): void => {
    const state = getWindowModeService().handleNativeLayoutChanged(browserWindow, "display");
    if (state && !browserWindow.webContents.isDestroyed()) {
      browserWindow.webContents.send("window.layoutChanged", WindowLayoutStateSchema.parse(state));
    }
  };
  browserWindow.on("resize", publishLayoutChange);
  browserWindow.on("move", publishLayoutChange);
  browserWindow.on("maximize", publishLayoutChange);
  browserWindow.on("unmaximize", publishLayoutChange);
  browserWindow.on("enter-full-screen", publishLayoutChange);
  browserWindow.on("leave-full-screen", publishLayoutChange);
  screen.on("display-metrics-changed", publishDisplayLayoutChange);
  screen.on("display-removed", publishDisplayLayoutChange);
  browserWindow.once("closed", () => {
    screen.removeListener("display-metrics-changed", publishDisplayLayoutChange);
    screen.removeListener("display-removed", publishDisplayLayoutChange);
  });

  if (!loadRenderer) return browserWindow;

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void browserWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    return browserWindow;
  }

  void browserWindow.loadFile(join(__dirname, "../renderer/index.html"));
  return browserWindow;
};

async function runPackagedRendererSmoke(browserWindow: BrowserWindow): Promise<{
  readonly title: "Pige";
  readonly rootReady: true;
  readonly preloadReady: true;
  readonly healthReady: true;
  readonly toolchainManifest: {
    readonly requiredRuntimeModulesReady: true;
    readonly missingBundledToolIds: readonly string[];
  };
}> {
  try {
    await browserWindow.loadFile(join(__dirname, "../renderer/index.html"));
  } catch {
    throw new PackagedRuntimeSmokeError({ stage: "renderer_load" });
  }

  let value: {
    readonly title?: unknown;
    readonly rootReady?: unknown;
    readonly preloadReady?: unknown;
    readonly health?: { readonly status?: unknown };
    readonly toolchain?: {
      readonly requiredRuntimeModulesReady?: unknown;
      readonly missingBundledToolIds?: unknown;
      readonly missingRequiredRuntimeModuleIds?: unknown;
    };
  };
  try {
    value = await browserWindow.webContents.executeJavaScript(`
      (async () => {
        const toolchain = await window.pige?.system?.toolchainHealth?.();
        const requiredRuntimeModuleIds = [
          "pdf-parser", "pdf-parser-runtime", "office-docx-parser", "office-openxml-parser",
          "office-archive-runtime", "web-readability-parser", "web-dom-runtime", "web-fetch-runtime"
        ];
        const statuses = new Map((toolchain?.tools ?? []).map((tool) => [tool.id, tool.status]));
        return {
          title: document.title,
          rootReady: Boolean(document.querySelector("#root")),
          preloadReady: typeof window.pige?.getHealth === "function",
          health: await window.pige?.getHealth?.(),
          toolchain: {
            requiredRuntimeModulesReady: requiredRuntimeModuleIds.every((id) => statuses.get(id) === "ready"),
            missingRequiredRuntimeModuleIds: requiredRuntimeModuleIds.filter((id) => statuses.get(id) !== "ready"),
            missingBundledToolIds: ["git", "bun", "uv"].filter((id) => statuses.get(id) === "missing")
          }
        };
      })()
    `) as typeof value;
  } catch {
    throw new PackagedRuntimeSmokeError({ stage: "renderer_probe" });
  }
  const missingRequiredRuntimeModuleIds = Array.isArray(value.toolchain?.missingRequiredRuntimeModuleIds)
    ? value.toolchain.missingRequiredRuntimeModuleIds.filter((id): id is string => typeof id === "string")
    : [];
  if (
    value.title !== "Pige" ||
    value.rootReady !== true ||
    value.preloadReady !== true ||
    value.health?.status !== "ok" ||
    value.toolchain?.requiredRuntimeModulesReady !== true ||
    !Array.isArray(value.toolchain.missingBundledToolIds) ||
    !value.toolchain.missingBundledToolIds.every((id) => typeof id === "string")
  ) {
    throw new PackagedRuntimeSmokeError({
      stage: "renderer_probe",
      checks: {
        titleReady: value.title === "Pige",
        rootReady: value.rootReady === true,
        preloadReady: value.preloadReady === true,
        healthReady: value.health?.status === "ok",
        requiredRuntimeModulesReady: value.toolchain?.requiredRuntimeModulesReady === true,
        missingRequiredRuntimeModuleIds
      }
    });
  }
  return {
    title: "Pige",
    rootReady: true,
    preloadReady: true,
    healthReady: true,
    toolchainManifest: {
      requiredRuntimeModulesReady: true,
      missingBundledToolIds: value.toolchain.missingBundledToolIds
    }
  };
}

const getLocalSettingsStore = (): LocalSettingsStore => {
  if (!localSettingsStore) {
    localSettingsStore = new LocalSettingsStore(app.getPath("userData"));
  }
  return localSettingsStore;
};

const getPermissionSettingsService = (): PermissionSettingsService => {
  if (!permissionSettingsService) {
    permissionSettingsService = new PermissionSettingsService(getLocalSettingsStore());
  }
  return permissionSettingsService;
};

const getVaultService = (): VaultService => {
  if (!vaultService) {
    vaultService = new VaultService(
      getLocalSettingsStore(),
      () => getModelProviderRegistry().hasDefaultRuntimeBinding()
    );
  }
  return vaultService;
};

const getWindowModeService = (): WindowModeService => {
  if (!windowModeService) {
    windowModeService = new WindowModeService(
      getLocalSettingsStore(),
      (bounds) => screen.getDisplayMatching(bounds).workArea
    );
  }
  return windowModeService;
};

const getBackupRestoreService = (): BackupRestoreService => {
  if (!backupRestoreService) {
    backupRestoreService = new BackupRestoreService({ userDataPath: app.getPath("userData") });
  }
  return backupRestoreService;
};

const getBackupCoordinatorService = (): BackupCoordinatorService => {
  if (!backupCoordinatorService) {
    backupCoordinatorService = new BackupCoordinatorService({
      vault: getVaultService(),
      backupService: getBackupRestoreService(),
      appVersion: app.getVersion(),
      writeBackupCreatedOperation: (input) => writeBackupCreatedOperation({
        job: input.job,
        vaultPath: input.vaultPath,
        vaultId: input.vaultId,
        backupId: input.backupId,
        archiveDigest: input.archiveDigest,
        assertVaultWriterLease: input.assertVaultWriterLease
      })
    });
  }
  return backupCoordinatorService;
};

const getRestoreCoordinatorService = (): RestoreCoordinatorService => {
  if (!restoreCoordinatorService) {
    restoreCoordinatorService = new RestoreCoordinatorService({
      userDataPath: app.getPath("userData"),
      appVersion: app.getVersion(),
      pathSafety: {
        appDataPath: app.getPath("appData"),
        tempPath: app.getPath("temp")
      },
      backupService: getBackupRestoreService(),
      vaultService: getVaultService(),
      pauseMutableWork: pauseMutableWorkForRestore,
      rebuildIndexes: async (vaultPath) => {
        const rebuilt = await getLocalDatabaseService().rebuildInWorker(vaultPath);
        getLocalDatabaseService().initialize(vaultPath);
        return rebuilt;
      }
    });
  }
  return restoreCoordinatorService;
};

const getAgentRuntimeService = (): AgentRuntimeService => {
  if (!agentRuntimeService) {
    agentRuntimeService = new AgentRuntimeService(
      getVaultService(),
      getModelProviderRegistry(),
      getLocalDatabaseService(),
      { snapshot: getAgentCapabilitySnapshot },
      getPermissionSettingsService()
    );
  }
  return agentRuntimeService;
};

const getAppearanceService = (): AppearanceService => {
  if (!appearanceService) {
    appearanceService = new AppearanceService(getLocalSettingsStore(), app.getLocale());
  }
  return appearanceService;
};

const getToolchainService = (): ToolchainService => {
  if (!toolchainService) {
    toolchainService = new ToolchainService(resolveToolchainManifestPath());
  }
  return toolchainService;
};

const getSpeechService = (): SpeechService => {
  if (!speechService) {
    speechService = new SpeechService({
      native: new MacOSSpeechAdapter(),
      permission: {
        canOpenSystemSettings: () => process.platform === "darwin",
        openSystemSettings: async () => {
          if (process.platform !== "darwin") return false;
          await shell.openExternal(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
          );
          return true;
        }
      },
      platform: process.platform,
      systemVersion: process.getSystemVersion()
    });
  }
  return speechService;
};

const getCaptureService = (): CaptureService => {
  if (!captureService) {
    captureService = new CaptureService(getVaultService());
  }
  return captureService;
};

const getModelEgressApprovalService = (): ModelEgressApprovalService => {
  if (!modelEgressApprovalService) {
    modelEgressApprovalService = new ModelEgressApprovalService({
      rootPath: app.getPath("userData"),
      assertWriterLease: (vaultPath) => getVaultService().assertWriterLease(vaultPath)
    });
  }
  return modelEgressApprovalService;
};

const getPermissionBrokerService = (): PermissionBrokerService => {
  if (!permissionBrokerService) {
    permissionBrokerService = new PermissionBrokerService({
      rootPath: app.getPath("userData"),
      assertWriterLease: (vaultPath) => getVaultService().assertWriterLease(vaultPath),
      permissionSettings: getPermissionSettingsService()
    });
  }
  return permissionBrokerService;
};

const getJobsService = (): JobsService => {
  if (!jobsService) {
    jobsService = new JobsService(
      getVaultService(),
      getAgentIngestService(),
      getLocalDatabaseService(),
      getDocumentParserService(),
      getOcrService(),
      getDatasetService(),
      getModelEgressApprovalService(),
      getPermissionBrokerService()
    );
  }
  return jobsService;
};

const getPermissionedExternalCapabilityRegistry = (): PermissionedExternalCapabilityRegistry => {
  if (!permissionedExternalCapabilityRegistry) {
    if (!firstPartyReadonlyNodeOsCapabilitiesRegistered) {
      for (const adapter of createFirstPartyReadonlyNodeOsCapabilityAdapters({
        protectedRoots: getReadonlyNodeOsProtectedRoots()
      })) {
        registerPermissionedExternalCapabilityAdapter(adapter);
      }
      firstPartyReadonlyNodeOsCapabilitiesRegistered = true;
    }
    permissionedExternalCapabilityRegistry = createPermissionedExternalCapabilityRegistry(
      getPermissionBrokerService(),
      getJobsService()
    );
  }
  return permissionedExternalCapabilityRegistry;
};

function getReadonlyNodeOsProtectedRoots(): readonly string[] {
  const home = app.getPath("home");
  return [
    app.getPath("userData"),
    app.getPath("sessionData"),
    app.getPath("logs"),
    app.getPath("crashDumps"),
    join(home, ".aws"),
    join(home, ".codex"),
    join(home, ".docker"),
    join(home, ".gnupg"),
    join(home, ".kube"),
    join(home, ".netrc"),
    join(home, ".npmrc"),
    join(home, ".ssh"),
    join(home, "Library", "Keychains")
  ];
}

const getDocumentParserService = (): DocumentParserService => {
  if (!documentParserService) documentParserService = new DocumentParserService();
  return documentParserService;
};

const getDatasetService = (): DatasetService => {
  if (!datasetService) datasetService = new DatasetService(new DatasetIngestWorkerService());
  return datasetService;
};

const getDatasetQueryService = (): DatasetQueryService => {
  if (!datasetQueryService) datasetQueryService = new DatasetQueryService();
  return datasetQueryService;
};

const getOcrService = (): OcrService => {
  if (!ocrService) ocrService = new OcrService();
  return ocrService;
};

const getAgentIngestService = (): AgentIngestService => {
  if (!agentIngestService) {
    agentIngestService = new AgentIngestService(getModelProviderRegistry(), undefined, {
      snapshot: getAgentCapabilitySnapshot
    }, undefined, undefined, createAgentIngestRetrievalPort(), createAgentIngestProposalPort(), getModelEgressApprovalService(), getPermissionSettingsService());
  }
  return agentIngestService;
};

const createAgentIngestRetrievalPort = (): AgentIngestRetrievalPort => ({
  search: (vaultPath, request) => {
    if (getVaultService().activeVaultPath() !== vaultPath) {
      throw new PigeDomainError(
        "vault.binding_changed",
        "The active vault changed before Agent-selected retrieval."
      );
    }
    const result = getRetrievalService().search(request);
    if (getVaultService().activeVaultPath() !== vaultPath) {
      throw new PigeDomainError(
        "vault.binding_changed",
        "The active vault changed during Agent-selected retrieval."
      );
    }
    return result;
  },
  listTags: (vaultPath) => {
    if (getVaultService().activeVaultPath() !== vaultPath) {
      throw new PigeDomainError(
        "vault.binding_changed",
        "The active vault changed before knowledge-tag catalog inspection."
      );
    }
    const tags = listMarkdownTagCatalog(vaultPath);
    if (getVaultService().activeVaultPath() !== vaultPath) {
      throw new PigeDomainError(
        "vault.binding_changed",
        "The active vault changed during knowledge-tag catalog inspection."
      );
    }
    return tags;
  }
});

const createAgentIngestProposalPort = (): AgentIngestProposalPort => ({
  findForJob: (vaultPath, jobId) => {
    assertAgentIngestVaultBinding(vaultPath, "before durable proposal recovery");
    const proposal = getProposalService().findForJob(jobId);
    assertAgentIngestVaultBinding(vaultPath, "during durable proposal recovery");
    return proposal;
  },
  stage: (vaultPath, request) => {
    assertAgentIngestVaultBinding(vaultPath, "before proposal staging");
    const result = getProposalService().stage(request);
    assertAgentIngestVaultBinding(vaultPath, "during proposal staging");
    return result;
  }
});

const assertAgentIngestVaultBinding = (vaultPath: string, boundary: string): void => {
  if (getVaultService().activeVaultPath() !== vaultPath) {
    throw new PigeDomainError(
      "vault.binding_changed",
      `The active vault changed ${boundary}.`
    );
  }
};

const getHomeAgentService = (): HomeAgentService => {
  if (!homeAgentService) {
    homeAgentService = new HomeAgentService(
      getVaultService(),
      getModelProviderRegistry(),
      getRetrievalService(),
      getJobsService(),
      undefined,
      { snapshot: getAgentCapabilitySnapshot },
      undefined,
      getHomeAgentUrlService(),
      getDatasetQueryService(),
      getModelEgressApprovalService(),
      getPermissionedExternalCapabilityRegistry(),
      getPermissionSettingsService()
    );
  }
  return homeAgentService;
};

const getHomeAgentUrlService = (): HomeAgentUrlService => {
  if (!homeAgentUrlService) {
    homeAgentUrlService = new HomeAgentUrlService(getCaptureService(), getJobsService());
  }
  return homeAgentUrlService;
};

const getAgentCapabilitySnapshot = (): AgentIngestCapabilitySnapshot => {
  const vaultPath = getVaultService().activeVaultPath();
  const localDatabaseStatus = vaultPath
    ? getLocalDatabaseService().status(vaultPath).status
    : "not_initialized";
  const parser = getDocumentParserService();
  const imageOcrReady = getOcrService().canOcr("image_file");
  return {
    localDatabaseStatus,
    parserToolchainReady: parser.canParse("pdf_file") && parser.canParse("docx_file") && parser.canParse("pptx_file"),
    datasetToolchainReady: getDatasetService().canMaterialize("csv_file") &&
      getDatasetService().canMaterialize("xlsx_file") &&
      getDatasetService().canMaterialize("sqlite_file"),
    ocrEngines: imageOcrReady && process.platform === "darwin" ? ["apple_vision"] : [],
    speechInputAvailable: false,
    embeddingModelInstalled: false,
    lexicalSearchAvailable: localDatabaseStatus === "ready",
    vectorSearchAvailable: false,
    rerankerAvailable: false
  };
};

const getLibraryService = (): LibraryService => {
  if (!libraryService) {
    libraryService = new LibraryService(getVaultService(), getLocalDatabaseService());
  }
  return libraryService;
};

const getNotesService = (): NotesService => {
  if (!notesService) {
    notesService = new NotesService(getVaultService(), getLocalDatabaseService());
  }
  return notesService;
};

const getReaderSelectionActionService = (): ReaderSelectionActionService => {
  if (!readerSelectionActionService) {
    readerSelectionActionService = new ReaderSelectionActionService(
      getVaultService(),
      getHomeAgentService()
    );
  }
  return readerSelectionActionService;
};

const getProposalService = (): ProposalService => {
  if (!proposalService) {
    proposalService = new ProposalService(getVaultService());
  }
  return proposalService;
};

const getKnowledgeActivityService = (): KnowledgeActivityService => {
  if (!knowledgeActivityService) {
    knowledgeActivityService = new KnowledgeActivityService(getVaultService());
  }
  return knowledgeActivityService;
};

const getRetrievalService = (): RetrievalService => {
  if (!retrievalService) {
    retrievalService = new RetrievalService(getVaultService(), getLocalDatabaseService());
  }
  return retrievalService;
};

const getDiagnosticsService = (): DiagnosticsService => {
  if (!diagnosticsService) {
    diagnosticsService = new DiagnosticsService(app.getPath("userData"));
  }
  return diagnosticsService;
};

const getLocalDatabaseService = (): LocalDatabaseService => {
  if (!localDatabaseService) {
    localDatabaseService = new LocalDatabaseService(undefined, new LocalDatabaseRebuildWorkerService());
  }
  return localDatabaseService;
};

const databaseInitializationRebuilds = new Set<string>();

const getModelProviderRegistry = (): ModelProviderRegistry => {
  if (!modelProviderRegistry) {
    modelProviderRegistry = new ModelProviderRegistry(
      app.getPath("userData"),
      new JsonSecretStore(app.getPath("userData"), safeStorage),
      undefined,
      undefined,
      {
        assertProviderInactive: (providerProfileId) => {
          const activeVaultPath = getVaultService().activeVaultPath();
          if (!activeVaultPath) return;
          const activeAgentJob = getJobsService().list({
            states: ["running", "cancel_requested"],
            classes: ["agent_turn", "agent_ingest"],
            limit: 1
          }).jobs[0];
          if (activeAgentJob) {
            throw new PigeDomainError(
              "model_provider.active_reference",
              "A running Agent Job still owns an active model runtime reference."
            );
          }
          getModelEgressApprovalService().assertProviderInactive(activeVaultPath, providerProfileId);
        }
      }
    );
  }
  return modelProviderRegistry;
};

const initializeActiveDatabase = (): void => {
  const activeVaultPath = getVaultService().activeVaultPath();
  if (activeVaultPath) {
    const status = getLocalDatabaseService().initialize(activeVaultPath);
    if (status.status !== "ready" && !databaseInitializationRebuilds.has(activeVaultPath)) {
      databaseInitializationRebuilds.add(activeVaultPath);
      void getJobsService().requestIndexRebuild().catch(() => {
        getDiagnosticsService().recordEvent({
          level: "warning",
          code: "database.index_rebuild.initialization_failed",
          message: "The local index still requires a rebuild after initialization."
        });
      }).finally(() => {
        databaseInitializationRebuilds.delete(activeVaultPath);
      });
    }
  }
};

const scheduleCaptureProcessing = (): void => {
  captureDrainer ??= new CoalescedBatchDrainer({
    runBatch: () => getJobsService().processQueuedCaptures({ limit: 20 }),
    onBatch: () => {
      scheduleParseProcessing();
      scheduleOcrProcessing();
      scheduleAgentIngestProcessing();
    },
    onError: () => recordBackgroundFailure(
      "capture.background_failed",
      "Background capture processing failed."
    )
  });
  captureDrainer.schedule();
};

const scheduleParseProcessing = (): void => {
  parseDrainer ??= new CoalescedBatchDrainer({
    runBatch: () => getJobsService().processQueuedParses({ limit: 20 }),
    onBatch: (result) => {
      if (result.agentReadySourceIds.length > 0) scheduleAgentIngestProcessing();
      if (result.ocrWaitingSourceIds.length > 0) scheduleOcrProcessing();
    },
    onError: () => recordBackgroundFailure(
      "parser.document.background_failed",
      "Background document parsing failed."
    )
  });
  parseDrainer.schedule();
};

const scheduleOcrProcessing = (): void => {
  ocrDrainer ??= new CoalescedBatchDrainer({
    runBatch: () => getJobsService().processQueuedOcr({ limit: 20 }),
    onBatch: (result) => {
      if (result.agentReadySourceIds.length > 0) scheduleAgentIngestProcessing();
    },
    onError: () => recordBackgroundFailure(
      "ocr.image.background_failed",
      "Background image OCR failed."
    )
  });
  ocrDrainer.schedule();
};

const scheduleAgentIngestProcessing = (): void => {
  agentIngestDrainer ??= new CoalescedBatchDrainer({
    runBatch: () => getJobsService().processQueuedAgentIngest({ limit: 20 }),
    onError: () => recordBackgroundFailure(
      "agent_ingest.background_failed",
      "Background Agent ingest failed."
    )
  });
  agentIngestDrainer.schedule();
};

const scheduleAgentTurnProcessing = (): void => {
  agentTurnDrainer ??= new CoalescedBatchDrainer({
    runBatch: () => getHomeAgentService().resumeWaitingTurns(20),
    onError: () => recordBackgroundFailure(
      "agent_runtime.turn_resume_failed",
      "Waiting Agent turns could not be resumed."
    )
  });
  agentTurnDrainer.schedule();
};

const scheduleIndexRebuildProcessing = (): void => {
  indexRebuildDrainer ??= new CoalescedBatchDrainer({
    runBatch: () => getJobsService().processQueuedIndexRebuild({ limit: 1 }),
    onError: () => recordBackgroundFailure(
      "database.index_rebuild.background_failed",
      "Background local index rebuild failed."
    )
  });
  indexRebuildDrainer.schedule();
};

const pauseMutableWorkForRestore = async (): Promise<() => void> => {
  const resumptions: (() => void)[] = [];
  try {
    for (const drainer of [
      captureDrainer,
      parseDrainer,
      ocrDrainer,
      agentIngestDrainer,
      agentTurnDrainer,
      indexRebuildDrainer
    ]) {
      if (drainer) resumptions.push(await drainer.pause());
    }
  } catch (caught) {
    for (const resume of resumptions.reverse()) resume();
    throw caught;
  }
  return () => {
    for (const resume of resumptions.reverse()) resume();
  };
};

const scheduleActivityIndexRebuild = (): void => {
  void getJobsService().requestIndexRebuild().catch(() => {
    getDiagnosticsService().recordEvent({
      level: "warning",
      code: "activity.index_rebuild_failed",
      message: "Local search needs a rebuild after knowledge Undo."
    });
  });
};

const recordBackgroundFailure = (code: string, fallback: string): void => {
  getDiagnosticsService().recordEvent({
    level: "warning",
    code,
    message: fallback
  });
};

const resumeBackgroundJobs = (): void => {
  void getBackupCoordinatorService().recoverInterrupted().then((backupRecovery) => {
    if (backupRecovery.recovered > 0 || backupRecovery.failed > 0) {
      getDiagnosticsService().recordEvent({
        level: backupRecovery.failed > 0 ? "warning" : "info",
        code: backupRecovery.failed > 0
          ? "backup.recovery_incomplete"
          : "backup.recovery_completed",
        message: backupRecovery.failed > 0
          ? "Some interrupted Backup Jobs still require repair."
          : "Interrupted Backup Jobs were reconciled from durable checkpoints."
      });
    }
  }).catch(() => {
    recordBackgroundFailure(
      "backup.recovery_incomplete",
      "Interrupted Backup Jobs could not be reconciled safely."
    );
  });
  try {
    const urlSourceHandoffs = getJobsService().reconcilePendingAgentTurnUrlSources();
    if (urlSourceHandoffs.linked > 0 || urlSourceHandoffs.failed > 0) {
      getDiagnosticsService().recordEvent({
        level: urlSourceHandoffs.failed > 0 ? "warning" : "info",
        code: urlSourceHandoffs.failed > 0
          ? "agent_runtime.url_source_handoff_conflict"
          : "agent_runtime.url_source_handoff_recovered",
        message: urlSourceHandoffs.failed > 0
          ? "An Agent-selected URL source handoff could not be reconciled safely."
          : "Agent-selected URL source handoffs were reconciled after startup."
      });
    }
    const sourceHandoffs = getJobsService().reconcilePendingAgentTurnSources();
    if (sourceHandoffs.linked > 0 || sourceHandoffs.failed > 0) {
      getDiagnosticsService().recordEvent({
        level: sourceHandoffs.failed > 0 ? "warning" : "info",
        code: sourceHandoffs.failed > 0
          ? "agent_runtime.source_handoff_conflict"
          : "agent_runtime.source_handoff_recovered",
        message: sourceHandoffs.failed > 0
          ? "A preserved Agent source handoff could not be reconciled safely."
          : "Preserved Agent source handoffs were reconciled after startup."
      });
    }
    const permissionRecovery = getJobsService().reconcilePermissionActions();
    if (permissionRecovery.reconciled > 0) {
      getDiagnosticsService().recordEvent({
        level: "info",
        code: "permission.action_reconciled",
        message: `Reconciled ${permissionRecovery.reconciled} body-free current-action permission decision(s).`
      });
    }
    const recovery = getJobsService().recoverInterruptedJobs();
    if (recovery.requeued > 0 || recovery.failedRetryable > 0) {
      getDiagnosticsService().recordEvent({
        level: "info",
        code: "jobs.interrupted_reconciled",
        message: `Recovered ${recovery.requeued} idempotent job(s); ${recovery.failedRetryable} job(s) require explicit retry.`
      });
    }
    const modelEgressRecovery = getJobsService().reconcileModelEgressApprovals();
    if (modelEgressRecovery.reconciled > 0) {
      getDiagnosticsService().recordEvent({
        level: "info",
        code: "model_egress.approval_reconciled",
        message: `Reconciled ${modelEgressRecovery.reconciled} body-free model egress decision(s).`
      });
    }
    getJobsService().requeueWaitingParses();
    getJobsService().requeueWaitingOcr();
    getJobsService().requeueWaitingAgentIngest();
    try {
      const activityRecovery = getKnowledgeActivityService().recoverIncompleteUndos();
      if (activityRecovery.recovered > 0) scheduleActivityIndexRebuild();
      if (activityRecovery.recovered > 0 || activityRecovery.failed > 0) {
        getDiagnosticsService().recordEvent({
          level: activityRecovery.failed > 0 ? "warning" : "info",
          code: activityRecovery.failed > 0 ? "activity.recovery_incomplete" : "activity.recovery_completed",
          message: activityRecovery.failed > 0
            ? "Some interrupted knowledge Undo work still requires repair."
            : "Interrupted knowledge Undo work was reconciled after startup."
        });
      }
    } catch {
      getDiagnosticsService().recordEvent({
        level: "warning",
        code: "activity.recovery_failed",
        message: "Knowledge Undo recovery could not inspect its durable records."
      });
    }
    void getJobsService().recoverProposalDecisions(getProposalService()).then((result) => {
      if (result.applied > 0 || result.rejected > 0 || result.conflicted > 0 || result.failed > 0) {
        getDiagnosticsService().recordEvent({
          level: result.failed > 0 ? "warning" : "info",
          code: result.failed > 0 ? "proposal.recovery_incomplete" : "proposal.recovery_completed",
          message: result.failed > 0
            ? "Some durable proposal decisions still require recovery."
            : "Durable proposal decisions were reconciled after startup."
        });
      }
    }).catch(() => {
      getDiagnosticsService().recordEvent({
        level: "warning",
        code: "proposal.recovery_failed",
        message: "Durable proposal decision recovery failed."
      });
    });
    scheduleCaptureProcessing();
    scheduleParseProcessing();
    scheduleOcrProcessing();
    scheduleAgentIngestProcessing();
    scheduleAgentTurnProcessing();
    scheduleIndexRebuildProcessing();
  } catch {
    getDiagnosticsService().recordEvent({
      level: "warning",
      code: "jobs.resume_failed",
      message: "Durable background job recovery failed."
    });
  }
};

const scheduleWaitingAgentIngestAfterModelReady = (): void => {
  try {
    const result = getJobsService().requeueWaitingAgentIngest();
    if (result.requeued > 0) {
      scheduleAgentIngestProcessing();
    }
    scheduleAgentTurnProcessing();
  } catch {
    getDiagnosticsService().recordEvent({
      level: "warning",
      code: "agent_ingest.requeue_failed",
      message: "Waiting Agent ingest requeue failed."
    });
  }
};

const isNeedsManualModelResult = (result: ProviderConnectResult): boolean =>
  "status" in result && result.status === "needs_manual_model";

ipcMain.handle("pige:getHealth", (): AppHealth => ({
  status: "ok",
  appVersion: app.getVersion(),
  checkedAt: new Date().toISOString()
}));

ipcMain.handle("window.current", (event) => getWindowModeService().current(requireWindow(event.sender)));
ipcMain.handle("window.currentLayout", (event) =>
  WindowLayoutStateSchema.parse(getWindowModeService().currentLayout(requireWindow(event.sender)))
);
ipcMain.handle("window.setLayout", (event, request: WindowLayoutRequest) => {
  const browserWindow = requireWindow(event.sender);
  const state = WindowLayoutStateSchema.parse(
    getWindowModeService().setLayout(browserWindow, WindowLayoutRequestSchema.parse(request))
  );
  if (!event.sender.isDestroyed()) event.sender.send("window.layoutChanged", state);
  return state;
});
ipcMain.handle("window.setMode", (event, request: SetWindowModeRequest) =>
  getWindowModeService().setMode(requireWindow(event.sender), request)
);
ipcMain.handle("window.setAlwaysOnTop", (event, request: SetAlwaysOnTopRequest) =>
  getWindowModeService().setAlwaysOnTop(requireWindow(event.sender), request)
);
ipcMain.handle("window.setSidebarOpen", (event, request: SetSidebarOpenRequest) =>
  getWindowModeService().setSidebarOpen(requireWindow(event.sender), request)
);
ipcMain.handle("speech.availability", (_event, request: SpeechAvailabilityRequest) =>
  getSpeechService().availability(SpeechAvailabilityRequestSchema.parse(request))
);
ipcMain.handle("speech.installLanguageAsset", async (event, request: SpeechAssetInstallRequest) => {
  const sender = event.sender;
  if (!speechTrackedSenders.has(sender.id)) {
    speechTrackedSenders.add(sender.id);
    sender.once("destroyed", () => {
      speechTrackedSenders.delete(sender.id);
      void getSpeechService().cancelOwner(sender.id);
    });
  }
  const parsed = SpeechAssetInstallRequestSchema.parse(request);
  const result = await getSpeechService().installLanguageAsset(sender.id, parsed, (installEvent) => {
    if (!sender.isDestroyed()) {
      sender.send("speech.assetInstallEvent", SpeechAssetInstallEventSchema.parse(installEvent));
    }
  });
  if (sender.isDestroyed()) await getSpeechService().cancelOwner(sender.id);
  return result;
});
ipcMain.handle("speech.start", async (event, request: SpeechStartRequest) => {
  const sender = event.sender;
  if (!speechTrackedSenders.has(sender.id)) {
    speechTrackedSenders.add(sender.id);
    sender.once("destroyed", () => {
      speechTrackedSenders.delete(sender.id);
      void getSpeechService().cancelOwner(sender.id);
    });
  }
  const parsed = SpeechStartRequestSchema.parse(request);
  const result = await getSpeechService().start(sender.id, parsed, (sessionEvent) => {
    if (!sender.isDestroyed()) {
      sender.send("speech.sessionEvent", SpeechSessionEventSchema.parse(sessionEvent));
    }
  });
  if (result.status === "started" && sender.isDestroyed()) {
    await getSpeechService().cancelOwner(sender.id);
  }
  return result;
});
ipcMain.handle("speech.stop", (event, request: SpeechSessionRequest) =>
  getSpeechService().stop(event.sender.id, SpeechSessionRequestSchema.parse(request))
);
ipcMain.handle("speech.cancel", (event, request: SpeechCancelRequest) =>
  getSpeechService().cancel(event.sender.id, SpeechCancelRequestSchema.parse(request))
);
ipcMain.handle("speech.openSystemSettings", () => getSpeechService().openSystemSettings());
ipcMain.handle("agent.runtimeStatus", () => getAgentRuntimeService().runtimeStatus());
ipcMain.handle("agent.ask", (_event, request: HomeAgentAskRequest) => getHomeAgentService().ask(request));
ipcMain.handle("agent.conversation", (_event, request?: AgentConversationRequest) =>
  getHomeAgentService().conversation(request)
);
ipcMain.handle("agent.submitTurn", async (event, payload: {
  readonly request: AgentSubmitTurnRequest;
  readonly filePaths?: readonly string[];
}) => {
  const filePaths = payload.filePaths ?? [];
  if (filePaths.length > 1) {
    throw new PigeDomainError(
      "agent_runtime.multiple_sources_not_ready",
      "Submit one attachment per Agent turn in this runtime build."
    );
  }
  const request = AgentSubmitTurnRequestSchema.parse(payload.request);
  const normalizedRequest: AgentSubmitTurnRequest = {
    schemaVersion: 1,
    inputKind: request.inputKind,
    locale: request.locale,
    ...(request.text === undefined ? {} : { text: request.text }),
    ...(request.objective === undefined ? {} : { objective: request.objective }),
    ...(request.scope === undefined ? {} : { scope: request.scope }),
    ...(request.clientTurnId === undefined ? {} : { clientTurnId: request.clientTurnId }),
    ...(request.conversationId === undefined ? {} : { conversationId: request.conversationId }),
    ...(request.expectedTailEventId === undefined ? {} : { expectedTailEventId: request.expectedTailEventId })
  };
  const draftPublisher = new AgentTurnDraftPublisher({
    clientTurnId: normalizedRequest.clientTurnId,
    send: (draft) => {
      if (!event.sender.isDestroyed()) event.sender.send("agent.turnDraft", draft);
    }
  });
  const draftContext = { onDraft: (draft: HomeAgentDraftSnapshot) => draftPublisher.publish(draft) };
  try {
    if (filePaths.length === 0) {
      return await getHomeAgentService().submitTurn(normalizedRequest, draftContext);
    }
    if (request.inputKind !== "file_drop" && request.inputKind !== "file_picker") {
      throw new PigeDomainError(
        "agent_runtime.turn_binding_invalid",
        "An attached source requires a file-drop or file-picker Agent input kind."
      );
    }
    const home = getHomeAgentService();
    const prepared = home.prepareSourceTurn(normalizedRequest);
    try {
      const preserved = await getCaptureService().preserveFilesForAgentTurn({
        filePaths,
        inputKind: request.inputKind === "file_drop" ? "file_drop" : "file_picker",
        userIntent: request.objective === "capture" ? "capture" : "unknown",
        locale: request.locale
      }, {
        jobId: prepared.jobId,
        sourceId: prepared.sourceId
      });
      if (
        preserved.status === "rejected" ||
        preserved.sourceIds.length !== 1 ||
        preserved.sourceIds[0] !== prepared.sourceId
      ) {
        home.failPreparedSourceTurn(prepared);
        throw new PigeDomainError("capture.file_rejected", "The selected attachment could not be preserved safely.");
      }
      return await home.submitPreparedSourceTurn(prepared, draftContext);
    } catch (caught) {
      home.failPreparedSourceTurn(prepared);
      throw caught;
    }
  } finally {
    draftPublisher.close();
  }
});
ipcMain.handle("jobs.list", (_event, request?: JobsListRequest) => getJobsService().list(request));
ipcMain.handle("jobs.cancel", async (_event, request: JobActionRequest): Promise<JobActionResult> => {
  const backup = await getBackupCoordinatorService().cancel(request);
  if (backup) {
    return projectBackupJobAction(
      backup.id,
      backup.state === "cancel_requested"
        ? "cancel_requested"
        : backup.state === "cancelled"
          ? "cancelled"
          : "not_allowed"
    );
  }
  return getJobsService().cancel(request);
});
ipcMain.handle("jobs.retry", async (_event, request: JobActionRequest) => {
  const backup = await getBackupCoordinatorService().retry(request);
  if (backup) {
    return {
      status: backup.status,
      job: getJobsService().summarize(backup.job)
    } satisfies JobActionResult;
  }
  const result = getJobsService().retry(request);
  if (result.status === "requeued" && result.job?.class === "capture") {
    scheduleCaptureProcessing();
  }
  if (result.status === "requeued" && result.job?.class === "parse") {
    scheduleParseProcessing();
  }
  if (result.status === "requeued" && result.job?.class === "ocr") {
    scheduleOcrProcessing();
  }
  if (result.status === "requeued" && result.job?.class === "agent_ingest") {
    scheduleAgentIngestProcessing();
  }
  if (result.status === "requeued" && result.job?.class === "agent_turn") {
    scheduleAgentIngestProcessing();
    scheduleAgentTurnProcessing();
  }
  if (result.status === "requeued" && result.job?.class === "index_rebuild") {
    scheduleIndexRebuildProcessing();
  }
  return result;
});
ipcMain.handle("modelEgress.pending", (_event, request: ModelEgressPendingRequestQuery) => {
  const parsed = ModelEgressPendingRequestQuerySchema.safeParse(request);
  if (!parsed.success) {
    throw new PigeDomainError("model_egress.approval_invalid", "The model egress request query is invalid.");
  }
  const pending = getJobsService().pendingModelEgress(parsed.data.requestId);
  if (pending === undefined) return undefined;
  const projected = ModelEgressPendingRequestSchema.safeParse(pending);
  if (!projected.success) {
    throw new PigeDomainError("model_egress.approval_store_invalid", "The model egress approval state is unavailable.");
  }
  return projected.data;
});
ipcMain.handle("modelEgress.resolve", (_event, request: ModelEgressResolveRequest) => {
  const parsed = ModelEgressResolveRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new PigeDomainError("model_egress.approval_invalid", "The model egress resolution is invalid.");
  }
  const result = getJobsService().resolveModelEgress(parsed.data);
  if (result.status === "approved") {
    scheduleAgentIngestProcessing();
    scheduleAgentTurnProcessing();
  }
  const projected = ModelEgressResolveResultSchema.safeParse(result);
  if (!projected.success) {
    throw new PigeDomainError("model_egress.approval_store_invalid", "The model egress decision result is unavailable.");
  }
  return projected.data;
});
ipcMain.handle("permissions.pending", (_event, request: PermissionPendingRequestQuery) => {
  const parsed = PermissionPendingRequestQuerySchema.safeParse(request);
  if (!parsed.success) {
    throw new PigeDomainError("permission.request_invalid", "The permission request query is invalid.");
  }
  const pending = getJobsService().pendingPermission(parsed.data.requestId);
  if (pending === undefined) return undefined;
  const projected = PermissionPendingRequestSchema.safeParse(pending);
  if (!projected.success) {
    throw new PigeDomainError("permission.store_invalid", "The pending permission state is unavailable.");
  }
  return projected.data;
});
ipcMain.handle("permissions.resolve", (_event, request: PermissionResolveRequest) => {
  const parsed = PermissionResolveRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new PigeDomainError("permission.request_invalid", "The permission decision is invalid.");
  }
  const result = getJobsService().resolvePermission(parsed.data);
  if (result.status === "approved") {
    scheduleAgentIngestProcessing();
    scheduleAgentTurnProcessing();
  }
  const projected = PermissionResolveResultSchema.safeParse(result);
  if (!projected.success) {
    throw new PigeDomainError("permission.store_invalid", "The permission decision result is unavailable.");
  }
  return projected.data;
});
ipcMain.handle("permissions.settings.current", () =>
  PermissionSettingsSummarySchema.parse(getPermissionSettingsService().current())
);
ipcMain.handle("permissions.settings.setDefaultMode", (_event, request: PermissionSetDefaultModeRequest) => {
  const parsed = PermissionSetDefaultModeRequestSchema.parse(request);
  return PermissionSettingsMutationResultSchema.parse(
    getPermissionSettingsService().setDefaultMode(parsed.expectedRevision, parsed.defaultMode)
  );
});
ipcMain.handle(
  "permissions.settings.prepareYoloEnable",
  async (event, request: PermissionPrepareYoloEnableRequest): Promise<PermissionPrepareYoloEnableResult> => {
    const parsed = PermissionPrepareYoloEnableRequestSchema.parse(request);
    const current = getPermissionSettingsService().current();
    if (current.revision !== parsed.expectedRevision) {
      return PermissionPrepareYoloEnableResultSchema.parse({
        status: "stale",
        revision: current.revision
      });
    }
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!parentWindow) throw new PigeDomainError("permission.settings_unavailable", "No active window owns permission settings.");
    const copy = getYoloConfirmationCopy();
    const response = await dialog.showMessageBox(parentWindow, {
      type: "warning",
      buttons: [copy.cancel, copy.confirm],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: copy.title,
      message: copy.message
    });
    if (response.response !== 1) {
      return PermissionPrepareYoloEnableResultSchema.parse({
        status: "cancelled",
        revision: getPermissionSettingsService().current().revision
      });
    }
    const confirmed = getPermissionSettingsService().current();
    if (confirmed.revision !== parsed.expectedRevision) {
      return PermissionPrepareYoloEnableResultSchema.parse({
        status: "stale",
        revision: confirmed.revision
      });
    }
    trackPermissionYoloSender(event.sender);
    return PermissionPrepareYoloEnableResultSchema.parse({
      status: "confirmation_ready",
      revision: confirmed.revision,
      ...permissionYoloConfirmationRegistry.issue(event.sender.id, confirmed.revision)
    });
  }
);
ipcMain.handle("permissions.settings.enableYolo", (event, request: PermissionEnableYoloRequest) => {
  const parsed = PermissionEnableYoloRequestSchema.parse(request);
  permissionYoloConfirmationRegistry.consume(
    event.sender.id,
    parsed.expectedRevision,
    parsed.confirmationToken
  );
  return PermissionSettingsMutationResultSchema.parse(
    getPermissionSettingsService().enableYolo(parsed.expectedRevision)
  );
});
ipcMain.handle("permissions.settings.disableYolo", (_event, request: PermissionDisableYoloRequest) => {
  const parsed = PermissionDisableYoloRequestSchema.parse(request);
  return PermissionSettingsMutationResultSchema.parse(
    getPermissionSettingsService().disableYolo(parsed.expectedRevision)
  );
});
ipcMain.handle("permissions.settings.revokeGrant", (_event, request: PermissionRevokeSavedGrantRequest) => {
  const parsed = PermissionRevokeSavedGrantRequestSchema.parse(request);
  return PermissionSettingsMutationResultSchema.parse(
    getPermissionSettingsService().revokeGrant(parsed.expectedRevision, parsed.grantId)
  );
});
ipcMain.handle("permissions.settings.revokeAllGrants", (_event, request: PermissionRevokeAllSavedGrantsRequest) => {
  const parsed = PermissionRevokeAllSavedGrantsRequestSchema.parse(request);
  return PermissionSettingsMutationResultSchema.parse(
    getPermissionSettingsService().revokeAllGrants(parsed.expectedRevision)
  );
});
ipcMain.handle("activity.list", (_event, request?: KnowledgeActivityListRequest) =>
  getKnowledgeActivityService().list(request)
);
ipcMain.handle("activity.undo", (_event, request: KnowledgeActivityUndoRequest) => {
  const result = getKnowledgeActivityService().undo(request);
  scheduleActivityIndexRebuild();
  return result;
});
ipcMain.handle("library.list", (_event, request?: LibraryListRequest) => getLibraryService().list(request));
ipcMain.handle("library.tree", () => getLibraryService().tree());
ipcMain.handle("library.related", (_event, request: LibraryRelatedRequest) => getLibraryService().related(request));
const notesTrackedSenders = new Map<number, string>();

function trackNotesSender(sender: WebContents): string {
  const existing = notesTrackedSenders.get(sender.id);
  if (existing) return existing;
  const ownerId = `notes_owner_${randomUUID()}`;
  notesTrackedSenders.set(sender.id, ownerId);
  sender.once("destroyed", () => {
    notesTrackedSenders.delete(sender.id);
    getNotesService().releaseOwner(ownerId);
  });
  return ownerId;
}

ipcMain.handle("notes.get", (_event, request: NoteGetRequest) => getNotesService().get(request));
ipcMain.handle("notes.render", (event, request: NoteRenderRequest) => {
  const sender = event.sender;
  const ownerId = trackNotesSender(sender);
  return getNotesService().render(request, ownerId).then((result) => {
    if (sender.isDestroyed() || notesTrackedSenders.get(sender.id) !== ownerId) {
      getNotesService().releaseOwner(ownerId);
      throw new PigeDomainError("note_render_stale", "The Reader owner changed while the page was rendered.");
    }
    return result;
  });
});
ipcMain.handle("notes.resolveInlineReference", (event, request: NoteResolveInlineReferenceRequest) => {
  const parsed = NoteResolveInlineReferenceRequestSchema.parse(request);
  const ownerId = notesTrackedSenders.get(event.sender.id);
  return NoteResolveInlineReferenceResultSchema.parse(
    ownerId === undefined
      ? { apiVersion: 1, requestId: parsed.requestId, status: "stale", scope: "render_context" }
      : getNotesService().resolveInlineReference(ownerId, parsed)
  );
});
ipcMain.handle("readerSelection.resolve", (event, request: ReaderSelectionResolveRequest) => {
  const parsed = ReaderSelectionResolveRequestSchema.parse(request);
  const ownerId = notesTrackedSenders.get(event.sender.id);
  return ReaderSelectionResolveResultSchema.parse(
    ownerId === undefined
      ? { apiVersion: 1, requestId: parsed.requestId, status: "stale", scope: "render_context" }
      : getNotesService().resolveSelection(ownerId, parsed)
  );
});
ipcMain.handle("readerSelection.submitAction", async (event, request: ReaderSelectionActionRequest) => {
  const parsed = ReaderSelectionActionRequestSchema.parse(request);
  const draftPublisher = new AgentTurnDraftPublisher({
    clientTurnId: parsed.clientTurnId,
    send: (draft) => {
      if (!event.sender.isDestroyed()) event.sender.send("agent.turnDraft", draft);
    }
  });
  try {
    return ReaderSelectionActionResultSchema.parse(
      await getReaderSelectionActionService().submit(parsed, {
        onDraft: (draft) => draftPublisher.publish(draft)
      })
    );
  } finally {
    draftPublisher.close();
  }
});

function proposalRendererBoundaryUnavailable(): never {
  throw new PigeDomainError(
    "proposal.renderer_preview_unavailable",
    "Proposal review is unavailable until a bounded renderer preview can be verified."
  );
}

ipcMain.handle("proposals.list", proposalRendererBoundaryUnavailable);
ipcMain.handle("proposals.get", proposalRendererBoundaryUnavailable);
ipcMain.handle("proposals.approve", proposalRendererBoundaryUnavailable);
ipcMain.handle("proposals.reject", proposalRendererBoundaryUnavailable);
ipcMain.handle("retrieval.search", (_event, request: unknown) =>
  handleRetrievalSearchIpc(request, getRetrievalService())
);
ipcMain.handle("retrieval.ask", (_event, request: RetrievalAskRequest) => getRetrievalService().ask(request));
ipcMain.handle("vault.current", () => getVaultService().current());
ipcMain.handle("vault.recent", () => getVaultService().recent());
ipcMain.handle("onboarding.status", () => getVaultService().onboardingStatus());
ipcMain.handle("onboarding.dismissFirstHome", () => getVaultService().dismissFirstHomeGuide());
ipcMain.handle("vault.create", async (event, request: CreateVaultRequest) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) throw new Error("No active window for vault creation.");
  const result = await getVaultService().create(parentWindow, request);
  if (result.status === "completed") {
    initializeActiveDatabase();
    resumeBackgroundJobs();
  }
  return result;
});
ipcMain.handle("vault.open", async (event) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) throw new Error("No active window for vault opening.");
  const result = await getVaultService().open(parentWindow);
  if (result.status === "completed") {
    initializeActiveDatabase();
    resumeBackgroundJobs();
  }
  return result;
});
ipcMain.handle("vault.openRecent", (_event, request: OpenRecentVaultRequest) => {
  const parsedRequest = OpenRecentVaultRequestSchema.parse(request);
  const result = getVaultService().openRecent(parsedRequest);
  initializeActiveDatabase();
  resumeBackgroundJobs();
  return VaultActionResultSchema.parse(result);
});
ipcMain.handle("vault.revealKnowledgeRoot", (event) => {
  requireWindow(event.sender);
  return getVaultService().revealKnowledgeRoot();
});
ipcMain.handle("vault.revealSourceAssetRoot", (event) => {
  requireWindow(event.sender);
  return getVaultService().revealSourceAssetRoot();
});
ipcMain.handle("vault.updateSourceStoragePolicy", (_event, request: UpdateSourceStoragePolicyRequest) =>
  getVaultService().updateSourceStoragePolicy(request)
);
ipcMain.handle("vault.removeRecent", (_event, vaultId: string) => getVaultService().removeRecent(vaultId));
ipcMain.handle("maintenance.rebuildLocalDatabase", () => getJobsService().requestIndexRebuild());
ipcMain.handle("maintenance.resetLocalDatabase", async (event) => {
  await confirmSettingAction(event.sender, ["maintenance.localDatabaseReset"], {
    title: "Reset local index data?",
    message: "Pige will delete and rebuild only local indexes, caches, and database state. Your notes and source evidence stay intact.",
    confirmLabel: "Reset local data"
  });
  const result = getVaultService().resetLocalDatabase();
  initializeActiveDatabase();
  return result;
});
ipcMain.handle("maintenance.localDatabaseStatus", () => {
  const activeVaultPath = getVaultService().activeVaultPath();
  if (!activeVaultPath) throw new Error("No active vault for local database status.");
  return getLocalDatabaseService().status(activeVaultPath);
});
ipcMain.handle("diagnostics.health", () => getDiagnosticsService().health());
ipcMain.handle("diagnostics.previewSupportBundle", () => {
  latestSupportBundlePreview = getDiagnosticsService().previewSupportBundle();
  return latestSupportBundlePreview;
});
ipcMain.handle("diagnostics.exportSupportBundle", async (event, request: ExportSupportBundleRequest) => {
  if (!request || !isDiagnosticsExportRequestId(request.exportRequestId)) {
    throw new Error("Support bundle export request is invalid.");
  }
  const preview = latestSupportBundlePreview;
  if (!preview || preview.previewId !== request.previewId) {
    throw new Error("Create a current support bundle preview before exporting.");
  }
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) throw new Error("No active window for support bundle export.");
  const selection = await dialog.showSaveDialog(parentWindow, {
    title: "Export Pige Support Bundle",
    defaultPath: `pige-support-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (selection.canceled || !selection.filePath) {
    return { status: "canceled" };
  }
  if (activeSupportBundleExports.has(request.exportRequestId) ||
    [...activeSupportBundleExports.values()].some((active) => active.senderId === event.sender.id)) {
    throw new Error("Support bundle export request is already active.");
  }
  const controller = new AbortController();
  const abortOnSenderDestroyed = (): void => controller.abort();
  event.sender.once("destroyed", abortOnSenderDestroyed);
  activeSupportBundleExports.set(request.exportRequestId, {
    senderId: event.sender.id,
    controller
  });
  try {
    return await getDiagnosticsService().exportSupportBundle(
      selection.filePath,
      preview,
      { signal: controller.signal }
    );
  } finally {
    event.sender.removeListener("destroyed", abortOnSenderDestroyed);
    const active = activeSupportBundleExports.get(request.exportRequestId);
    if (active?.controller === controller) activeSupportBundleExports.delete(request.exportRequestId);
  }
});
ipcMain.handle(
  "diagnostics.cancelSupportBundleExport",
  (event, request: CancelSupportBundleExportRequest): CancelSupportBundleExportResult => {
    if (!request || !isDiagnosticsExportRequestId(request.exportRequestId)) return { status: "not_found" };
    const active = activeSupportBundleExports.get(request.exportRequestId);
    if (!active || active.senderId !== event.sender.id) return { status: "not_found" };
    active.controller.abort();
    return { status: "cancel_requested" };
  }
);

function isDiagnosticsExportRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{16,64}$/u.test(value);
}
ipcMain.handle("models.summary", () => getModelProviderRegistry().summary());
ipcMain.handle("models.addPresetProvider", async (_event, request: AddPresetProviderRequest) => {
  const parsedRequest = AddPresetProviderRequestSchema.parse(request);
  const validatedRequest: AddPresetProviderRequest = {
    presetId: parsedRequest.presetId,
    ...(parsedRequest.apiKey ? { apiKey: parsedRequest.apiKey } : {})
  };
  return getModelProviderRegistry().addPresetProvider(validatedRequest).then((result) => {
    if (!isNeedsManualModelResult(result)) scheduleWaitingAgentIngestAfterModelReady();
    return result;
  });
});
ipcMain.handle("models.addManualProvider", async (_event, request: AddManualProviderRequest) => {
  const validatedRequest = AddManualProviderRequestSchema.parse(request) as AddManualProviderRequest;
  return getModelProviderRegistry().addManualProvider(validatedRequest).then((result) => {
    if (!isNeedsManualModelResult(result)) scheduleWaitingAgentIngestAfterModelReady();
    return result;
  });
});
ipcMain.handle("models.refreshProviderModels", async (_event, request: RefreshProviderModelsRequest) =>
  getModelProviderRegistry().refreshProviderModels(RefreshProviderModelsRequestSchema.parse(request))
);
ipcMain.handle("models.updateProviderCredential", async (event, request: UpdateProviderCredentialRequest) => {
  const validatedRequest = UpdateProviderCredentialRequestSchema.parse(request);
  await confirmSettingAction(event.sender, ["models.providerProfiles", "models.providerApiKeys"], {
    title: "Replace this model service credential?",
    message: "Pige will test the replacement credential without displaying the existing credential. The current credential remains active unless the replacement is verified and saved successfully.",
    confirmLabel: "Replace credential"
  });
  return getModelProviderRegistry().updateProviderCredential(validatedRequest);
});
ipcMain.handle("models.deleteProvider", async (event, request: DeleteProviderRequest) => {
  const validatedRequest = DeleteProviderRequestSchema.parse(request);
  await confirmSettingAction(event.sender, ["models.providerProfiles", "models.providerApiKeys"], {
    title: "Delete this model service?",
    message: "Pige will remove this Provider Profile, its protected credential reference, and its owned model profiles. If it owns the default model, Pige will select a usable remaining model or clear the default.",
    confirmLabel: "Delete service"
  });
  return getModelProviderRegistry().deleteProvider(validatedRequest);
});
ipcMain.handle("models.addManualModel", async (_event, request: AddManualModelRequest) =>
  {
    const parsed = AddManualModelRequestSchema.parse(request);
    return getModelProviderRegistry().addManualModel({
      providerProfileId: parsed.providerProfileId,
      modelId: parsed.modelId,
      ...(parsed.displayName === undefined ? {} : { displayName: parsed.displayName })
    });
  }
);
ipcMain.handle("models.updateModel", async (_event, request: UpdateModelRequest) => {
  const parsed = UpdateModelRequestSchema.parse(request);
  return getModelProviderRegistry().updateModel({
    modelProfileId: parsed.modelProfileId,
    ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
    ...(parsed.displayName === undefined ? {} : { displayName: parsed.displayName })
  });
}
);
ipcMain.handle("models.setDefaultModel", async (_event, request: SetDefaultModelRequest) => {
    const summary = await getModelProviderRegistry().setDefaultModel(SetDefaultModelRequestSchema.parse(request));
    scheduleWaitingAgentIngestAfterModelReady();
    return summary;
});
ipcMain.handle("settings.appearance", () => getAppearanceService().summary());
ipcMain.handle("settings.setLocale", (_event, request: SetLocaleRequest) => getAppearanceService().setLocale(request));
ipcMain.handle("settings.registry", () => getSettingsRegistry());
ipcMain.handle("backup.status", () => {
  const activeVault = getVaultService().current();
  if (!activeVault) return getBackupRestoreService().status(undefined);
  const lastBackup = getJobsService().list({
    classes: ["backup"],
    states: ["completed", "completed_with_warnings"],
    limit: 100
  }).jobs.find((job) => job.backupKind === "user_backup");
  return getBackupRestoreService().status({
    ...activeVault,
    ...(lastBackup ? { lastBackupAt: lastBackup.updatedAt } : {})
  });
});
ipcMain.handle("backup.create", async (event): Promise<BackupCreateResult> => {
  const activeVault = getVaultService().current();
  const activeVaultPath = getVaultService().activeVaultPath();
  if (!activeVault || !activeVaultPath) throw new Error("No active vault for backup creation.");
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) throw new Error("No active window for backup creation.");
  const selection = await dialog.showSaveDialog(parentWindow, {
    title: "Create Pige Backup",
    defaultPath: `${activeVault.name}-${new Date().toISOString().slice(0, 10)}.pige-backup.zip`,
    filters: [{ name: "Pige Backup", extensions: ["zip"] }]
  });
  if (selection.canceled || !selection.filePath) {
    return { status: "canceled" };
  }
  const job = await getBackupCoordinatorService().create(selection.filePath);
  if (job.state === "cancelled") return { status: "canceled" };
  if (job.state === "waiting_dependency") {
    throw new PigeDomainError(
      "backup.dependency_waiting",
      "The durable Backup Job is waiting for a required managed source location."
    );
  }
  if (job.state !== "completed" && job.state !== "completed_with_warnings") {
    throw new PigeDomainError(
      job.error?.code ?? "backup.execution_failed",
      "The durable Backup Job did not complete."
    );
  }
  const archivePath = job.outputRefs?.find((ref) => ref.role === "backup_archive")?.path;
  if (!archivePath) {
    throw new PigeDomainError("backup.job_conflict", "The completed Backup Job has no archive reference.");
  }
  const inspected = await getBackupRestoreService().inspectRestoreArchive(archivePath);
  return { status: "created", backupPath: archivePath, manifest: inspected.manifest };
});
ipcMain.handle("restore.preview", async (event): Promise<RestorePreviewResult> => {
  const senderId = event.sender.id;
  trackRestorePreviewSender(event.sender);
  const generation = restorePreviewRegistry.begin(senderId);
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) {
    restorePreviewRegistry.cancel(senderId, generation);
    throw new Error("No active window for restore preview.");
  }
  const selection = await dialog.showOpenDialog(parentWindow, {
    title: "Choose Pige Backup",
    properties: ["openFile"],
    filters: [{ name: "Pige Backup", extensions: ["zip"] }]
  });
  if (selection.canceled || selection.filePaths.length === 0 || !selection.filePaths[0]) {
    restorePreviewRegistry.cancel(senderId, generation);
    return { status: "canceled" };
  }
  try {
    const preview = await getBackupRestoreService().inspectRestoreArchive(selection.filePaths[0]);
    const accepted = restorePreviewRegistry.complete(senderId, generation, {
      backupPath: preview.backupPath,
      archivePreviewToken: preview.archivePreviewToken,
      archiveDigest: preview.archiveDigest,
      backupId: preview.backupId,
      backupIdSource: preview.backupIdSource,
      sourceVaultId: preview.sourceVaultId
    });
    const activeVault = getVaultService().current();
    const permittedModes = activeVault?.vaultId === preview.sourceVaultId
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
    restorePreviewRegistry.cancel(senderId, generation);
    throw caught;
  }
});
ipcMain.handle("restore.apply", async (event, request: RestoreApplyRequest): Promise<RestoreApplyResult> => {
  if (!request || typeof request.previewId !== "string") {
    throw new PigeDomainError("restore.backup_invalid", "Create a current restore preview before applying restore.");
  }
  const senderId = event.sender.id;
  const acceptedPreview = restorePreviewRegistry.claim(senderId, request);
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) {
    restorePreviewRegistry.release(senderId, acceptedPreview);
    throw new Error("No active window for restore.");
  }
  const restoreNativeCopy = RESTORE_NATIVE_COPY[getAppearanceService().summary().locale];
  let replaceConfirmed = false;
  if (acceptedPreview.mode === "replace_existing") {
    let activeSourceVaultId: string | undefined;
    try {
      activeSourceVaultId = getVaultService().current()?.vaultId;
    } catch (caught) {
      restorePreviewRegistry.release(senderId, acceptedPreview);
      throw caught;
    }
    if (activeSourceVaultId !== acceptedPreview.sourceVaultId) {
      restorePreviewRegistry.release(senderId, acceptedPreview);
      throw new PigeDomainError(
        "restore.replace_unavailable",
        "Replace existing requires the exact source vault to remain active."
      );
    }
    const confirmation = await dialog.showMessageBox(parentWindow, {
      type: "warning",
      buttons: [restoreNativeCopy.cancel, restoreNativeCopy.confirm],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: restoreNativeCopy.title,
      message: restoreNativeCopy.message
    }).catch((caught) => {
      restorePreviewRegistry.release(senderId, acceptedPreview);
      throw caught;
    });
    if (confirmation.response !== 1) {
      restorePreviewRegistry.release(senderId, acceptedPreview);
      return { status: "canceled" };
    }
    replaceConfirmed = true;
  }
  const selection = await dialog.showOpenDialog(parentWindow, {
    title: restoreNativeCopy.destinationPickerTitle,
    defaultPath: app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"]
  }).catch((caught) => {
    restorePreviewRegistry.release(senderId, acceptedPreview);
    throw caught;
  });
  if (selection.canceled || selection.filePaths.length === 0 || !selection.filePaths[0]) {
    restorePreviewRegistry.release(senderId, acceptedPreview);
    return { status: "canceled" };
  }
  if (!restorePreviewRegistry.isCurrent(senderId, acceptedPreview)) {
    throw new PigeDomainError("restore.backup_invalid", "The restore preview was superseded before apply.");
  }
  let result: RestoreApplyResult;
  try {
    result = await getRestoreCoordinatorService().apply({
      preview: acceptedPreview,
      destinationPath: createRestoreDestinationPath(selection.filePaths[0], acceptedPreview),
      replaceConfirmed
    });
  } catch (caught) {
    if (
      caught instanceof PigeDomainError &&
      (caught.code === "restore.backup_invalid" || caught.code === "restore.backup_changed")
    ) {
      restorePreviewRegistry.consume(senderId, acceptedPreview);
    } else {
      restorePreviewRegistry.release(senderId, acceptedPreview);
    }
    throw caught;
  }
  if (result.status !== "restored") {
    restorePreviewRegistry.release(senderId, acceptedPreview);
    return result;
  }
  restorePreviewRegistry.consume(senderId, acceptedPreview);
  resumeBackgroundJobs();
  return result;
});
ipcMain.handle("system.toolchainHealth", () => getToolchainService().health());

app.whenReady().then(async () => {
  const packagedRuntimeSmokeReportPath = resolvePackagedRuntimeSmokeReportPath();
  if (packagedRuntimeSmokeReportPath) {
    let smokeWindow: BrowserWindow | undefined;
    let smokeStage: PackagedRuntimeSmokeStage = "runtime_import";
    try {
      const smoke = await import(pathToFileURL(join(__dirname, "pi-agent-runtime-smoke.js")).href);
      smokeStage = "pi_runtime";
      const pi = await smoke.runPiAgentRuntimeSmoke();
      smokeStage = "home_runtime";
      const home = await smoke.runHomeAgentRuntimeSmoke();
      smokeStage = "renderer_window";
      smokeWindow = createMainWindow(false);
      smokeStage = "renderer_load";
      const renderer = await runPackagedRendererSmoke(smokeWindow);
      const runtimeIdentity = {
        appName: app.getName(),
        appVersion: app.getVersion(),
        isPackaged: app.isPackaged
      };
      smokeStage = "report_write";
      writeFileSync(packagedRuntimeSmokeReportPath, `${JSON.stringify({
        schemaVersion: 1,
        status: "passed",
        runtimeIdentity,
        pi,
        home,
        renderer
      })}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx"
      });
      smokeWindow.destroy();
      app.exit(0);
    } catch (caught) {
      const failure = caught instanceof PackagedRuntimeSmokeError
        ? caught.failure
        : { stage: smokeStage };
      try {
        writeFileSync(packagedRuntimeSmokeReportPath, `${JSON.stringify({
          schemaVersion: 1,
          status: "failed",
          failure
        })}\n`, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx"
        });
      } catch {
        // A report write failure must preserve the original fail-closed exit.
      }
      smokeWindow?.destroy();
      app.exit(1);
    }
    return;
  }

  localSettingsStore = new LocalSettingsStore(app.getPath("userData"));
  permissionSettingsService = new PermissionSettingsService(getLocalSettingsStore());
  appearanceService = new AppearanceService(getLocalSettingsStore(), app.getLocale());
  modelProviderRegistry = new ModelProviderRegistry(
    app.getPath("userData"),
    new JsonSecretStore(app.getPath("userData"), safeStorage)
  );
  vaultService = new VaultService(
    getLocalSettingsStore(),
    () => getModelProviderRegistry().hasDefaultRuntimeBinding()
  );
  windowModeService = new WindowModeService(
    getLocalSettingsStore(),
    (bounds) => screen.getDisplayMatching(bounds).workArea
  );
  localDatabaseService = new LocalDatabaseService(undefined, new LocalDatabaseRebuildWorkerService());
  backupRestoreService = new BackupRestoreService({ userDataPath: app.getPath("userData") });
  agentRuntimeService = new AgentRuntimeService(
    getVaultService(),
    getModelProviderRegistry(),
    getLocalDatabaseService(),
    { snapshot: getAgentCapabilitySnapshot },
    getPermissionSettingsService()
  );
  proposalService = new ProposalService(getVaultService());
  knowledgeActivityService = new KnowledgeActivityService(getVaultService());
  agentIngestService = new AgentIngestService(getModelProviderRegistry(), undefined, {
    snapshot: getAgentCapabilitySnapshot
  }, undefined, undefined, createAgentIngestRetrievalPort(), createAgentIngestProposalPort(), getModelEgressApprovalService(), getPermissionSettingsService());
  documentParserService = new DocumentParserService();
  datasetService = new DatasetService(new DatasetIngestWorkerService());
  ocrService = new OcrService();
  toolchainService = new ToolchainService(resolveToolchainManifestPath());
  captureService = new CaptureService(getVaultService());
  jobsService = new JobsService(
    getVaultService(),
    getAgentIngestService(),
    getLocalDatabaseService(),
    getDocumentParserService(),
    getOcrService(),
    getDatasetService(),
    getModelEgressApprovalService(),
    getPermissionBrokerService()
  );
  diagnosticsService = new DiagnosticsService(app.getPath("userData"));
  const restoreRecovery = await getRestoreCoordinatorService().recoverInterrupted();
  if (restoreRecovery.recovered > 0 || restoreRecovery.failed > 0) {
    diagnosticsService.recordEvent({
      level: restoreRecovery.failed > 0 ? "warning" : "info",
      code: restoreRecovery.failed > 0 ? "restore.recovery_incomplete" : "restore.recovery_completed",
      message: restoreRecovery.failed > 0
        ? "Some interrupted Restore Jobs still require repair."
        : "Interrupted Restore Jobs were reconciled from durable checkpoints."
    });
  }
  initializeActiveDatabase();
  diagnosticsService.recordEvent({ level: "info", code: "app.ready", message: "App ready." });
  createMainWindow();
  resumeBackgroundJobs();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  restoreCoordinatorService?.close();
  vaultService?.close();
});

function projectBackupJobAction(
  jobId: string,
  status: "cancel_requested" | "cancelled" | "requeued" | "not_allowed"
): JobActionResult {
  const job = getJobsService().list({ classes: ["backup"], limit: 100 }).jobs.find(
    (candidate) => candidate.id === jobId
  );
  return { status, ...(job ? { job } : {}) };
}

function createRestoreDestinationPath(
  parentPathInput: string,
  preview: { readonly mode: "clone_as_new" | "replace_existing"; readonly backupId: string; readonly sourceVaultId: string }
): string {
  const parentPath = resolve(parentPathInput);
  const sourceSuffix = preview.sourceVaultId.replace(/[^a-z0-9]/giu, "").slice(-8) || "vault";
  const backupSuffix = preview.backupId.replace(/[^a-z0-9]/giu, "").slice(-8) || "backup";
  const modeSuffix = preview.mode === "clone_as_new" ? "copy" : "recovered";
  return join(parentPath, `Pige-${modeSuffix}-${sourceSuffix}-${backupSuffix}`);
}

function requireWindow(webContents: WebContents): BrowserWindow {
  const parentWindow = BrowserWindow.fromWebContents(webContents);
  if (!parentWindow) throw new Error("No active Pige window.");
  return parentWindow;
}

function resolveToolchainManifestPath(): string {
  const fallback = join(process.cwd(), "resources/toolchain-manifest/toolchain.manifest.json");
  const candidates = [
    join(process.resourcesPath, "toolchain-manifest/toolchain.manifest.json"),
    join(process.cwd(), "../../resources/toolchain-manifest/toolchain.manifest.json"),
    fallback,
    join(app.getAppPath(), "resources/toolchain-manifest/toolchain.manifest.json"),
    join(app.getAppPath(), "../../resources/toolchain-manifest/toolchain.manifest.json")
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? fallback;
}

function resolvePackagedRuntimeSmokeReportPath(): string | undefined {
  if (!app.isPackaged) return undefined;
  const argument = process.argv.find((value) => value.startsWith(PACKAGED_RUNTIME_SMOKE_ARGUMENT));
  const requestedPath = argument?.slice(PACKAGED_RUNTIME_SMOKE_ARGUMENT.length);
  if (!requestedPath || !isAbsolute(requestedPath)) return undefined;
  const reportPath = resolve(requestedPath);
  const tempRoot = realpathSync(app.getPath("temp"));
  const reportParent = realpathSync(dirname(reportPath));
  const relativeParent = relative(tempRoot, reportParent);
  if (relativeParent === ".." || relativeParent.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(relativeParent)) {
    return undefined;
  }
  return reportPath;
}
