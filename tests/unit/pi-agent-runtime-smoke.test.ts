import { describe, expect, it } from "vitest";
import {
  runHomeAgentRuntimeSmoke,
  runPiAgentRuntimeSmoke
} from "../../apps/desktop/src/main/smokes/pi-agent-runtime-smoke";

describe("packaged Pi runtime smoke", () => {
  it("finishes with ordinary assistant prose and an explicit known citation", async () => {
    await expect(runPiAgentRuntimeSmoke()).resolves.toEqual({
      adapterMode: "embedded_pi_sdk",
      modelId: "pi-smoke-model",
      invokedTools: ["pige_inspect_source", "pige_create_knowledge_note"],
      publicationCount: 1
    });
    await expect(runHomeAgentRuntimeSmoke()).resolves.toEqual({
      state: "completed",
      answerMode: "model_grounded",
      citationCount: 1
    });
  });
});
