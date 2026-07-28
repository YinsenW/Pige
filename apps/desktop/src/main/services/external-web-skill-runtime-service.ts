import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  ExternalWebSkillReadRequestSchema,
  ExternalWebSkillReadResultSchema,
  type ExternalWebSkillReadRequest,
  type ExternalWebSkillRuntimeIdentity
} from "@pige/schemas";
import { PigeDomainError } from "@pige/domain";
import {
  assertPermissionedExternalExecutionAuthority,
  type PermissionedExternalCapabilityAdapter,
  type PermissionedExternalTurnContext
} from "./permissioned-external-capability-service";
import { createPigeTextToolResult, type PigeAgentToolDefinition } from "./pi-agent-tool-boundary";
import { type EnabledExternalWebSkillRuntime } from "./skill-registry-lifecycle-store";
import { SkillRegistryService } from "./skill-registry-service";
import { SourceFetchService } from "./source-fetch-service";

const MAX_MODEL_TEXT_CHARACTERS = 64_000;
const TOOL_NAME = "pige_external_web_read";

export interface ExternalWebSkillRuntimeTurn extends PermissionedExternalTurnContext {
  readonly authoredTaskIntent: "explicit_user_task" | "neutral_attachment";
  readonly authoredText: string | undefined;
}

export interface ExternalWebSkillCapabilityPort {
  toolsForTurn(
    adapter: PermissionedExternalCapabilityAdapter,
    turn: PermissionedExternalTurnContext
  ): readonly PigeAgentToolDefinition[];
}

export class ExternalWebSkillRuntimeService {
  readonly #registry: SkillRegistryService;
  readonly #capabilities: ExternalWebSkillCapabilityPort;
  readonly #fetcher: SourceFetchService;

  constructor(input: {
    readonly registry: SkillRegistryService;
    readonly capabilities: ExternalWebSkillCapabilityPort;
    readonly fetcher?: SourceFetchService;
  }) {
    this.#registry = input.registry;
    this.#capabilities = input.capabilities;
    this.#fetcher = input.fetcher ?? new SourceFetchService();
  }

  toolsForTurn(turn: ExternalWebSkillRuntimeTurn): readonly PigeAgentToolDefinition[] {
    if (turn.authoredTaskIntent !== "explicit_user_task" || !turn.authoredText?.trim()) return [];
    const candidates = this.#registry.enabledExternalWebRuntimes();
    if (candidates.length !== 1) return [];
    const selected = candidates[0]!;
    const assertCurrent = (): void => {
      turn.assertCurrent();
      const current = this.#registry.enabledExternalWebRuntimes();
      if (current.length !== 1 || !sameIdentity(current[0]!.identity, selected.identity)) throw staleRuntime();
    };
    const adapter = createAdapter(selected, this.#fetcher, assertCurrent);
    return this.#capabilities.toolsForTurn(adapter, {
      ...turn,
      assertCurrent
    });
  }
}

function createAdapter(
  selected: EnabledExternalWebSkillRuntime,
  fetcher: SourceFetchService,
  assertCurrent: () => void
): PermissionedExternalCapabilityAdapter {
  const { identity } = selected;
  return {
    tool: {
      name: TOOL_NAME,
      label: `Read with ${selected.name}`,
      description: `Read public HTTPS content from the reviewed origin ${identity.runtime.origin} using the enabled ${selected.name} Skill.`,
      parameters: strictObjectSchema({
        url: { type: "string", minLength: 1, maxLength: 2_048 }
      }, ["url"]),
      outputSchema: strictObjectSchema({
        status: { enum: ["ready"] },
        origin: { type: "string" },
        contentType: { type: "string" },
        byteLength: { type: "integer", minimum: 0, maximum: 16 * 1024 * 1024 },
        truncated: { type: "boolean" },
        warningCount: { type: "integer", minimum: 0, maximum: 32 }
      }, ["status", "origin", "contentType", "byteLength", "truncated", "warningCount"]),
      effect: "read_only",
      inputTrust: "model_generated",
      outputTrust: "untrusted_source",
      dataBoundary: {
        resourceScope: "current_url",
        pathAuthority: "host_only",
        sourceIdAuthority: "host_only",
        modelAuthority: "none"
      },
      execution: "sequential",
      idempotency: { mode: "idempotent", scope: "tool_call" },
      limits: { maxInputBytes: 8 * 1_024, maxOutputBytes: 256 * 1_024, timeoutMs: 15_000 },
      ownerService: "ExternalWebSkillRuntimeService"
    },
    actor: {
      type: "skill",
      id: `skill:${identity.skillId}`,
      displayName: selected.name,
      version: identity.skillVersion,
      digest: identity.runtimeIdentityHash
    },
    action: { id: "external_web.read_https", version: "1", labelKey: "permissions.actions.external_web_read" },
    permission: {
      capability: "external_network",
      dataBoundary: "network",
      resourceScope: "current_url",
      reasonCode: "external_web.read_https",
      highRisk: () => ({
        effect: "external_web_skill_https_read",
        presentation: {
          action: "read_external_web",
          target: "reviewed_https_origin",
          subject: {
            kind: "external_web_skill",
            value: selected.name,
            version: identity.skillVersion,
            origin: identity.runtime.origin,
            capability: "external_network",
            dataBoundary: "network"
          }
        }
      })
    },
    normalizeInput: (value) => ExternalWebSkillReadRequestSchema.parse(value),
    resourceIdentity: (value) => ({
      origin: identity.runtime.origin,
      requestHash: digest((value as ExternalWebSkillReadRequest).url),
      runtimeIdentityHash: identity.runtimeIdentityHash
    }),
    resourceCount: () => 1,
    execute: async (value, signal, _context, authority) => {
      assertPermissionedExternalExecutionAuthority(authority, "external_network");
      assertCurrent();
      const request = ExternalWebSkillReadRequestSchema.parse(value);
      const snapshot = await fetcher.fetchSnapshot(request.url, signal, {
        requiredHttpsOrigin: identity.runtime.origin
      });
      assertCurrent();
      const content = Array.from(snapshot.extractedText).slice(0, MAX_MODEL_TEXT_CHARACTERS).join("");
      const result = ExternalWebSkillReadResultSchema.parse({
        status: "ready",
        origin: identity.runtime.origin,
        contentType: snapshot.contentType,
        byteLength: Buffer.byteLength(snapshot.rawContent, "utf8"),
        truncated: snapshot.extraction?.truncated === true || content.length < snapshot.extractedText.length,
        warningCount: snapshot.warnings.length
      });
      return createPigeTextToolResult(content, result);
    }
  };
}

function sameIdentity(left: ExternalWebSkillRuntimeIdentity, right: ExternalWebSkillRuntimeIdentity): boolean {
  return left.runtimeIdentityHash === right.runtimeIdentityHash && JSON.stringify(left) === JSON.stringify(right);
}

function strictObjectSchema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[]
): Readonly<Record<string, unknown>> {
  return Object.freeze({ type: "object", additionalProperties: false, properties, required });
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function staleRuntime(): PigeDomainError {
  return new PigeDomainError("permission.binding_changed", "The External/Web Skill runtime binding changed.");
}
