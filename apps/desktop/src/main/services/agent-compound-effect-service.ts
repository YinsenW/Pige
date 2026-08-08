import { PigeDomainError } from "@pige/domain";

export const AGENT_COMPOUND_EFFECT_CHECKPOINT_ID = "agent_existing_note_update_started";
export const MAX_AGENT_COMPOUND_EFFECTS = 2;
const COMPOUND_EFFECT_CONFLICT_CODE = ["agent", "ingest"].join("_") + ".page_conflict";

export interface AgentCompoundEffectUserTurn {
  readonly text: string;
  readonly authoredTaskIntent?: "explicit_user_task" | "neutral_attachment";
  readonly locale?: "en" | "de" | "fr" | "ja" | "ko" | "zh-Hans";
}

export interface AgentCompoundEffectBinding {
  readonly pageId: string;
  readonly toolId: string;
  readonly canonicalInputHash: string;
  readonly checkpointId: string;
  readonly operationId?: string;
}

export interface AgentCompoundEffectReplay<T> {
  readonly toolId: string;
  readonly inputHash: string;
  readonly execute: () => Promise<T>;
}

export interface AgentCompoundEffectCoordinator<T> {
  readonly bindings: readonly AgentCompoundEffectBinding[];
  register(
    next: Omit<AgentCompoundEffectBinding, "checkpointId" | "operationId">,
    generatedPageEffect?: boolean
  ): AgentCompoundEffectBinding;
  recordOperation(binding: AgentCompoundEffectBinding, operationId: string): void;
  replay(toolId: string, inputHash: string): Promise<T> | undefined;
  remember(replay: AgentCompoundEffectReplay<T>): void;
  assertNoPrior(generatedPageEffect?: boolean): void;
}

export function createAgentCompoundEffectCoordinator<T>(
  authorized: boolean
): AgentCompoundEffectCoordinator<T> {
  let bindings: AgentCompoundEffectBinding[] = [];
  const replays: AgentCompoundEffectReplay<T>[] = [];
  const conflict = (message: string): never => {
    throw new PigeDomainError(COMPOUND_EFFECT_CONFLICT_CODE, message);
  };
  return {
    get bindings() {
      return bindings;
    },
    register(next, generatedPageEffect = false) {
      const existing = bindings.find((binding) =>
        binding.pageId === next.pageId && binding.toolId === next.toolId &&
        binding.canonicalInputHash === next.canonicalInputHash
      );
      if (existing) return existing;
      if (generatedPageEffect || bindings.length >= MAX_AGENT_COMPOUND_EFFECTS || (bindings.length > 0 && !authorized)) {
        return conflict("A different page mutation already owns this Agent Job.");
      }
      if (bindings.some((binding) => binding.pageId === next.pageId)) {
        return conflict("A second durable effect cannot target the same page in this Agent Job.");
      }
      const binding = { ...next, checkpointId: compoundEffectCheckpointId(bindings.length) };
      bindings = [...bindings, binding];
      return binding;
    },
    recordOperation(binding, operationId) {
      bindings = bindings.map((candidate) => candidate.checkpointId === binding.checkpointId ? { ...candidate, operationId } : candidate);
    },
    replay(toolId, inputHash) {
      const replay = replays.find((candidate) => candidate.toolId === toolId && candidate.inputHash === inputHash);
      if (replay) return replay.execute();
      if (replays.length > 0 && (!authorized || bindings.length >= MAX_AGENT_COMPOUND_EFFECTS)) {
        return conflict("A different page mutation already owns this Agent Job.");
      }
      return undefined;
    },
    remember(replay) {
      replays.push(replay);
    },
    assertNoPrior(generatedPageEffect = false) {
      if (generatedPageEffect || bindings.length > 0) conflict("A page mutation already owns this Agent Job.");
    }
  };
}

export function compoundEffectCheckpointIds(
  checkpoints: readonly { readonly id: string }[] | undefined
): string[] {
  return Array.from(new Set((checkpoints ?? []).map(({ id }) => id).filter(isCompoundEffectCheckpointId))).sort((left, right) => {
    const ordinal = (value: string) => value === AGENT_COMPOUND_EFFECT_CHECKPOINT_ID ? 1 : Number(value.split(":").at(-1));
    return ordinal(left) - ordinal(right);
  });
}

export function compoundEffectConflict(message: string): PigeDomainError {
  return new PigeDomainError(COMPOUND_EFFECT_CONFLICT_CODE, message);
}

export function hasExplicitAgentCompoundEffectIntent(
  userTurn: AgentCompoundEffectUserTurn | undefined
): boolean {
  if (!userTurn || userTurn.authoredTaskIntent !== "explicit_user_task") return false;
  const normalized = userTurn.text.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > 8_000) return false;
  if (/^[>"'`]|^```/u.test(normalized) || /["'`]/u.test(normalized)) return false;
  if (/\b(?:example|examples|explain|explaining|mention|mentions|mentioned|quote|quoted|says|said|source|excerpt)\b/iu.test(normalized)) {
    return false;
  }
  const patternsByLocale: Record<NonNullable<AgentCompoundEffectUserTurn["locale"]>, readonly RegExp[]> = {
    en: [
      /^(?:please\s+)?(?:update|edit|revise)\b[\s\S]*\b(?:link|tag)\b/iu,
      /^(?:please\s+)?(?:link|tag)\b[\s\S]*\b(?:update|edit|revise)\b/iu
    ],
    de: [
      /^(?:bitte\s+)?(?:aktualisiere|aktualisieren|bearbeite|bearbeiten)\b[\s\S]*(?:verknüpf|tag)/iu,
      /^(?:bitte\s+)?(?:verknüpf|tag)[\s\S]*(?:aktualisiere|aktualisieren|bearbeite|bearbeiten)\b/iu
    ],
    fr: [
      /^(?:veuillez\s+)?(?:mettre à jour|modifie|modifier)\b[\s\S]*(?:lier|tag)/iu,
      /^(?:veuillez\s+)?(?:lier|tag)[\s\S]*(?:mettre à jour|modifie|modifier)\b/iu
    ],
    ja: [
      /^(?:現在の|この)?ノート[\s\S]*(?:更新|編集)[\s\S]*(?:リンク|タグ)/u,
      /^(?:現在の|この)?ノート[\s\S]*(?:リンク|タグ)[\s\S]*(?:更新|編集)/u
    ],
    ko: [
      /^(?:현재|이)?\s*노트[\s\S]*(?:업데이트|수정)[\s\S]*(?:연결|태그)/u,
      /^(?:현재|이)?\s*노트[\s\S]*(?:연결|태그)[\s\S]*(?:업데이트|수정)/u
    ],
    "zh-Hans": [
      /^(?:请)?(?:更新|修改|编辑)[\s\S]*(?:链接|标签)/u,
      /^(?:请)?(?:链接|标签)[\s\S]*(?:更新|修改|编辑)/u
    ]
  };
  const patterns = userTurn.locale ? patternsByLocale[userTurn.locale] : Object.values(patternsByLocale).flat();
  return patterns.some((pattern) => pattern.test(normalized));
}

export function compoundEffectCheckpointId(ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= MAX_AGENT_COMPOUND_EFFECTS) {
    throw new PigeDomainError(
      "agent_runtime.effect_limit",
      "The Agent turn exceeded its bounded durable-effect limit."
    );
  }
  return ordinal === 0
    ? AGENT_COMPOUND_EFFECT_CHECKPOINT_ID
    : `${AGENT_COMPOUND_EFFECT_CHECKPOINT_ID}:${ordinal + 1}`;
}

export function isCompoundEffectCheckpointId(value: string): boolean {
  return value === AGENT_COMPOUND_EFFECT_CHECKPOINT_ID || value === `${AGENT_COMPOUND_EFFECT_CHECKPOINT_ID}:2`;
}

export function mergeCompoundEffectOperationIds(
  preceding: readonly string[],
  bindings: readonly AgentCompoundEffectBinding[]
): string[] {
  return Array.from(new Set([
    ...preceding,
    ...bindings.flatMap((binding) => binding.operationId ? [binding.operationId] : [])
  ]));
}
