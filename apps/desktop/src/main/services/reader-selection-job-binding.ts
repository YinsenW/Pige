import { isDeepStrictEqual } from "node:util";
import type {
  ReaderSelectionIdentity,
  ReaderSelectionTransformAction
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  ReaderSelectionIdentitySchema,
  type JobRecord,
  type PigeErrorSummary
} from "@pige/schemas";
import type { ResolveJobReviewInput } from "./job-execution-coordinator";

export interface ReaderSelectionJobScope {
  readonly pageId: string;
  readonly bindingHash: string;
  readonly selection?: ReaderSelectionIdentity;
  readonly transformAction?: ReaderSelectionTransformAction;
}

type JobRef = NonNullable<JobRecord["inputRefs"]>[number];

const SCOPE_ROLE = "agent_turn_current_note_scope";
const SELECTION_ROLE = "agent_turn_reader_selection";
const TRANSFORM_ROLE = "agent_turn_reader_transform";

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
