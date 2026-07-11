import { app } from "electron";

try {
  const module = await import("../out/main/pi-agent-runtime-smoke.js");
  const result = await module.runPiAgentRuntimeSmoke();
  const homeResult = await module.runHomeAgentRuntimeSmoke();
  const expectedTools = ["pige_inspect_source", "pige_create_knowledge_note"];
  if (
    result.adapterMode !== "embedded_pi_sdk" ||
    result.modelId !== "pi-smoke-model" ||
    result.publicationCount !== 1 ||
    JSON.stringify(result.invokedTools) !== JSON.stringify(expectedTools)
  ) {
    throw new Error(`Unexpected Pi runtime smoke result: ${JSON.stringify(result)}`);
  }
  if (
    homeResult.state !== "completed" ||
    homeResult.answerMode !== "model_grounded" ||
    homeResult.citationCount !== 1
  ) {
    throw new Error(`Unexpected Home Agent smoke result: ${JSON.stringify(homeResult)}`);
  }
  console.log(`Electron Pi runtime smoke OK: ${result.modelId}, ${result.invokedTools.join(" -> ")}; Home grounded citation=${homeResult.citationCount}.`);
} finally {
  app.quit();
}
