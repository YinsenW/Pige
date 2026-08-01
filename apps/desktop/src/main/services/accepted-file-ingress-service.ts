import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import type { AgentTurnFilePreservationBinding } from "./capture-service";
import {
  ingressSnapshotService,
  type IngressSnapshotBinding,
  type IngressSnapshotDescriptor
} from "./ingress-snapshot-service";

interface AcceptedFileIngressVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
  assertWriterLease?(vaultPath: string): void;
}

export class AcceptedFileIngressService {
  readonly #vaults: AcceptedFileIngressVaultPort;

  constructor(vaults: AcceptedFileIngressVaultPort) {
    this.#vaults = vaults;
  }

  async freeze(
    filePath: string,
    binding: AgentTurnFilePreservationBinding
  ): Promise<IngressSnapshotDescriptor> {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vault || !vaultPath) throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    this.#vaults.assertWriterLease?.(vaultPath);
    const normalizedPath = path.resolve(filePath);
    const existing = await resolveAcceptedFileIngress({
      vaultPath, vaultId: vault.vaultId, filePath: normalizedPath, binding
    });
    if (existing) return existing;
    return freezeAcceptedFileIngress({ vaultPath, vaultId: vault.vaultId, filePath: normalizedPath, binding });
  }

  discard(descriptor: IngressSnapshotDescriptor): void {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vault || !vaultPath || descriptor.vaultId !== vault.vaultId) {
      throw new PigeDomainError("vault_missing", "The ingress snapshot vault is unavailable.");
    }
    this.#vaults.assertWriterLease?.(vaultPath);
    const result = ingressSnapshotService.discardUnpublished(vaultPath, descriptor, descriptor.descriptorDigest);
    if (result.status !== "released" && result.status !== "not_found") {
      throw new PigeDomainError("agent_runtime.turn_conflict", "The unpublished ingress snapshot could not be released.");
    }
  }
}

export async function resolveAcceptedFileIngress(input: {
  readonly vaultPath: string;
  readonly vaultId: string;
  readonly filePath: string;
  readonly binding: AgentTurnFilePreservationBinding;
}): Promise<IngressSnapshotDescriptor | undefined> {
  const snapshot = await ingressSnapshotService.readAsync(
    input.vaultPath,
    toSnapshotBinding(input.vaultId, input.binding)
  );
  if (snapshot && (
    snapshot.sourceProvenance.originalPath !== path.resolve(input.filePath) ||
    (input.binding.inputChecksum !== undefined && snapshot.checksum !== input.binding.inputChecksum)
  )) throw bindingChanged();
  return snapshot;
}

export async function freezeAcceptedFileIngress(input: {
  readonly vaultPath: string;
  readonly vaultId: string;
  readonly filePath: string;
  readonly binding: AgentTurnFilePreservationBinding;
}): Promise<IngressSnapshotDescriptor> {
  assertBinding(input.binding);
  const sourceStat = fs.lstatSync(input.filePath);
  if (!sourceStat.isFile()) throw bindingChanged();
  const checksum = input.binding.inputChecksum ?? await checksumFile(input.filePath);
  return ingressSnapshotService.createOrAdopt({
    vaultPath: input.vaultPath,
    vaultId: input.vaultId,
    parentJobId: input.binding.jobId,
    sourceId: input.binding.sourceId,
    ordinal: input.binding.snapshotOrdinal ?? input.binding.ordinal ?? 0,
    sourcePath: input.filePath,
    checksum: checksum as `sha256:${string}`,
    size: sourceStat.size,
    noFollowIdentity: {
      device: sourceStat.dev, inode: sourceStat.ino, size: sourceStat.size,
      modifiedAtMs: sourceStat.mtimeMs, changedAtMs: sourceStat.ctimeMs
    }
  });
}

function toSnapshotBinding(vaultId: string, binding: AgentTurnFilePreservationBinding): IngressSnapshotBinding {
  assertBinding(binding);
  return {
    vaultId,
    parentJobId: binding.jobId,
    sourceId: binding.sourceId,
    ordinal: binding.snapshotOrdinal ?? binding.ordinal ?? 0
  };
}

function assertBinding(binding: AgentTurnFilePreservationBinding): void {
  if (
    !/^job_\d{8}_[a-z0-9]{8,}$/u.test(binding.jobId) ||
    !/^src_\d{8}_[a-z0-9]{8,}$/u.test(binding.sourceId) ||
    (binding.inputChecksum !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(binding.inputChecksum)) ||
    [binding.ordinal, binding.snapshotOrdinal].some((ordinal) =>
      ordinal !== undefined && (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 7)
    ) ||
    (binding.attachmentSetHash !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(binding.attachmentSetHash))
  ) throw bindingChanged();
}

async function checksumFile(filePath: string): Promise<`sha256:${string}`> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return `sha256:${hash.digest("hex")}`;
}

function bindingChanged(): PigeDomainError {
  return new PigeDomainError(
    "agent_runtime.turn_binding_invalid",
    "The accepted file does not match its immutable ingress snapshot."
  );
}
