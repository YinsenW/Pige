import { PigeDomainError } from "@pige/domain";
import type { AgentIngestRuntimePort } from "../../apps/desktop/src/main/services/agent-ingest-service";
import {
  CREATE_KNOWLEDGE_NOTE_TOOL_NAME,
  INSPECT_SOURCE_TOOL_NAME
} from "../../apps/desktop/src/main/services/agent-ingest-tool-registry";
import type {
  PiAgentRunRequest,
  PiAgentRunResult
} from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";

export class ScriptedAgentIngestRuntime implements AgentIngestRuntimePort {
  readonly runRequests: PiAgentRunRequest[] = [];
  systemPrompt = "";
  userPrompt = "";
  callCount = 0;

  constructor(
    readonly output: unknown,
    readonly onModelTurn?: () => void | Promise<void>
  ) {}

  async run(request: PiAgentRunRequest): Promise<PiAgentRunResult> {
    this.runRequests.push(request);
    this.systemPrompt = request.systemPrompt;
    this.callCount += 1;
    const signal = request.signal ?? new AbortController().signal;
    throwIfAborted(signal);
    await request.beforeModelTurn?.();
    const inspect = requireTool(request, INSPECT_SOURCE_TOOL_NAME);
    if (inspect.authorize && !(await inspect.authorize({}))) throw permissionDenied();
    const inspection = await inspect.execute({}, signal);
    this.userPrompt = `${request.userPrompt}\n${inspection.modelText}`;
    await this.onInspectionReady(request);
    await this.onModelTurn?.();
    throwIfAborted(signal);
    await request.beforeModelTurn?.();
    const publish = requireTool(request, CREATE_KNOWLEDGE_NOTE_TOOL_NAME);
    if (publish.authorize && !(await publish.authorize(this.output))) throw permissionDenied();
    await publish.execute(this.output, signal);
    return {
      adapterMode: "embedded_pi_sdk",
      providerProfileId: request.runtimeConfig.provider.id,
      modelProfileId: request.runtimeConfig.model.id,
      modelId: request.runtimeConfig.model.modelId,
      events: [],
      assistantText: "",
      invokedTools: [INSPECT_SOURCE_TOOL_NAME, CREATE_KNOWLEDGE_NOTE_TOOL_NAME]
    };
  }

  protected async onInspectionReady(_request: PiAgentRunRequest): Promise<void> {}
}

function requireTool(request: PiAgentRunRequest, name: string) {
  const tool = request.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing scripted Agent tool ${name}.`);
  return tool;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("scripted Agent runtime cancelled");
  error.name = "AbortError";
  throw error;
}

function permissionDenied(): PigeDomainError {
  return new PigeDomainError("permission.denied", "Pige policy did not authorize this tool call.");
}
