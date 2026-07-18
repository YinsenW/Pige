import { describe, expect, it } from "vitest";
import {
  AddManualProviderRequestSchema,
  AddPresetProviderRequestSchema,
  DeleteProviderRequestSchema,
  ModelEgressApprovalRequestRecordSchema,
  ModelEgressDecisionSchema,
  ModelEgressPendingRequestQuerySchema,
  ModelEgressPendingRequestSchema,
  ModelEgressResolveRequestSchema,
  ModelEgressResolveResultSchema,
  NoteResolveInlineReferenceRequestSchema,
  NoteResolveInlineReferenceResultSchema,
  PermissionActionBindingSchema,
  PermissionActionLifecycleRecordSchema,
  PermissionDecisionRecordSchema,
  PermissionPendingRequestQuerySchema,
  PermissionPendingRequestSchema,
  PermissionRequestSchema,
  PermissionResolveRequestSchema,
  PermissionResolveResultSchema,
  PermissionMachineSettingsSchema,
  PermissionSettingsSummarySchema,
  PermissionEnableYoloRequestSchema,
  PigeErrorSummarySchema,
  ProviderProfileSchema,
  ReaderSelectionActionRequestSchema,
  ReaderSelectionActionResultSchema,
  ReaderSelectionTransformRequestSchema,
  ReaderSelectionTransformResultSchema,
  ReaderSelectionResolveRequestSchema,
  ReaderSelectionResolveResultSchema,
  UpdateProviderCredentialRequestSchema
} from "@pige/schemas";

const timestamp = "2026-07-10T00:00:00.000Z";
const policyHash = `sha256:${"a".repeat(64)}`;

describe("security-sensitive shared contracts", () => {
  it("keeps inline note reference requests bounded and results pathless", () => {
    const request = {
      apiVersion: 1 as const,
      requestId: "noteref_abcdefghijklmnop",
      activeVaultId: "vault_20260710_abcdef12",
      currentPageId: "page_20260710_abcdef12",
      renderContextId: `notectx_${"a".repeat(32)}`,
      href: "#wiki:Product%20Positioning"
    };
    expect(NoteResolveInlineReferenceRequestSchema.parse(request)).toEqual(request);
    expect(() => NoteResolveInlineReferenceRequestSchema.parse({ ...request, href: "https://example.com" })).toThrow();
    expect(() => NoteResolveInlineReferenceRequestSchema.parse({ ...request, href: `#wiki:${"a".repeat(1025)}` })).toThrow();
    expect(() => NoteResolveInlineReferenceRequestSchema.parse({ ...request, href: `#wiki:${"界".repeat(340)}` })).toThrow();
    expect(() => NoteResolveInlineReferenceRequestSchema.parse({ ...request, href: "#wiki:line\nbreak" })).toThrow();

    const resolved = {
      apiVersion: 1 as const,
      requestId: request.requestId,
      status: "resolved" as const,
      target: { kind: "page" as const, pageId: "page_20260710_abcdef12" }
    };
    expect(NoteResolveInlineReferenceResultSchema.parse(resolved)).toEqual(resolved);
    expect(() => NoteResolveInlineReferenceResultSchema.parse({
      ...resolved,
      target: { ...resolved.target, path: "/private/vault/wiki/page.md" }
    })).toThrow();
    expect(() => NoteResolveInlineReferenceResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      status: "ambiguous",
      candidates: ["page_20260710_abcdef12"]
    })).toThrow();
  });

  it("binds Reader selections to an opaque render context without renderer text authority", () => {
    const request = {
      apiVersion: 1 as const,
      requestId: "readerselreq_abcdefghijklmnop",
      activeVaultId: "vault_20260710_abcdef12",
      currentPageId: "page_20260710_abcdef12",
      renderContextId: `notectx_${"a".repeat(32)}`,
      anchor: { segmentId: `readerseg_${"b".repeat(16)}`, utf16Offset: 0 },
      focus: { segmentId: `readerseg_${"c".repeat(16)}`, utf16Offset: 7 }
    };
    expect(ReaderSelectionResolveRequestSchema.parse(request)).toEqual(request);
    expect(() => ReaderSelectionResolveRequestSchema.parse({
      ...request,
      selectedText: "renderer text must never become selection authority"
    })).toThrow();
    expect(() => ReaderSelectionResolveRequestSchema.parse({
      ...request,
      path: "/private/vault/wiki/page.md"
    })).toThrow();
    expect(() => ReaderSelectionResolveRequestSchema.parse({
      ...request,
      focus: { ...request.focus, utf16Offset: 4 * 1024 * 1024 + 1 }
    })).toThrow();

    const resolved = {
      apiVersion: 1 as const,
      requestId: request.requestId,
      status: "resolved" as const,
      selection: {
        pageId: request.currentPageId,
        pageContentHash: `sha256:${"d".repeat(64)}`,
        span: { unit: "utf8_bytes" as const, start: 200, endExclusive: 212 },
        selectedContentHash: `sha256:${"e".repeat(64)}`
      }
    };
    expect(ReaderSelectionResolveResultSchema.parse(resolved)).toEqual(resolved);
    expect(() => ReaderSelectionResolveResultSchema.parse({
      ...resolved,
      selection: { ...resolved.selection, text: "private selected body" }
    })).toThrow();
    expect(() => ReaderSelectionResolveResultSchema.parse({
      ...resolved,
      selection: {
        ...resolved.selection,
        span: { unit: "utf8_bytes", start: 0, endExclusive: 64 * 1024 + 1 }
      }
    })).toThrow();
    expect(ReaderSelectionResolveResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      status: "failed"
    })).toEqual({ apiVersion: 1, requestId: request.requestId, status: "failed" });
  });

  it("accepts Reader read actions only by resolved identity and returns body-free state", () => {
    const request = {
      apiVersion: 1 as const,
      requestId: "readerselaction_abcdefghijklmnop",
      action: "explain" as const,
      selection: {
        pageId: "page_20260710_abcdef12",
        pageContentHash: `sha256:${"a".repeat(64)}`,
        span: { unit: "utf8_bytes" as const, start: 200, endExclusive: 212 },
        selectedContentHash: `sha256:${"b".repeat(64)}`
      },
      locale: "en" as const,
      clientTurnId: "turn_20260710_abcdefghijkl"
    };
    expect(ReaderSelectionActionRequestSchema.parse(request)).toEqual(request);
    expect(() => ReaderSelectionActionRequestSchema.parse({
      ...request,
      selectedText: "renderer-selected body"
    })).toThrow();
    expect(() => ReaderSelectionActionRequestSchema.parse({
      ...request,
      action: "polish"
    })).toThrow();
    expect(ReaderSelectionActionResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      status: "completed",
      jobId: "job_20260710_abcdef12",
      conversationEventId: "evt_20260710_abcdef12",
      conversationId: "conv_20260710_abcd",
      tailEventId: "evt_20260710_bcdef123"
    })).toMatchObject({ status: "completed" });
    expect(() => ReaderSelectionActionResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      status: "completed",
      jobId: "job_20260710_abcdef12",
      conversationEventId: "evt_20260710_abcdef12",
      conversationId: "conv_20260710_abcd",
      tailEventId: "evt_20260710_bcdef123",
      answer: "raw provider body"
    })).toThrow();

    const transform = { ...request, action: "polish" as const };
    expect(ReaderSelectionTransformRequestSchema.parse(transform)).toEqual(transform);
    expect(() => ReaderSelectionTransformRequestSchema.parse({
      ...transform,
      replacement: "renderer-authored replacement"
    })).toThrow();
    expect(ReaderSelectionTransformResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      status: "applied",
      jobId: "job_20260710_abcdef12",
      conversationEventId: "evt_20260710_abcdef12",
      conversationId: "conv_20260710_abcd",
      tailEventId: "evt_20260710_bcdef123",
      operationId: "op_20260710_abcdef12"
    })).toMatchObject({ status: "applied" });
    expect(() => ReaderSelectionTransformResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      status: "applied",
      jobId: "job_20260710_abcdef12",
      conversationEventId: "evt_20260710_abcdef12",
      conversationId: "conv_20260710_abcd",
      tailEventId: "evt_20260710_bcdef123",
      operationId: "op_20260710_abcdef12",
      replacement: "main-only model output"
    })).toThrow();
  });

  it("rejects raw-secret capabilities and YOLO eligibility for always-confirmed actions", () => {
    const request = {
      id: "permreq_20260710_abcdef12",
      schemaVersion: 1 as const,
      authorizationLayer: "permission_broker" as const,
      actorType: "skill" as const,
      actorId: "skill_example",
      actorVersion: "1.0.0",
      capability: "change_settings" as const,
      resourceScope: "current_vault" as const,
      dataBoundary: "destructive" as const,
      duration: "once" as const,
      runtimeKind: "desktop_local" as const,
      clientCapabilityTier: "desktop_full" as const,
      requiresExplicitConfirmation: true,
      yoloEligible: false,
      reason: "Apply a user-reviewed settings change.",
      createdAt: timestamp,
      defaultModeAtRequest: "yolo_full_access" as const
    };

    expect(PermissionRequestSchema.parse(request).yoloEligible).toBe(false);
    expect(() => PermissionRequestSchema.parse({ ...request, yoloEligible: true })).toThrow(
      "An always-confirmed action cannot be YOLO eligible."
    );
    expect(() => PermissionRequestSchema.parse({ ...request, capability: "access_secret" })).toThrow();
  });

  it("rejects contradictory permission decision, scope, actor, and auto-allow combinations", () => {
    const manualAllowOnce = {
      id: "permdec_20260710_abcdef12",
      schemaVersion: 1 as const,
      authorizationLayer: "permission_broker" as const,
      permissionRequestId: "permreq_20260710_abcdef12",
      decision: "allow_once" as const,
      scope: "once" as const,
      resourceScope: "current_file" as const,
      decidedBy: "user" as const,
      autoAllowedBy: "none" as const,
      decidedAt: timestamp
    };
    const automaticAllowOnce = {
      ...manualAllowOnce,
      id: "permdec_20260710_abcdef13",
      decidedBy: "system" as const,
      autoAllowedBy: "saved_grant" as const
    };
    const scopedAllow = {
      ...manualAllowOnce,
      id: "permdec_20260710_abcdef14",
      decision: "allow_scoped" as const,
      scope: "resource_scope" as const
    };

    expect(PermissionDecisionRecordSchema.parse(manualAllowOnce).scope).toBe("once");
    expect(PermissionDecisionRecordSchema.parse(automaticAllowOnce).autoAllowedBy).toBe("saved_grant");
    expect(PermissionDecisionRecordSchema.parse(scopedAllow).decision).toBe("allow_scoped");
    expect(() => PermissionDecisionRecordSchema.parse({ ...manualAllowOnce, scope: "never" })).toThrow(
      "allow-once decision must use the once"
    );
    expect(() => PermissionDecisionRecordSchema.parse({
      ...automaticAllowOnce,
      decidedBy: "user"
    })).toThrow("must be recorded as a system decision");
    expect(() => PermissionDecisionRecordSchema.parse({
      ...scopedAllow,
      decidedBy: "system",
      autoAllowedBy: "yolo_full_access"
    })).toThrow("must not create another persistent scoped grant");
    expect(() => PermissionDecisionRecordSchema.parse({
      ...scopedAllow,
      resourceScope: "current_action"
    })).toThrow("cannot target only the current action");
    expect(() => PermissionDecisionRecordSchema.parse({
      ...manualAllowOnce,
      decision: "deny",
      scope: "once"
    })).toThrow("denial must use the never");
    expect(() => PermissionDecisionRecordSchema.parse({
      ...manualAllowOnce,
      decidedBy: "system",
      autoAllowedBy: "yolo_full_access"
    })).toThrow("bind exactly one machine-local permission settings revision");
    expect(PermissionDecisionRecordSchema.parse({
      ...manualAllowOnce,
      decidedBy: "system",
      autoAllowedBy: "yolo_full_access",
      permissionSettingsRevision: 4
    }).permissionSettingsRevision).toBe(4);
  });

  it("keeps permission settings internally strict and renderer projections body-free", () => {
    const grant = {
      grantId: "permgrant_20260718_abcdefgh",
      actorType: "skill" as const,
      actorId: "skill.synthetic.internal",
      actorVersion: "1.0.0",
      actorDigest: policyHash,
      actorDisplayName: "Synthetic Skill",
      capability: "external_filesystem" as const,
      dataBoundary: "filesystem" as const,
      resourceScope: "current_folder" as const,
      resourceKind: "folder" as const,
      resourceIdentityHash: policyHash,
      decisionScope: "resource_scope" as const,
      createdAt: timestamp
    };
    const machine = PermissionMachineSettingsSchema.parse({
      revision: 2,
      defaultMode: "remember_scoped_grants",
      yoloEnabled: false,
      savedGrants: [grant]
    });
    expect(machine.savedGrants[0]?.actorId).toBe("skill.synthetic.internal");
    expect(() => PermissionMachineSettingsSchema.parse({
      ...machine,
      defaultMode: "yolo_full_access",
      yoloEnabled: false
    })).toThrow("must change atomically");
    expect(() => PermissionMachineSettingsSchema.parse({
      ...machine,
      savedGrants: [{ ...grant, capability: "change_settings", dataBoundary: "destructive" }]
    })).toThrow("cannot cover destructive");

    const summary = PermissionSettingsSummarySchema.parse({
      apiVersion: 1,
      revision: 2,
      defaultMode: "remember_scoped_grants",
      yoloEnabled: false,
      savedGrants: [{
        grantId: grant.grantId,
        actorType: grant.actorType,
        actorDisplayName: grant.actorDisplayName,
        capability: grant.capability,
        resourceScope: grant.resourceScope,
        resourceKind: grant.resourceKind,
        decisionScope: grant.decisionScope,
        createdAt: grant.createdAt
      }]
    });
    expect(JSON.stringify(summary)).not.toContain("actorId");
    expect(JSON.stringify(summary)).not.toContain("sha256:");
    expect(() => PermissionSettingsSummarySchema.parse({
      ...summary,
      savedGrants: [{ ...summary.savedGrants[0], actorId: grant.actorId }]
    })).toThrow();
    expect(PermissionEnableYoloRequestSchema.parse({
      apiVersion: 1,
      expectedRevision: 2,
      confirmationToken: "permyolo_20260718_abcdefghijklmnop"
    }).expectedRevision).toBe(2);
  });

  it("binds current permission actions to an exact versioned actor and hashed input identity", () => {
    const binding = {
      vaultId: "vault_20260710_abcdef12",
      jobId: "job_20260710_abcdef12",
      actorType: "skill" as const,
      actorId: "skill_example",
      actorVersion: "1.2.3",
      actorDigest: policyHash,
      actionId: "fetch_release_notes",
      actionVersion: "1",
      actionInputHash: policyHash,
      capability: "external_network" as const,
      dataBoundary: "network" as const,
      resourceScope: "current_domain" as const,
      resourceIdentityHash: policyHash,
      policyContextId: "policy_context_example",
      policyHash,
      runtimeKind: "desktop_local" as const,
      clientCapabilityTier: "desktop_full" as const,
      bindingHash: policyHash
    };

    expect(PermissionActionBindingSchema.parse(binding).actorVersion).toBe("1.2.3");
    expect(() => PermissionActionBindingSchema.parse({
      ...binding,
      actorVersion: undefined
    })).toThrow();
    expect(() => PermissionActionBindingSchema.parse({
      ...binding,
      actorDigest: "sha256:not-a-digest"
    })).toThrow();
    expect(() => PermissionActionBindingSchema.parse({
      ...binding,
      actorId: "a".repeat(129)
    })).toThrow();
    expect(() => PermissionActionBindingSchema.parse({
      ...binding,
      actionVersion: "v".repeat(33)
    })).toThrow();
    expect(() => PermissionActionBindingSchema.parse({
      ...binding,
      policyContextId: "policy context with spaces"
    })).toThrow();
    expect(() => PermissionActionBindingSchema.parse({
      ...binding,
      command: "curl https://private.example"
    })).toThrow();
  });

  it("keeps current-action lifecycle records body-free and state exact", () => {
    const binding = PermissionActionBindingSchema.parse({
      vaultId: "vault_20260710_abcdef12",
      jobId: "job_20260710_abcdef12",
      actorType: "skill",
      actorId: "skill_example",
      actorVersion: "1.2.3",
      actorDigest: policyHash,
      actionId: "fetch_release_notes",
      actionVersion: "1",
      actionInputHash: policyHash,
      capability: "external_network",
      dataBoundary: "network",
      resourceScope: "current_domain",
      resourceIdentityHash: policyHash,
      policyContextId: "policy_context_example",
      policyHash,
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full",
      bindingHash: policyHash
    });
    const pending = {
      schemaVersion: 1 as const,
      id: "permreq_20260710_abcdef12",
      authorizationLayer: "permission_broker" as const,
      state: "pending" as const,
      binding,
      actorDisplayName: "Release Notes Skill",
      actionLabelKey: "permissions.action.fetch_release_notes",
      resourceKind: "network" as const,
      resourceCount: 1,
      reasonCode: "permission.external_network_required",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const approved = {
      ...pending,
      state: "approved" as const,
      decision: "allow_once" as const,
      decisionId: "permdec_20260710_abcdef12",
      decidedAt: timestamp
    };
    const consumed = {
      ...approved,
      state: "consumed" as const,
      consumedAt: timestamp,
      completionMarkerHash: policyHash,
      completedAt: timestamp
    };

    expect(PermissionActionLifecycleRecordSchema.parse(pending).state).toBe("pending");
    expect(PermissionActionLifecycleRecordSchema.parse(approved).decision).toBe("allow_once");
    expect(PermissionActionLifecycleRecordSchema.parse(consumed).completionMarkerHash).toBe(policyHash);
    expect(PermissionActionLifecycleRecordSchema.parse({
      ...pending,
      state: "denied",
      decision: "deny",
      decisionId: "permdec_20260710_abcdef13",
      decidedAt: timestamp
    }).state).toBe("denied");
    expect(PermissionActionLifecycleRecordSchema.parse({
      ...pending,
      state: "cancelled",
      cancelledAt: timestamp
    }).state).toBe("cancelled");

    expect(() => PermissionActionLifecycleRecordSchema.parse({
      ...pending,
      decision: "allow_once",
      decisionId: "permdec_20260710_abcdef12"
    })).toThrow("pending permission action");
    expect(() => PermissionActionLifecycleRecordSchema.parse({
      ...approved,
      decision: "deny"
    })).toThrow("approved permission action");
    expect(() => PermissionActionLifecycleRecordSchema.parse({
      ...consumed,
      completedAt: undefined
    })).toThrow("recorded together");
    expect(() => PermissionActionLifecycleRecordSchema.parse({
      ...approved,
      completionMarkerHash: policyHash,
      completedAt: timestamp
    })).toThrow("Only a consumed permission action");
    expect(() => PermissionActionLifecycleRecordSchema.parse({
      ...pending,
      resourceKind: "path"
    })).toThrow();
    expect(() => PermissionActionLifecycleRecordSchema.parse({
      ...pending,
      reasonCode: "r".repeat(121)
    })).toThrow();

    for (const unsafeField of ["params", "path", "url", "body", "command", "credential"] as const) {
      expect(() => PermissionActionLifecycleRecordSchema.parse({
        ...pending,
        [unsafeField]: "private action material"
      })).toThrow();
    }
  });

  it("exposes only safe Permission Broker pending and resolve IPC fields", () => {
    const pending = {
      requestId: "permreq_20260710_abcdef12",
      jobId: "job_20260710_abcdef12",
      actorType: "skill" as const,
      actorDisplayName: "Release Notes Skill",
      actorVersion: "1.2.3",
      capability: "external_network" as const,
      dataBoundary: "network" as const,
      actionLabelKey: "permissions.action.fetch_release_notes",
      resourceScope: "current_domain" as const,
      resourceKind: "network" as const,
      resourceCount: 1,
      reasonCode: "permission.external_network_required",
      createdAt: timestamp
    };

    expect(PermissionPendingRequestQuerySchema.parse({ requestId: pending.requestId })).toEqual({
      requestId: pending.requestId
    });
    expect(PermissionPendingRequestSchema.parse(pending)).toEqual(pending);
    expect(PermissionResolveRequestSchema.parse({
      requestId: pending.requestId,
      jobId: pending.jobId,
      decision: "allow_once"
    }).decision).toBe("allow_once");
    expect(PermissionResolveResultSchema.parse({
      status: "approved",
      requestId: pending.requestId,
      jobId: pending.jobId
    }).status).toBe("approved");
    expect(PigeErrorSummarySchema.parse({
      code: "permission.user_denied",
      domain: "permission",
      messageKey: "errors.permission.user_denied",
      retryable: false,
      severity: "warning",
      userAction: "none",
      permissionRequestId: pending.requestId
    }).permissionRequestId).toBe(pending.requestId);

    expect(() => PermissionPendingRequestQuerySchema.parse({
      requestId: pending.requestId,
      jobId: pending.jobId
    })).toThrow();
    expect(() => PermissionResolveRequestSchema.parse({
      requestId: pending.requestId,
      jobId: pending.jobId,
      decision: "allow_scoped"
    })).toThrow();
    expect(() => PermissionResolveResultSchema.parse({
      status: "approved",
      requestId: pending.requestId,
      jobId: pending.jobId,
      decisionId: "permdec_20260710_abcdef12"
    })).toThrow();

    for (const unsafeField of ["params", "path", "url", "body", "command", "credential"] as const) {
      expect(() => PermissionPendingRequestSchema.parse({
        ...pending,
        [unsafeField]: "private action material"
      })).toThrow();
    }
  });

  it("enforces fail-safe model-egress outcomes from boundary, policy, and content class", () => {
    const common = {
      schemaVersion: 1 as const,
      providerProfileId: "provider_example",
      payloadCharacters: 1000,
      estimatedPayloadTokens: 250,
      normalPayloadCharacterLimit: 18000,
      policyHash
    };

    expect(
      ModelEgressDecisionSchema.parse({
        ...common,
        outcome: "confirm",
        reasonCode: "unknown_boundary_confirmation",
        cloudBoundary: "unknown",
        boundaryVerification: "unknown",
        cloudSendPolicy: "ordinary_allowed",
        contentClasses: ["ordinary"]
      }).outcome
    ).toBe("confirm");

    expect(() =>
      ModelEgressDecisionSchema.parse({
        ...common,
        outcome: "allow",
        reasonCode: "ordinary_external_allowed",
        cloudBoundary: "unknown",
        boundaryVerification: "unknown",
        cloudSendPolicy: "ordinary_allowed",
        contentClasses: ["ordinary"]
      })
    ).toThrow("Model egress outcome must be confirm");

    expect(
      ModelEgressDecisionSchema.parse({
        ...common,
        outcome: "block",
        reasonCode: "restricted_content_block",
        cloudBoundary: "local",
        boundaryVerification: "loopback_verified",
        cloudSendPolicy: "ordinary_allowed",
        contentClasses: ["restricted"]
      }).outcome
    ).toBe("block");
  });

  it("rejects contradictory or understated model-egress classifications", () => {
    const common = {
      schemaVersion: 1 as const,
      outcome: "allow" as const,
      reasonCode: "ordinary_external_allowed" as const,
      providerProfileId: "provider_example",
      cloudBoundary: "cloud" as const,
      boundaryVerification: "builtin_verified" as const,
      cloudSendPolicy: "ordinary_allowed" as const,
      estimatedPayloadTokens: 25,
      normalPayloadCharacterLimit: 1000,
      policyHash
    };

    expect(() => ModelEgressDecisionSchema.parse({
      ...common,
      contentClasses: ["ordinary", "private"],
      payloadCharacters: 100
    })).toThrow("ordinary is mutually exclusive");

    expect(() => ModelEgressDecisionSchema.parse({
      ...common,
      contentClasses: ["ordinary"],
      payloadCharacters: 1001
    })).toThrow("must be classified as large");
  });

  it("keeps one-use model-egress approvals strict, body-free, and distinct from Permission Broker grants", () => {
    const pending = {
      schemaVersion: 1 as const,
      id: "egressreq_20260710_abcdef1234567890",
      authorizationLayer: "model_egress" as const,
      state: "pending" as const,
      jobId: "job_20260710_abcdef12",
      vaultId: "vault_20260710_abcdef12",
      providerProfileId: "provider_example",
      modelProfileId: "model_example",
      providerIdentityHash: policyHash,
      modelIdentityHash: policyHash,
      policyHash,
      payloadHash: policyHash,
      evidenceSummaryHash: policyHash,
      baseDecisionHash: policyHash,
      decisionHash: policyHash,
      operationId: "op_20260710_abcdef12",
      reasonCode: "sensitive_confirmation" as const,
      contentClasses: ["sensitive"] as const,
      payloadCharacters: 100,
      estimatedPayloadTokens: 25,
      normalPayloadCharacterLimit: 1_000,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    expect(ModelEgressApprovalRequestRecordSchema.parse(pending).authorizationLayer).toBe("model_egress");
    expect(() => ModelEgressApprovalRequestRecordSchema.parse({
      ...pending,
      permissionDecisionId: "permdec_20260710_abcdef12"
    })).toThrow();
    expect(() => ModelEgressApprovalRequestRecordSchema.parse({
      ...pending,
      prompt: "private body"
    })).toThrow();
    expect(() => ModelEgressApprovalRequestRecordSchema.parse({
      ...pending,
      state: "approved",
      decision: "allow_once",
      decidedAt: timestamp,
      consumedAt: timestamp
    })).toThrow("An approved model egress request must contain one unconsumed allow-once decision.");

    expect(ModelEgressPendingRequestQuerySchema.parse({ requestId: pending.id })).toEqual({
      requestId: pending.id
    });
    expect(() => ModelEgressPendingRequestQuerySchema.parse({
      requestId: pending.id,
      prompt: "private body"
    })).toThrow();
    expect(ModelEgressResolveRequestSchema.parse({
      requestId: pending.id,
      jobId: pending.jobId,
      decision: "allow_once"
    })).toMatchObject({ decision: "allow_once" });
    expect(() => ModelEgressResolveRequestSchema.parse({
      requestId: pending.id,
      jobId: pending.jobId,
      decision: "allow_once",
      permissionDecisionId: "permdec_20260710_abcdef12"
    })).toThrow();
    expect(() => ModelEgressPendingRequestSchema.parse({
      requestId: pending.id,
      jobId: pending.jobId,
      providerProfileId: pending.providerProfileId,
      modelProfileId: pending.modelProfileId,
      reasonCode: pending.reasonCode,
      contentClasses: pending.contentClasses,
      requestedAt: pending.createdAt,
      secretRef: "provider_secret_private"
    })).toThrow();
    expect(() => ModelEgressResolveResultSchema.parse({
      status: "approved",
      requestId: pending.id,
      jobId: pending.jobId,
      endpoint: "https://private.example"
    })).toThrow();
  });

  it("strips arbitrary provider headers from persisted provider metadata", () => {
    const parsed = ProviderProfileSchema.parse({
      id: "provider_example",
      displayName: "Example",
      providerKind: "openai_compatible",
      baseUrl: "https://models.example.com/v1",
      authSecretRef: "provider_secret_example",
      modelListStrategy: "manual",
      cloudBoundary: "unknown",
      boundaryVerification: "unknown",
      defaultHeaders: { Authorization: "Bearer secret" },
      createdAt: timestamp,
      updatedAt: timestamp
    });

    expect(parsed).not.toHaveProperty("defaultHeaders");
  });

  it("accepts only bounded provider connection request fields", () => {
    expect(AddPresetProviderRequestSchema.parse({
      presetId: "openai",
      apiKey: "synthetic-key"
    })).toEqual({ presetId: "openai", apiKey: "synthetic-key" });
    expect(() => AddPresetProviderRequestSchema.parse({
      presetId: "openai",
      apiKey: "synthetic-key",
      baseUrl: "https://attacker.example/v1"
    })).toThrow();
    expect(AddPresetProviderRequestSchema.parse({ presetId: "ollama" })).toEqual({ presetId: "ollama" });
    expect(AddManualProviderRequestSchema.parse({
      displayName: "Discover first",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://models.example.com/v1",
      apiKey: "synthetic-key",
      cloudBoundary: "unknown"
    })).not.toHaveProperty("manualModelId");
    expect(() => AddManualProviderRequestSchema.parse({
      displayName: "Compatible",
      providerKind: "openai_compatible",
      baseUrl: "https://models.example.com/v1",
      apiKey: "x".repeat(16_385),
      manualModelId: "model",
      cloudBoundary: "unknown"
    })).toThrow();
    expect(UpdateProviderCredentialRequestSchema.parse({
      providerProfileId: "provider_existing",
      expectedRevision: `sha256:${"a".repeat(64)}`,
      apiKey: "replacement-key"
    })).toEqual({
      providerProfileId: "provider_existing",
      expectedRevision: `sha256:${"a".repeat(64)}`,
      apiKey: "replacement-key"
    });
    expect(() => UpdateProviderCredentialRequestSchema.parse({
      providerProfileId: "provider_existing",
      expectedRevision: `sha256:${"a".repeat(64)}`,
      apiKey: "replacement-key",
      oldApiKey: "must-never-cross-preload"
    })).toThrow();
    expect(DeleteProviderRequestSchema.parse({
      providerProfileId: "provider_existing",
      expectedRevision: `sha256:${"b".repeat(64)}`
    })).toEqual({
      providerProfileId: "provider_existing",
      expectedRevision: `sha256:${"b".repeat(64)}`
    });
    expect(() => DeleteProviderRequestSchema.parse({
      providerProfileId: "provider_existing",
      expectedRevision: `sha256:${"b".repeat(64)}`,
      credential: "must-never-cross-preload"
    })).toThrow();
  });

  it("binds required, optional, and no-auth Provider Profiles without dummy secret references", () => {
    const common = {
      id: "provider_keyless",
      displayName: "Keyless",
      providerKind: "openai_compatible" as const,
      endpointProtocol: "openai_chat_completions" as const,
      baseUrl: "http://127.0.0.1:11434/v1",
      modelListStrategy: "list_models" as const,
      cloudBoundary: "local" as const,
      boundaryVerification: "loopback_verified" as const,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    expect(ProviderProfileSchema.parse({ ...common, authRequirement: "none" })).not.toHaveProperty("authSecretRef");
    expect(ProviderProfileSchema.parse({ ...common, authRequirement: "optional_api_key" })).not.toHaveProperty("authSecretRef");
    expect(() => ProviderProfileSchema.parse({
      ...common,
      authRequirement: "none",
      authSecretRef: "provider_secret_forbidden"
    })).toThrow("cannot persist a secret reference");
    expect(() => ProviderProfileSchema.parse({ ...common, authRequirement: "api_key" }))
      .toThrow("require a secret reference");
  });

  it("normalizes safe provider URLs and rejects unsafe URLs in persisted metadata", () => {
    const profile = {
      id: "provider_example",
      displayName: "Example",
      providerKind: "openai_compatible" as const,
      authSecretRef: "provider_secret_example",
      modelListStrategy: "manual" as const,
      cloudBoundary: "local" as const,
      boundaryVerification: "loopback_verified" as const,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    expect(ProviderProfileSchema.parse({
      ...profile,
      baseUrl: " HTTP://[::1]:11434/v1/// "
    }).baseUrl).toBe("http://[::1]:11434/v1");

    for (const baseUrl of [
      "http://models.example.com/v1",
      "ftp://localhost/v1",
      "https://token@models.example.com/v1",
      "https://models.example.com/v1?api_key=secret",
      "https://models.example.com/v1#credential"
    ]) {
      expect(() => ProviderProfileSchema.parse({ ...profile, baseUrl })).toThrow();
    }
  });

  it("rejects provider boundary metadata that can disguise a cloud endpoint as verified local", () => {
    const common = {
      id: "provider_example",
      displayName: "Example",
      authSecretRef: "provider_secret_example",
      modelListStrategy: "manual" as const,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    expect(ProviderProfileSchema.parse({
      ...common,
      providerKind: "openai",
      cloudBoundary: "cloud",
      boundaryVerification: "builtin_verified"
    }).cloudBoundary).toBe("cloud");
    expect(() => ProviderProfileSchema.parse({
      ...common,
      providerKind: "openai",
      cloudBoundary: "cloud"
    })).toThrow("require builtin_verified");
    expect(() => ProviderProfileSchema.parse({
      ...common,
      providerKind: "openai",
      cloudBoundary: "local",
      boundaryVerification: "loopback_verified"
    })).toThrow("must use the cloud boundary");
    expect(() => ProviderProfileSchema.parse({
      ...common,
      providerKind: "openai",
      baseUrl: "http://127.0.0.1:11434/v1",
      cloudBoundary: "cloud",
      boundaryVerification: "builtin_verified"
    })).toThrow("fixed official endpoint");
    expect(() => ProviderProfileSchema.parse({
      ...common,
      providerKind: "openai_compatible",
      baseUrl: "https://models.example.com/v1",
      cloudBoundary: "local",
      boundaryVerification: "loopback_verified"
    })).toThrow("Only a canonical loopback provider URL");
    expect(() => ProviderProfileSchema.parse({
      ...common,
      providerKind: "openai_compatible",
      baseUrl: "http://127.0.0.1:11434/v1",
      cloudBoundary: "unknown",
      boundaryVerification: "unknown"
    })).toThrow("loopback compatible provider must use local");
    expect(() => ProviderProfileSchema.parse({
      ...common,
      providerKind: "custom",
      baseUrl: "https://models.example.com/v1",
      cloudBoundary: "cloud",
      boundaryVerification: "builtin_verified"
    })).toThrow("cannot claim builtin_verified");
  });
});
