import { PigeDomainError } from "@pige/domain";
import type { AgentIngestOutput } from "@pige/schemas";
import type {
  PigeAgentToolCallContext,
  PigeAgentToolDescriptor,
  PigeAgentToolResult
} from "./pi-agent-runtime-adapter";

export const INSPECT_SOURCE_TOOL_NAME = "pige_inspect_source";
export const PARSE_SOURCE_TOOL_NAME = "pige_parse_source";
export const PARSE_SOURCE_TOOL_VERSION = "1";
export const OCR_SOURCE_TOOL_NAME = "pige_ocr_source";
export const OCR_SOURCE_TOOL_VERSION = "1";
export const SEARCH_KNOWLEDGE_TOOL_NAME = "pige_search_knowledge";
export const SEARCH_KNOWLEDGE_TOOL_VERSION = "1";
export const RESPOND_TO_USER_TOOL_NAME = "pige_respond_to_user";
export const RESPOND_TO_USER_TOOL_VERSION = "1";
export const CREATE_KNOWLEDGE_NOTE_TOOL_NAME = "pige_create_knowledge_note";
export const UPDATE_KNOWLEDGE_NOTE_TOOL_NAME = "pige_update_knowledge_note";
export const UPDATE_KNOWLEDGE_NOTE_TOOL_VERSION = "1";
export const ADD_KNOWLEDGE_TAGS_TOOL_NAME = "pige_add_knowledge_tags";
export const ADD_KNOWLEDGE_TAGS_TOOL_VERSION = "1";
export const LINK_KNOWLEDGE_NOTES_TOOL_NAME = "pige_link_knowledge_notes";
export const LINK_KNOWLEDGE_NOTES_TOOL_VERSION = "1";
export const STAGE_KNOWLEDGE_NOTE_PROPOSAL_TOOL_NAME = "pige_stage_knowledge_note_proposal";
export const STAGE_KNOWLEDGE_NOTE_PROPOSAL_TOOL_VERSION = "1";

export type AgentIngestToolCapability =
  | "read_current_source"
  | "parse_current_source"
  | "ocr_current_source"
  | "read_current_vault_knowledge"
  | "respond_current_source"
  | "stage_generated_note_proposal"
  | "organize_existing_note"
  | "link_existing_notes"
  | "update_existing_note"
  | "write_generated_note";

export interface AgentIngestToolAuthorizationRequest {
  readonly toolName:
    | typeof INSPECT_SOURCE_TOOL_NAME
    | typeof PARSE_SOURCE_TOOL_NAME
    | typeof OCR_SOURCE_TOOL_NAME
    | typeof SEARCH_KNOWLEDGE_TOOL_NAME
    | typeof RESPOND_TO_USER_TOOL_NAME
    | typeof STAGE_KNOWLEDGE_NOTE_PROPOSAL_TOOL_NAME
    | typeof ADD_KNOWLEDGE_TAGS_TOOL_NAME
    | typeof LINK_KNOWLEDGE_NOTES_TOOL_NAME
    | typeof UPDATE_KNOWLEDGE_NOTE_TOOL_NAME
    | typeof CREATE_KNOWLEDGE_NOTE_TOOL_NAME;
  readonly capability: AgentIngestToolCapability;
  readonly jobId: string;
  readonly sourceId: string;
  readonly toolCallId: string;
}

export interface AgentIngestToolAuthorizationPort {
  authorize(request: AgentIngestToolAuthorizationRequest): boolean | Promise<boolean>;
}

export interface AgentIngestInspectToolResult {
  readonly modelText: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly terminate?: boolean;
}

export interface AgentIngestParseToolResult {
  readonly modelText: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly terminate?: boolean;
}

export interface AgentIngestOcrToolResult {
  readonly modelText: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly terminate?: boolean;
}

export interface AgentIngestSearchToolResult {
  readonly modelText: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly terminate?: boolean;
}

export interface AgentIngestPublishToolResult {
  readonly modelText: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly terminate?: boolean;
}

export interface AgentIngestStageProposalToolResult {
  readonly modelText: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly terminate?: boolean;
}

export interface AgentIngestRespondToolInput {
  readonly answer: string;
  readonly evidenceRefs: readonly string[];
}

export type AgentIngestToolOutput = AgentIngestOutput & {
  readonly relatedPageRefs?: readonly string[];
};

export interface AgentIngestUpdateToolInput {
  readonly targetPageRef: string;
  readonly summary: AgentIngestOutput["summary"];
  readonly keyPoints: AgentIngestOutput["keyPoints"];
  readonly warnings: AgentIngestOutput["warnings"];
  readonly confidence: AgentIngestOutput["confidence"];
}

export interface AgentIngestLinkToolInput {
  readonly fromPageRef: string;
  readonly toPageRef: string;
  readonly reason: AgentIngestOutput["summary"];
  readonly confidence: AgentIngestOutput["confidence"];
}

export interface AgentIngestAddTagsToolInput {
  readonly targetPageRef: string;
  readonly tagsToAdd: readonly string[];
  readonly reason: AgentIngestOutput["summary"];
  readonly confidence: AgentIngestOutput["confidence"];
}

export interface AgentIngestToolHost {
  inspect(signal: AbortSignal): Promise<AgentIngestInspectToolResult>;
  parse?(context: PigeAgentToolCallContext): Promise<AgentIngestParseToolResult>;
  ocr?(context: PigeAgentToolCallContext): Promise<AgentIngestOcrToolResult>;
  search?(
    input: { readonly query: string },
    context: PigeAgentToolCallContext
  ): Promise<AgentIngestSearchToolResult>;
  respond?(
    input: AgentIngestRespondToolInput,
    context: PigeAgentToolCallContext
  ): Promise<AgentIngestPublishToolResult>;
  stageProposal?(
    output: AgentIngestToolOutput,
    context: PigeAgentToolCallContext
  ): Promise<AgentIngestStageProposalToolResult>;
  addTags?(
    input: AgentIngestAddTagsToolInput,
    context: PigeAgentToolCallContext
  ): Promise<AgentIngestPublishToolResult>;
  link?(
    input: AgentIngestLinkToolInput,
    context: PigeAgentToolCallContext
  ): Promise<AgentIngestPublishToolResult>;
  update?(
    input: AgentIngestUpdateToolInput,
    context: PigeAgentToolCallContext
  ): Promise<AgentIngestPublishToolResult>;
  publish(output: AgentIngestToolOutput, signal: AbortSignal): Promise<AgentIngestPublishToolResult>;
}

export function createAgentIngestToolRegistry(input: {
  readonly jobId: string;
  readonly sourceId: string;
  readonly authorization: AgentIngestToolAuthorizationPort;
  readonly host: AgentIngestToolHost;
}): readonly PigeAgentToolDescriptor[] {
  return [
    ...(input.host.stageProposal ? [{
      name: STAGE_KNOWLEDGE_NOTE_PROPOSAL_TOOL_NAME,
      label: "Stage grounded knowledge note for review",
      description: "Validate and durably stage one grounded Markdown note proposal for the current preserved source. Pige owns the target path, trust level, references, and proposed operation.",
      parameters: AGENT_INGEST_OUTPUT_SCHEMA,
      version: STAGE_KNOWLEDGE_NOTE_PROPOSAL_TOOL_VERSION,
      capability: "stage_generated_note_proposal",
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      effect: "proposal",
      inputTrust: "model_generated",
      outputTrust: "host_validated",
      dataBoundary: CURRENT_SOURCE_DATA_BOUNDARY,
      execution: "sequential",
      idempotency: CURRENT_SOURCE_IDEMPOTENCY,
      limits: {
        maxInputBytes: 131_072,
        maxOutputBytes: 32_768,
        timeoutMs: 30_000
      },
      ownerService: "ProposalService",
      authorize: (_args, context) => input.authorization.authorize({
        toolName: STAGE_KNOWLEDGE_NOTE_PROPOSAL_TOOL_NAME,
        capability: "stage_generated_note_proposal",
        jobId: input.jobId,
        sourceId: input.sourceId,
        toolCallId: context.toolCallId
      }),
      execute: async (args, _signal, context): Promise<PigeAgentToolResult> => {
        if (!input.host.stageProposal) {
          throw new PigeDomainError(
            "agent_runtime.proposal_tool_unavailable",
            "The proposal staging tool is unavailable."
          );
        }
        const result = await input.host.stageProposal(args as AgentIngestToolOutput, context);
        return { ...result, terminate: true };
      }
    } satisfies PigeAgentToolDescriptor] : []),
    {
      name: INSPECT_SOURCE_TOOL_NAME,
      label: "Inspect preserved source",
      description: "Inspect Pige-verified evidence for the current preserved source. Takes no source path or source ID.",
      parameters: EMPTY_OBJECT_SCHEMA,
      version: "1",
      capability: "read_current_source",
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      effect: "read_only",
      inputTrust: "model_generated",
      outputTrust: "untrusted_source",
      dataBoundary: CURRENT_SOURCE_DATA_BOUNDARY,
      execution: "sequential",
      idempotency: CURRENT_SOURCE_IDEMPOTENCY,
      limits: {
        maxInputBytes: 2,
        maxOutputBytes: 131_072,
        timeoutMs: 10_000
      },
      ownerService: "AgentIngestService",
      authorize: (_args, context) => input.authorization.authorize({
        toolName: INSPECT_SOURCE_TOOL_NAME,
        capability: "read_current_source",
        jobId: input.jobId,
        sourceId: input.sourceId,
        toolCallId: context.toolCallId
      }),
      execute: async (_args, signal): Promise<PigeAgentToolResult> => input.host.inspect(signal)
    },
    {
      name: PARSE_SOURCE_TOOL_NAME,
      label: "Parse preserved source",
      description: "Parse the current preserved source through Pige-owned local parser services. Takes no path, source ID, or model authority.",
      parameters: EMPTY_OBJECT_SCHEMA,
      version: PARSE_SOURCE_TOOL_VERSION,
      capability: "parse_current_source",
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      effect: "idempotent_write",
      inputTrust: "model_generated",
      outputTrust: "host_validated",
      dataBoundary: CURRENT_SOURCE_DATA_BOUNDARY,
      execution: "sequential",
      idempotency: CURRENT_SOURCE_IDEMPOTENCY,
      limits: {
        maxInputBytes: 2,
        maxOutputBytes: 262_144,
        timeoutMs: 120_000
      },
      ownerService: "DocumentParserService",
      authorize: (_args, context) => input.authorization.authorize({
        toolName: PARSE_SOURCE_TOOL_NAME,
        capability: "parse_current_source",
        jobId: input.jobId,
        sourceId: input.sourceId,
        toolCallId: context.toolCallId
      }),
      execute: async (_args, _signal, context): Promise<PigeAgentToolResult> => {
        if (!context || !input.host.parse) {
          throw new PigeDomainError(
            "agent_runtime.parse_tool_unavailable",
            "The current-source parser tool is unavailable."
          );
        }
        return input.host.parse(context);
      }
    },
    {
      name: OCR_SOURCE_TOOL_NAME,
      label: "Recognize preserved source visuals",
      description: "Run bounded local OCR for the current preserved image or parser-selected document visuals. Takes no path, source ID, target list, or model authority.",
      parameters: EMPTY_OBJECT_SCHEMA,
      version: OCR_SOURCE_TOOL_VERSION,
      capability: "ocr_current_source",
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      effect: "idempotent_write",
      inputTrust: "model_generated",
      outputTrust: "host_validated",
      dataBoundary: CURRENT_SOURCE_DATA_BOUNDARY,
      execution: "sequential",
      idempotency: CURRENT_SOURCE_IDEMPOTENCY,
      limits: {
        maxInputBytes: 2,
        maxOutputBytes: 262_144,
        timeoutMs: 300_000
      },
      ownerService: "OcrService",
      authorize: (_args, context) => input.authorization.authorize({
        toolName: OCR_SOURCE_TOOL_NAME,
        capability: "ocr_current_source",
        jobId: input.jobId,
        sourceId: input.sourceId,
        toolCallId: context.toolCallId
      }),
      execute: async (_args, _signal, context): Promise<PigeAgentToolResult> => {
        if (!context || !input.host.ocr) {
          throw new PigeDomainError(
            "agent_runtime.ocr_tool_unavailable",
            "The current-source OCR tool is unavailable."
          );
        }
        return input.host.ocr(context);
      }
    },
    ...(input.host.search ? [{
      name: SEARCH_KNOWLEDGE_TOOL_NAME,
      label: "Search related local knowledge",
      description: "Search the current Pige vault for bounded related knowledge after inspecting the preserved source. Takes one query and no path, page ID, source ID, or model authority.",
      parameters: RELATED_KNOWLEDGE_QUERY_SCHEMA,
      version: SEARCH_KNOWLEDGE_TOOL_VERSION,
      capability: "read_current_vault_knowledge",
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      effect: "read_only",
      inputTrust: "model_generated",
      outputTrust: "untrusted_source",
      dataBoundary: CURRENT_VAULT_DATA_BOUNDARY,
      execution: "sequential",
      idempotency: CURRENT_VAULT_IDEMPOTENCY,
      limits: {
        maxInputBytes: 2_048,
        maxOutputBytes: 65_536,
        timeoutMs: 30_000
      },
      ownerService: "RetrievalService",
      authorize: (_args, context) => input.authorization.authorize({
        toolName: SEARCH_KNOWLEDGE_TOOL_NAME,
        capability: "read_current_vault_knowledge",
        jobId: input.jobId,
        sourceId: input.sourceId,
        toolCallId: context.toolCallId
      }),
      execute: async (args, _signal, context): Promise<PigeAgentToolResult> => {
        if (
          !context ||
          !input.host.search ||
          typeof args !== "object" ||
          args === null ||
          Array.isArray(args) ||
          typeof (args as { readonly query?: unknown }).query !== "string"
        ) {
          throw new PigeDomainError(
            "agent_runtime.search_tool_unavailable",
            "The current-vault retrieval tool is unavailable."
          );
        }
        return input.host.search({ query: (args as { readonly query: string }).query }, context);
      }
    } satisfies PigeAgentToolDescriptor] : []),
    ...(input.host.respond ? [{
      name: RESPOND_TO_USER_TOOL_NAME,
      label: "Respond about preserved source",
      description: "Return one bounded user-facing answer grounded in evidence from the current preserved source, without publishing or staging a note.",
      parameters: SOURCE_RESPONSE_SCHEMA,
      version: RESPOND_TO_USER_TOOL_VERSION,
      capability: "respond_current_source",
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      effect: "compute",
      inputTrust: "model_generated",
      outputTrust: "host_validated",
      dataBoundary: CURRENT_SOURCE_DATA_BOUNDARY,
      execution: "sequential",
      idempotency: { mode: "idempotent", scope: "tool_call" },
      limits: {
        maxInputBytes: 65_536,
        maxOutputBytes: 4_096,
        timeoutMs: 10_000
      },
      ownerService: "AgentIngestService",
      authorize: (_args, context) => input.authorization.authorize({
        toolName: RESPOND_TO_USER_TOOL_NAME,
        capability: "respond_current_source",
        jobId: input.jobId,
        sourceId: input.sourceId,
        toolCallId: context.toolCallId
      }),
      execute: async (args, _signal, context): Promise<PigeAgentToolResult> => {
        if (!input.host.respond) {
          throw new PigeDomainError("agent_runtime.response_tool_unavailable", "The source response tool is unavailable.");
        }
        return input.host.respond(args as AgentIngestRespondToolInput, context).then((result) => ({
          ...result,
          terminate: true
        }));
      }
    } satisfies PigeAgentToolDescriptor] : []),
    ...(input.host.addTags ? [{
      name: ADD_KNOWLEDGE_TAGS_TOOL_NAME,
      label: "Add knowledge tags",
      description: "Add a small evidence-backed set of lightweight tags to one eligible Pige-managed note selected from the current related_NN retrieval results. Takes no path, page ID, base hash, YAML, replacement, removal, or Operation authority.",
      parameters: AGENT_NOTE_TAG_SCHEMA,
      version: ADD_KNOWLEDGE_TAGS_TOOL_VERSION,
      capability: "organize_existing_note",
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      effect: "idempotent_write",
      inputTrust: "model_generated",
      outputTrust: "host_validated",
      dataBoundary: CURRENT_VAULT_DATA_BOUNDARY,
      execution: "sequential",
      idempotency: CURRENT_VAULT_IDEMPOTENCY,
      limits: {
        maxInputBytes: 16_384,
        maxOutputBytes: 32_768,
        timeoutMs: 30_000
      },
      ownerService: "KnowledgeCompiler",
      authorize: (_args, context) => input.authorization.authorize({
        toolName: ADD_KNOWLEDGE_TAGS_TOOL_NAME,
        capability: "organize_existing_note",
        jobId: input.jobId,
        sourceId: input.sourceId,
        toolCallId: context.toolCallId
      }),
      execute: async (args, _signal, context): Promise<PigeAgentToolResult> => {
        if (!context || !input.host.addTags) {
          throw new PigeDomainError(
            "agent_runtime.tag_tool_unavailable",
            "The knowledge-tag tool is unavailable."
          );
        }
        return input.host.addTags(args as AgentIngestAddTagsToolInput, context).then((result) => ({
          ...result,
          terminate: true
        }));
      }
    } satisfies PigeAgentToolDescriptor] : []),
    ...(input.host.link ? [{
      name: LINK_KNOWLEDGE_NOTES_TOOL_NAME,
      label: "Link related knowledge notes",
      description: "Add one evidence-cited directed links_to edge from one eligible Pige-managed note to another selected from the current related_NN retrieval results. Takes no path, page ID, base hash, relation type, or Operation authority.",
      parameters: AGENT_NOTE_LINK_SCHEMA,
      version: LINK_KNOWLEDGE_NOTES_TOOL_VERSION,
      capability: "link_existing_notes",
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      effect: "idempotent_write",
      inputTrust: "model_generated",
      outputTrust: "host_validated",
      dataBoundary: CURRENT_VAULT_DATA_BOUNDARY,
      execution: "sequential",
      idempotency: CURRENT_VAULT_IDEMPOTENCY,
      limits: {
        maxInputBytes: 16_384,
        maxOutputBytes: 32_768,
        timeoutMs: 30_000
      },
      ownerService: "KnowledgeCompiler",
      authorize: (_args, context) => input.authorization.authorize({
        toolName: LINK_KNOWLEDGE_NOTES_TOOL_NAME,
        capability: "link_existing_notes",
        jobId: input.jobId,
        sourceId: input.sourceId,
        toolCallId: context.toolCallId
      }),
      execute: async (args, _signal, context): Promise<PigeAgentToolResult> => {
        if (!context || !input.host.link) {
          throw new PigeDomainError(
            "agent_runtime.link_tool_unavailable",
            "The knowledge-note link tool is unavailable."
          );
        }
        return input.host.link(args as AgentIngestLinkToolInput, context).then((result) => ({
          ...result,
          terminate: true
        }));
      }
    } satisfies PigeAgentToolDescriptor] : []),
    ...(input.host.update ? [{
      name: UPDATE_KNOWLEDGE_NOTE_TOOL_NAME,
      label: "Update related knowledge note",
      description: "Append one evidence-cited Pige-managed update to an eligible existing note selected from the current related_NN retrieval results. Takes no path, page ID, base hash, or Operation authority.",
      parameters: AGENT_NOTE_UPDATE_SCHEMA,
      version: UPDATE_KNOWLEDGE_NOTE_TOOL_VERSION,
      capability: "update_existing_note",
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      effect: "idempotent_write",
      inputTrust: "model_generated",
      outputTrust: "host_validated",
      dataBoundary: CURRENT_VAULT_DATA_BOUNDARY,
      execution: "sequential",
      idempotency: CURRENT_VAULT_IDEMPOTENCY,
      limits: {
        maxInputBytes: 65_536,
        maxOutputBytes: 32_768,
        timeoutMs: 30_000
      },
      ownerService: "KnowledgeCompiler",
      authorize: (_args, context) => input.authorization.authorize({
        toolName: UPDATE_KNOWLEDGE_NOTE_TOOL_NAME,
        capability: "update_existing_note",
        jobId: input.jobId,
        sourceId: input.sourceId,
        toolCallId: context.toolCallId
      }),
      execute: async (args, _signal, context): Promise<PigeAgentToolResult> => {
        if (!context || !input.host.update) {
          throw new PigeDomainError(
            "agent_runtime.update_tool_unavailable",
            "The existing-note update tool is unavailable."
          );
        }
        return input.host.update(args as AgentIngestUpdateToolInput, context).then((result) => ({
          ...result,
          terminate: true
        }));
      }
    } satisfies PigeAgentToolDescriptor] : []),
    {
      name: CREATE_KNOWLEDGE_NOTE_TOOL_NAME,
      label: "Create grounded knowledge note",
      description: "Validate and publish one grounded Markdown note for the current preserved source through Pige's durable write boundary.",
      parameters: AGENT_INGEST_OUTPUT_SCHEMA,
      version: "1",
      capability: "write_generated_note",
      outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
      effect: "idempotent_write",
      inputTrust: "model_generated",
      outputTrust: "host_validated",
      dataBoundary: CURRENT_SOURCE_DATA_BOUNDARY,
      execution: "sequential",
      idempotency: CURRENT_SOURCE_IDEMPOTENCY,
      limits: {
        maxInputBytes: 131_072,
        maxOutputBytes: 32_768,
        timeoutMs: 30_000
      },
      ownerService: "AgentIngestService",
      authorize: (_args, context) => input.authorization.authorize({
        toolName: CREATE_KNOWLEDGE_NOTE_TOOL_NAME,
        capability: "write_generated_note",
        jobId: input.jobId,
        sourceId: input.sourceId,
        toolCallId: context.toolCallId
      }),
      execute: async (args, signal): Promise<PigeAgentToolResult> => input.host.publish(
        args as AgentIngestToolOutput,
        signal
      ).then((result) => ({ ...result, terminate: true }))
    }
  ];
}

export const allowCurrentAgentIngestTools: AgentIngestToolAuthorizationPort = {
  authorize: (request) => {
    if (request.toolName === INSPECT_SOURCE_TOOL_NAME) {
      return request.capability === "read_current_source";
    }
    if (request.toolName === PARSE_SOURCE_TOOL_NAME) {
      return request.capability === "parse_current_source";
    }
    if (request.toolName === OCR_SOURCE_TOOL_NAME) {
      return request.capability === "ocr_current_source";
    }
    if (request.toolName === SEARCH_KNOWLEDGE_TOOL_NAME) {
      return request.capability === "read_current_vault_knowledge";
    }
    if (request.toolName === RESPOND_TO_USER_TOOL_NAME) {
      return request.capability === "respond_current_source";
    }
    if (request.toolName === STAGE_KNOWLEDGE_NOTE_PROPOSAL_TOOL_NAME) {
      return request.capability === "stage_generated_note_proposal";
    }
    if (request.toolName === ADD_KNOWLEDGE_TAGS_TOOL_NAME) {
      return request.capability === "organize_existing_note";
    }
    if (request.toolName === LINK_KNOWLEDGE_NOTES_TOOL_NAME) {
      return request.capability === "link_existing_notes";
    }
    if (request.toolName === UPDATE_KNOWLEDGE_NOTE_TOOL_NAME) {
      return request.capability === "update_existing_note";
    }
    return request.toolName === CREATE_KNOWLEDGE_NOTE_TOOL_NAME &&
      request.capability === "write_generated_note";
  }
};

const CURRENT_SOURCE_DATA_BOUNDARY = {
  resourceScope: "current_source",
  pathAuthority: "host_only",
  sourceIdAuthority: "host_only",
  modelAuthority: "none"
} as const;

const CURRENT_SOURCE_IDEMPOTENCY = {
  mode: "idempotent",
  scope: "current_source"
} as const;

const CURRENT_VAULT_DATA_BOUNDARY = {
  resourceScope: "current_vault",
  pathAuthority: "host_only",
  sourceIdAuthority: "host_only",
  modelAuthority: "none"
} as const;

const CURRENT_VAULT_IDEMPOTENCY = {
  mode: "idempotent",
  scope: "current_vault"
} as const;

const TOOL_RESULT_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    modelText: { type: "string" },
    details: { type: "object" },
    terminate: { type: "boolean" }
  },
  required: ["modelText", "details"],
  additionalProperties: false
} as const;

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false
} as const;

const RELATED_KNOWLEDGE_QUERY_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1, maxLength: 320 }
  },
  required: ["query"],
  additionalProperties: false
} as const;

const SOURCE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", minLength: 1, maxLength: 8_000 },
    evidenceRefs: {
      type: "array",
      items: { type: "string", pattern: "^ev_[0-9]{2}$" },
      minItems: 1,
      maxItems: 8
    }
  },
  required: ["answer", "evidenceRefs"],
  additionalProperties: false
} as const;

const EVIDENCE_STATEMENT_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", minLength: 1, maxLength: 1_600 },
    evidenceRefs: {
      type: "array",
      items: { type: "string", pattern: "^ev_[0-9]{2}$" },
      maxItems: 8
    }
  },
  required: ["text", "evidenceRefs"],
  additionalProperties: false
} as const;

const EVIDENCE_KEY_POINT_SCHEMA = {
  ...EVIDENCE_STATEMENT_SCHEMA,
  properties: {
    ...EVIDENCE_STATEMENT_SCHEMA.properties,
    text: { type: "string", minLength: 1, maxLength: 320 }
  }
} as const;

const AGENT_INGEST_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 120 },
    summary: EVIDENCE_STATEMENT_SCHEMA,
    keyPoints: {
      type: "array",
      items: EVIDENCE_KEY_POINT_SCHEMA,
      maxItems: 8
    },
    tags: { type: "array", items: { type: "string", minLength: 1, maxLength: 48 }, maxItems: 12 },
    topics: { type: "array", items: { type: "string", minLength: 1, maxLength: 80 }, maxItems: 8 },
    entities: { type: "array", items: { type: "string", minLength: 1, maxLength: 80 }, maxItems: 12 },
    relatedPageRefs: {
      type: "array",
      items: { type: "string", pattern: "^related_[0-9]{2}$" },
      maxItems: 6
    },
    warnings: { type: "array", items: { type: "string", minLength: 1, maxLength: 240 }, maxItems: 8 },
    confidence: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["title", "summary", "keyPoints", "tags", "topics", "entities", "warnings", "confidence"],
  additionalProperties: false
} as const;

const AGENT_NOTE_UPDATE_SCHEMA = {
  type: "object",
  properties: {
    targetPageRef: { type: "string", pattern: "^related_[0-9]{2}$" },
    summary: EVIDENCE_STATEMENT_SCHEMA,
    keyPoints: {
      type: "array",
      items: EVIDENCE_KEY_POINT_SCHEMA,
      maxItems: 8
    },
    warnings: { type: "array", items: { type: "string", minLength: 1, maxLength: 240 }, maxItems: 8 },
    confidence: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["targetPageRef", "summary", "keyPoints", "warnings", "confidence"],
  additionalProperties: false
} as const;

const AGENT_NOTE_LINK_SCHEMA = {
  type: "object",
  properties: {
    fromPageRef: { type: "string", pattern: "^related_[0-9]{2}$" },
    toPageRef: { type: "string", pattern: "^related_[0-9]{2}$" },
    reason: EVIDENCE_STATEMENT_SCHEMA,
    confidence: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["fromPageRef", "toPageRef", "reason", "confidence"],
  additionalProperties: false
} as const;

const AGENT_NOTE_TAG_SCHEMA = {
  type: "object",
  properties: {
    targetPageRef: { type: "string", pattern: "^related_[0-9]{2}$" },
    tagsToAdd: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 48 },
      minItems: 1,
      maxItems: 6
    },
    reason: EVIDENCE_STATEMENT_SCHEMA,
    confidence: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["targetPageRef", "tagsToAdd", "reason", "confidence"],
  additionalProperties: false
} as const;
