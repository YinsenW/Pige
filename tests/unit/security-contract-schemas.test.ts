import { describe, expect, it } from "vitest";
import type { HighRiskConfirmationOwner, ReaderSelectionActionRequest } from "@pige/contracts";
import {
  AddManualProviderRequestSchema,
  AddPresetProviderRequestSchema,
  DeleteProviderRequestSchema,
  ExternalWebSkillRuntimeCallSchema,
  HighRiskConfirmationChangedEventSchema,
  HighRiskConfirmationPendingResultSchema,
  HighRiskConfirmationResolveRequestSchema,
  HighRiskConfirmationSummarySchema,
  NoteResolveInlineReferenceRequestSchema,
  NoteResolveInlineReferenceResultSchema,
  PermissionActionBindingSchema,
  PigeErrorSummarySchema,
  ProviderProfileSchema,
  READER_SELECTION_ASK_QUESTION_MAX_CODE_POINTS,
  ReaderSelectionActionRequestSchema,
  ReaderSelectionActionResultSchema,
  ReaderSelectionCreateNoteRequestSchema,
  ReaderSelectionCreateNoteResultSchema,
  ReaderSelectionLinkRequestSchema,
  ReaderSelectionLinkResultSchema,
  ReaderSelectionProposalDecisionRequestSchema,
  ReaderSelectionProposalDecisionResultSchema,
  ReaderSelectionProposalGetResultSchema,
  ReaderSelectionTransformRequestSchema,
  ReaderSelectionTransformResultSchema,
  ReaderSelectionResolveRequestSchema,
  ReaderSelectionResolveResultSchema,
  SkillDisableRequestSchema,
  SkillManifestSchema,
  SkillRegistryMutationResultSchema,
  SkillRegistryQueryResultSchema,
  SkillRegistrySummarySchema,
  SkillStageFromMarkdownRequestSchema,
  SkillStageFromMarkdownResultSchema,
  SkillStageUpdateRequestSchema,
  SkillStageUpdateResultSchema,
  UpdateProviderCredentialRequestSchema
} from "@pige/schemas";

const timestamp = "2026-07-10T00:00:00.000Z";
const policyHash = `sha256:${"a".repeat(64)}`;

describe("security-sensitive shared contracts", () => {
  it("keeps high-risk confirmation projection closed, coherent, and body-free", () => {
    const confirmation = {
      apiVersion: 1 as const,
      confirmationId: "confirm_20260722_abcdefghijklmnop",
      effect: "arbitrary_shell" as const,
      presentation: {
        action: "run_shell_command" as const,
        target: "local_system" as const,
        subject: { kind: "executable_name" as const, value: "lark-cli" }
      },
      owner: { kind: "agent_turn" as const, clientTurnId: "turn_20260722_abcdefghijklmnop" }
    };
    expect(HighRiskConfirmationSummarySchema.parse(confirmation)).toEqual(confirmation);
    expect(HighRiskConfirmationPendingResultSchema.parse({
      apiVersion: 1,
      status: "pending",
      revision: 4,
      confirmation
    })).toMatchObject({ status: "pending", revision: 4 });
    expect(HighRiskConfirmationChangedEventSchema.parse({
      apiVersion: 1,
      status: "pending",
      revision: 4,
      confirmation
    })).toMatchObject({ status: "pending", revision: 4 });
    expect(HighRiskConfirmationResolveRequestSchema.parse({
      apiVersion: 1,
      confirmationId: confirmation.confirmationId,
      expectedRevision: 4,
      decision: "deny"
    })).toMatchObject({ decision: "deny" });

    expect(() => HighRiskConfirmationSummarySchema.parse({
      ...confirmation,
      effect: "export_secret",
      presentation: {
        action: "delete_permanently",
        target: "current_note",
        subject: { kind: "display_name", value: "Note" }
      }
    })).toThrow();
    expect(() => HighRiskConfirmationSummarySchema.parse({
      ...confirmation,
      effect: "risky_agent_edit",
      presentation: {
        action: "apply_risky_edit",
        target: "current_note",
        subject: { kind: "display_name", value: "Note" }
      }
    })).toThrow();
    expect(() => HighRiskConfirmationPendingResultSchema.parse({
      apiVersion: 1,
      status: "pending",
      revision: 4,
      confirmation: { ...confirmation, revision: 3 }
    })).toThrow();
    for (const unsafeField of ["path", "command", "body", "hash", "credential", "provider", "rawError", "jobId"]) {
      expect(() => HighRiskConfirmationSummarySchema.parse({ ...confirmation, [unsafeField]: "private" })).toThrow();
    }
    for (const unsafeValue of [
      "/Users/example/private.txt",
      "C:\\Users\\example\\private.txt",
      "https://example.com/package",
      "npm install unsafe-package",
      "rm -rf data",
      "curl example.com",
      "Key sk-example-secret",
      "github_pat_example",
      "xoxb-example",
      "access token=example",
      "Bearer example-secret",
      "access_token_example",
      "clientSecretExample",
      "private_key_example",
      "Review op_20260722_abcdefgh",
      "Retry job_20260722_abcdefgh",
      "Use provider_20260722_abcdefgh",
      "secret_20260722_abcdefghijklmnop",
      "note; rm -rf data"
    ]) {
      expect(() => HighRiskConfirmationSummarySchema.parse({
        ...confirmation,
        presentation: {
          action: "run_shell_command",
          target: "local_system",
          subject: { kind: "executable_name", value: unsafeValue }
        }
      }), `executable_name accepted ${unsafeValue}`).toThrow();
    }
    for (const unsafeValue of [
      "C:\\Users\\example\\private.txt",
      "https://example.com/package",
      "rm -rf data",
      "curl example.com",
      "Key sk-example-secret",
      "github_pat_example",
      "xoxp-example",
      "access token=example",
      "Review op_20260722_abcdefgh",
      "Retry job_20260722_abcdefgh",
      "Use provider_20260722_abcdefgh"
    ]) {
      expect(() => HighRiskConfirmationSummarySchema.parse({
        apiVersion: 1,
        confirmationId: confirmation.confirmationId,
        effect: "write_outside_authorized_root",
        presentation: {
          action: "write_external_item",
          target: "external_location",
          subject: { kind: "display_name", value: unsafeValue }
        },
        owner: confirmation.owner
      }), `display_name accepted ${unsafeValue}`).toThrow();
    }
    for (const unsafeValue of [
      "sk-example-secret",
      "github_pat_example",
      "xoxb-example",
      "token=example",
      "plugin-op_20260722_abcdefgh",
      "plugin-provider_20260722_abcdefgh",
      "@larksuite/cli",
      "safe-package@latest",
      "safe-package@1.2"
    ]) {
      expect(() => HighRiskConfirmationSummarySchema.parse({
        ...confirmation,
        effect: "install_unreviewed_package",
        presentation: {
          action: "install_package",
          target: "local_toolchain",
          subject: { kind: "package_name", value: unsafeValue }
        }
      }), `package_name accepted ${unsafeValue}`).toThrow();
    }
    expect(HighRiskConfirmationSummarySchema.parse({
      ...confirmation,
      effect: "install_unreviewed_package",
      presentation: {
        action: "install_package",
        target: "local_toolchain",
        subject: { kind: "package_name", value: "@larksuite/cli@1.0.72" }
      }
    }).presentation.subject).toEqual({ kind: "package_name", value: "@larksuite/cli@1.0.72" });

    const packageTaskOwner = {
      kind: "pi_package_install_task" as const,
      taskId: "pi_package_task_abcdefghijklmnop"
    };
    expect(HighRiskConfirmationSummarySchema.parse({
      ...confirmation,
      effect: "install_unreviewed_package",
      presentation: {
        action: "install_package",
        target: "local_toolchain",
        subject: { kind: "package_name", value: "@larksuite/cli@1.0.72" }
      },
      owner: packageTaskOwner
    }).owner).toEqual(packageTaskOwner);
    expect(() => HighRiskConfirmationSummarySchema.parse({
      ...confirmation,
      owner: packageTaskOwner
    })).toThrow();

    const permissionPolicyOwner: HighRiskConfirmationOwner = {
      kind: "permission_policy",
      policyRequestId: "permissionpolicyreq_abcdefghijklmnop"
    };
    const fullAccessConfirmation = {
      apiVersion: 1 as const,
      confirmationId: "confirm_20260729_yolofullaccess1234",
      effect: "authority_boundary_change" as const,
      presentation: {
        action: "change_authority_boundary" as const,
        target: "authority_boundary" as const,
        subject: { kind: "display_name" as const, value: "YOLO Full Access" }
      },
      owner: permissionPolicyOwner
    };
    expect(HighRiskConfirmationSummarySchema.parse(fullAccessConfirmation)).toEqual(fullAccessConfirmation);
    expect(() => HighRiskConfirmationSummarySchema.parse({
      ...fullAccessConfirmation,
      owner: { ...permissionPolicyOwner, privatePath: "/private/policy.json" }
    })).toThrow();
    expect(() => HighRiskConfirmationSummarySchema.parse({
      ...confirmation,
      owner: permissionPolicyOwner
    })).toThrow("authority-boundary");

    const externalWebConfirmation = {
      apiVersion: 1 as const,
      confirmationId: "confirm_20260729_externalwebread01",
      effect: "external_web_skill_https_read" as const,
      presentation: {
        action: "read_external_web" as const,
        target: "reviewed_https_origin" as const,
        subject: {
          kind: "external_web_skill" as const,
          value: "External Research",
          version: "1.0.0",
          origin: "https://api.example.com",
          capability: "external_network" as const,
          dataBoundary: "network" as const
        }
      },
      owner: { kind: "agent_turn" as const, clientTurnId: "turn_20260729_externalwebread" }
    };
    expect(HighRiskConfirmationSummarySchema.parse(externalWebConfirmation)).toEqual(externalWebConfirmation);
    for (const unsafe of [
      {
        ...externalWebConfirmation,
        presentation: {
          ...externalWebConfirmation.presentation,
          subject: { ...externalWebConfirmation.presentation.subject, origin: "http://api.example.com" }
        }
      },
      {
        ...externalWebConfirmation,
        presentation: {
          ...externalWebConfirmation.presentation,
          subject: { ...externalWebConfirmation.presentation.subject, origin: "https://api.example.com/path" }
        }
      },
      { ...externalWebConfirmation, owner: { kind: "operation", operationId: "op_20260729_abcdef12" } },
      { ...externalWebConfirmation, body: "private" },
      { ...externalWebConfirmation, url: "https://api.example.com/private" },
      { ...externalWebConfirmation, credential: "secret" }
    ]) {
      expect(() => HighRiskConfirmationSummarySchema.parse(unsafe)).toThrow();
    }
  });

  it("keeps Skill inventory and lifecycle requests strict, pathless, and body-free", () => {
    const summary = {
      apiVersion: 1 as const,
      revision: 4,
      invalidManifestCount: 1,
      restorableSkills: [],
      skills: [{
        id: "paper-reading",
        name: "Paper Reading",
        version: "1",
        description: "Create source-backed notes.",
        scope: "machine_local" as const,
        kind: "pure" as const,
        enabled: true,
        trust: "user_confirmed" as const,
        capabilities: ["read_current_source" as const],
        dataBoundaries: ["local" as const],
        canEnable: false,
        canUninstall: true,
        canExport: true,
        canUpdate: true
      }]
    };
    expect(SkillRegistrySummarySchema.parse(summary)).toEqual(summary);
    expect(SkillRegistryQueryResultSchema.parse({ status: "ready", registry: summary })).toEqual({
      status: "ready",
      registry: summary
    });
    expect(() => SkillRegistrySummarySchema.parse({
      ...summary,
      skills: [{ ...summary.skills[0], path: "/private/skills/paper-reading/SKILL.md" }]
    })).toThrow();
    expect(() => SkillRegistrySummarySchema.parse({
      ...summary,
      skills: [{ ...summary.skills[0], body: "untrusted instructions" }]
    })).toThrow();
    expect(() => SkillRegistrySummarySchema.parse({
      ...summary,
      skills: [{ ...summary.skills[0], capabilities: ["raw_secret_access"] }]
    })).toThrow();
    expect(SkillDisableRequestSchema.parse({
      apiVersion: 1,
      activeVaultId: "vault_20260728_abcdefgh",
      scope: "machine_local",
      skillId: "paper-reading",
      expectedRevision: 4
    }).skillId).toBe("paper-reading");
    expect(() => SkillDisableRequestSchema.parse({
      apiVersion: 1,
      activeVaultId: "vault_20260728_abcdefgh",
      scope: "machine_local",
      skillId: "../../outside",
      expectedRevision: 4
    })).toThrow();
    for (const skillId of ["con", "nul.logs", "com1", "portable."]) {
      expect(() => SkillDisableRequestSchema.parse({
        apiVersion: 1, activeVaultId: "vault_20260728_abcdefgh", scope: "machine_local", skillId, expectedRevision: 4
      })).toThrow();
    }
    const updateRequest = {
      apiVersion: 1 as const,
      requestId: "skill_lifecycle_request_abcdefghijklmnop",
      activeVaultId: "vault_20260728_abcdefgh",
      scope: "machine_local" as const,
      skillId: "paper-reading",
      expectedRegistryRevision: 4
    };
    expect(SkillStageUpdateRequestSchema.parse(updateRequest)).toEqual(updateRequest);
    expect(() => SkillStageUpdateRequestSchema.parse({
      ...updateRequest,
      sourceUrl: "https://example.com/private/SKILL.md"
    })).toThrow();
    expect(() => SkillStageUpdateResultSchema.parse({
      apiVersion: 1,
      requestId: updateRequest.requestId,
      activeVaultId: updateRequest.activeVaultId,
      scope: updateRequest.scope,
      skillId: updateRequest.skillId,
      status: "failed",
      error: { path: "/private/source" }
    })).toThrow();
    const markdownRequest = {
      apiVersion: 1 as const,
      requestId: "skillreq_markdownabcdefghijkl",
      activeVaultId: "vault_20260728_markdownskill"
    };
    expect(SkillStageFromMarkdownRequestSchema.parse(markdownRequest)).toEqual(markdownRequest);
    expect(() => SkillStageFromMarkdownRequestSchema.parse({ ...markdownRequest, path: "/private/SKILL.md" })).toThrow();
    expect(() => SkillStageFromMarkdownResultSchema.parse({
      ...markdownRequest,
      status: "failed",
      selectedPath: "/private/SKILL.md"
    })).toThrow();
    const failed = {
      status: "failed" as const,
      error: {
        code: "skill.registry_unavailable",
        domain: "skill" as const,
        messageKey: "error.generic",
        retryable: true,
        severity: "error" as const,
        userAction: "retry" as const
      }
    };
    expect(SkillRegistryMutationResultSchema.parse(failed)).toEqual(failed);
    expect(SkillRegistryQueryResultSchema.parse(failed)).toEqual(failed);
    expect(() => SkillRegistryMutationResultSchema.parse({
      ...failed,
      error: { ...failed.error, path: "/private/skills" }
    })).toThrow();

    expect(() => SkillManifestSchema.parse({
      id: "unsafe-pure",
      name: "Unsafe Pure Skill",
      version: "1",
      description: "Incorrectly claims pure execution.",
      scope: "machine_local",
      kind: "pure",
      capabilities: ["external_network"]
    })).toThrow("Pure Skills cannot declare permission-mediated");
  });

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
    for (const action of ["explain", "summarize"] as const) {
      expect(() => ReaderSelectionActionRequestSchema.parse({
        ...request,
        action,
        question: "Do not accept a question for this action."
      })).toThrow();
    }
    const askRequest = {
      ...request,
      action: "ask" as const,
      question: "  How does this passage support the conclusion?  "
    } satisfies ReaderSelectionActionRequest;
    expect(ReaderSelectionActionRequestSchema.parse(askRequest)).toEqual({
      ...askRequest,
      question: "How does this passage support the conclusion?"
    });
    expect(() => ReaderSelectionActionRequestSchema.parse({
      ...request,
      action: "ask"
    })).toThrow();
    expect(() => ReaderSelectionActionRequestSchema.parse({
      ...request,
      action: "ask",
      question: "   "
    })).toThrow();
    expect(ReaderSelectionActionRequestSchema.parse({
      ...request,
      action: "ask",
      question: "问".repeat(READER_SELECTION_ASK_QUESTION_MAX_CODE_POINTS)
    })).toMatchObject({
      action: "ask",
      question: "问".repeat(READER_SELECTION_ASK_QUESTION_MAX_CODE_POINTS)
    });
    expect(() => ReaderSelectionActionRequestSchema.parse({
      ...request,
      action: "ask",
      question: "问".repeat(READER_SELECTION_ASK_QUESTION_MAX_CODE_POINTS + 1)
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

    const link = {
      ...request,
      action: "link" as const,
      activeVaultId: "vault_20260710_abcdef12",
      renderContextId: `notectx_${"c".repeat(32)}`
    };
    expect(ReaderSelectionLinkRequestSchema.parse(link)).toEqual(link);
    for (const unsafe of [
      { targetPageId: "page_20260710_target12" },
      { targetPath: "/private/vault/wiki/target.md" },
      { selectedText: "untrusted selection body" },
      { targetHash: `sha256:${"d".repeat(64)}` }
    ]) {
      expect(() => ReaderSelectionLinkRequestSchema.parse({ ...link, ...unsafe })).toThrow();
    }
    expect(ReaderSelectionLinkResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      status: "applied",
      jobId: "job_20260710_abcdef12",
      conversationEventId: "evt_20260710_abcdef12",
      conversationId: "conv_20260710_abcd",
      tailEventId: "evt_20260710_bcdef123",
      operationId: "op_20260710_abcdef12",
      currentPageId: request.selection.pageId,
      targetPageId: "page_20260710_target12"
    })).toMatchObject({ status: "applied", targetPageId: "page_20260710_target12" });
    expect(() => ReaderSelectionLinkResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      status: "applied",
      jobId: "job_20260710_abcdef12",
      conversationEventId: "evt_20260710_abcdef12",
      conversationId: "conv_20260710_abcd",
      tailEventId: "evt_20260710_bcdef123",
      operationId: "op_20260710_abcdef12",
      currentPageId: request.selection.pageId,
      targetPageId: request.selection.pageId
    })).toThrow();
    expect(ReaderSelectionLinkResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      status: "invalid",
      reason: "target_ambiguous"
    })).toEqual({
      apiVersion: 1,
      requestId: request.requestId,
      status: "invalid",
      reason: "target_ambiguous"
    });

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

    const proposal = {
      proposalId: "proposal_20260710_readerreview",
      action: "polish" as const,
      state: "ready" as const,
      revision: 1,
      lines: [{ kind: "removed" as const, text: "bounded preview" }]
    };
    expect(ReaderSelectionProposalGetResultSchema.parse({
      apiVersion: 1,
      status: "available",
      proposal
    })).toMatchObject({ status: "available" });
    expect(() => ReaderSelectionProposalGetResultSchema.parse({
      apiVersion: 1,
      status: "available",
      proposal: { ...proposal, path: "/private/vault/wiki/page.md" }
    })).toThrow();
    expect(ReaderSelectionProposalDecisionRequestSchema.parse({
      apiVersion: 1,
      proposalId: proposal.proposalId,
      expectedRevision: 1,
      decision: "approve"
    })).toMatchObject({ decision: "approve" });
    expect(() => ReaderSelectionProposalDecisionRequestSchema.parse({
      apiVersion: 1,
      proposalId: proposal.proposalId,
      expectedRevision: 1,
      decision: "approve",
      replacement: "renderer apply bytes"
    })).toThrow();
    expect(ReaderSelectionProposalDecisionResultSchema.parse({
      apiVersion: 1,
      status: "applied",
      proposal: { ...proposal, state: "applied", revision: 3 },
      operationId: "op_20260710_abcdef12"
    })).toMatchObject({ status: "applied" });
  });

  it("keeps Reader create-page actions closed and returns page authority only after review", () => {
    const selection = {
      pageId: "page_20260710_abcdef12",
      pageContentHash: `sha256:${"a".repeat(64)}`,
      span: { unit: "utf8_bytes" as const, start: 12, endExclusive: 24 },
      selectedContentHash: `sha256:${"b".repeat(64)}`
    };
    for (const [index, action] of ([
      "create_note", "create_claim", "create_question", "create_concept", "create_entity", "create_topic"
    ] as const).entries()) {
      const request = {
        apiVersion: 1 as const,
        requestId: `readerselaction_abcdef123456789${index}`,
        action,
        activeVaultId: "vault_20260710_abcdef12",
        renderContextId: `notectx_${"c".repeat(32)}`,
        selection,
        locale: "en" as const,
        clientTurnId: "turn_20260710_abcdefghijkl"
      };
      expect(ReaderSelectionCreateNoteRequestSchema.parse(request)).toEqual(request);
      expect(ReaderSelectionCreateNoteResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        status: "review_required",
        jobId: "job_20260710_abcdef12",
        conversationEventId: "evt_20260710_abcdef12",
        conversationId: "conv_20260710_abcd",
        tailEventId: "evt_20260710_bcdef123",
        proposal: {
          proposalId: "proposal_20260710_readerpage",
          action,
          state: "ready",
          revision: 1,
          lines: [{ kind: "added", text: "Bounded preview" }]
        }
      })).toMatchObject({ status: "review_required", proposal: { action } });
    }
    expect(() => ReaderSelectionCreateNoteRequestSchema.parse({
      apiVersion: 1,
      requestId: "readerselaction_abcdef1234567899",
      action: "create_summary",
      activeVaultId: "vault_20260710_abcdef12",
      renderContextId: `notectx_${"c".repeat(32)}`,
      selection,
      locale: "en",
      clientTurnId: "turn_20260710_abcdefghijkl"
    })).toThrow();
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

  it("binds one External/Web Skill HTTPS call without widening public-network policy", () => {
    const runtimeIdentityHash = `sha256:${"c".repeat(64)}`;
    const binding = {
      vaultId: "vault_20260729_externalruntime",
      jobId: "job_20260729_externalruntime",
      actorType: "skill" as const,
      actorId: "skill:external-research",
      actorVersion: "1",
      actorDigest: runtimeIdentityHash,
      actionId: "external_web.read_https",
      actionVersion: "1",
      actionInputHash: `sha256:${"d".repeat(64)}`,
      capability: "external_network" as const,
      dataBoundary: "network" as const,
      resourceScope: "current_url" as const,
      resourceIdentityHash: `sha256:${"e".repeat(64)}`,
      policyContextId: "policy_context_external_runtime",
      policyHash: `sha256:${"f".repeat(64)}`,
      runtimeKind: "desktop_local" as const,
      clientCapabilityTier: "desktop_full" as const,
      bindingHash: `sha256:${"0".repeat(64)}`
    };
    const call = {
      toolName: "pige_external_web_read" as const,
      turn: {
        apiVersion: 1 as const,
        activeVaultId: binding.vaultId,
        jobId: binding.jobId,
        clientTurnId: "turn_20260729_externalruntime",
        authoredTaskIntent: "explicit_user_task" as const,
        policyContextId: binding.policyContextId,
        policyHash: binding.policyHash,
        networkPolicy: "public_https_only" as const,
        runtimeKind: "desktop_local" as const,
        clientCapabilityTier: "desktop_full" as const,
        identity: {
          kind: "external_web" as const,
          scope: "machine_local" as const,
          trust: "user_confirmed" as const,
          enabled: true as const,
          skillId: "external-research",
          skillVersion: "1.0.0",
          manifestSha256: `sha256:${"a".repeat(64)}`,
          bundleSha256: `sha256:${"b".repeat(64)}`,
          registryRevision: 12,
          runtime: {
            adapter: "pige_readonly_https_v1" as const,
            origin: "https://api.example.com"
          },
          runtimeIdentityHash
        },
        permissionBinding: binding
      },
      request: { url: "https://api.example.com/v1/search" }
    };

    expect(ExternalWebSkillRuntimeCallSchema.parse(call)).toEqual(call);
    for (const invalid of [
      { ...call, toolName: "third_party_fetch" },
      { ...call, request: { url: "https://other.example.com/v1/search" } },
      { ...call, turn: { ...call.turn, networkPolicy: "permissioned_external_network" } },
      { ...call, turn: { ...call.turn, authoredTaskIntent: "neutral_attachment" } },
      { ...call, turn: { ...call.turn, jobId: "job_20260729_otherjob12" } },
      {
        ...call,
        turn: {
          ...call.turn,
          identity: { ...call.turn.identity, registryRevision: undefined }
        }
      },
      {
        ...call,
        turn: {
          ...call.turn,
          permissionBinding: { ...binding, actorDigest: `sha256:${"9".repeat(64)}` }
        }
      },
      { ...call, body: "private" },
      { ...call, credential: "secret" }
    ]) {
      expect(() => ExternalWebSkillRuntimeCallSchema.parse(invalid)).toThrow();
    }
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
