import type { IpcMain, WebContents } from "electron";
import {
  PIGE_POLICY_STATUS_CHANNEL,
  PIGE_POLICY_UPDATE_CHANNEL,
  PigePolicySummarySchema,
  PigePolicyUpdateRequestSchema,
  PigePolicyUpdateResultSchema,
  type PigePolicySummary,
  type PigePolicyUpdateRequest,
  type PigePolicyUpdateResult
} from "@pige/schemas";
import type { PigePolicyPreparedUpdate, PigePolicyPrepareResult } from "./services/pige-policy-service";

export interface RegisterPigePolicyIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly isTrustedSender: (sender: WebContents) => boolean;
  readonly summary: () => PigePolicySummary;
  readonly prepareUpdate: (request: PigePolicyUpdateRequest) => PigePolicyPrepareResult;
  readonly confirmUpdate: (sender: WebContents, prepared: PigePolicyPreparedUpdate) => Promise<boolean>;
  readonly commitUpdate: (prepared: PigePolicyPreparedUpdate) => PigePolicyUpdateResult;
  readonly denied: (request: PigePolicyUpdateRequest) => PigePolicyUpdateResult;
  readonly failed: (request: PigePolicyUpdateRequest) => PigePolicyUpdateResult;
}

export function registerPigePolicyIpc(options: RegisterPigePolicyIpcOptions): void {
  options.ipcMain.handle(PIGE_POLICY_STATUS_CHANNEL, (event) => {
    if (!options.isTrustedSender(event.sender)) throw new Error("Untrusted PIGE.md policy sender.");
    return PigePolicySummarySchema.parse(options.summary());
  });

  options.ipcMain.handle(PIGE_POLICY_UPDATE_CHANNEL, async (event, input) => {
    if (!options.isTrustedSender(event.sender)) throw new Error("Untrusted PIGE.md policy sender.");
    const request = PigePolicyUpdateRequestSchema.parse(input);
    try {
      const prepared = options.prepareUpdate(request);
      if (prepared.status !== "ready") return PigePolicyUpdateResultSchema.parse(prepared);
      if (!await options.confirmUpdate(event.sender, prepared)) {
        return PigePolicyUpdateResultSchema.parse(options.denied(request));
      }
      return PigePolicyUpdateResultSchema.parse(options.commitUpdate(prepared));
    } catch {
      return PigePolicyUpdateResultSchema.parse(options.failed(request));
    }
  });
}
