import { PigeDomainError } from "@pige/domain";
import {
  PiAgentRuntimeAdapter,
  type PiAgentRunRequest,
  type PiAgentRunResult,
  type PigeAgentToolDefinition
} from "./pi-agent-runtime-adapter";
import type { ModelProviderRuntimeConfig } from "./model-provider-registry";

export interface ModelProviderGenerationProbePort {
  readonly probe: (runtimeConfig: ModelProviderRuntimeConfig) => Promise<void>;
}

export interface ModelProviderProbeRuntimePort {
  readonly run: (request: PiAgentRunRequest) => Promise<PiAgentRunResult>;
}

const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
const PROBE_TOOL_NAME = "pige_provider_probe";
const PROBE_SYSTEM_PROMPT =
  "This is a synthetic provider readiness check. Use only the supplied Pige probe tool.";
const PROBE_USER_PROMPT =
  "Call pige_provider_probe exactly once. After it succeeds, reply with a short acknowledgement.";

export class ModelProviderGenerationProbe implements ModelProviderGenerationProbePort {
  readonly #runtime: ModelProviderProbeRuntimePort;
  readonly #timeoutMs: number;

  constructor(
    runtime: ModelProviderProbeRuntimePort = new PiAgentRuntimeAdapter(),
    timeoutMs = DEFAULT_PROBE_TIMEOUT_MS
  ) {
    this.#runtime = runtime;
    this.#timeoutMs = timeoutMs;
  }

  async probe(runtimeConfig: ModelProviderRuntimeConfig): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let executionCount = 0;
    const tool: PigeAgentToolDefinition = {
      name: PROBE_TOOL_NAME,
      label: "Provider probe",
      description: "Return one fixed synthetic readiness result.",
      version: "1",
      capability: "model_provider.probe",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: { ready: { type: "boolean" } },
        required: ["ready"],
        additionalProperties: false
      },
      effect: "compute",
      inputTrust: "model_generated",
      outputTrust: "host_validated",
      dataBoundary: {
        resourceScope: "none",
        pathAuthority: "host_only",
        sourceIdAuthority: "host_only",
        modelAuthority: "none"
      },
      execution: "sequential",
      idempotency: { mode: "idempotent", scope: "none" },
      limits: { maxInputBytes: 64, maxOutputBytes: 128, timeoutMs: 1_000 },
      ownerService: "ModelProviderGenerationProbe",
      execute: async () => {
        executionCount += 1;
        if (executionCount > 1) throw generationProbeError();
        return {
          modelText: JSON.stringify({ ready: true }),
          details: { ready: true }
        };
      }
    };

    try {
      const result = await this.#runtime.run({
        runtimeConfig,
        jobId: "provider_generation_probe",
        systemPrompt: PROBE_SYSTEM_PROMPT,
        userPrompt: PROBE_USER_PROMPT,
        tools: [tool],
        signal: controller.signal
      });
      const toolEndEvents = result.events.filter(
        (event) => event.type === "tool_execution_end" && event.toolName === PROBE_TOOL_NAME
      );
      if (
        executionCount !== 1 ||
        result.invokedTools.length !== 1 ||
        result.invokedTools[0] !== PROBE_TOOL_NAME ||
        toolEndEvents.length !== 1 ||
        toolEndEvents[0]?.isError !== false ||
        result.assistantText.trim().length === 0
      ) {
        throw generationProbeError();
      }
    } catch {
      throw generationProbeError();
    } finally {
      clearTimeout(timeout);
    }
  }
}

function generationProbeError(): PigeDomainError {
  return new PigeDomainError(
    "model_provider.generation_probe_failed",
    "The selected provider model could not complete the synthetic readiness probe."
  );
}
