import { createHash } from "node:crypto";
import { PigeDomainError } from "@pige/domain";
import {
  PiPackageSetEnabledRequestSchema,
  PiPackageSetEnabledResultSchema,
  type PiPackageRegistrySummary,
  type PiPackageSetEnabledRequest,
  type PiPackageSetEnabledResult
} from "@pige/schemas";
import type { ModelProviderRegistry } from "./model-provider-registry";
import {
  assertPermissionedExternalExecutionAuthority,
  type PermissionedExternalCapabilityAdapter,
  type PermissionedExternalExecutionAuthority
} from "./permissioned-external-capability-service";
import {
  PiPackageManagerService,
  type PiPackageRecord
} from "./pi-package-manager-service";
import {
  isReviewedPiPackageRuntimeRecord,
  REVIEWED_PI_BTW_RUNTIME,
  type PackageRuntimeMutationRecord
} from "./pi-package-lifecycle-store";
import { PiAgentRuntimeAdapter } from "./pi-agent-runtime-adapter";
import { createPigeTextToolResult } from "./pi-agent-tool-boundary";

const QUESTION_LIMIT = 2_000;
const ANSWER_LIMIT = 4_000;
const ACTOR_DIGEST = `sha256:${createHash("sha256")
  .update(JSON.stringify(REVIEWED_PI_BTW_RUNTIME), "utf8").digest("hex")}`;

export class PiPackageRuntimeService {
  readonly #manager: PiPackageManagerService;
  readonly #providers: Pick<ModelProviderRegistry, "getDefaultRuntimeConfig">;
  readonly #runtime: Pick<PiAgentRuntimeAdapter, "run">;

  constructor(options: {
    readonly manager: PiPackageManagerService;
    readonly providers: Pick<ModelProviderRegistry, "getDefaultRuntimeConfig">;
    readonly runtime?: Pick<PiAgentRuntimeAdapter, "run">;
  }) {
    this.#manager = options.manager;
    this.#providers = options.providers;
    this.#runtime = options.runtime ?? new PiAgentRuntimeAdapter();
  }

  setEnabled(requestInput: PiPackageSetEnabledRequest): Promise<PiPackageSetEnabledResult> {
    const request = PiPackageSetEnabledRequestSchema.parse(requestInput);
    const identity = enabledIdentity(request);
    return this.#manager.withLifecycleLock(() => {
      try {
        const current = this.#manager.readLifecycleRegistry();
        const replay = findMutation(current.packages, request.requestId);
        if (replay) return this.#adoptReplay(request, replay.record, replay.mutation, current);
        if (current.revision !== request.expectedRegistryRevision) return enabledResult(identity, "stale", this.#project(current));
        const record = current.packages.find((candidate) => candidate.packageId === request.packageId);
        if (!record) return enabledResult(identity, "not_found", this.#project(current));
        this.#manager.lifecycleStore.assertInstalled(record);
        if (!isReviewedPiPackageRuntimeRecord(record)) return enabledResult(identity, "ineligible", this.#project(current));
        if (record.enabled === request.enabled) return enabledResult(identity, "committed", this.#project(current));
        const committedRegistryRevision = current.revision + 1;
        const mutation: PackageRuntimeMutationRecord = {
          requestId: request.requestId,
          expectedRegistryRevision: request.expectedRegistryRevision,
          enabled: request.enabled,
          committedRegistryRevision
        };
        const replacement: PiPackageRecord = {
          ...record,
          enabled: request.enabled,
          runtimeMutations: [...(record.runtimeMutations ?? []), mutation].slice(-1_024)
        };
        const next = this.#manager.replaceLifecycleRecord(current.revision, record, replacement);
        return enabledResult(identity, "committed", this.#project(next));
      } catch {
        return enabledResult(identity, "failed");
      }
    });
  }

  isEnabled(): boolean {
    try {
      const registry = this.#manager.readLifecycleRegistry();
      const record = registry.packages.find((candidate) =>
        candidate.packageName === REVIEWED_PI_BTW_RUNTIME.packageName
      );
      if (!record?.enabled || !isReviewedPiPackageRuntimeRecord(record)) return false;
      this.#manager.lifecycleStore.assertInstalled(record);
      return true;
    } catch { return false; }
  }

  async ask(question: string, signal: AbortSignal, authority?: PermissionedExternalExecutionAuthority): Promise<string> {
    assertPermissionedExternalExecutionAuthority(authority, "call_cloud_model_with_private_or_large_source");
    if (!this.isEnabled()) throw new PigeDomainError("package.runtime_disabled", "The reviewed Pi package runtime is disabled.");
    const runtimeConfig = this.#providers.getDefaultRuntimeConfig();
    if (!runtimeConfig) throw new PigeDomainError("model_provider.not_configured", "No default model is available.");
    const result = await this.#runtime.run({
      runtimeConfig,
      jobId: `pi_btw_${createHash("sha256").update(question, "utf8").digest("hex").slice(0, 24)}`,
      systemPrompt: "Answer the side question directly and concisely. Do not call tools or modify the main conversation.",
      userPrompt: question,
      tools: [],
      signal,
      limits: { maxWallTimeMs: 60_000, maxToolCalls: 0, maxWorkBytes: 64_000, maxAssistantCharacters: ANSWER_LIMIT }
    });
    return result.assistantText;
  }

  #project(registry: ReturnType<PiPackageManagerService["readLifecycleRegistry"]>): PiPackageRegistrySummary {
    return this.#manager.projectLifecycleRegistry(registry);
  }

  #adoptReplay(
    request: PiPackageSetEnabledRequest,
    record: PiPackageRecord,
    mutation: PackageRuntimeMutationRecord,
    registry: ReturnType<PiPackageManagerService["readLifecycleRegistry"]>
  ): PiPackageSetEnabledResult {
    const identity = enabledIdentity(request);
    if (mutation.expectedRegistryRevision !== request.expectedRegistryRevision || mutation.enabled !== request.enabled ||
      record.packageId !== request.packageId) return enabledResult(identity, "failed");
    return record.enabled === mutation.enabled && registry.revision >= mutation.committedRegistryRevision
      ? enabledResult(identity, "committed", this.#project(registry))
      : enabledResult(identity, "failed");
  }
}

export function createReviewedPiBtwCapabilityAdapter(runtime: PiPackageRuntimeService): PermissionedExternalCapabilityAdapter {
  return {
    tool: {
      name: "pige_pi_btw", label: "Ask a side question",
      description: "Ask one bounded side question without adding its answer to the main conversation history.",
      parameters: { type: "object", additionalProperties: false, properties: {
        question: { type: "string", minLength: 1, maxLength: QUESTION_LIMIT }
      }, required: ["question"] },
      outputSchema: { type: "object", additionalProperties: false, properties: {
        answer: { type: "string", minLength: 1, maxLength: ANSWER_LIMIT }
      }, required: ["answer"] },
      effect: "read_only", inputTrust: "model_generated", outputTrust: "untrusted_source",
      dataBoundary: { resourceScope: "current_vault", pathAuthority: "host_only", sourceIdAuthority: "host_only", modelAuthority: "none" },
      execution: "sequential", idempotency: { mode: "idempotent", scope: "tool_call" },
      limits: { maxInputBytes: 8_192, maxOutputBytes: 20_000, timeoutMs: 60_000 },
      ownerService: "PiPackageRuntimeService"
    },
    actor: { type: "package", id: "pkg_narumitw_pi_btw", displayName: "Pi BTW", version: REVIEWED_PI_BTW_RUNTIME.version, digest: ACTOR_DIGEST },
    action: { id: "package.pi_btw.side_question", version: "1", labelKey: "permissions.actions.pi_btw_side_question" },
    permission: {
      capability: "call_cloud_model_with_private_or_large_source", dataBoundary: "cloud",
      resourceScope: "current_action", reasonCode: "package.pi_btw.side_question"
    },
    isAvailable: () => runtime.isEnabled(),
    normalizeInput: (args) => normalizeQuestion(args),
    resourceIdentity: (input) => ({ questionHash: createHash("sha256").update((input as { question: string }).question, "utf8").digest("hex") }),
    resourceDisplayName: () => "Pi BTW side question",
    resourceCount: () => 1,
    execute: async (input, signal, _context, authority) => {
      const answer = await runtime.ask((input as { question: string }).question, signal, authority);
      return createPigeTextToolResult(answer, { answer });
    }
  };
}

function normalizeQuestion(args: unknown): { readonly question: string } {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new PigeDomainError("package.runtime_input_invalid", "Pi BTW input is invalid.");
  const question = (args as { question?: unknown }).question;
  if (typeof question !== "string" || question !== question.trim() || question.length === 0 || Array.from(question).length > QUESTION_LIMIT ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(question)) {
    throw new PigeDomainError("package.runtime_input_invalid", "Pi BTW question is invalid.");
  }
  return { question };
}

function findMutation(records: readonly PiPackageRecord[], requestId: string) {
  for (const record of records) {
    const mutation = record.runtimeMutations?.find((candidate) => candidate.requestId === requestId);
    if (mutation) return { record, mutation };
  }
  return undefined;
}

function enabledIdentity(request: PiPackageSetEnabledRequest) {
  return { apiVersion: request.apiVersion, requestId: request.requestId, packageId: request.packageId, enabled: request.enabled } as const;
}
function enabledResult(
  identity: ReturnType<typeof enabledIdentity>,
  status: "committed" | "stale" | "not_found" | "ineligible" | "failed",
  registry?: PiPackageRegistrySummary
): PiPackageSetEnabledResult {
  return PiPackageSetEnabledResultSchema.parse({ ...identity, status, ...(registry ? { registry } : {}) });
}
