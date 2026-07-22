import type {
  AgentIngestDatasetToolExecution,
  AgentIngestDatasetToolRequest,
  AgentIngestOcrToolExecution,
  AgentIngestOcrToolRequest,
  AgentIngestParseToolExecution,
  AgentIngestParseToolRequest
} from "./agent-ingest-service";

export interface AgentSourceToolExecutionPort {
  parse(request: AgentIngestParseToolRequest): Promise<AgentIngestParseToolExecution>;
  ocr(request: AgentIngestOcrToolRequest): Promise<AgentIngestOcrToolExecution>;
  materializeDataset(request: AgentIngestDatasetToolRequest): Promise<AgentIngestDatasetToolExecution>;
}
