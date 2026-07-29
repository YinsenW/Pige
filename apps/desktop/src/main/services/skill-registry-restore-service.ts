import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  SkillLifecycleRequestIdSchema,
  SkillRegistryRecordSchema,
  VaultIdSchema,
  type SkillManifest,
  type SkillRegistryFile,
  type SkillRegistryRecord,
  type SkillRegistrySummary,
  type SkillRestorableSummary
} from "@pige/schemas";
import {
  fsyncDirectory,
  parseInstallReceipt,
  readBoundedNoFollow,
  readManifestDirectory,
  stableJson,
  writeJsonAtomic,
  SkillRegistryLifecycleStore,
  type InstalledSkillSnapshot,
  type SkillInstallReceipt,
  type SkillUninstallReceipt,
  type SkillUninstallReceiptV2
} from "./skill-registry-lifecycle-store";

const RESTORE_RECEIPT_NAME = ".pige-restore.json";
const TRASHED_SKILL_NAME = "skill";
const INSTALL_RECEIPT_NAME = ".pige-install.json";
const MAX_RECEIPT_BYTES = 16 * 1024;

export interface RestoreSkillRequestBinding {
  readonly requestId: string;
  readonly activeVaultId: string;
  readonly restoreContextId: string;
  readonly skillId: string;
  readonly expectedRegistryRevision: number;
}

export function lifecycleRequestIdentity(request: {
  readonly requestId: string; readonly activeVaultId: string; readonly skillId: string;
}) {
  return { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId, skillId: request.skillId };
}

export function matchesUninstallRequest(receipt: SkillUninstallReceipt, request: {
  readonly requestId: string; readonly activeVaultId: string; readonly skillId: string;
  readonly expectedRegistryRevision: number;
}): boolean {
  return receipt.requestId === request.requestId && receipt.activeVaultId === request.activeVaultId &&
    receipt.skillId === request.skillId && receipt.expectedRegistryRevision === request.expectedRegistryRevision;
}

export type RestoreSkillOutcome =
  | { readonly status: "committed" | "stale" | "not_found" | "ineligible"; readonly registry: SkillRegistrySummary }
  | { readonly status: "failed" };

interface RegistryPorts {
  readonly appDataRoot: string;
  readonly readRegistry: () => SkillRegistryFile;
  readonly parseManifest: (source: string) => SkillManifest;
  readonly project: (registry: SkillRegistryFile) => SkillRegistrySummary;
  readonly nextRegistry: (current: SkillRegistryFile, skills: readonly SkillRegistryRecord[]) => SkillRegistryFile;
  readonly writeRegistry: (registry: SkillRegistryFile) => void;
  readonly lifecycleStore: SkillRegistryLifecycleStore;
}

interface SkillRestoreReceipt {
  readonly schemaVersion: 1;
  readonly state: "prepared" | "committed";
  readonly requestId: string;
  readonly activeVaultId: string;
  readonly skillId: string;
  readonly expectedRegistryRevision: number;
  readonly committedRegistryRevision?: number;
  readonly uninstallRequestId: string;
  readonly record: SkillRegistryRecord;
  readonly bundleSha256: string;
  readonly installReceiptSha256: string;
  readonly createdAt: string;
}

interface RestorableSkillCandidate {
  readonly uninstallReceipt: SkillUninstallReceiptV2;
  readonly snapshot: InstalledSkillSnapshot;
  readonly installReceipt: SkillInstallReceipt;
}

interface BoundCandidate {
  readonly candidate: RestorableSkillCandidate;
  readonly projection: SkillRestorableSummary;
}

export class SkillRegistryRestoreService {
  readonly #ports: RegistryPorts;
  readonly #installedRoot: string;
  readonly #trashRoot: string;

  constructor(ports: RegistryPorts) {
    this.#ports = ports;
    this.#installedRoot = path.join(ports.appDataRoot, "skills", "installed");
    this.#trashRoot = path.join(ports.appDataRoot, "skills", "trash");
  }

  projectCandidates(registry = this.#ports.readRegistry()): readonly SkillRestorableSummary[] {
    return this.#readCandidates(registry).map(({ projection }) => projection);
  }

  restore(request: RestoreSkillRequestBinding, assertLock: () => void): RestoreSkillOutcome {
    try {
      this.recover(this.#listRestoreReceipts().filter((receipt) => receipt.state === "prepared"), assertLock);
      const current = this.#ports.readRegistry();
      const replay = this.#listRestoreReceipts().find((receipt) => receipt.requestId === request.requestId);
      if (replay) return this.#replayResult(request, replay, current);
      if (request.expectedRegistryRevision !== current.revision) {
        return { status: "stale", registry: this.#ports.project(current) };
      }
      const matching = this.#readCandidates(current).filter(({ projection }) =>
        projection.restoreContextId === request.restoreContextId && projection.skillId === request.skillId
      );
      if (matching.length !== 1) return { status: "not_found", registry: this.#ports.project(current) };
      if (current.skills.some((record) => record.id === request.skillId)) {
        return { status: "ineligible", registry: this.#ports.project(current) };
      }
      const receipt = this.#prepareRestore(request, matching[0]!.candidate);
      const next = this.#ports.nextRegistry(current, [...current.skills, receipt.record]);
      assertLock();
      this.#ports.writeRegistry(next);
      this.#markCommitted(receipt, next.revision);
      return { status: "committed", registry: this.#ports.project(next) };
    } catch {
      return { status: "failed" };
    }
  }

  recoverPrepared(assertLock: () => void): void {
    this.recover(this.#listRestoreReceipts().filter((receipt) => receipt.state === "prepared"), assertLock);
  }

  hasPreparedRestore(): boolean { return this.#listRestoreReceipts().some((receipt) => receipt.state === "prepared"); }

  recover(receipts: readonly SkillRestoreReceipt[], assertLock: () => void): void {
    for (const receipt of receipts) {
      const current = this.#ports.readRegistry();
      const installed = current.skills.find((record) => record.id === receipt.skillId);
      if (current.revision === receipt.expectedRegistryRevision) {
        if (installed) throw new Error("skill.restore_recovery_conflict");
        this.#ensureRestored(receipt);
        const next = this.#ports.nextRegistry(current, [...current.skills, receipt.record]);
        assertLock();
        this.#ports.writeRegistry(next);
        this.#markCommitted(receipt, next.revision);
      } else if (current.revision === receipt.expectedRegistryRevision + 1 && installed &&
        stableJson(installed) === stableJson(receipt.record)) {
        this.#markCommitted(receipt, current.revision);
      } else {
        throw new Error("skill.restore_recovery_conflict");
      }
    }
  }

  recoverPreparedUninstalls(receipts: readonly SkillUninstallReceipt[], assertLock: () => void): void {
    for (const receipt of receipts) {
      const current = this.#ports.readRegistry();
      const index = current.skills.findIndex((record) => record.id === receipt.skillId);
      if (current.revision === receipt.expectedRegistryRevision) {
        if (index < 0 || stableJson(current.skills[index]) !== stableJson(receipt.record)) {
          throw new Error("skill.uninstall_recovery_conflict");
        }
        this.#ports.lifecycleStore.ensureTrashed(receipt);
        const next = this.#ports.nextRegistry(current, current.skills.filter((record) => record.id !== receipt.skillId));
        assertLock();
        this.#ports.writeRegistry(next);
        this.#ports.lifecycleStore.markUninstallCommitted(receipt, next.revision);
      } else if (current.revision === receipt.expectedRegistryRevision + 1 && index < 0) {
        this.#ports.lifecycleStore.markUninstallCommitted(receipt, current.revision);
      } else {
        throw new Error("skill.uninstall_recovery_conflict");
      }
    }
  }

  #readCandidates(registry: SkillRegistryFile): readonly BoundCandidate[] {
    const installedIds = new Set(registry.skills.map((record) => record.id));
    const candidates: BoundCandidate[] = [];
    for (const receipt of this.#ports.lifecycleStore.listUninstallReceipts()) {
      if (receipt.schemaVersion !== 2 || receipt.state !== "committed" || installedIds.has(receipt.skillId)) continue;
      try {
        const candidate = this.#readCandidate(receipt);
        if (!candidate || candidate.installReceipt.enabled !== receipt.record.enabled) continue;
        const source = candidate.snapshot.bytes.toString("utf8");
        if (source.includes("\uFFFD")) continue;
        const manifest = this.#ports.parseManifest(source);
        if (manifest.id !== receipt.skillId || manifest.version !== receipt.record.version ||
          manifest.kind !== "pure" || manifest.scope !== "machine_local") continue;
        candidates.push({
          candidate,
          projection: {
            restoreContextId: skillRestoreContextId(receipt),
            skillId: manifest.id,
            name: manifest.name,
            version: manifest.version,
            kind: manifest.kind,
            scope: manifest.scope,
            uninstalledAt: receipt.createdAt,
            canRestore: true
          }
        });
      } catch { /* invalid private trash grants no restore authority */ }
    }
    return candidates.sort((left, right) =>
      right.projection.uninstalledAt.localeCompare(left.projection.uninstalledAt) ||
      left.projection.skillId.localeCompare(right.projection.skillId, "en")
    );
  }

  #readCandidate(receipt: SkillUninstallReceiptV2): RestorableSkillCandidate | undefined {
    const receiptDirectory = this.#trashEntry(receipt.requestId);
    const trashedPath = path.join(receiptDirectory, TRASHED_SKILL_NAME);
    if (receipt.state !== "committed" || !fs.existsSync(trashedPath) ||
      fs.existsSync(path.join(this.#installedRoot, receipt.skillId))) return undefined;
    const snapshot = readManifestDirectory(receiptDirectory, trashedPath);
    const source = readBoundedNoFollow(path.join(trashedPath, INSTALL_RECEIPT_NAME), MAX_RECEIPT_BYTES);
    if (!source) throw new Error("skill.restore_install_receipt_missing");
    const installReceipt = parseInstallReceipt(source);
    if (snapshot.sha256 !== receipt.manifestSha256 || snapshot.bundleSha256 !== receipt.bundleSha256 ||
      installReceipt.manifestSha256 !== receipt.manifestSha256 || installReceipt.bundleSha256 !== receipt.bundleSha256 ||
      digestStableJson(installReceipt) !== receipt.installReceiptSha256) throw new Error("skill.restore_payload_changed");
    return { uninstallReceipt: receipt, snapshot, installReceipt };
  }

  #prepareRestore(request: RestoreSkillRequestBinding, candidate: RestorableSkillCandidate): SkillRestoreReceipt {
    const currentCandidate = this.#readCandidate(candidate.uninstallReceipt);
    if (!currentCandidate || stableJson(currentCandidate.uninstallReceipt) !== stableJson(candidate.uninstallReceipt)) {
      throw new Error("skill.restore_candidate_changed");
    }
    const existing = this.#readRestoreReceipt(candidate.uninstallReceipt.requestId);
    const createdAt = new Date().toISOString();
    const expected: SkillRestoreReceipt = {
      schemaVersion: 1,
      state: "prepared",
      requestId: SkillLifecycleRequestIdSchema.parse(request.requestId),
      activeVaultId: VaultIdSchema.parse(request.activeVaultId),
      skillId: candidate.uninstallReceipt.skillId,
      expectedRegistryRevision: request.expectedRegistryRevision,
      uninstallRequestId: candidate.uninstallReceipt.requestId,
      record: { ...candidate.uninstallReceipt.record, enabled: false, updatedAt: createdAt },
      bundleSha256: candidate.uninstallReceipt.bundleSha256,
      installReceiptSha256: candidate.uninstallReceipt.installReceiptSha256,
      createdAt
    };
    const receipt = existing ?? this.#writeRestoreReceipt(expected);
    if (!sameRestoreIntent(receipt, expected)) throw new Error("skill.restore_receipt_conflict");
    this.#ensureRestored(receipt);
    return receipt;
  }

  #ensureRestored(receipt: SkillRestoreReceipt): void {
    const receiptDirectory = this.#trashEntry(receipt.uninstallRequestId);
    const trashedPath = path.join(receiptDirectory, TRASHED_SKILL_NAME);
    const installedPath = path.join(this.#installedRoot, receipt.skillId);
    const trashedExists = fs.existsSync(trashedPath);
    const installedExists = fs.existsSync(installedPath);
    if (trashedExists === installedExists) throw new Error("skill.restore_path_conflict");
    if (trashedExists) {
      const uninstall = this.#ports.lifecycleStore.readUninstallReceipt(receipt.uninstallRequestId);
      if (!uninstall || uninstall.schemaVersion !== 2 || !this.#readCandidate(uninstall)) {
        throw new Error("skill.restore_candidate_changed");
      }
      fs.renameSync(trashedPath, installedPath);
      fsyncDirectory(receiptDirectory);
      fsyncDirectory(this.#installedRoot);
    }
    const snapshot = this.#ports.lifecycleStore.readInstalled(receipt.skillId);
    const installReceipt = this.#ports.lifecycleStore.readInstallReceipt(receipt.skillId);
    if (!installReceipt || snapshot.bundleSha256 !== receipt.bundleSha256 ||
      digestStableJson(installReceipt) !== receipt.installReceiptSha256) throw new Error("skill.restore_payload_changed");
  }

  #markCommitted(receipt: SkillRestoreReceipt, registryRevision: number): SkillRestoreReceipt {
    this.#ensureRestored(receipt);
    const current = this.#readRestoreReceipt(receipt.uninstallRequestId);
    if (!current || !sameRestoreIntent(current, receipt)) throw new Error("skill.restore_receipt_conflict");
    if (current.state === "committed") {
      if (current.committedRegistryRevision !== registryRevision) throw new Error("skill.restore_receipt_conflict");
      return current;
    }
    return this.#writeRestoreReceipt({ ...current, state: "committed", committedRegistryRevision: registryRevision });
  }

  #replayResult(request: RestoreSkillRequestBinding, replay: SkillRestoreReceipt, current: SkillRegistryFile): RestoreSkillOutcome {
    const uninstall = this.#ports.lifecycleStore.readUninstallReceipt(replay.uninstallRequestId);
    const installed = current.skills.find((record) => record.id === replay.skillId);
    if (uninstall?.schemaVersion === 2 && replay.activeVaultId === request.activeVaultId &&
      replay.skillId === request.skillId && replay.expectedRegistryRevision === request.expectedRegistryRevision &&
      skillRestoreContextId(uninstall) === request.restoreContextId && replay.state === "committed" && installed &&
      stableJson(installed) === stableJson(replay.record)) return { status: "committed", registry: this.#ports.project(current) };
    return { status: "ineligible", registry: this.#ports.project(current) };
  }

  #listRestoreReceipts(): readonly SkillRestoreReceipt[] {
    const receipts: SkillRestoreReceipt[] = [];
    for (const uninstall of this.#ports.lifecycleStore.listUninstallReceipts()) {
      try {
        const receipt = this.#readRestoreReceipt(uninstall.requestId);
        if (receipt) receipts.push(receipt);
      } catch { /* malformed receipt remains fail closed */ }
    }
    return receipts.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  #readRestoreReceipt(uninstallRequestId: string): SkillRestoreReceipt | undefined {
    const source = readBoundedNoFollow(path.join(this.#trashEntry(uninstallRequestId), RESTORE_RECEIPT_NAME), MAX_RECEIPT_BYTES);
    return source === undefined ? undefined : parseRestoreReceipt(source, uninstallRequestId);
  }

  #writeRestoreReceipt(receipt: SkillRestoreReceipt): SkillRestoreReceipt {
    writeJsonAtomic(path.join(this.#trashEntry(receipt.uninstallRequestId), RESTORE_RECEIPT_NAME), receipt);
    return this.#readRestoreReceipt(receipt.uninstallRequestId) ?? receipt;
  }

  #trashEntry(requestId: string): string {
    const candidate = path.join(this.#trashRoot, SkillLifecycleRequestIdSchema.parse(requestId));
    if (path.dirname(candidate) !== this.#trashRoot) throw new Error("skill.registry_path_escape");
    const stats = fs.lstatSync(candidate);
    if (!stats.isDirectory() || stats.isSymbolicLink() || fs.realpathSync.native(candidate) !== candidate) {
      throw new Error("skill.restore_path_invalid");
    }
    return candidate;
  }
}

function parseRestoreReceipt(source: string, uninstallRequestId: string): SkillRestoreReceipt {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error("skill.restore_receipt_invalid"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("skill.restore_receipt_invalid");
  const record = value as Record<string, unknown>;
  const expectedKeys = record.state === "committed"
    ? "activeVaultId,bundleSha256,committedRegistryRevision,createdAt,expectedRegistryRevision,installReceiptSha256,record,requestId,schemaVersion,skillId,state,uninstallRequestId"
    : "activeVaultId,bundleSha256,createdAt,expectedRegistryRevision,installReceiptSha256,record,requestId,schemaVersion,skillId,state,uninstallRequestId";
  if (Object.keys(record).sort().join(",") !== expectedKeys || record.schemaVersion !== 1 ||
    (record.state !== "prepared" && record.state !== "committed") ||
    !SkillLifecycleRequestIdSchema.safeParse(record.requestId).success ||
    !SkillLifecycleRequestIdSchema.safeParse(record.uninstallRequestId).success || record.uninstallRequestId !== uninstallRequestId ||
    !VaultIdSchema.safeParse(record.activeVaultId).success || typeof record.skillId !== "string" ||
    !Number.isSafeInteger(record.expectedRegistryRevision) || Number(record.expectedRegistryRevision) < 0 ||
    typeof record.bundleSha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(record.bundleSha256) ||
    typeof record.installReceiptSha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(record.installReceiptSha256) ||
    !SkillRegistryRecordSchema.safeParse(record.record).success ||
    (record.record as { readonly enabled?: unknown }).enabled !== false ||
    typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt)) ||
    (record.state === "committed" && (!Number.isSafeInteger(record.committedRegistryRevision) ||
      Number(record.committedRegistryRevision) !== Number(record.expectedRegistryRevision) + 1))) {
    throw new Error("skill.restore_receipt_invalid");
  }
  const parsed = record as unknown as SkillRestoreReceipt;
  if (parsed.skillId !== parsed.record.id) throw new Error("skill.restore_receipt_invalid");
  return parsed;
}

function sameRestoreIntent(left: SkillRestoreReceipt, right: SkillRestoreReceipt): boolean {
  return left.requestId === right.requestId && left.activeVaultId === right.activeVaultId &&
    left.skillId === right.skillId && left.expectedRegistryRevision === right.expectedRegistryRevision &&
    left.uninstallRequestId === right.uninstallRequestId && left.bundleSha256 === right.bundleSha256 &&
    left.installReceiptSha256 === right.installReceiptSha256 && stableJson(left.record) === stableJson(right.record);
}

function skillRestoreContextId(receipt: SkillUninstallReceiptV2): string {
  return `skill_restore_context_v2_${createHash("sha256")
    .update("pige.skill.restore.context.v1\0", "utf8").update(receipt.requestId, "utf8").update("\0", "utf8")
    .update(receipt.bundleSha256, "utf8").update("\0", "utf8").update(receipt.installReceiptSha256, "utf8")
    .digest("hex").slice(0, 48)}`;
}

function digestStableJson(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}
