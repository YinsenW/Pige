import { describe, expect, it } from "vitest";
import {
  AppearanceSettingsSummarySchema,
  AppearanceThemeMutationResultSchema,
  BackupReconnectDependencyRequestSchema,
  BackupReconnectDependencyResultSchema,
  ConfirmationProposalSchema,
  ConversationEventSchema,
  FixtureManifestSchema,
  HighRiskConfirmationSummarySchema,
  JobRecordSchema,
  KnowledgeActivityListResultSchema,
  MachineLocalSettingsSchema,
  MarkdownPageStatusSchema,
  MarkdownPageTypeSchema,
  MemoryDeleteRequestSchema,
  MemoryEnableRequestSchema,
  MemoryExportRequestSchema,
  MemoryExportResultSchema,
  MemoryLifecycleMutationResultSchema,
  MemoryResetRequestSchema,
  NOTE_EDITOR_MAX_MARKDOWN_UTF8_BYTES,
  NoteEditorOpenRequestSchema,
  NoteEditorOpenResultSchema,
  NoteEditorPortableMarkdownSchema,
  NoteEditorSaveRequestSchema,
  NoteEditorSaveResultSchema,
  NoteOpenSourceReferenceRequestSchema,
  NoteOpenSourceReferenceResultSchema,
  RequirementIdSchema,
  SetThemeRequestSchema,
  SkillDiscardStagedRequestSchema,
  SkillDiscardStagedResultSchema,
  SkillInstallStagedRequestSchema,
  SkillInstallStagedResultSchema,
  SkillStageFromUrlRequestSchema,
  SkillStageFromUrlResultSchema,
  SourceRecordSchema,
  TaskExecutionPlanSchema,
  TaskExecutionPlanSummarySchema,
  TaskInteractionOpenRequestSchema,
  TaskInteractionOpenResultSchema,
  TaskInteractionPendingResultSchema,
  ToolchainManifestSchema,
  VaultConfigSchema,
  VaultManifestSchema,
  VaultRevealResultSchema,
  WindowLayoutRequestSchema,
  WindowLayoutStateSchema
} from "@pige/schemas";

describe("schemas", () => {
  it("keeps reviewed task plans private and browser interactions renderer-safe", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const planId = "plan_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const jobId = "job_20260727_abcdefgh";
    const summary = {
      planId,
      toolLabel: "Feishu CLI",
      resolvedVersion: "1.0.77",
      sourceOrigin: "https://registry.npmjs.org",
      integrities: [digest],
      stepCount: 6,
      destinationRoots: ["Pige managed tools", "Private Feishu config"],
      skillCount: 27,
      targetAgents: ["Codex", "Claude Code"],
      requiresBrowserOAuth: true
    } as const;
    expect(TaskExecutionPlanSummarySchema.parse(summary)).toEqual(summary);
    for (const unsafe of [
      { url: "https://accounts.feishu.cn/device" },
      { deviceCode: "PRIVATE-CODE" },
      { path: "/Users/private/.config" },
      { body: "PRIVATE OUTPUT" }
    ]) {
      expect(() => TaskExecutionPlanSummarySchema.parse({ ...summary, ...unsafe })).toThrow();
    }
    expect(() => TaskExecutionPlanSummarySchema.parse({
      ...summary,
      sourceOrigin: "https://registry.npmjs.org/package/path"
    })).toThrow();

    const confirmation = {
      apiVersion: 1,
      confirmationId: "confirm_20260727_abcdefghijklmnop",
      effect: "reviewed_execution_plan",
      presentation: {
        action: "execute_reviewed_plan",
        target: "local_toolchain",
        subject: { kind: "reviewed_execution_plan", value: "Feishu CLI", plan: summary }
      },
      owner: { kind: "agent_turn", clientTurnId: "turn_20260727_abcdefghijkl" }
    } as const;
    expect(HighRiskConfirmationSummarySchema.parse(confirmation)).toEqual(confirmation);
    expect(() => HighRiskConfirmationSummarySchema.parse({
      ...confirmation,
      presentation: {
        ...confirmation.presentation,
        subject: { ...confirmation.presentation.subject, argv: ["install", "secret"] }
      }
    })).toThrow();

    const plan = {
      planId,
      vaultId: "vault_20260709_abcdefgh",
      jobId,
      clientTurnId: "turn_20260727_abcdefghijkl",
      authoredTaskIntent: "explicit_user_task",
      policyHash: digest,
      toolCatalogHash: digest,
      recipeId: "official.feishu-cli.install-config-auth-status",
      recipeVersion: "1",
      recipeDigest: digest,
      actorId: "pige.task-execution",
      actorVersion: "1",
      actorDigest: digest,
      environment: {
        controlledHomeRoot: "/private/pige/home",
        configRoot: "/private/pige/config",
        sanitizedPathEntries: ["/private/pige/tools/bin"],
        descendantExecutableIdentities: ["/private/pige/tools/lark-cli"],
        canonicalWorkingDirectory: "/private/pige/task",
        temporaryDirectoryPolicy: "task_scoped",
        localeProfile: "en-US",
        npmRegistry: "https://registry.npmjs.org",
        npmPrefix: "/private/pige/npm-prefix",
        npmCache: "/private/pige/npm-cache",
        npmConfigProvenance: "/private/pige/npmrc",
        targetAgentRoots: ["/private/pige/agents/codex"],
        networkOrigins: ["https://registry.npmjs.org"],
        destinations: ["/private/pige/tools"],
        secretHandleVersions: { "feishu.oauth": "1" }
      },
      planDigest: digest,
      summary: { ...summary, stepCount: 1 },
      steps: [{
        ordinal: 1,
        adapterId: "pige.package-install",
        adapterVersion: "1",
        adapterDigest: digest,
        actionId: "install_cli_package",
        normalizedExecutableIdentity: "/private/pige/npm",
        argv: ["install", "@larksuite/cli@1.0.77"],
        canonicalWorkingDirectory: "/private/pige/task",
        environmentProfileHash: digest,
        networkOrigins: ["https://registry.npmjs.org"],
        destinations: ["/private/pige/tools"],
        interactionProtocol: "none",
        timeoutMs: 600_000,
        inputHash: digest,
        postconditionProbeId: "installed-cli-version",
        recoveryMode: "probe_then_adopt"
      }]
    } as const;
    expect(TaskExecutionPlanSchema.parse(plan)).toEqual(plan);
    expect(() => TaskExecutionPlanSchema.parse({
      ...plan,
      steps: [{ ...plan.steps[0], ordinal: 2 }]
    })).toThrow();

    const pending = {
      status: "browser_oauth",
      interactionId: "interaction_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      planId,
      jobId,
      stepOrdinal: 5,
      origin: "https://accounts.feishu.cn",
      revision: 3
    } as const;
    expect(TaskInteractionPendingResultSchema.parse(pending)).toEqual(pending);
    expect(TaskInteractionPendingResultSchema.parse({ status: "none" }))
      .toEqual({ status: "none" });
    for (const unsafe of [
      { url: "https://accounts.feishu.cn/device" },
      { deviceCode: "PRIVATE-CODE" },
      { path: "/private/config" },
      { body: "PRIVATE OUTPUT" }
    ]) {
      expect(() => TaskInteractionPendingResultSchema.parse({ ...pending, ...unsafe })).toThrow();
    }

    const openRequest = {
      interactionId: pending.interactionId,
      planId,
      jobId,
      stepOrdinal: 5,
      expectedRevision: 3
    } as const;
    expect(TaskInteractionOpenRequestSchema.parse(openRequest)).toEqual(openRequest);
    for (const status of ["opened", "stale", "not_found", "failed"] as const) {
      const result = status === "not_found" ? { status } : { status, revision: 3 };
      expect(TaskInteractionOpenResultSchema.parse(result)).toEqual(result);
    }
    expect(() => TaskInteractionOpenRequestSchema.parse({
      ...openRequest,
      url: "https://accounts.feishu.cn/device"
    })).toThrow();
  });

  it("keeps Backup reconnect identity strict and body-free", () => {
    const request = {
      apiVersion: 1,
      requestId: "backupreconnectreq_abcdefgh",
      activeVaultId: "vault_20260709_abcdefgh",
      waitingJobId: "job_20260709_abcdefgh"
    } as const;
    expect(BackupReconnectDependencyRequestSchema.parse(request)).toEqual(request);
    expect(() => BackupReconnectDependencyRequestSchema.parse({ ...request, dependencyId: "root_private" }))
      .toThrow();
    for (const status of ["resolved", "cancelled", "stale", "not_found", "failed"] as const) {
      expect(BackupReconnectDependencyResultSchema.parse({ ...request, status })).toEqual({ ...request, status });
    }
    expect(() => BackupReconnectDependencyResultSchema.parse({
      ...request,
      status: "failed",
      path: "/private/source-root",
      error: { code: "raw" }
    })).toThrow();
  });

  it("keeps saved-source Reader navigation strict and body-free", () => {
    const request = {
      apiVersion: 1,
      requestId: "noteref_abcdefghijklmnop",
      activeVaultId: "vault_20260709_abcdefgh",
      currentPageId: "page_20260709_current1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      sourceId: "src_20260709_source1234"
    } as const;

    expect(NoteOpenSourceReferenceRequestSchema.parse(request)).toEqual(request);
    expect(() => NoteOpenSourceReferenceRequestSchema.parse({ ...request, path: "/private/note.md" })).toThrow();
    expect(NoteOpenSourceReferenceResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      status: "resolved",
      target: { pageId: "page_20260709_source1234" }
    })).toEqual({
      apiVersion: 1,
      requestId: request.requestId,
      status: "resolved",
      target: { pageId: "page_20260709_source1234" }
    });
    for (const status of ["unresolved", "not_found", "stale", "mismatch", "changed"] as const) {
      expect(NoteOpenSourceReferenceResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        status
      })).toEqual({ apiVersion: 1, requestId: request.requestId, status });
    }
    expect(() => NoteOpenSourceReferenceResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      status: "not_found",
      sourceRecord: { path: "/private/source.json" }
    })).toThrow();
  });

  it("keeps Markdown editor identity revision-fenced and drafts exact", () => {
    const identity = {
      apiVersion: 1,
      requestId: "noteeditreq_abcdefghijklmnop",
      activeVaultId: "vault_20260727_abcdefgh",
      pageId: "page_20260727_editor1234"
    } as const;
    const renderContextId = "notectx_0123456789abcdef0123456789abcdef";
    const revision = `noteeditrev_${"a".repeat(32)}`;
    const markdown = "---\nid: page_20260727_editor1234\ntitle: Exact draft\ntype: note\n---\n\n  First line  \nSecond line\n";
    const openRequest = { ...identity, renderContextId } as const;
    const ready = {
      ...identity,
      status: "ready",
      renderContextId,
      revision,
      markdown
    } as const;

    expect(NoteEditorOpenRequestSchema.parse(openRequest)).toEqual(openRequest);
    expect(NoteEditorOpenResultSchema.parse(ready)).toEqual(ready);
    expect(NoteEditorPortableMarkdownSchema.parse(markdown)).toBe(markdown);
    expect(() => NoteEditorOpenRequestSchema.parse({ ...openRequest, path: "/private/note.md" })).toThrow();

    const saveRequest = {
      ...identity,
      renderContextId,
      expectedRevision: revision,
      markdown
    } as const;
    expect(NoteEditorSaveRequestSchema.parse(saveRequest)).toEqual(saveRequest);
    expect(NoteEditorSaveResultSchema.parse({
      ...identity,
      status: "committed",
      revision: `noteeditrev_${"b".repeat(32)}`,
      operationId: "op_20260727_editor1234",
      render: {
        summary: {
          pageId: identity.pageId,
          title: "Exact draft",
          pageType: "note",
          status: "active",
          pagePath: "notes/exact-draft.md",
          createdAt: "2026-07-27T10:00:00.000Z",
          updatedAt: "2026-07-27T10:01:00.000Z",
          language: "en",
          sourceIds: []
        },
        renderContextId: "notectx_fedcba9876543210fedcba9876543210",
        html: "<h1>Exact draft</h1>",
        byteSize: 20
      }
    })).toMatchObject({ status: "committed", operationId: "op_20260727_editor1234" });
    expect(NoteEditorSaveResultSchema.parse({
      ...identity,
      status: "stale",
      revision: `noteeditrev_${"c".repeat(32)}`
    })).toEqual({ ...identity, status: "stale", revision: `noteeditrev_${"c".repeat(32)}` });
    for (const reason of [
      "markdown_too_large",
      "invalid_frontmatter",
      "page_id_changed",
      "unsupported_page_type",
      "invalid_wiki_link",
      "invalid_citation"
    ] as const) {
      expect(NoteEditorSaveResultSchema.parse({ ...identity, status: "invalid", reason }))
        .toEqual({ ...identity, status: "invalid", reason });
    }
    for (const unsafe of [
      { path: "/private/note.md" },
      { hash: `sha256:${"d".repeat(64)}` },
      { error: { code: "raw_fs_error" } }
    ]) {
      expect(() => NoteEditorSaveResultSchema.parse({ ...identity, status: "failed", ...unsafe })).toThrow();
    }
    expect(() => NoteEditorPortableMarkdownSchema.parse(
      "😀".repeat(Math.floor(NOTE_EDITOR_MAX_MARKDOWN_UTF8_BYTES / 4) + 1)
    )).toThrow();
  });

  it("keeps vault Memory lifecycle CAS-bound, reversible, and pathless", () => {
    const identity = {
      apiVersion: 1,
      requestId: "memory_request_abcdefghijklmnop",
      activeVaultId: "vault_20260727_abcdefgh"
    } as const;
    const recordRequest = {
      ...identity,
      memoryId: "memory_20260727_abcdefghijkl",
      expectedRevision: 7
    } as const;
    const summary = {
      apiVersion: 1,
      activeVaultId: identity.activeVaultId,
      revision: 8,
      records: [{
        id: recordRequest.memoryId,
        kind: "preference",
        title: "Concise replies",
        body: "Prefer concise replies.",
        status: "active",
        provenance: { kind: "explicit_user_request", occurredAt: "2026-07-27T10:00:00.000Z" },
        createdAt: "2026-07-27T10:00:00.000Z",
        updatedAt: "2026-07-27T10:01:00.000Z"
      }]
    } as const;

    expect(MemoryEnableRequestSchema.parse(recordRequest)).toEqual(recordRequest);
    expect(MemoryDeleteRequestSchema.parse(recordRequest)).toEqual(recordRequest);
    const resetRequest = { ...identity, expectedRevision: 7 } as const;
    expect(MemoryResetRequestSchema.parse(resetRequest)).toEqual(resetRequest);
    expect(MemoryLifecycleMutationResultSchema.parse({
      ...identity,
      status: "committed",
      operationId: "op_20260727_memory01",
      summary
    })).toMatchObject({ status: "committed", operationId: "op_20260727_memory01" });
    for (const status of ["stale", "not_found"] as const) {
      expect(MemoryLifecycleMutationResultSchema.parse({ ...identity, status, summary }))
        .toEqual({ ...identity, status, summary });
    }
    expect(() => MemoryDeleteRequestSchema.parse({ ...recordRequest, path: "/private/memory.json" })).toThrow();
    expect(() => MemoryLifecycleMutationResultSchema.parse({
      ...identity,
      status: "committed",
      operationId: "op_20260727_memory01",
      summary,
      sourceEventId: "evt_private"
    })).toThrow();

    expect(MemoryExportRequestSchema.parse(resetRequest)).toEqual(resetRequest);
    for (const status of ["exported", "cancelled", "stale", "failed"] as const) {
      const result = { ...identity, revision: 7, status } as const;
      expect(MemoryExportResultSchema.parse(result)).toEqual(result);
    }
    expect(() => MemoryExportResultSchema.parse({
      ...identity,
      revision: 7,
      status: "exported",
      path: "/private/export.json",
      conversationId: "conversation_private",
      records: summary.records
    })).toThrow();
  });

  it("accepts only the bounded Reader transform input presentation", () => {
    const event = {
      schemaVersion: 1,
      id: "evt_20260718_transformpresentation",
      conversationId: "conv_20260718_transform",
      type: "user_message",
      createdAt: "2026-07-18T12:00:00.000Z",
      text: "HOST_EXECUTION_INSTRUCTION",
      inputPresentation: {
        kind: "reader_selection_transform",
        action: "translate"
      }
    };

    expect(ConversationEventSchema.parse(event).inputPresentation).toEqual({
      kind: "reader_selection_transform",
      action: "translate"
    });
    expect(() => ConversationEventSchema.parse({
      ...event,
      inputPresentation: {
        ...event.inputPresentation,
        selectedText: "PRIVATE_SELECTION"
      }
    })).toThrow();
    expect(() => ConversationEventSchema.parse({
      ...event,
      inputPresentation: {
        kind: "reader_selection_transform",
        action: "rewrite"
      }
    })).toThrow();
  });

  it("validates the renderer-safe resident pane layout boundary", () => {
    expect(
      WindowLayoutRequestSchema.parse({
        apiVersion: 1,
        surface: "reader",
        sidebarOpen: true,
        noteAgentOpen: true
      })
    ).toEqual({
      apiVersion: 1,
      surface: "reader",
      sidebarOpen: true,
      noteAgentOpen: true
    });
    expect(() =>
      WindowLayoutRequestSchema.parse({
        apiVersion: 1,
        surface: "home",
        sidebarOpen: false,
        noteAgentOpen: true
      })
    ).toThrow();
    expect(() =>
      WindowLayoutRequestSchema.parse({
        apiVersion: 1,
        surface: "reader",
        sidebarOpen: true,
        noteAgentOpen: false,
        width: 1240
      })
    ).toThrow();

    expect(
      WindowLayoutStateSchema.parse({
        apiVersion: 1,
        revision: 4,
        surface: "reader",
        sidebarOpen: true,
        noteAgentOpen: true,
        sidebarPresentation: "resident",
        noteAgentPresentation: "overlay",
        autoExpanded: true,
        isMaximized: false,
        isFullScreen: false
      })
    ).toMatchObject({ revision: 4, sidebarPresentation: "resident", noteAgentPresentation: "overlay" });
    expect(() =>
      WindowLayoutStateSchema.parse({
        apiVersion: 1,
        revision: 4,
        surface: "reader",
        sidebarOpen: false,
        noteAgentOpen: false,
        sidebarPresentation: "resident",
        noteAgentPresentation: "closed",
        autoExpanded: false,
        isMaximized: false,
        isFullScreen: false
      })
    ).toThrow();
    expect(() =>
      WindowLayoutStateSchema.parse({
        apiVersion: 1,
        revision: 5,
        surface: "reader",
        sidebarOpen: true,
        noteAgentOpen: true,
        sidebarPresentation: "overlay",
        noteAgentPresentation: "resident",
        autoExpanded: false,
        isMaximized: false,
        isFullScreen: false
      })
    ).toThrow();
  });

  it("validates requirement IDs", () => {
    expect(RequirementIdSchema.parse("PIGE-REPO-004")).toBe("PIGE-REPO-004");
  });

  it("validates Markdown page type and status values", () => {
    expect(MarkdownPageTypeSchema.parse("source")).toBe("source");
    expect(MarkdownPageStatusSchema.parse("needs_review")).toBe("needs_review");
  });

  it("validates empty fixture manifests", () => {
    expect(FixtureManifestSchema.parse({ schemaVersion: 1, fixtures: [] })).toEqual({
      schemaVersion: 1,
      fixtures: []
    });
  });

  it("validates vault manifest and config files", () => {
    expect(
      VaultManifestSchema.parse({
        vault_id: "vault_20260709_ab12cd",
        vault_schema_version: 1,
        created_at: "2026-07-09T00:00:00.000Z",
        updated_at: "2026-07-09T00:00:00.000Z",
        app_min_version: "0.1.0",
        default_locale: "zh-Hans",
        durable_roots: ["raw", ".pige/conversations"],
        rebuildable_roots: [".pige/db"]
      }).vault_id
    ).toBe("vault_20260709_ab12cd");

    expect(
      VaultConfigSchema.parse({
        schemaVersion: 1,
        sourceStorage: {
          defaultStrategy: "copy_to_source_library",
          sourceAssetRootKind: "inside_vault",
          inVaultSourceAssetRoot: "raw"
        },
        backup: {
          includeConversations: true,
          includeVaultMemory: true,
          includeTrash: true
        },
        memory: {
          vaultMemoryEnabled: true
        }
      }).sourceStorage.defaultStrategy
    ).toBe("copy_to_source_library");
  });

  it("accepts only canonical portable in-vault source roots", () => {
    const baseConfig = {
      schemaVersion: 1 as const,
      sourceStorage: {
        defaultStrategy: "copy_to_source_library" as const,
        sourceAssetRootKind: "inside_vault" as const,
        inVaultSourceAssetRoot: "raw/files"
      },
      backup: {
        includeConversations: true,
        includeVaultMemory: true,
        includeTrash: true
      },
      memory: { vaultMemoryEnabled: true }
    };

    expect(VaultConfigSchema.parse(baseConfig).sourceStorage.inVaultSourceAssetRoot).toBe("raw/files");
    for (const unsafeRoot of [
      "",
      ".",
      "..",
      "../raw",
      "raw/../outside",
      "raw/./files",
      "raw//files",
      "raw/",
      "/tmp/raw",
      "C:/raw",
      "raw\\files",
      " raw"
    ]) {
      expect(() => VaultConfigSchema.parse({
        ...baseConfig,
        sourceStorage: { ...baseConfig.sourceStorage, inVaultSourceAssetRoot: unsafeRoot }
      })).toThrow();
    }
  });

  it("keeps vault reveal results strict and pathless", () => {
    expect(VaultRevealResultSchema.parse({
      status: "revealed",
      target: "knowledge_root"
    })).toEqual({ status: "revealed", target: "knowledge_root" });
    expect(VaultRevealResultSchema.parse({
      status: "failed",
      target: "source_asset_root",
      error: {
        code: "vault.reveal_failed",
        domain: "vault",
        messageKey: "errors.vault.reveal_failed",
        retryable: true,
        severity: "warning",
        userAction: "retry"
      }
    })).toMatchObject({ status: "failed", target: "source_asset_root" });
    expect(() => VaultRevealResultSchema.parse({
      status: "revealed",
      target: "knowledge_root",
      path: "/redacted-test/vault"
    })).toThrow();
    expect(() => VaultRevealResultSchema.parse({
      status: "failed",
      target: "source_asset_root",
      error: {
        code: "vault.reveal_failed",
        domain: "vault",
        messageKey: "errors.vault.reveal_failed",
        retryable: true,
        severity: "warning",
        userAction: "retry",
        redactedDetails: { path: "/redacted-test/vault" }
      }
    })).toThrow();
  });

  it("validates machine-local window preferences", () => {
    const settings = MachineLocalSettingsSchema.parse({
      schemaVersion: 1,
      appLocale: "en",
      window: {
        mode: "compact",
        alwaysOnTop: false,
        sidebarOpen: true,
        compactSize: { width: 420, height: 760 }
      },
      dismissedFirstHomeVaultIds: ["vault_20260709_ab12cd"],
      updates: {
        revision: 2,
        channel: "alpha",
        lastCheck: {
          phase: "failed",
          checkedAt: "2026-07-18T08:00:00.000Z"
        }
      },
      recentVaults: []
    });

    expect(settings.window?.mode).toBe("compact");
    expect(settings.appLocale).toBe("en");
    expect(settings.window?.sidebarOpen).toBe(true);
    expect(settings.dismissedFirstHomeVaultIds).toEqual(["vault_20260709_ab12cd"]);
    expect(settings.updates).toMatchObject({ revision: 2, channel: "alpha", lastCheck: { phase: "failed" } });
  });

  it("validates a pathless Activity page target projection", () => {
    const result = KnowledgeActivityListResultSchema.parse({
      scannedAt: "2026-07-18T00:00:00.000Z",
      activeVaultId: "vault_20260718_activitysafe",
      total: 1,
      invalidOperationCount: 0,
      activities: [{
        operationId: "op_20260718_activitysafe",
        kind: "create_page",
        createdAt: "2026-07-18T00:00:00.000Z",
        targetLabel: "Activity page",
        target: { kind: "page", pageId: "page_20260718_activitysafe" },
        status: "applied",
        canUndo: true
      }]
    });
    expect(result.activities[0]?.target).toEqual({
      kind: "page",
      pageId: "page_20260718_activitysafe"
    });
    expect(() => KnowledgeActivityListResultSchema.parse({
      ...result,
      activities: [{ ...result.activities[0], path: "/private/vault/page.md" }]
    })).toThrow();
  });

  it("strictly validates appearance summaries, CAS requests, and machine-local persistence", () => {
    const summary = AppearanceSettingsSummarySchema.parse({
      apiVersion: 1,
      locale: "en",
      availableLocales: ["en", "zh-Hans"],
      themePreference: "system",
      effectiveTheme: "dark",
      revision: 4
    });
    expect(SetThemeRequestSchema.parse({ themePreference: "light", expectedRevision: 4 })).toEqual({
      themePreference: "light",
      expectedRevision: 4
    });
    expect(AppearanceThemeMutationResultSchema.parse({ status: "stale", settings: summary }).status).toBe("stale");
    expect(MachineLocalSettingsSchema.parse({
      schemaVersion: 1,
      appearance: { revision: 4, themePreference: "system" },
      recentVaults: []
    }).appearance).toEqual({ revision: 4, themePreference: "system" });

    expect(() => SetThemeRequestSchema.parse({ themePreference: "sepia", expectedRevision: 4 })).toThrow();
    expect(() => SetThemeRequestSchema.parse({
      themePreference: "dark",
      expectedRevision: 4,
      rawCss: "body{}"
    })).toThrow();
  });

  it("validates toolchain manifests", () => {
    const manifest = ToolchainManifestSchema.parse({
      schemaVersion: 1,
      tools: [
        {
          id: "git",
          name: "Git",
          required: true,
          bundledPath: "../../vendor/toolchain/git/bin/git",
          repairHint: "Install bundled Git."
        },
        {
          id: "pdf-parser",
          name: "PDF parser",
          required: true,
          bundledModule: "pdfjs-dist/package.json"
        }
      ]
    });

    expect(manifest.tools[0]?.id).toBe("git");
    expect(manifest.tools[1]?.bundledModule).toBe("pdfjs-dist/package.json");
    expect(() => ToolchainManifestSchema.parse({
      schemaVersion: 1,
      tools: [{ id: "invalid", name: "Invalid", required: true }]
    })).toThrow();
  });

  it("validates file source records and canonical job states", () => {
    const sourceRecord = SourceRecordSchema.parse({
      id: "src_20260709_abcdef123456",
      kind: "markdown_file",
      storageStrategy: "copy_to_source_library",
      original: {
        uri: "file:///tmp/source.md",
        path: "/tmp/source.md",
        displayName: "source.md",
        lastKnownMtime: "2026-07-09T00:00:00.000Z",
        lastKnownSize: 12,
        checksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      managedCopy: {
        path: "raw/files/2026/07/src_20260709_abcdef123456.md",
        checksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        size: 12
      },
      artifacts: [{
        id: "art_20260709_abcdef123456_text",
        kind: "extracted_text",
        path: "artifacts/extracted-text/2026/07/src_20260709_abcdef123456.txt",
        checksum: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        size: 42
      }],
      metadata: {},
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z"
    });
    const jobRecord = JobRecordSchema.parse({
      id: "job_20260709_abcdef123456",
      class: "capture",
      state: "failed_retryable",
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
      sourceId: sourceRecord.id,
      message: "Retryable capture failure."
    });

    expect(sourceRecord.original?.displayName).toBe("source.md");
    expect(sourceRecord.artifacts[0]?.size).toBe(42);
    expect(jobRecord.state).toBe("failed_retryable");
  });

  it("validates durable confirmation proposals and preserves future extension fields", () => {
    const proposal = ConfirmationProposalSchema.parse({
      id: "proposal_20260709_abcdef123456",
      schemaVersion: 1,
      jobId: "job_20260709_abcdef123456",
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
      state: "ready",
      trustLevel: "review_required",
      summary: "Review a proposed note edit.",
      reason: "The change touches an existing wiki page.",
      sourceRefs: [{ kind: "job", id: "job_20260709_abcdef123456" }],
      targetRefs: [{ kind: "page", id: "page_20260709_abcdef123456", path: "wiki/note.md" }],
      proposedOperations: [
        {
          kind: "update",
          path: "wiki/note.md",
          beforeSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          content: "# Updated note\n"
        }
      ],
      diffRefs: [],
      warnings: [],
      baseHashes: {
        "wiki/note.md": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      futureRemoteAgentField: "preserved"
    });

    expect(proposal.state).toBe("ready");
    expect(proposal.futureRemoteAgentField).toBe("preserved");
  });

  it("keeps URL Skill staging explicit, immutable, and renderer-safe", () => {
    const requestId = "skillreq_abcdefghijklmnop";
    const stagingId = `skillstage_${"a".repeat(32)}`;
    const manifestSha256 = `sha256:${"b".repeat(64)}`;
    const sourceUrl = "https://example.com/skills/paper-reading/SKILL.md";
    const stageRequest = { apiVersion: 1, requestId, sourceUrl } as const;
    expect(SkillStageFromUrlRequestSchema.parse(stageRequest)).toEqual(stageRequest);
    for (const unsafeUrl of [
      "http://example.com/SKILL.md",
      "https://user:secret@example.com/SKILL.md",
      "https://example.com/SKILL.md?token=secret",
      "https://example.com/SKILL.md#private"
    ]) {
      expect(() => SkillStageFromUrlRequestSchema.parse({ ...stageRequest, sourceUrl: unsafeUrl })).toThrow();
    }

    const staged = {
      stagingId,
      manifestSha256,
      registryRevision: 4,
      expiresAt: "2026-07-27T12:00:00.000Z",
      sourceUrl,
      id: "paper-reading",
      name: "Paper Reading",
      version: "1.0.0",
      description: "Review papers with source-aware prompts.",
      scope: "machine_local",
      kind: "pure",
      capabilities: ["read_current_source"],
      dataBoundaries: ["local"],
      files: [{ relativePath: "SKILL.md", utf8ByteSize: 1024, sha256: manifestSha256 }],
      warnings: ["untrusted_remote_source"]
    } as const;
    const stageResult = { status: "ready", requestId, staged } as const;
    expect(SkillStageFromUrlResultSchema.parse(stageResult)).toEqual(stageResult);
    for (const unsafe of [{ body: "private" }, { path: "/tmp/staged" }, { sourceBytes: "private" }]) {
      expect(() => SkillStageFromUrlResultSchema.parse({ ...stageResult, ...unsafe })).toThrow();
    }

    const installRequest = {
      apiVersion: 1,
      requestId,
      stagingId,
      manifestSha256,
      expectedRegistryRevision: 4,
      enabled: true
    } as const;
    expect(SkillInstallStagedRequestSchema.parse(installRequest)).toEqual(installRequest);
    const registry = { apiVersion: 1, revision: 5, invalidManifestCount: 0, skills: [] } as const;
    expect(SkillInstallStagedResultSchema.parse({ status: "committed", requestId, registry }))
      .toEqual({ status: "committed", requestId, registry });

    const discardRequest = { apiVersion: 1, requestId, stagingId, manifestSha256 } as const;
    expect(SkillDiscardStagedRequestSchema.parse(discardRequest)).toEqual(discardRequest);
    expect(SkillDiscardStagedResultSchema.parse({ status: "discarded", requestId }))
      .toEqual({ status: "discarded", requestId });
  });
});
