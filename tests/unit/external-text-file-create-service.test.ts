import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("publishes one new UTF-8 file without persisting its path in the vault Operation", () => {
    const fixture = createFixture();
    const targetPath = path.join(fixture.externalRoot, "created.txt");

    const result = fixture.service.create(
      targetPath,
      "Pige external text: 中文",
      fixture.authority,
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
      permissionDecisionIds: [fixture.authority.permissionDecisionId],
      after: { kind: "external_resource", checksum: result.contentHash }
    });

    expect(fixture.service.create(
      targetPath,
      "Pige external text: 中文",
      fixture.authority,
      liveSignal()
    )).toEqual(result);

    fixture.service.finalize(result.intentId, fixture.authority);
    expect(fs.readFileSync(targetPath, "utf8")).toBe("Pige external text: 中文");
    expect(fs.existsSync(intent.stagePath)).toBe(false);
    expect(readIntent(fixture.machineRoot).state).toBe("completed");
  });

  it("never overwrites an existing target or follows protected and symlink paths", () => {
    const fixture = createFixture();
    const existing = path.join(fixture.externalRoot, "existing.txt");
    fs.writeFileSync(existing, "keep", "utf8");

    expect(() => fixture.service.create(existing, "replace", fixture.authority, liveSignal())).toThrowError(
      expect.objectContaining({ code: "external_filesystem.target_exists" })
    );
    expect(fs.readFileSync(existing, "utf8")).toBe("keep");
    expect(() => fixture.service.create(
      path.join(fixture.vaultPath, "escape.txt"),
      "blocked",
      fixture.authority,
      liveSignal()
    )).toThrowError(expect.objectContaining({ code: "external_filesystem.protected_path" }));

    const alias = path.join(fixture.externalRoot, "alias");
    fs.symlinkSync(fixture.externalRoot, alias, process.platform === "win32" ? "junction" : "dir");
    expect(() => fixture.service.create(
      path.join(alias, "escape.txt"),
      "blocked",
      fixture.authority,
      liveSignal()
    )).toThrowError(expect.objectContaining({ code: "external_filesystem.symlink_not_allowed" }));
  });

  it("rejects oversized or non-round-tripping text before creating an intent", () => {
    const fixture = createFixture();

    expect(() => fixture.service.create(
      path.join(fixture.externalRoot, "large.txt"),
      "x".repeat(MAX_EXTERNAL_TEXT_CREATE_BYTES + 1),
      fixture.authority,
      liveSignal()
    )).toThrowError(expect.objectContaining({ code: "external_filesystem.invalid_text" }));
    expect(() => fixture.service.create(
      path.join(fixture.externalRoot, "surrogate.txt"),
      "\ud800",
      fixture.authority,
      liveSignal()
    )).toThrowError(expect.objectContaining({ code: "external_filesystem.invalid_text" }));
    expect(intentFiles(fixture.machineRoot)).toEqual([]);
  });

  it("cleans its owned stage when cancellation wins before exclusive publication", () => {
    const fixture = createFixture();
    const controller = new AbortController();
    const authority = { ...fixture.authority, assertWriterLease: () => controller.abort() };
    const targetPath = path.join(fixture.externalRoot, "cancelled.txt");

    expect(() => fixture.service.create(targetPath, "cancel", authority, controller.signal)).toThrowError(
      expect.objectContaining({ code: "external_filesystem.cancelled" })
    );
    expect(fs.existsSync(targetPath)).toBe(false);
    const intent = readIntent(fixture.machineRoot);
    expect(intent.state).toBe("failed_uncertain");
    expect(fs.existsSync(intent.stagePath)).toBe(false);
  });

  it("adopts a published hard-link after an Operation-store crash without writing again", () => {
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

    expect(() => service.create(targetPath, "recover", fixture.authority, liveSignal())).toThrowError(
      expect.objectContaining({ code: "external_filesystem.write_failed" })
    );
    expect(fs.readFileSync(targetPath, "utf8")).toBe("recover");
    const published = readIntent(fixture.machineRoot);
    expect(published.state).toBe("published");
    const beforeIdentity = fs.statSync(targetPath);

    write.mockRestore();
    const adopted = service.adopt(published.id, fixture.authority);
    const afterIdentity = fs.statSync(targetPath);
    expect([afterIdentity.dev, afterIdentity.ino]).toEqual([beforeIdentity.dev, beforeIdentity.ino]);
    expect(adopted.operationId).toBe(published.operationId);
    expect(readIntent(fixture.machineRoot).state).toBe("operation_committed");
  });

  it("fails closed when authority or the staged bytes change during recovery", () => {
    const fixture = createFixture();
    const targetPath = path.join(fixture.externalRoot, "tamper.txt");
    const result = fixture.service.create(targetPath, "original", fixture.authority, liveSignal());
    const intent = readIntent(fixture.machineRoot);

    expect(() => fixture.service.adopt(result.intentId, {
      ...fixture.authority,
      bindingHash: `sha256:${"2".repeat(64)}`
    })).toThrowError(expect.objectContaining({ code: "external_filesystem.authority_changed" }));
    fs.unlinkSync(intent.stagePath);
    fs.writeFileSync(intent.stagePath, "changed", { encoding: "utf8", mode: 0o600 });
    expect(() => fixture.service.adopt(result.intentId, fixture.authority)).toThrowError(
      expect.objectContaining({ code: "external_filesystem.changed" })
    );
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
  const authority: ExternalTextFileCreateAuthority = {
    vaultPath,
    vaultId: "vault_20260718_external01",
    jobId: "job_20260718_external01",
    toolCallId: "call_external_create_01",
    permissionRequestId: "permreq_20260718_external01",
    permissionDecisionId: "permdec_20260718_external01",
    bindingHash: `sha256:${"a".repeat(64)}`,
    policyContextId: "policy_external_create_01",
    policyHash: `sha256:${"b".repeat(64)}`,
    assertWriterLease: vi.fn()
  };
  return {
    vaultPath,
    machineRoot,
    externalRoot,
    authority,
    service: new ExternalTextFileCreateService({
      platform: new TestOnlyNodePublicationPort([vaultPath, machineRoot]),
      machineRootPath: machineRoot
    })
  };
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

  captureTarget(targetPathInput: unknown): string {
    const target = this.#guard.captureTargetParent(targetPathInput);
    return target.path;
  }

  publishExclusive(
    plan: ExternalFilePublicationPlan,
    signal: AbortSignal,
    assertWriterLease: () => void
  ): void {
    signal.throwIfAborted();
    const target = this.#guard.captureTargetParent(plan.targetPath);
    assertAbsent(target.path);
    writeStage(plan.stagePath, plan.content);
    try {
      signal.throwIfAborted();
      assertWriterLease();
      signal.throwIfAborted();
      this.#guard.assertParentCurrent(target);
      fs.linkSync(plan.stagePath, target.path);
      verifyPlan(plan);
    } catch (caught) {
      if (!fs.existsSync(plan.targetPath)) fs.rmSync(plan.stagePath, { force: true });
      throw caught;
    }
  }

  adoptExclusive(plan: ExternalFilePublicationIdentity, assertWriterLease: () => void): void {
    if (!fs.existsSync(plan.targetPath)) {
      verifyStage(plan);
      assertWriterLease();
      fs.linkSync(plan.stagePath, plan.targetPath);
    }
    verifyPlan(plan);
  }

  finalize(plan: ExternalFilePublicationIdentity): void {
    assertExternalIdentity(lstatExternal(plan.stagePath), lstatExternal(plan.targetPath));
    fs.unlinkSync(plan.stagePath);
  }
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
