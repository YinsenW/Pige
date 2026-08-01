import { randomUUID } from "node:crypto";
import fs from "node:fs";
import {
  LOCAL_RERANKER_ASSET_BYTES,
  LOCAL_RERANKER_ASSET_ID,
  type LocalRerankerDisableRequest,
  type LocalRerankerDisableResult,
  type LocalRerankerEnableRequest,
  type LocalRerankerEnableResult,
  type LocalRerankerInstallRequest,
  type LocalRerankerInstallResult,
  type LocalRerankerRemoveRequest,
  type LocalRerankerRemoveResult,
  type LocalRerankerStatus,
  type LocalRerankerStatusRequest
} from "@pige/schemas";
import type { LocalSemanticAssetLease } from "./local-semantic-embedding-runtime";
import {
  LocalRerankerAssetStore,
  type LocalRerankerAssetStorePort,
  type LocalRerankerReceipt,
  type LocalRerankerRecord,
  type VerifiedLocalRerankerAsset
} from "./local-reranker-asset-store";

const ASSET_URL = "https://huggingface.co/tensorblock/Qwen_Qwen3-Reranker-0.6B-GGUF/resolve/" +
  "4bf3a1660c61f2754fc18035fb1d728d9b8735fc/Qwen3-Reranker-0.6B-Q3_K_M.gguf";
const ALLOWED_DOWNLOAD_HOSTS = new Set(["huggingface.co", "cdn-lfs.hf.co", "cas-bridge.xethub.hf.co"]);

export interface LocalRerankerTransport {
  download(url: string, destinationPath: string): Promise<void>;
}

export interface LocalRerankerServiceOptions {
  readonly appDataRoot: string;
  readonly store?: LocalRerankerAssetStorePort;
  readonly transport?: LocalRerankerTransport;
  readonly now?: () => Date;
  readonly onAssetRevoked?: () => void | Promise<void>;
}

type MutationRequest = LocalRerankerInstallRequest;

export class LocalRerankerService {
  readonly #store: LocalRerankerAssetStorePort;
  readonly #transport: LocalRerankerTransport;
  readonly #now: () => Date;
  readonly #onAssetRevoked: () => void | Promise<void>;
  #verifiedBinding: VerifiedLocalRerankerAsset | undefined;

  constructor(options: LocalRerankerServiceOptions) {
    this.#store = options.store ?? new LocalRerankerAssetStore(options.appDataRoot);
    this.#transport = options.transport ?? createFetchTransport();
    this.#now = options.now ?? (() => new Date());
    this.#onAssetRevoked = options.onAssetRevoked ?? (() => undefined);
  }

  status(_request: LocalRerankerStatusRequest): LocalRerankerStatus {
    const record = this.#read();
    return {
      apiVersion: 1, revision: record.revision, assetId: LOCAL_RERANKER_ASSET_ID,
      assetState: record.state, downloadSizeBytes: LOCAL_RERANKER_ASSET_BYTES,
      hybridSearchRemainsAvailable: true,
      ...(record.activeJobId ? { activeJobId: record.activeJobId } : {})
    };
  }

  install(request: LocalRerankerInstallRequest): LocalRerankerInstallResult {
    const record = this.#read();
    const prior = receiptFor(record, request.requestId, "install");
    if (prior?.status === "accepted" && prior.jobId) {
      return { apiVersion: 1, requestId: request.requestId, revision: prior.revision, status: "accepted", jobId: prior.jobId };
    }
    if (prior) return result(request, prior.revision, "already_installed");
    if (request.expectedRevision !== record.revision) return result(request, record.revision, "stale");
    if (record.state === "ready" || record.state === "disabled") return result(request, record.revision, "already_installed");
    if (record.state === "installing" || record.state === "verifying") return result(request, record.revision, "stale");
    const jobId = createJobId(this.#now());
    const accepted = nextRecord(record, this.#now(), {
      state: "installing", activeRequestId: request.requestId, activeJobId: jobId,
      receipts: appendReceipt(record, {
        requestId: request.requestId, action: "install", revision: record.revision + 1, status: "accepted", jobId
      })
    });
    try {
      this.#revoke();
      this.#store.discardStaging();
      this.#store.write(accepted);
    } catch {
      return result(request, record.revision, "failed");
    }
    void this.#completeInstall(request.requestId, jobId);
    return { apiVersion: 1, requestId: request.requestId, revision: accepted.revision, status: "accepted", jobId };
  }

  async enable(request: LocalRerankerEnableRequest): Promise<LocalRerankerEnableResult> {
    const record = this.#read();
    const prior = receiptFor(record, request.requestId, "enable");
    if (prior) return result(request, prior.revision, prior.status as "committed" | "already_enabled");
    if (request.expectedRevision !== record.revision) return result(request, record.revision, "stale");
    if (record.state === "not_installed") return result(request, record.revision, "not_found");
    if (record.state === "installing" || record.state === "verifying") return result(request, record.revision, "stale");
    if (record.state === "ready" && this.availableNow()) return result(request, record.revision, "already_enabled");
    try {
      this.#verifiedBinding = await this.#store.verify();
      return this.#recordMutation(record, request, "enable", "committed", "ready");
    } catch {
      this.#revoke();
      return result(request, this.#writeRepair(record).revision, "failed");
    }
  }

  disable(request: LocalRerankerDisableRequest): LocalRerankerDisableResult {
    const record = this.#read();
    const prior = receiptFor(record, request.requestId, "disable");
    if (prior) return result(request, prior.revision, "committed");
    if (request.expectedRevision !== record.revision) return result(request, record.revision, "stale");
    if (record.state === "not_installed" || record.state === "needs_repair") return result(request, record.revision, "not_found");
    if (record.state === "installing" || record.state === "verifying") return result(request, record.revision, "stale");
    if (record.state === "disabled") return result(request, record.revision, "committed");
    this.#revoke();
    return this.#recordMutation(record, request, "disable", "committed", "disabled");
  }

  remove(request: LocalRerankerRemoveRequest): LocalRerankerRemoveResult {
    const record = this.#read();
    const prior = receiptFor(record, request.requestId, "remove");
    if (prior) return result(request, prior.revision, "committed");
    if (request.expectedRevision !== record.revision) return result(request, record.revision, "stale");
    if (record.state === "not_installed") return result(request, record.revision, "not_found");
    if (record.state === "installing" || record.state === "verifying") return result(request, record.revision, "stale");
    try {
      this.#revoke();
      const withdrawn = nextRecord(record, this.#now(), { state: "not_installed", receipts: record.receipts });
      this.#store.write(withdrawn);
      this.#store.removeAsset();
      this.#store.discardStaging();
      return this.#recordMutation(withdrawn, request, "remove", "committed", "not_installed");
    } catch {
      return result(request, this.#read().revision, "failed");
    }
  }

  availableNow(): boolean {
    try { return this.#read().state === "ready" && this.#store.stillMatches(this.#verifiedBinding); } catch { return false; }
  }

  createAssetLease(): LocalSemanticAssetLease | undefined {
    let record: LocalRerankerRecord;
    try { record = this.#read(); } catch { return undefined; }
    const binding = this.#verifiedBinding;
    if (record.state !== "ready" || !binding || !this.#store.stillMatches(binding)) return undefined;
    return {
      path: binding.path,
      identity: [record.revision, binding.dev, binding.ino, binding.size, binding.mtimeMs].join(":"),
      stillCurrent: () => {
        try {
          return this.#verifiedBinding === binding && this.#read().state === "ready" && this.#store.stillMatches(binding);
        } catch { return false; }
      }
    };
  }

  async recover(): Promise<void> {
    let record: LocalRerankerRecord;
    try { record = this.#read(); } catch { this.#revoke(); return; }
    try {
      if (record.state === "not_installed") {
        this.#revoke();
        this.#store.removeAsset();
        this.#store.discardStaging();
        return;
      }
      this.#verifiedBinding = await this.#store.verify();
      if (["installing", "verifying", "needs_repair"].includes(record.state)) {
        record = nextRecord(record, this.#now(), { state: "disabled", receipts: record.receipts });
        this.#store.write(record);
      }
      this.#store.discardStaging();
    } catch {
      this.#revoke();
      this.#store.discardStaging();
      this.#writeRepair(record);
    }
  }

  async #completeInstall(requestId: string, jobId: string): Promise<void> {
    const stagingPath = this.#store.createStagingPath(requestId);
    try {
      await this.#transport.download(ASSET_URL, stagingPath);
      const installing = this.#read();
      if (!sameInstall(installing, requestId, jobId)) throw new Error("Install ownership changed.");
      this.#store.write(nextRecord(installing, this.#now(), { state: "verifying", receipts: installing.receipts }));
      await this.#store.verify(stagingPath);
      this.#verifiedBinding = await this.#store.publish(stagingPath);
      const current = this.#read();
      if (!sameInstall(current, requestId, jobId)) throw new Error("Install ownership changed.");
      this.#store.write(nextRecord(current, this.#now(), { state: "disabled", receipts: current.receipts }));
      this.#store.discardStaging();
    } catch {
      this.#revoke();
      try {
        const current = this.#read();
        if (sameInstall(current, requestId, jobId)) this.#writeRepair(current);
        this.#store.discardStaging();
      } catch { /* Restart recovery keeps the asset fail-closed. */ }
    }
  }

  #recordMutation<S extends string>(
    record: LocalRerankerRecord,
    request: MutationRequest,
    action: LocalRerankerReceipt["action"],
    status: S,
    state = record.state
  ): { apiVersion: 1; requestId: string; revision: number; status: S } {
    const next = nextRecord(record, this.#now(), {
      state,
      receipts: appendReceipt(record, { requestId: request.requestId, action, revision: record.revision + 1, status })
    });
    this.#store.write(next);
    return { apiVersion: 1, requestId: request.requestId, revision: next.revision, status };
  }

  #read(): LocalRerankerRecord { return this.#store.read(this.#now().toISOString()); }
  #writeRepair(record: LocalRerankerRecord): LocalRerankerRecord {
    if (record.state === "needs_repair" && !record.activeJobId) return record;
    const repaired = nextRecord(record, this.#now(), { state: "needs_repair", receipts: record.receipts });
    this.#store.write(repaired);
    return repaired;
  }
  #revoke(): void {
    this.#verifiedBinding = undefined;
    void Promise.resolve(this.#onAssetRevoked()).catch(() => undefined);
  }
}

function nextRecord(
  record: LocalRerankerRecord,
  now: Date,
  update: Pick<LocalRerankerRecord, "state" | "receipts"> &
    Partial<Pick<LocalRerankerRecord, "activeRequestId" | "activeJobId">>
): LocalRerankerRecord {
  const active = update.state === "installing" || update.state === "verifying";
  const { activeRequestId: _request, activeJobId: _job, ...settled } = record;
  const activeRequestId = update.activeRequestId ?? record.activeRequestId;
  const activeJobId = update.activeJobId ?? record.activeJobId;
  return {
    ...settled, revision: record.revision + 1, state: update.state, updatedAt: now.toISOString(), receipts: update.receipts,
    ...(active && activeRequestId ? { activeRequestId } : {}), ...(active && activeJobId ? { activeJobId } : {})
  };
}

function appendReceipt(record: LocalRerankerRecord, receipt: LocalRerankerReceipt): readonly LocalRerankerReceipt[] {
  return [...record.receipts.filter(({ requestId }) => requestId !== receipt.requestId), receipt].slice(-64);
}
function receiptFor(record: LocalRerankerRecord, requestId: string, action: LocalRerankerReceipt["action"]): LocalRerankerReceipt | undefined {
  return record.receipts.find((receipt) => receipt.requestId === requestId && receipt.action === action);
}
function sameInstall(record: LocalRerankerRecord, requestId: string, jobId: string): boolean {
  return ["installing", "verifying"].includes(record.state) && record.activeRequestId === requestId && record.activeJobId === jobId;
}
function result<S extends "committed" | "already_enabled" | "already_installed" | "stale" | "not_found" | "failed">(
  request: MutationRequest, revision: number, status: S
): { apiVersion: 1; requestId: string; revision: number; status: S } {
  return { apiVersion: 1, requestId: request.requestId, revision, status };
}
function createJobId(now: Date): string {
  return `job_${now.toISOString().slice(0, 10).replaceAll("-", "")}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function createFetchTransport(): LocalRerankerTransport {
  return {
    download: async (url, destinationPath) => {
      if (url !== ASSET_URL) throw new Error("Unexpected reranker URL.");
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok || !response.body) throw new Error("Local reranker download failed.");
      const finalUrl = new URL(response.url);
      if (finalUrl.protocol !== "https:" || !ALLOWED_DOWNLOAD_HOSTS.has(finalUrl.hostname)) {
        throw new Error("Local reranker redirect was not approved.");
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
          if (written > LOCAL_RERANKER_ASSET_BYTES) throw new Error("Reranker download exceeded its bound.");
          writeAll(descriptor, chunk.value);
        }
        if (written !== LOCAL_RERANKER_ASSET_BYTES) throw new Error("Reranker download size was invalid.");
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    }
  };
}

function writeAll(descriptor: number, bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.byteLength) offset += fs.writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
}
