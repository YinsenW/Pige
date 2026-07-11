import { app } from "electron";

try {
  const module = await import("../out/main/pi-agent-runtime-smoke.js");
  const result = await module.runPiAgentRuntimeSmoke();
  const expectedTools = ["pige_inspect_source", "pige_create_knowledge_note"];
  if (
    result.adapterMode !== "embedded_pi_sdk" ||
    result.modelId !== "pi-smoke-model" ||
    result.publicationCount !== 1 ||
    JSON.stringify(result.invokedTools) !== JSON.stringify(expectedTools)
  ) {
    throw new Error(`Unexpected Pi runtime smoke result: ${JSON.stringify(result)}`);
  }
  console.log(`Electron Pi runtime smoke OK: ${result.modelId}, ${result.invokedTools.join(" -> ")}.`);
} finally {
  app.quit();
}
