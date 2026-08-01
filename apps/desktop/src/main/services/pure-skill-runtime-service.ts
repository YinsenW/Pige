import { createHash } from "node:crypto";
import { PigeDomainError } from "@pige/domain";
import { type SkillManifest, type SkillRegistryFile } from "@pige/schemas";
import { createPigeTextToolResult, type PigeAgentToolDefinition } from "./pi-agent-tool-boundary";
import { type SkillBundleFile } from "./skill-zip-stage-service";

const MAX_ACTIVE_SKILLS_PER_TURN = 8;

export interface PureSkillRuntimeIdentity {
  readonly skillId: string;
  readonly skillVersion: string;
  readonly scope: "machine_local" | "vault";
  readonly manifestSha256: string;
  readonly bundleSha256: string;
  readonly registryRevision: number;
}

export interface EnabledPureSkillRuntime {
  readonly identity: PureSkillRuntimeIdentity;
  readonly name: string;
  readonly description: string;
  readonly triggers: readonly string[];
  readonly files: readonly SkillBundleFile[];
}

export interface PureSkillRuntimeCatalogPort {
  enabledPureSkillRuntimes(activeVaultId: string): readonly EnabledPureSkillRuntime[];
}

export interface PureSkillRuntimeTurn {
  readonly activeVaultId: string;
  readonly authoredTaskIntent: "explicit_user_task" | "neutral_attachment";
  readonly authoredText: string | undefined;
  readonly assertCurrent: () => void;
}

export class PureSkillRuntimeService {
  readonly #catalog: PureSkillRuntimeCatalogPort;

  constructor(catalog: PureSkillRuntimeCatalogPort) {
    this.#catalog = catalog;
  }

  toolsForTurn(turn: PureSkillRuntimeTurn): readonly PigeAgentToolDefinition[] {
    if (turn.authoredTaskIntent !== "explicit_user_task" || !turn.authoredText?.trim()) return [];
    turn.assertCurrent();
    const selected = this.#catalog.enabledPureSkillRuntimes(turn.activeVaultId)
      .filter((runtime) => isRelevant(runtime, turn.authoredText!))
      .slice(0, MAX_ACTIVE_SKILLS_PER_TURN);
    return selected.map((runtime) => createRuntimeTool(runtime, turn, this.#catalog));
  }
}

export function projectEnabledPureSkillRuntimes(
  registry: SkillRegistryFile,
  scope: "machine_local" | "vault",
  readManifest: (skillId: string) => {
    readonly manifest: SkillManifest;
    readonly sha256: string;
    readonly bundleSha256: string;
    readonly files: readonly SkillBundleFile[];
  }
): readonly EnabledPureSkillRuntime[] {
  const runtimes: EnabledPureSkillRuntime[] = [];
  for (const record of registry.skills) {
    if (!record.enabled || record.trust !== "user_confirmed") continue;
    try {
      const loaded = readManifest(record.id);
      const manifest = loaded.manifest;
      if (manifest.kind !== "pure" || manifest.scope !== scope || loaded.sha256 !== record.manifestSha256 ||
        manifest.id !== record.id || manifest.version !== record.version) continue;
      runtimes.push(Object.freeze({
        identity: Object.freeze({
          skillId: manifest.id,
          skillVersion: manifest.version,
          scope,
          manifestSha256: loaded.sha256,
          bundleSha256: loaded.bundleSha256,
          registryRevision: registry.revision
        }),
        name: manifest.name,
        description: manifest.description,
        triggers: Object.freeze([...(manifest.triggers ?? [])]),
        files: Object.freeze(loaded.files.map((file) => Object.freeze({ ...file })))
      }));
    } catch {
      // Invalid or drifting installed bytes contribute no runtime authority.
    }
  }
  return Object.freeze(runtimes.sort((left, right) =>
    left.identity.skillId.localeCompare(right.identity.skillId, "en")));
}

function createRuntimeTool(
  selected: EnabledPureSkillRuntime,
  turn: PureSkillRuntimeTurn,
  catalog: PureSkillRuntimeCatalogPort
): PigeAgentToolDefinition {
  const fileNames = selected.files.map((file) => file.relativePath);
  const assertCurrent = (): void => {
    turn.assertCurrent();
    const current = catalog.enabledPureSkillRuntimes(turn.activeVaultId)
      .find((candidate) => candidate.identity.scope === selected.identity.scope &&
        candidate.identity.skillId === selected.identity.skillId);
    if (!current || !sameRuntime(current, selected)) throw staleRuntime();
  };
  return {
    name: `pige_use_skill_${digest(selected.identity.scope, selected.identity.skillId).slice(0, 16)}`,
    label: `Use ${selected.identity.skillId}`,
    description: truncateUtf8(
      `${selected.name}: ${selected.description} Read this enabled Skill's reviewed instruction or reference file when it is relevant.`,
      1_800
    ),
    version: "1",
    capability: "skill.instructions.read",
    parameters: strictObjectSchema({ relativePath: { enum: fileNames } }, ["relativePath"]),
    outputSchema: strictObjectSchema({
      skillId: { type: "string" },
      skillName: { type: "string" },
      skillVersion: { type: "string" },
      relativePath: { enum: fileNames },
      sha256: { type: "string" }
    }, ["skillId", "skillName", "skillVersion", "relativePath", "sha256"]),
    effect: "read_only",
    inputTrust: "model_generated",
    outputTrust: "untrusted_source",
    dataBoundary: {
      resourceScope: "current_vault",
      pathAuthority: "host_only",
      sourceIdAuthority: "host_only",
      modelAuthority: "none"
    },
    execution: "parallel_read_only",
    idempotency: { mode: "idempotent", scope: "current_vault" },
    limits: { maxInputBytes: 2_048, maxOutputBytes: 512 * 1_024, timeoutMs: 5_000 },
    ownerService: "PureSkillRuntimeService",
    authorize: () => {
      assertCurrent();
      return true;
    },
    execute: async (args) => {
      assertCurrent();
      const relativePath = readRelativePath(args, fileNames);
      const file = selected.files.find((candidate) => candidate.relativePath === relativePath);
      if (!file) throw invalidInput();
      assertCurrent();
      return createPigeTextToolResult(file.bytes.toString("utf8"), {
        skillId: selected.identity.skillId,
        skillName: selected.name,
        skillVersion: selected.identity.skillVersion,
        relativePath: file.relativePath,
        sha256: file.sha256
      });
    }
  };
}

function isRelevant(runtime: EnabledPureSkillRuntime, authoredText: string): boolean {
  const normalized = authoredText.normalize("NFKC").toLocaleLowerCase("en");
  return [runtime.name, runtime.identity.skillId, ...runtime.triggers]
    .some((candidate) => normalized.includes(candidate.normalize("NFKC").toLocaleLowerCase("en")));
}

function sameRuntime(left: EnabledPureSkillRuntime, right: EnabledPureSkillRuntime): boolean {
  return JSON.stringify(left.identity) === JSON.stringify(right.identity) &&
    left.files.length === right.files.length && left.files.every((file, index) => {
      const expected = right.files[index];
      return expected !== undefined && file.relativePath === expected.relativePath && file.sha256 === expected.sha256;
    });
}

function readRelativePath(value: unknown, allowed: readonly string[]): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidInput();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.relativePath !== "string" ||
    !allowed.includes(record.relativePath)) throw invalidInput();
  return record.relativePath;
}

function strictObjectSchema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[]
): Readonly<Record<string, unknown>> {
  return Object.freeze({ type: "object", additionalProperties: false, properties, required });
}

function digest(...parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\0"), "utf8").digest("hex");
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) return value;
  let output = "";
  for (const character of value) {
    if (Buffer.byteLength(output + character, "utf8") > maximumBytes - 3) break;
    output += character;
  }
  return `${output}...`;
}

function staleRuntime(): PigeDomainError {
  return new PigeDomainError("skill.runtime_binding_changed", "The enabled pure Skill runtime binding changed.");
}

function invalidInput(): PigeDomainError {
  return new PigeDomainError("agent_runtime.tool_input_invalid", "The pure Skill file request is invalid.");
}
