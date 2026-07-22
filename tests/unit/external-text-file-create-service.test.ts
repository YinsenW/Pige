import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PigeDomainError } from "@pige/domain";
import { ExternalOperationRecordStore } from "../../apps/desktop/src/main/services/external-operation-record-store";
import {
  ExternalTextFileCreateService,
  MAX_EXTERNAL_TEXT_CREATE_BYTES,
  type ExternalFilePublicationIdentity,
  type ExternalFilePublicationPlan,
  type ExternalFilePublicationPort,
  type ExternalTextFileCreateAuthority
} from "../../apps/desktop/src/main/services/external-text-file-create-service";
import {
  capturedExternalTarget,
  EXTERNAL_TEXT_FILE_CREATE_ACTION_ID,
  EXTERNAL_TEXT_FILE_CREATE_ACTION_VERSION,
  hashExternalTarget,
  hashExternalTargetPermissionIdentity,
  hashExternalTextCreateActionInput,
  type CapturedExternalTarget,
  type ExternalFilePublicationFailureCode,
  type ExternalFilePublicationReceipt
} from "../../apps/desktop/src/main/services/external-file-publication-protocol";
import { createPermissionActionBinding } from "../../apps/desktop/src/main/services/permission-broker-service";
import {
  ExternalFilesystemPathGuard,
  assertExternalIdentity,
  externalFilesystemError,
  lstatExternal
} from "../../apps/desktop/src/main/services/readonly-node-os/external-filesystem-path-guard";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length > 0) fs.rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe("ExternalTextFileCreateService", () => {
  it("publishes one new UTF-8 file without persisting its path in the vault Operation", async () => {
    const fixture = createFixture();
    const targetPath = path.join(fixture.externalRoot, "created.txt");

    const prepared = await fixture.prepare(targetPath, "Pige external text: 中文");
    const result = await fixture.service.create(
      prepared.target,
      "Pige external text: 中文",
      prepared.authority,
      new AbortController().signal
    );

    expect(fs.readFileSync(targetPath, "utf8")).toBe("Pige external text: 中文");
    expect(fs.statSync(targetPath).mode & 0o777).toBe(0o600);
    expect(result).toMatchObject({
      intentId: expect.stringMatching(/^extmut_20260718_[a-f0-9]{20}$/u),
      operationId: expect.stringMatching(/^op_20260718_[a-f0-9]{20}$/u),
      targetResourceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u)
    });

    const intent = readIntent(fixture.machineRoot);
    expect(intent.targetPath).toBe(targetPath);
    expect(intent.state).toBe("operation_committed");
    const operationText = fs.readFileSync(findOperation(fixture.vaultPath), "utf8");
    expect(operationText).not.toContain(targetPath);
    expect(operationText).not.toContain("Pige external text");
    expect(JSON.parse(operationText)).toMatchObject({
      kind: "create_external_file",
      after: { kind: "external_resource", checksum: result.contentHash }
    });

    expect(await fixture.service.create(
      prepared.target,
      "Pige external text: 中文",
      prepared.authority,
      liveSignal()
    )).toEqual(result);

    await fixture.service.finalize(result.intentId, prepared.authority);
    expect(fs.readFileSync(targetPath, "utf8")).toBe("Pige external text: 中文");
    expect(fs.existsSync(intent.stagePath)).toBe(false);
    expect(readIntent(fixture.machineRoot).state).toBe("completed");
    const markCompleted = vi.mocked(prepared.authority.markCompleted);
    expect(markCompleted).toHaveBeenCalledTimes(1);
    const completionMarkerHash = markCompleted.mock.calls[0]?.[0];
    expect(completionMarkerHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(await fixture.service.create(
      prepared.target,
      "Pige external text: 中文",
      prepared.authority,
      liveSignal()
    )).toEqual(result);
    expect(markCompleted).toHaveBeenLastCalledWith(completionMarkerHash);
  });

  it("cannot mint a successor mutation by replaying one action binding with another tool call", async () => {
    const fixture = createFixture();
    const targetPath = path.join(fixture.externalRoot, "one-use.txt");
    const prepared = await fixture.prepare(targetPath, "one use");
    const result = await fixture.service.create(prepared.target, "one use", prepared.authority, liveSignal());
    await fixture.service.finalize(result.intentId, prepared.authority);
    fs.unlinkSync(targetPath);

    expect(await fixture.service.create(prepared.target, "one use", prepared.authority, liveSignal())).toEqual(result);
    expect(fs.existsSync(targetPath)).toBe(false);
    await expect(fixture.service.create(prepared.target, "one use", {
      ...prepared.authority,
      toolCallId: "call_external_create_successor"
    }, liveSignal())).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.authority_changed" })
    );
    expect(intentFiles(fixture.machineRoot)).toHaveLength(1);
    expect(fs.existsSync(targetPath)).toBe(false);
  });

  it("never overwrites an existing target or follows protected and symlink paths", async () => {
    const fixture = createFixture();
    const existing = path.join(fixture.externalRoot, "existing.txt");
    fs.writeFileSync(existing, "keep", "utf8");

    const existingPrepared = await fixture.prepare(existing, "replace");
    await expect(fixture.service.create(existingPrepared.target, "replace", existingPrepared.authority, liveSignal())).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.target_exists" })
    );
    expect(fs.readFileSync(existing, "utf8")).toBe("keep");
    expect(readIntent(fixture.machineRoot).state).toBe("failed_no_effect");
    await expect(fixture.prepare(path.join(fixture.vaultPath, "escape.txt"), "blocked")).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.protected_path" })
    );

    const alias = path.join(fixture.externalRoot, "alias");
    fs.symlinkSync(fixture.externalRoot, alias, process.platform === "win32" ? "junction" : "dir");
    await expect(fixture.prepare(path.join(alias, "escape.txt"), "blocked")).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.symlink_not_allowed" })
    );
  });

  it("rejects a replaced parent directory and an action authority for another captured target", async () => {
    const fixture = createFixture();
    const targetPath = path.join(fixture.externalRoot, "captured.txt");
    const prepared = await fixture.prepare(targetPath, "blocked");

    await expect(fixture.service.create(prepared.target, "blocked", {
      ...prepared.authority,
      binding: {
        ...prepared.authority.binding,
        resourceIdentityHash: `sha256:${"f".repeat(64)}`
      }
    }, liveSignal())).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.authority_changed" })
    );
    const other = await fixture.prepare(path.join(fixture.externalRoot, "other.txt"), "other");
    await expect(fixture.service.create(prepared.target, "blocked", other.authority, liveSignal())).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.authority_changed" })
    );
    await expect(fixture.service.create(prepared.target, "changed content", prepared.authority, liveSignal()))
      .rejects.toMatchObject(expect.objectContaining({ code: "external_filesystem.authority_changed" }));

    const displaced = `${fixture.externalRoot}-displaced`;
    fs.renameSync(fixture.externalRoot, displaced);
    fs.mkdirSync(fixture.externalRoot);
    await expect(fixture.service.create(prepared.target, "blocked", prepared.authority, liveSignal())).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.changed" })
    );
    expect(fs.existsSync(targetPath)).toBe(false);
  });

  it("requires the current execution owner to accept the exact action authority", async () => {
    const fixture = createFixture();
    const targetPath = path.join(fixture.externalRoot, "revoked.txt");
    const prepared = await fixture.prepare(targetPath, "blocked");
    const authority = {
      ...prepared.authority,
      assertExecutionAuthority: vi.fn(() => {
        throw new PigeDomainError("permission.denied", "Execution authority is no longer valid.");
      })
    };

    await expect(fixture.service.create(prepared.target, "blocked", authority, liveSignal())).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.authority_changed" })
    );
    expect(authority.assertExecutionAuthority).toHaveBeenCalledWith(prepared.authority.binding);
    expect(intentFiles(fixture.machineRoot)).toEqual([]);
    expect(fs.existsSync(targetPath)).toBe(false);
  });

  it("rechecks execution authority immediately before exclusive publication", async () => {
    const fixture = createFixture();
    const targetPath = path.join(fixture.externalRoot, "revoked-before-publish.txt");
    const prepared = await fixture.prepare(targetPath, "blocked");
    const assertExecutionAuthority = vi.fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new PigeDomainError("permission.stale", "Permission authority expired.");
      });
    const authority = { ...prepared.authority, assertExecutionAuthority };

    await expect(fixture.service.create(prepared.target, "blocked", authority, liveSignal())).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.authority_changed" })
    );
    expect(assertExecutionAuthority).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(targetPath)).toBe(false);
    const intent = readIntent(fixture.machineRoot);
    expect(intent.state).toBe("failed_no_effect");
    expect(fs.existsSync(intent.stagePath)).toBe(false);
  });

  it("fails uncertain when the async platform receipt does not match the approved target", async () => {
    const fixture = createFixture();
    const platform = new TestOnlyNodePublicationPort([fixture.vaultPath, fixture.machineRoot]);
    const service = new ExternalTextFileCreateService({ platform, machineRootPath: fixture.machineRoot });
    const target = await service.captureTarget(path.join(fixture.externalRoot, "bad-receipt.txt"));
    const authority = authorityFor(fixture.authority, target, "receipt");
    vi.spyOn(platform, "publishExclusive").mockResolvedValue({
      state: "published",
      parentIdentityHash: target.parentIdentityHash,
      targetResourceHash: `sha256:${"f".repeat(64)}`,
      contentHash: `sha256:${"e".repeat(64)}`,
      byteLength: 1
    });

    await expect(service.create(target, "receipt", authority, liveSignal())).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.publication_protocol_invalid" })
    );
    expect(readIntent(fixture.machineRoot).state).toBe("failed_uncertain");
  });

  it("treats an untyped platform publication failure as uncertain", async () => {
    const fixture = createFixture();
    const platform = new TestOnlyNodePublicationPort([fixture.vaultPath, fixture.machineRoot]);
    const service = new ExternalTextFileCreateService({ platform, machineRootPath: fixture.machineRoot });
    const target = await service.captureTarget(path.join(fixture.externalRoot, "transport-failure.txt"));
    const authority = authorityFor(fixture.authority, target, "transport");
    vi.spyOn(platform, "publishExclusive").mockRejectedValue(new Error("synthetic helper disconnect"));

    await expect(service.create(target, "transport", authority, liveSignal())).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.write_uncertain" })
    );
    expect(readIntent(fixture.machineRoot).state).toBe("failed_uncertain");
    expect(fs.existsSync(target.targetPath)).toBe(false);
  });

  it("rejects oversized or non-round-tripping text before creating an intent", async () => {
    const fixture = createFixture();

    const large = await fixture.prepare(path.join(fixture.externalRoot, "large.txt"), "");
    await expect(fixture.service.create(
      large.target,
      "x".repeat(MAX_EXTERNAL_TEXT_CREATE_BYTES + 1),
      large.authority,
      liveSignal()
    )).rejects.toMatchObject(expect.objectContaining({ code: "external_filesystem.invalid_text" }));
    const surrogate = await fixture.prepare(path.join(fixture.externalRoot, "surrogate.txt"), "");
    await expect(fixture.service.create(
      surrogate.target,
      "\ud800",
      surrogate.authority,
      liveSignal()
    )).rejects.toMatchObject(expect.objectContaining({ code: "external_filesystem.invalid_text" }));
    expect(intentFiles(fixture.machineRoot)).toEqual([]);
  });

  it("cleans its owned stage when cancellation wins before exclusive publication", async () => {
    const fixture = createFixture();
    const controller = new AbortController();
    const targetPath = path.join(fixture.externalRoot, "cancelled.txt");
    const prepared = await fixture.prepare(targetPath, "cancel");
    const authority = { ...prepared.authority, assertWriterLease: () => controller.abort() };

    await expect(fixture.service.create(prepared.target, "cancel", authority, controller.signal)).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.cancelled" })
    );
    expect(fs.existsSync(targetPath)).toBe(false);
    const intent = readIntent(fixture.machineRoot);
    expect(intent.state).toBe("cancelled");
    expect(fs.existsSync(intent.stagePath)).toBe(false);
  });

  it("adopts a published hard-link after an Operation-store crash without writing again", async () => {
    const fixture = createFixture();
    const operationStore = new ExternalOperationRecordStore();
    const service = new ExternalTextFileCreateService({
      platform: new TestOnlyNodePublicationPort([fixture.vaultPath, fixture.machineRoot]),
      machineRootPath: fixture.machineRoot,
      operationStore
    });
    const write = vi.spyOn(operationStore, "write").mockImplementationOnce(() => {
      throw new Error("synthetic operation-store crash");
    });
    const targetPath = path.join(fixture.externalRoot, "recover.txt");
    const target = await service.captureTarget(targetPath);
    const authority = authorityFor(fixture.authority, target, "recover");

    await expect(service.create(target, "recover", authority, liveSignal())).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.write_failed" })
    );
    expect(fs.readFileSync(targetPath, "utf8")).toBe("recover");
    const published = readIntent(fixture.machineRoot);
    expect(published.state).toBe("published");
    const beforeIdentity = fs.statSync(targetPath);

    write.mockRestore();
    const adopted = await service.adopt(published.id, authority);
    const afterIdentity = fs.statSync(targetPath);
    expect([afterIdentity.dev, afterIdentity.ino]).toEqual([beforeIdentity.dev, beforeIdentity.ino]);
    expect(adopted.operationId).toBe(published.operationId);
    expect(readIntent(fixture.machineRoot).state).toBe("operation_committed");
  });

  it("persists an invalid adoption receipt as uncertain instead of retrying", async () => {
    const fixture = createFixture();
    const platform = new TestOnlyNodePublicationPort([fixture.vaultPath, fixture.machineRoot]);
    const operationStore = new ExternalOperationRecordStore();
    const service = new ExternalTextFileCreateService({ platform, machineRootPath: fixture.machineRoot, operationStore });
    vi.spyOn(operationStore, "write").mockImplementationOnce(() => {
      throw new Error("synthetic operation-store crash");
    });
    const target = await service.captureTarget(path.join(fixture.externalRoot, "bad-adopt-receipt.txt"));
    const authority = authorityFor(fixture.authority, target, "recover");

    await expect(service.create(target, "recover", authority, liveSignal())).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.write_failed" })
    );
    const published = readIntent(fixture.machineRoot);
    vi.spyOn(platform, "adoptExclusive").mockResolvedValue({
      state: "published",
      parentIdentityHash: published.parentIdentityHash as `sha256:${string}`,
      targetResourceHash: `sha256:${"f".repeat(64)}`,
      contentHash: published.contentHash as `sha256:${string}`,
      byteLength: Number(published.byteLength)
    });

    await expect(service.adopt(published.id, authority)).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.write_uncertain" })
    );
    expect(readIntent(fixture.machineRoot).state).toBe("failed_uncertain");
    await expect(service.adopt(published.id, authority)).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.write_uncertain" })
    );
  });

  it("fails closed when authority or the staged bytes change during recovery", async () => {
    const fixture = createFixture();
    const targetPath = path.join(fixture.externalRoot, "tamper.txt");
    const prepared = await fixture.prepare(targetPath, "original");
    const result = await fixture.service.create(prepared.target, "original", prepared.authority, liveSignal());
    const intent = readIntent(fixture.machineRoot);

    await expect(fixture.service.adopt(result.intentId, {
      ...prepared.authority,
      binding: {
        ...prepared.authority.binding,
        bindingHash: `sha256:${"2".repeat(64)}`
      }
    })).rejects.toMatchObject(expect.objectContaining({ code: "external_filesystem.authority_changed" }));
    fs.unlinkSync(intent.stagePath);
    fs.writeFileSync(intent.stagePath, "changed", { encoding: "utf8", mode: 0o600 });
    await expect(fixture.service.adopt(result.intentId, prepared.authority)).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.write_uncertain" })
    );
    expect(readIntent(fixture.machineRoot).state).toBe("failed_uncertain");
  });

  it("does not finalize the owned stage after the writer lease is lost", async () => {
    const fixture = createFixture();
    const targetPath = path.join(fixture.externalRoot, "lease-finalize.txt");
    const prepared = await fixture.prepare(targetPath, "lease");
    const result = await fixture.service.create(prepared.target, "lease", prepared.authority, liveSignal());
    const intent = readIntent(fixture.machineRoot);
    let checks = 0;
    const authority = {
      ...prepared.authority,
      assertWriterLease: () => {
        checks += 1;
        if (checks === 2) throw externalFilesystemError("external_filesystem.writer_lease_lost");
      }
    };

    await expect(fixture.service.finalize(result.intentId, authority)).rejects.toMatchObject(
      expect.objectContaining({ code: "external_filesystem.writer_lease_lost" })
    );
    expect(fs.existsSync(intent.stagePath)).toBe(true);
    expect(readIntent(fixture.machineRoot).state).toBe("operation_committed");
  });
});

function createFixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-ext-create-")));
  roots.push(root);
  const vaultPath = path.join(root, "vault");
  const machineRoot = path.join(root, "machine");
  const externalRoot = path.join(root, "external");
  fs.mkdirSync(path.join(vaultPath, ".pige"), { recursive: true });
  fs.mkdirSync(machineRoot);
  fs.mkdirSync(externalRoot);
  const authority: TestAuthorityBase = {
    vaultPath,
    vaultId: "vault_20260718_external01",
    jobId: "job_20260718_external01",
    toolCallId: "call_external_create_01",
    policyContextId: "policy_external_create_01",
    policyHash: `sha256:${"b".repeat(64)}`,
    assertWriterLease: vi.fn()
  };
  const service = new ExternalTextFileCreateService({
    platform: new TestOnlyNodePublicationPort([vaultPath, machineRoot]),
    machineRootPath: machineRoot
  });
  return {
    vaultPath,
    machineRoot,
    externalRoot,
    authority,
    service,
    async prepare(targetPath: string, content: string) {
      const target = await service.captureTarget(targetPath);
      return { target, authority: authorityFor(authority, target, content) };
    }
  };
}

function authorityFor(
  authority: TestAuthorityBase,
  target: CapturedExternalTarget,
  content: string
): ExternalTextFileCreateAuthority {
  const contentBytes = Buffer.from(content, "utf8");
  const contentHash = hashContent(contentBytes);
  const binding = createPermissionActionBinding({
    vaultId: authority.vaultId,
    jobId: authority.jobId,
    actorType: "local_tool",
    actorId: "pige_external_text_file",
    actorVersion: "1.0.0",
    actorDigest: `sha256:${"d".repeat(64)}`,
    actionId: EXTERNAL_TEXT_FILE_CREATE_ACTION_ID,
    actionVersion: EXTERNAL_TEXT_FILE_CREATE_ACTION_VERSION,
    actionInputHash: hashExternalTextCreateActionInput({
      toolCallId: authority.toolCallId,
      targetResourceHash: target.targetResourceHash,
      contentHash,
      byteLength: contentBytes.byteLength
    }),
    capability: "external_filesystem",
    dataBoundary: "filesystem",
    resourceScope: "current_file",
    resourceIdentityHash: hashExternalTargetPermissionIdentity(target.targetResourceHash),
    policyContextId: authority.policyContextId,
    policyHash: authority.policyHash,
    runtimeKind: "desktop_local",
    clientCapabilityTier: "desktop_full"
  });
  return Object.freeze({
    vaultPath: authority.vaultPath,
    toolCallId: authority.toolCallId,
    binding,
    assertExecutionAuthority: vi.fn(),
    markCompleted: vi.fn(),
    assertWriterLease: authority.assertWriterLease
  });
}

interface TestAuthorityBase {
  readonly vaultPath: string;
  readonly vaultId: string;
  readonly jobId: string;
  readonly toolCallId: string;
  readonly policyContextId: string;
  readonly policyHash: `sha256:${string}`;
  readonly assertWriterLease: () => void;
}

function readIntent(machineRoot: string): Record<string, string> {
  const intentDirectory = intentFiles(machineRoot)[0] as string;
  const revision = fs.readdirSync(intentDirectory).sort().at(-1) as string;
  return JSON.parse(fs.readFileSync(path.join(intentDirectory, revision), "utf8")) as Record<string, string>;
}

function intentFiles(machineRoot: string): string[] {
  const directory = path.join(machineRoot, "external-mutation-intents");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.startsWith("extmut_"))
    .map((name) => path.join(directory, name));
}

function findOperation(vaultPath: string): string {
  return path.join(
    vaultPath,
    ".pige",
    "operations",
    "2026",
    "07",
    fs.readdirSync(path.join(vaultPath, ".pige", "operations", "2026", "07"))[0] as string
  );
}

function liveSignal(): AbortSignal {
  return new AbortController().signal;
}

class TestOnlyNodePublicationPort implements ExternalFilePublicationPort {
  readonly #guard: ExternalFilesystemPathGuard;

  constructor(protectedRoots: readonly string[]) {
    this.#guard = new ExternalFilesystemPathGuard(protectedRoots);
  }

  async captureTarget(targetPathInput: unknown): Promise<CapturedExternalTarget> {
    const target = this.#guard.captureTargetParent(targetPathInput);
    const parentIdentityHash = hashParentIdentity(target.parentStats);
    return capturedExternalTarget({
      targetPath: target.path,
      targetLeafName: path.basename(target.path),
      parentIdentityHash,
      targetResourceHash: hashExternalTarget(parentIdentityHash, path.basename(target.path))
    });
  }

  async publishExclusive(
    plan: ExternalFilePublicationPlan,
    signal: AbortSignal,
    assertWriterLease: () => void
  ): Promise<ExternalFilePublicationReceipt> {
    let publicationAttempted = false;
    try {
      signal.throwIfAborted();
      const target = this.#guard.captureTargetParent(plan.targetPath);
      assertParentIdentity(plan, target.parentStats);
      assertAbsent(target.path);
      writeStage(plan.stagePath, plan.content);
      signal.throwIfAborted();
      assertWriterLease();
      signal.throwIfAborted();
      this.#guard.assertParentCurrent(target);
      publicationAttempted = true;
      fs.linkSync(plan.stagePath, target.path);
      verifyPlan(plan);
    } catch (caught) {
      if (!publicationAttempted) {
        fs.rmSync(plan.stagePath, { force: true });
        const failure = noEffectReceiptFor(plan, caught, signal.aborted);
        if (failure !== undefined) return failure;
      }
      throw caught;
    }
    return receiptFor(plan, "published");
  }

  async adoptExclusive(
    plan: ExternalFilePublicationIdentity,
    assertWriterLease: () => void
  ): Promise<ExternalFilePublicationReceipt> {
    const target = this.#guard.captureTargetParent(plan.targetPath);
    assertParentIdentity(plan, target.parentStats);
    if (!fs.existsSync(plan.targetPath)) {
      verifyStage(plan);
      assertWriterLease();
      fs.linkSync(plan.stagePath, plan.targetPath);
    }
    verifyPlan(plan);
    return receiptFor(plan, "published");
  }

  async finalize(
    plan: ExternalFilePublicationIdentity,
    assertWriterLease: () => void
  ): Promise<ExternalFilePublicationReceipt> {
    try {
      const target = this.#guard.captureTargetParent(plan.targetPath);
      assertParentIdentity(plan, target.parentStats);
      assertExternalIdentity(lstatExternal(plan.stagePath), lstatExternal(plan.targetPath));
      assertWriterLease();
      fs.unlinkSync(plan.stagePath);
    } catch (caught) {
      const failure = noEffectReceiptFor(plan, caught, false);
      if (failure !== undefined) return failure;
      throw caught;
    }
    return receiptFor(plan, "finalized");
  }
}

function receiptFor(
  plan: ExternalFilePublicationIdentity,
  state: ExternalFilePublicationReceipt["state"]
): ExternalFilePublicationReceipt {
  return Object.freeze({
    state,
    parentIdentityHash: plan.parentIdentityHash,
    targetResourceHash: plan.targetResourceHash,
    contentHash: plan.contentHash,
    byteLength: plan.byteLength
  });
}

function noEffectReceiptFor(
  plan: ExternalFilePublicationIdentity,
  caught: unknown,
  aborted: boolean
): ExternalFilePublicationReceipt | undefined {
  if (aborted || (caught instanceof Error && caught.name === "AbortError")) {
    return Object.freeze({
      ...receiptIdentityFor(plan),
      state: "cancelled",
      errorCode: "external_filesystem.cancelled"
    });
  }
  if (!(caught instanceof PigeDomainError)) return undefined;
  const errorCode = caught.code as ExternalFilePublicationFailureCode;
  if (![
    "external_filesystem.authority_changed",
    "external_filesystem.changed",
    "external_filesystem.target_exists",
    "external_filesystem.writer_lease_lost",
    "external_filesystem.write_failed"
  ].includes(errorCode)) return undefined;
  return Object.freeze({ ...receiptIdentityFor(plan), state: "failed_no_effect", errorCode });
}

function receiptIdentityFor(plan: ExternalFilePublicationIdentity) {
  return {
    parentIdentityHash: plan.parentIdentityHash,
    targetResourceHash: plan.targetResourceHash,
    contentHash: plan.contentHash,
    byteLength: plan.byteLength
  } as const;
}

function assertParentIdentity(plan: ExternalFilePublicationIdentity, stats: fs.BigIntStats): void {
  if (hashParentIdentity(stats) !== plan.parentIdentityHash) {
    throw externalFilesystemError("external_filesystem.changed");
  }
}

function hashParentIdentity(stats: fs.BigIntStats): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update("pige.external_parent_identity.test.v1", "utf8")
    .update("\0", "utf8")
    .update(`${stats.dev}:${stats.ino}:${stats.mode}`, "utf8")
    .digest("hex")}`;
}

function writeStage(stagePath: string, content: Buffer): void {
  const descriptor = fs.openSync(stagePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function verifyStage(plan: ExternalFilePublicationIdentity): void {
  const stage = lstatExternal(plan.stagePath);
  const bytes = fs.readFileSync(plan.stagePath);
  if (
    !stage.isFile() || stage.isSymbolicLink() || stage.nlink !== 1n ||
    bytes.byteLength !== plan.byteLength || hashContent(bytes) !== plan.contentHash
  ) {
    throw externalFilesystemError("external_filesystem.write_uncertain");
  }
}

function verifyPlan(plan: ExternalFilePublicationIdentity): void {
  const stage = lstatExternal(plan.stagePath);
  const target = lstatExternal(plan.targetPath);
  assertExternalIdentity(stage, target);
  const bytes = fs.readFileSync(plan.stagePath);
  if (stage.nlink < 2n || bytes.byteLength !== plan.byteLength || hashContent(bytes) !== plan.contentHash) {
    throw externalFilesystemError("external_filesystem.write_uncertain");
  }
}

function hashContent(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update("pige.external_content.v1", "utf8")
    .update("\0", "utf8")
    .update(bytes)
    .digest("hex")}`;
}

function assertAbsent(targetPath: string): void {
  try {
    fs.lstatSync(targetPath);
  } catch (caught) {
    if (caught instanceof Error && "code" in caught && caught.code === "ENOENT") return;
    throw caught;
  }
  throw externalFilesystemError("external_filesystem.target_exists");
}
