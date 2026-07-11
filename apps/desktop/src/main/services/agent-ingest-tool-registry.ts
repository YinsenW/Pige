import type { AgentIngestOutput } from "@pige/schemas";
import type { PigeAgentToolDefinition, PigeAgentToolResult } from "./pi-agent-runtime-adapter";

export const INSPECT_SOURCE_TOOL_NAME = "pige_inspect_source";
export const CREATE_KNOWLEDGE_NOTE_TOOL_NAME = "pige_create_knowledge_note";

export type AgentIngestToolCapability = "read_current_source" | "write_generated_note";

export interface AgentIngestToolAuthorizationRequest {
  readonly toolName: typeof INSPECT_SOURCE_TOOL_NAME | typeof CREATE_KNOWLEDGE_NOTE_TOOL_NAME;
  readonly capability: AgentIngestToolCapability;
  readonly jobId: string;
  readonly sourceId: string;
}

export interface AgentIngestToolAuthorizationPort {
  authorize(request: AgentIngestToolAuthorizationRequest): boolean | Promise<boolean>;
}

export interface AgentIngestInspectToolResult {
  readonly modelText: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AgentIngestPublishToolResult {
  readonly modelText: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AgentIngestToolHost {
  inspect(signal: AbortSignal): Promise<AgentIngestInspectToolResult>;
  publish(output: AgentIngestOutput, signal: AbortSignal): Promise<AgentIngestPublishToolResult>;
}

export function createAgentIngestToolRegistry(input: {
  readonly jobId: string;
  readonly sourceId: string;
  readonly authorization: AgentIngestToolAuthorizationPort;
  readonly host: AgentIngestToolHost;
}): readonly PigeAgentToolDefinition[] {
  return [
    {
      name: INSPECT_SOURCE_TOOL_NAME,
      label: "Inspect preserved source",
      description: "Inspect Pige-verified evidence for the current preserved source. Takes no source path or source ID.",
      parameters: EMPTY_OBJECT_SCHEMA,
      authorize: () => input.authorization.authorize({
        toolName: INSPECT_SOURCE_TOOL_NAME,
        capability: "read_current_source",
        jobId: input.jobId,
        sourceId: input.sourceId
      }),
      execute: async (_args, signal): Promise<PigeAgentToolResult> => input.host.inspect(signal)
    },
    {
      name: CREATE_KNOWLEDGE_NOTE_TOOL_NAME,
      label: "Create grounded knowledge note",
      description: "Validate and publish one grounded Markdown note for the current preserved source through Pige's durable write boundary.",
      parameters: AGENT_INGEST_OUTPUT_SCHEMA,
      authorize: () => input.authorization.authorize({
        toolName: CREATE_KNOWLEDGE_NOTE_TOOL_NAME,
        capability: "write_generated_note",
        jobId: input.jobId,
        sourceId: input.sourceId
      }),
      execute: async (args, signal): Promise<PigeAgentToolResult> => input.host.publish(
        args as AgentIngestOutput,
        signal
      ).then((result) => ({ ...result, terminate: true }))
    }
  ];
}

export const allowCurrentAgentIngestTools: AgentIngestToolAuthorizationPort = {
  authorize: (request) =>
    request.toolName === INSPECT_SOURCE_TOOL_NAME
      ? request.capability === "read_current_source"
      : request.toolName === CREATE_KNOWLEDGE_NOTE_TOOL_NAME && request.capability === "write_generated_note"
};

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
