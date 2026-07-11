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
export const CREATE_KNOWLEDGE_NOTE_TOOL_NAME = "pige_create_knowledge_note";

export type AgentIngestToolCapability =
  | "read_current_source"
  | "parse_current_source"
  | "ocr_current_source"
  | "write_generated_note";

export interface AgentIngestToolAuthorizationRequest {
  readonly toolName:
    | typeof INSPECT_SOURCE_TOOL_NAME
    | typeof PARSE_SOURCE_TOOL_NAME
    | typeof OCR_SOURCE_TOOL_NAME
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
}

export interface AgentIngestOcrToolResult {
  readonly modelText: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AgentIngestPublishToolResult {
  readonly modelText: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AgentIngestToolHost {
  inspect(signal: AbortSignal): Promise<AgentIngestInspectToolResult>;
  parse?(context: PigeAgentToolCallContext): Promise<AgentIngestParseToolResult>;
  ocr?(context: PigeAgentToolCallContext): Promise<AgentIngestOcrToolResult>;
  publish(output: AgentIngestOutput, signal: AbortSignal): Promise<AgentIngestPublishToolResult>;
}

export function createAgentIngestToolRegistry(input: {
  readonly jobId: string;
  readonly sourceId: string;
  readonly authorization: AgentIngestToolAuthorizationPort;
  readonly host: AgentIngestToolHost;
}): readonly PigeAgentToolDescriptor[] {
  return [
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
        args as AgentIngestOutput,
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
    warnings: { type: "array", items: { type: "string", minLength: 1, maxLength: 240 }, maxItems: 8 },
    confidence: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["title", "summary", "keyPoints", "tags", "topics", "entities", "warnings", "confidence"],
  additionalProperties: false
} as const;
