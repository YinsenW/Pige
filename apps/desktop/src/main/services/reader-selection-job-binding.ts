import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  AgentConversationInputPresentation,
  ReaderSelectionIdentity,
  ReaderSelectionReadAction,
  ReaderSelectionTransformAction
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  ReaderSelectionIdentitySchema,
  type JobRecord,
  type PigeErrorSummary
} from "@pige/schemas";
import type { ResolveJobReviewInput } from "./job-execution-coordinator";
import {
  readCurrentNoteEvidenceBinding,
  readCurrentNoteSelectionEvidenceBinding,
  type CurrentNoteEvidenceBinding
} from "./retrieval-evidence-boundary";

export interface ReaderSelectionJobScope {
  readonly pageId: string;
  readonly bindingHash: string;
  readonly selection?: ReaderSelectionIdentity;
  readonly transformAction?: ReaderSelectionTransformAction;
}

export interface ReaderSelectionTurnContext {
  readonly currentNoteSelection?: ReaderSelectionIdentity;
  readonly currentNoteReadAction?: ReaderSelectionReadAction;
  readonly currentNoteTransformAction?: ReaderSelectionTransformAction;
}

type JobRef = NonNullable<JobRecord["inputRefs"]>[number];

const SCOPE_ROLE = "agent_turn_current_note_scope";
const SELECTION_ROLE = "agent_turn_reader_selection";
const TRANSFORM_ROLE = "agent_turn_reader_transform";

export function createReaderSelectionPublicationIntentHash(
  jobId: string,
  action: ReaderSelectionTransformAction,
  selection: ReaderSelectionIdentity,
  replacement: string
): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify({ jobId, action, selection, replacement }), "utf8")
    .digest("hex")}`;
}

export function createReaderSelectionPublicationArtifact(
  jobId: string,
  action: ReaderSelectionTransformAction,
  selection: ReaderSelectionIdentity,
  replacement: string
): { readonly id: string; readonly checksum: string } {
  const checksum = createReaderSelectionPublicationIntentHash(jobId, action, selection, replacement);
  return {
    id: `art_reader_selection_${checksum.slice("sha256:".length, "sha256:".length + 16)}`,
    checksum
  };
}

export function validateReaderSelectionTurnContext(input: {
  readonly scopePageId?: string;
  readonly sourceTurn: boolean;
  readonly prepared: boolean;
  readonly context: ReaderSelectionTurnContext;
}): void {
  const { context } = input;
  if (
    context.currentNoteSelection &&
    (input.scopePageId !== context.currentNoteSelection.pageId || input.sourceTurn || input.prepared)
  ) {
    throw new PigeDomainError(
      "agent_runtime.turn_binding_invalid",
      "A Reader selection action requires the exact current-note scope."
    );
  }
  if ((context.currentNoteReadAction || context.currentNoteTransformAction) && !context.currentNoteSelection) {
    throw new PigeDomainError(
      "agent_runtime.turn_binding_invalid",
      "A Reader selection presentation requires an exact selection identity."
    );
  }
  if (context.currentNoteReadAction && context.currentNoteTransformAction) {
    throw new PigeDomainError(
      "agent_runtime.turn_binding_invalid",
      "One Reader selection turn cannot bind read and transform actions together."
    );
  }
}

export function readerSelectionInputPresentation(
  context: ReaderSelectionTurnContext
): AgentConversationInputPresentation | undefined {
  if (context.currentNoteReadAction) {
    return { kind: "reader_selection_action", action: context.currentNoteReadAction };
  }
  if (context.currentNoteTransformAction) {
    return { kind: "reader_selection_transform", action: context.currentNoteTransformAction };
  }
  return undefined;
}

export function readInitialReaderSelectionEvidence(
  vaultPath: string,
  pageId: string,
  context: ReaderSelectionTurnContext
): CurrentNoteEvidenceBinding {
  return context.currentNoteSelection
    ? readCurrentNoteSelectionEvidenceBinding(vaultPath, context.currentNoteSelection)
    : readCurrentNoteEvidenceBinding(vaultPath, pageId);
}

export function createReaderSelectionJobScope(
  pageId: string,
  bindingHash: string,
  context: ReaderSelectionTurnContext
): ReaderSelectionJobScope {
  return {
    pageId,
    bindingHash,
    ...(context.currentNoteSelection ? { selection: context.currentNoteSelection } : {}),
    ...(context.currentNoteSelection && context.currentNoteTransformAction
      ? { transformAction: context.currentNoteTransformAction }
      : {})
  };
}

export function readBoundReaderSelectionEvidence(
  vaultPath: string,
  pageId: string,
  job: JobRecord
): CurrentNoteEvidenceBinding {
  const selectionRefs = (job.inputRefs ?? []).filter((ref) => ref.role === SELECTION_ROLE);
  if (selectionRefs.length === 0) return readCurrentNoteEvidenceBinding(vaultPath, pageId);
  const selectionRef = selectionRefs[0];
  const locator = /^utf8_bytes:(\d+):(\d+)$/u.exec(selectionRef?.locator ?? "");
  if (
    selectionRefs.length !== 1 ||
    selectionRef?.kind !== "page" ||
    selectionRef.id !== pageId ||
    !selectionRef.checksum ||
    !locator
  ) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The durable Reader selection binding is invalid.");
  }
  const current = readCurrentNoteEvidenceBinding(vaultPath, pageId);
  return readCurrentNoteSelectionEvidenceBinding(vaultPath, {
    pageId,
    pageContentHash: current.contentHash,
    span: {
      unit: "utf8_bytes",
      start: Number(locator[1]),
      endExclusive: Number(locator[2])
    },
    selectedContentHash: selectionRef.checksum
  });
}

export function readReaderSelectionTransformBinding(job: JobRecord): {
  readonly selection: ReaderSelectionIdentity;
  readonly action: ReaderSelectionTransformAction;
} | undefined {
  const refs = job.inputRefs ?? [];
  const transformRefs = refs.filter((ref) => ref.role === TRANSFORM_ROLE);
  if (transformRefs.length === 0) return undefined;
  const scopeRefs = refs.filter((ref) => ref.role === SCOPE_ROLE);
  const selectionRefs = refs.filter((ref) => ref.role === SELECTION_ROLE);
  const transform = transformRefs[0];
  const scope = scopeRefs[0];
  const selection = selectionRefs[0];
  const actionMatch = /^reader_selection_(translate|polish|expand)$/u.exec(transform?.id ?? "");
  const locatorMatch = /^utf8_bytes:(\d+):(\d+)$/u.exec(selection?.locator ?? "");
  const parsed = ReaderSelectionIdentitySchema.safeParse({
    pageId: scope?.id,
    pageContentHash: transform?.checksum,
    span: {
      unit: "utf8_bytes",
      start: Number(locatorMatch?.[1]),
      endExclusive: Number(locatorMatch?.[2])
    },
    selectedContentHash: selection?.checksum
  });
  if (
    transformRefs.length !== 1 ||
    scopeRefs.length !== 1 ||
    selectionRefs.length !== 1 ||
    transform?.kind !== "tool" ||
    selection?.kind !== "page" ||
    selection.id !== scope?.id ||
    !actionMatch ||
    !locatorMatch ||
    !parsed.success
  ) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The durable Reader transform binding is invalid.");
  }
  return { selection: parsed.data, action: actionMatch[1] as ReaderSelectionTransformAction };
}

export function isValidReaderSelectionJobScope(
  scope: ReaderSelectionJobScope,
  hasSourceBinding: boolean
): boolean {
  return /^page_\d{8}_[a-z0-9]{8,}$/u.test(scope.pageId) &&
    /^sha256:[a-f0-9]{64}$/u.test(scope.bindingHash) &&
    (scope.selection === undefined || (
      ReaderSelectionIdentitySchema.safeParse(scope.selection).success &&
      scope.selection.pageId === scope.pageId
    )) &&
    (scope.transformAction === undefined || (
      scope.selection !== undefined &&
      ["translate", "polish", "expand"].includes(scope.transformAction)
    )) &&
    !hasSourceBinding;
}

export function createReaderSelectionJobRefs(scope: ReaderSelectionJobScope): JobRef[] {
  return [
    {
      kind: "page",
      id: scope.pageId,
      role: SCOPE_ROLE,
      checksum: scope.bindingHash
    },
    ...(scope.selection ? [createSelectionRef(scope.selection)] : []),
    ...(scope.selection && scope.transformAction
      ? [createTransformRef(scope.selection, scope.transformAction)]
      : [])
  ];
}

export function assertReaderSelectionJobBinding(
  inputRefs: readonly JobRef[] | undefined,
  scope: ReaderSelectionJobScope | undefined
): void {
  const refs = inputRefs ?? [];
  const scopeRefs = refs.filter((ref) => ref.role === SCOPE_ROLE);
  const selectionRefs = refs.filter((ref) => ref.role === SELECTION_ROLE);
  const transformRefs = refs.filter((ref) => ref.role === TRANSFORM_ROLE);
  const expected = scope ? createReaderSelectionJobRefs(scope) : [];
  const expectedScope = expected.find((ref) => ref.role === SCOPE_ROLE);
  const expectedSelection = expected.find((ref) => ref.role === SELECTION_ROLE);
  const expectedTransform = expected.find((ref) => ref.role === TRANSFORM_ROLE);

  if (
    (expectedScope && !scopeRefs[0]) ||
    (expectedSelection && !selectionRefs[0]) ||
    (expectedTransform && !transformRefs[0])
  ) {
    throw new PigeDomainError(
      "agent_runtime.turn_binding_invalid",
      "A current-note Agent Job cannot adopt an evidence binding after creation."
    );
  }
  if (
    scopeRefs.length > 1 ||
    selectionRefs.length > 1 ||
    transformRefs.length > 1 ||
    !isDeepStrictEqual(scopeRefs[0], expectedScope) ||
    !isDeepStrictEqual(selectionRefs[0], expectedSelection) ||
    !isDeepStrictEqual(transformRefs[0], expectedTransform)
  ) {
    throw new PigeDomainError(
      "agent_runtime.turn_conflict",
      "The existing Agent Job binding does not match the preserved turn."
    );
  }
}

export function createReaderSelectionReviewResolution(input: {
  readonly proposalId: string;
  readonly result: "completed" | "failed_final";
  readonly operationId?: string;
  readonly error?: PigeErrorSummary;
}): ResolveJobReviewInput {
  const outputRefs = input.operationId
    ? [{ kind: "operation" as const, id: input.operationId, role: "reader_selection_transform_operation" }]
    : [];
  return {
    proposalId: input.proposalId,
    result: input.result,
    ...(input.error ? { error: input.error } : {}),
    facts: {
      stage: "planning",
      outputRefs,
      ...(input.operationId ? { operationIds: [input.operationId] } : {})
    },
    message: input.result === "completed"
      ? "The Reader selection review was resolved."
      : "The Reader selection review conflicted with current note state."
  };
}

function createSelectionRef(selection: ReaderSelectionIdentity): JobRef {
  return {
    kind: "page",
    id: selection.pageId,
    role: SELECTION_ROLE,
    checksum: selection.selectedContentHash,
    locator: `utf8_bytes:${selection.span.start}:${selection.span.endExclusive}`
  };
}

function createTransformRef(
  selection: ReaderSelectionIdentity,
  action: ReaderSelectionTransformAction
): JobRef {
  return {
    kind: "tool",
    id: `reader_selection_${action}`,
    role: TRANSFORM_ROLE,
    checksum: selection.pageContentHash
  };
}
