import type { UpdateManualDownloadRequest, UpdateManualDownloadResult } from "@pige/contracts";
import { UpdateManualDownloadResultSchema } from "@pige/schemas";

export const PIGE_MANUAL_DOWNLOAD_URL = "https://github.com/YinsenW/Pige/releases";

export class ManualUpdateDownloadService {
  readonly #openExternal: (url: string) => Promise<void>;
  #activeRequestId: string | undefined;

  constructor(openExternal: (url: string) => Promise<void>) {
    this.#openExternal = openExternal;
  }

  async open(request: UpdateManualDownloadRequest): Promise<UpdateManualDownloadResult> {
    if (this.#activeRequestId) return UpdateManualDownloadResultSchema.parse({ ...request, status: "busy" });
    this.#activeRequestId = request.requestId;
    try {
      await this.#openExternal(PIGE_MANUAL_DOWNLOAD_URL);
      return UpdateManualDownloadResultSchema.parse({ ...request, status: "opened" });
    } catch {
      return UpdateManualDownloadResultSchema.parse({ ...request, status: "failed" });
    } finally {
      if (this.#activeRequestId === request.requestId) this.#activeRequestId = undefined;
    }
  }
}
