import type { IpcMain } from "electron";
import {
  SkillDiscardStagedRequestSchema,
  SkillDiscardStagedResultSchema,
  SkillDisableRequestSchema,
  SkillInstallStagedRequestSchema,
  SkillInstallStagedResultSchema,
  SkillRegistryMutationResultSchema,
  SkillRegistryQueryResultSchema,
  SkillStageFromUrlRequestSchema,
  SkillStageFromUrlResultSchema,
  type SkillDiscardStagedRequest,
  type SkillDiscardStagedResult,
  type SkillDisableRequest,
  type SkillInstallStagedRequest,
  type SkillInstallStagedResult,
  type SkillRegistryMutationResult,
  type SkillRegistryQueryResult,
  type SkillStageFromUrlRequest,
  type SkillStageFromUrlResult
} from "@pige/schemas";

interface RegisterSkillsIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly summary: () => SkillRegistryQueryResult | Promise<SkillRegistryQueryResult>;
  readonly stageFromUrl: (
    request: SkillStageFromUrlRequest
  ) => SkillStageFromUrlResult | Promise<SkillStageFromUrlResult>;
  readonly installStaged: (
    request: SkillInstallStagedRequest
  ) => SkillInstallStagedResult | Promise<SkillInstallStagedResult>;
  readonly discardStaged: (
    request: SkillDiscardStagedRequest
  ) => SkillDiscardStagedResult | Promise<SkillDiscardStagedResult>;
  readonly disable: (
    request: SkillDisableRequest
  ) => SkillRegistryMutationResult | Promise<SkillRegistryMutationResult>;
  readonly publishRegistryChanged: (result: SkillInstallStagedResult | SkillRegistryMutationResult) => void;
}

function assertRequestIdentity<T extends { readonly requestId: string }>(
  request: T,
  result: { readonly requestId: string }
): void {
  if (result.requestId !== request.requestId) {
    throw new Error("Skill lifecycle response identity did not match the request.");
  }
}

export function registerSkillsIpc(options: RegisterSkillsIpcOptions): void {
  options.ipcMain.handle("skills.summary", async () =>
    SkillRegistryQueryResultSchema.parse(await options.summary())
  );
  options.ipcMain.handle("skills.stageFromUrl", async (_event, request: unknown) => {
    const parsed = SkillStageFromUrlRequestSchema.parse(request);
    const result = SkillStageFromUrlResultSchema.parse(await options.stageFromUrl(parsed));
    assertRequestIdentity(parsed, result);
    return result;
  });
  options.ipcMain.handle("skills.installStaged", async (_event, request: unknown) => {
    const parsed = SkillInstallStagedRequestSchema.parse(request);
    const result = SkillInstallStagedResultSchema.parse(await options.installStaged(parsed));
    assertRequestIdentity(parsed, result);
    if (result.status === "committed") options.publishRegistryChanged(result);
    return result;
  });
  options.ipcMain.handle("skills.discardStaged", async (_event, request: unknown) => {
    const parsed = SkillDiscardStagedRequestSchema.parse(request);
    const result = SkillDiscardStagedResultSchema.parse(await options.discardStaged(parsed));
    assertRequestIdentity(parsed, result);
    return result;
  });
  options.ipcMain.handle("skills.disable", async (_event, request: unknown) => {
    const parsed = SkillDisableRequestSchema.parse(request);
    const result = SkillRegistryMutationResultSchema.parse(await options.disable(parsed));
    if (result.status === "committed") options.publishRegistryChanged(result);
    return result;
  });
}
