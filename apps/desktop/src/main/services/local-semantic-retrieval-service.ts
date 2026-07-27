import { randomUUID } from "node:crypto";
import fs from "node:fs";
import {
  LOCAL_SEMANTIC_RETRIEVAL_ASSET_BYTES,
  LOCAL_SEMANTIC_RETRIEVAL_ASSET_ID,
  type LocalSemanticRetrievalDisableRequest,
  type LocalSemanticRetrievalDisableResult,
  type LocalSemanticRetrievalEnableRequest,
  type LocalSemanticRetrievalEnableResult,
  type LocalSemanticRetrievalInstallRequest,
  type LocalSemanticRetrievalInstallResult,
  type LocalSemanticRetrievalRemoveRequest,
  type LocalSemanticRetrievalRemoveResult,
  type LocalSemanticRetrievalStatus,
  type LocalSemanticRetrievalStatusRequest
} from "@pige/schemas";
import {
  LocalSemanticRetrievalAssetStore,
  type LocalSemanticAssetReceipt,
  type LocalSemanticAssetRecord,
  type LocalSemanticRetrievalAssetStorePort,
  type VerifiedLocalSemanticAsset
} from "./local-semantic-retrieval-asset-store";

const ASSET_URL = "https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/" +
  "c2602621d50895a7b8277ddd4a8c31e699c9d002/Qwen3-Embedding-0.6B-Q8_0.gguf";
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "huggingface.co",
  "cdn-lfs.hf.co",
  "cas-bridge.xethub.hf.co"
]);

export interface LocalSemanticAssetTransport {
  download(url: string, destinationPath: string): Promise<void>;
}

interface LocalSemanticRetrievalServiceOptions {
  readonly appDataRoot: string;
  readonly store?: LocalSemanticRetrievalAssetStorePort;
  readonly transport?: LocalSemanticAssetTransport;
  readonly now?: () => Date;
}

type MutationRequest = LocalSemanticRetrievalInstallRequest;

export class LocalSemanticRetrievalService {
  readonly #store: LocalSemanticRetrievalAssetStorePort;
  readonly #transport: LocalSemanticAssetTransport;
  readonly #now: () => Date;
  #verifiedBinding: VerifiedLocalSemanticAsset | undefined;

  constructor(options: LocalSemanticRetrievalServiceOptions) {
    this.#store = options.store ?? new LocalSemanticRetrievalAssetStore(options.appDataRoot);
    this.#transport = options.transport ?? createFetchLocalSemanticAssetTransport();
    this.#now = options.now ?? (() => new Date());
  }

  status(_request: LocalSemanticRetrievalStatusRequest): LocalSemanticRetrievalStatus {
    return statusFromRecord(this.#read());
  }

  install(request: LocalSemanticRetrievalInstallRequest): LocalSemanticRetrievalInstallResult {
    const record = this.#read();
    const prior = receiptFor(record, request.requestId, "install");
    if (prior) return installResult(request.requestId, prior);
    if (request.expectedRevision !== record.revision) return mutationResult(request, record.revision, "stale");
    if (record.state === "ready" || record.state === "disabled") {
      return this.#recordInstallResult(record, request, "already_installed");
    }
    if (record.state === "installing" || record.state === "verifying") {
      return mutationResult(request, record.revision, "stale");
    }

    const jobId = createAssetJobId(this.#now());
    const accepted = nextRecord(record, this.#now(), {
      state: "installing",
      activeRequestId: request.requestId,
      activeJobId: jobId,
      receipts: appendReceipt(record, {
        requestId: request.requestId,
        action: "install",
        revision: record.revision + 1,
        status: "accepted",
        jobId
      })
    });
    try {
      this.#store.discardStaging();
      this.#store.write(accepted);
    } catch {
      return mutationResult(request, record.revision, "failed");
    }
    void this.#completeInstall(request.requestId, jobId);
    return { apiVersion: 1, requestId: request.requestId, revision: accepted.revision, status: "accepted", jobId };
  }

  async enable(request: LocalSemanticRetrievalEnableRequest): Promise<LocalSemanticRetrievalEnableResult> {
    const record = this.#read();
    const prior = receiptFor(record, request.requestId, "enable");
    if (prior) return mutationResult(request, prior.revision, prior.status as "committed" | "already_enabled");
    if (request.expectedRevision !== record.revision) return mutationResult(request, record.revision, "stale");
    if (record.state === "not_installed") return mutationResult(request, record.revision, "not_found");
    if (record.state === "installing" || record.state === "verifying") {
      return mutationResult(request, record.revision, "stale");
    }
    if (record.state === "ready" && this.embeddingModelInstalled()) {
      return this.#recordMutation(record, request, "enable", "already_enabled");
    }
    try {
      this.#verifiedBinding = await this.#store.verify();
      return this.#recordMutation(record, request, "enable", "committed", "ready");
    } catch {
      this.#verifiedBinding = undefined;
      const repaired = this.#writeRepairState(record);
      return mutationResult(request, repaired.revision, "failed");
    }
  }

  disable(request: LocalSemanticRetrievalDisableRequest): LocalSemanticRetrievalDisableResult {
    const record = this.#read();
    const prior = receiptFor(record, request.requestId, "disable");
    if (prior) return mutationResult(request, prior.revision, "committed");
    if (request.expectedRevision !== record.revision) return mutationResult(request, record.revision, "stale");
    if (record.state === "not_installed" || record.state === "needs_repair") {
      return mutationResult(request, record.revision, "not_found");
    }
    if (record.state === "installing" || record.state === "verifying") {
      return mutationResult(request, record.revision, "stale");
    }
    return this.#recordMutation(record, request, "disable", "committed", "disabled");
  }

  remove(request: LocalSemanticRetrievalRemoveRequest): LocalSemanticRetrievalRemoveResult {
    const record = this.#read();
    const prior = receiptFor(record, request.requestId, "remove");
    if (prior) return mutationResult(request, prior.revision, "committed");
    if (request.expectedRevision !== record.revision) return mutationResult(request, record.revision, "stale");
    if (record.state === "not_installed") return mutationResult(request, record.revision, "not_found");
    if (record.state === "installing" || record.state === "verifying") {
      return mutationResult(request, record.revision, "stale");
    }
    try {
      this.#verifiedBinding = undefined;
      const withdrawn = nextRecord(record, this.#now(), { state: "not_installed", receipts: record.receipts });
      this.#store.write(withdrawn);
      this.#store.removeAsset();
      this.#store.discardStaging();
      return this.#recordMutation(withdrawn, request, "remove", "committed", "not_installed");
    } catch {
      return mutationResult(request, this.#read().revision, "failed");
    }
  }

  embeddingModelInstalled(): boolean {
    let record: LocalSemanticAssetRecord;
    try { record = this.#read(); } catch { return false; }
    return record.state === "ready" && this.#store.stillMatches(this.#verifiedBinding);
  }

  async recover(): Promise<void> {
    let record: LocalSemanticAssetRecord;
    try { record = this.#read(); } catch {
      this.#verifiedBinding = undefined;
      return;
    }
    try {
      if (record.state === "not_installed") {
        this.#verifiedBinding = undefined;
        this.#store.removeAsset();
        this.#store.discardStaging();
        return;
      }
      this.#verifiedBinding = await this.#store.verify();
      if (record.state === "installing" || record.state === "verifying" || record.state === "needs_repair") {
        record = nextRecord(record, this.#now(), { state: "ready", receipts: record.receipts });
        this.#store.write(record);
      }
      this.#store.discardStaging();
    } catch {
      this.#verifiedBinding = undefined;
      this.#store.discardStaging();
      this.#writeRepairState(record);
    }
  }

  async #completeInstall(requestId: string, jobId: string): Promise<void> {
    const stagingPath = this.#store.createStagingPath(requestId);
    try {
      await this.#transport.download(ASSET_URL, stagingPath);
      const installing = this.#read();
      if (!sameActiveInstall(installing, requestId, jobId)) throw new Error("Install ownership changed.");
      const verifying = nextRecord(installing, this.#now(), { state: "verifying", receipts: installing.receipts });
      this.#store.write(verifying);
      await this.#store.verify(stagingPath);
      this.#verifiedBinding = await this.#store.publish(stagingPath);
      const current = this.#read();
      if (!sameActiveInstall(current, requestId, jobId)) throw new Error("Install ownership changed.");
      this.#store.write(nextRecord(current, this.#now(), { state: "ready", receipts: current.receipts }));
      this.#store.discardStaging();
    } catch {
      this.#verifiedBinding = undefined;
      try {
        const current = this.#read();
        if (sameActiveInstall(current, requestId, jobId)) this.#writeRepairState(current);
        this.#store.discardStaging();
      } catch { /* The durable active state is recovered fail-closed on restart. */ }
    }
  }

  #recordInstallResult(
    record: LocalSemanticAssetRecord,
    request: LocalSemanticRetrievalInstallRequest,
    status: "already_installed"
  ): LocalSemanticRetrievalInstallResult {
    const next = nextRecord(record, this.#now(), {
      state: record.state,
      receipts: appendReceipt(record, {
        requestId: request.requestId, action: "install", revision: record.revision + 1, status
      })
    });
    this.#store.write(next);
    return { apiVersion: 1, requestId: request.requestId, revision: next.revision, status };
  }

  #recordMutation<T extends "enable" | "disable" | "remove", S extends string>(
    record: LocalSemanticAssetRecord,
    request: MutationRequest,
    action: T,
    status: S,
    state = record.state
  ): { apiVersion: 1; requestId: string; revision: number; status: S } {
    const next = nextRecord(record, this.#now(), {
      state,
      receipts: appendReceipt(record, {
        requestId: request.requestId, action, revision: record.revision + 1, status
      })
    });
    this.#store.write(next);
    return { apiVersion: 1, requestId: request.requestId, revision: next.revision, status };
  }

  #writeRepairState(record: LocalSemanticAssetRecord): LocalSemanticAssetRecord {
    if (record.state === "needs_repair" && !record.activeJobId) return record;
    const repaired = nextRecord(record, this.#now(), { state: "needs_repair", receipts: record.receipts });
    this.#store.write(repaired);
    return repaired;
  }

  #read(): LocalSemanticAssetRecord {
    return this.#store.read(this.#now().toISOString());
  }
}

function statusFromRecord(record: LocalSemanticAssetRecord): LocalSemanticRetrievalStatus {
  return {
    apiVersion: 1,
    revision: record.revision,
    assetId: LOCAL_SEMANTIC_RETRIEVAL_ASSET_ID,
    assetState: record.state,
    downloadSizeBytes: LOCAL_SEMANTIC_RETRIEVAL_ASSET_BYTES,
    lexicalSearchRemainsAvailable: true,
    ...(record.activeJobId ? { activeJobId: record.activeJobId } : {})
  };
}

function nextRecord(
  record: LocalSemanticAssetRecord,
  now: Date,
  update: Pick<LocalSemanticAssetRecord, "state" | "receipts"> &
    Partial<Pick<LocalSemanticAssetRecord, "activeRequestId" | "activeJobId">>
): LocalSemanticAssetRecord {
  const active = update.state === "installing" || update.state === "verifying";
  const { activeRequestId: _activeRequestId, activeJobId: _activeJobId, ...settledRecord } = record;
  const activeRequestId = update.activeRequestId ?? record.activeRequestId;
  const activeJobId = update.activeJobId ?? record.activeJobId;
  return {
    ...settledRecord,
    revision: record.revision + 1,
    state: update.state,
    updatedAt: now.toISOString(),
    receipts: update.receipts,
    ...(active && activeRequestId ? { activeRequestId } : {}),
    ...(active && activeJobId ? { activeJobId } : {})
  };
}

function appendReceipt(
  record: LocalSemanticAssetRecord,
  receipt: LocalSemanticAssetReceipt
): readonly LocalSemanticAssetReceipt[] {
  return [...record.receipts.filter(({ requestId }) => requestId !== receipt.requestId), receipt].slice(-64);
}

function receiptFor(
  record: LocalSemanticAssetRecord,
  requestId: string,
  action: LocalSemanticAssetReceipt["action"]
): LocalSemanticAssetReceipt | undefined {
  return record.receipts.find((receipt) => receipt.requestId === requestId && receipt.action === action);
}

function installResult(requestId: string, receipt: LocalSemanticAssetReceipt): LocalSemanticRetrievalInstallResult {
  if (receipt.status === "accepted" && receipt.jobId) {
    return { apiVersion: 1, requestId, revision: receipt.revision, status: "accepted", jobId: receipt.jobId };
  }
  return { apiVersion: 1, requestId, revision: receipt.revision, status: "already_installed" };
}

function mutationResult<S extends "committed" | "already_enabled" | "stale" | "not_found" | "failed">(
  request: MutationRequest,
  revision: number,
  status: S
): { apiVersion: 1; requestId: string; revision: number; status: S } {
  return { apiVersion: 1, requestId: request.requestId, revision, status };
}

function sameActiveInstall(record: LocalSemanticAssetRecord, requestId: string, jobId: string): boolean {
  return (record.state === "installing" || record.state === "verifying") &&
    record.activeRequestId === requestId && record.activeJobId === jobId;
}

function createAssetJobId(now: Date): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `job_${date}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function createFetchLocalSemanticAssetTransport(): LocalSemanticAssetTransport {
  return {
    download: async (url, destinationPath) => {
      if (url !== ASSET_URL) throw new Error("Unexpected local semantic asset URL.");
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok || !response.body) throw new Error("Local semantic asset download failed.");
      const finalUrl = new URL(response.url);
      if (finalUrl.protocol !== "https:" || !ALLOWED_DOWNLOAD_HOSTS.has(finalUrl.hostname)) {
        throw new Error("Local semantic asset redirect was not approved.");
      }
      const descriptor = fs.openSync(
        destinationPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
        0o600
      );
      let written = 0;
      try {
        const reader = response.body.getReader();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          written += chunk.value.byteLength;
          if (written > LOCAL_SEMANTIC_RETRIEVAL_ASSET_BYTES) throw new Error("Asset download exceeded its bound.");
          writeAll(descriptor, chunk.value);
        }
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    }
  };
}

function writeAll(descriptor: number, value: Uint8Array): void {
  let offset = 0;
  while (offset < value.byteLength) {
    const written = fs.writeSync(descriptor, value, offset, value.byteLength - offset);
    if (written <= 0) throw new Error("Local semantic asset write stopped unexpectedly.");
    offset += written;
  }
}
