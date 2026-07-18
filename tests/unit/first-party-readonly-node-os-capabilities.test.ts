import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PermissionedExternalCapabilityAdapter } from "../../apps/desktop/src/main/services/permissioned-external-capability-service";
import {
  createFirstPartyReadonlyNodeOsCapabilityAdapters
} from "../../apps/desktop/src/main/services/readonly-node-os/first-party-readonly-node-os-capability-adapters";
import { assertPigeAgentToolDescriptors } from "../../apps/desktop/src/main/services/pi-agent-tool-boundary";
import { SourceFetchService } from "../../apps/desktop/src/main/services/source-fetch-service";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length > 0) fs.rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe("first-party read-only Node/OS capability adapters", () => {
  it("publishes only three complete read-only descriptors", () => {
    const adapters = createFirstPartyReadonlyNodeOsCapabilityAdapters({ sourceFetch: fetchFixture() });

    expect(adapters.map((adapter) => adapter.tool.name)).toEqual([
      "pige_external_filesystem_list",
      "pige_external_filesystem_read_text",
      "pige_external_network_fetch_text"
    ]);
    expect(adapters.every((adapter) => adapter.tool.effect === "read_only")).toBe(true);
    expect(adapters.every((adapter) => adapter.tool.execution === "parallel_read_only")).toBe(true);
    expect(adapters.every((adapter) => adapter.tool.idempotency.mode === "idempotent")).toBe(true);
    expect(adapters.map((adapter) => adapter.permission.capability)).toEqual([
      "external_filesystem",
      "external_filesystem",
      "external_network"
    ]);
    expect(adapters.map((adapter) => adapter.permission.resourceScope)).toEqual([
      "current_folder",
      "current_file",
      "current_url"
    ]);
    expect(adapters.map((adapter) => adapter.permission.dataBoundary)).toEqual([
      "filesystem",
      "filesystem",
      "network"
    ]);
    expect(adapters.every((adapter) => adapter.tool.ownerService === "ReadonlyNodeOsCapabilityService")).toBe(true);
    expect(adapters.some((adapter) => /write|delete|shell/u.test(adapter.tool.name))).toBe(false);

    assertPigeAgentToolDescriptors(adapters.map(asToolDescriptor));
  });

  it("validates exact absolute-path and bounded-limit inputs", () => {
    const [list, read, fetch] = createFirstPartyReadonlyNodeOsCapabilityAdapters({ sourceFetch: fetchFixture() });

    expect(() => list?.normalizeInput({ path: "relative", maxEntries: 2 })).toThrowError(
      expect.objectContaining({ code: "external_filesystem.path_not_absolute" })
    );
    expect(() => list?.normalizeInput({ path: path.parse(process.cwd()).root, maxEntries: 129 })).toThrowError(
      expect.objectContaining({ code: "external_filesystem.invalid_limit" })
    );
    expect(() => read?.normalizeInput({ path: path.parse(process.cwd()).root, unexpected: true })).toThrowError(
      expect.objectContaining({ code: "external_capability.invalid_input" })
    );
    expect(() => fetch?.normalizeInput({ url: "file:///etc/passwd" })).toThrowError(
      expect.objectContaining({ code: "external_network.invalid_input" })
    );
  });

  it("lists bounded external entries without exposing a configured protected root", async () => {
    const root = tempRoot();
    const visible = path.join(root, "visible");
    const protectedRoot = path.join(root, "protected");
    fs.mkdirSync(visible);
    fs.mkdirSync(protectedRoot);
    fs.writeFileSync(path.join(root, "a.txt"), "a", "utf8");
    fs.writeFileSync(path.join(root, "b.txt"), "b", "utf8");
    const list = requireAdapter(createAdapters([protectedRoot]), "pige_external_filesystem_list");

    const result = await execute(list, { path: root, maxEntries: 2 });
    const projection = JSON.parse(textContent(result)) as {
      readonly entries: readonly { readonly name: string; readonly kind: string }[];
      readonly truncated: boolean;
    };

    expect(projection.entries).toHaveLength(2);
    expect(projection.entries.map((entry) => entry.name)).not.toContain("protected");
    expect(projection.truncated).toBe(true);
    expect(result.details).toMatchObject({
      status: "ok",
      entryCount: 2,
      truncated: true,
      identityHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      revisionHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u)
    });
  });

  it("keeps escaped directory projections inside the declared output budget", async () => {
    const root = tempRoot();
    for (let index = 0; index < 128; index += 1) {
      fs.writeFileSync(path.join(root, `${index.toString().padStart(3, "0")}-${"line\n".repeat(30)}.txt`), "x", "utf8");
    }
    const list = requireAdapter(createAdapters(), "pige_external_filesystem_list");

    const result = await execute(list, { path: root, maxEntries: 128 });

    expect(result.details.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(list.tool.limits.maxOutputBytes);
  });

  it("rejects direct protected paths and a parent symlink escape into them", async () => {
    const root = tempRoot();
    const protectedRoot = path.join(root, "protected");
    fs.mkdirSync(protectedRoot);
    fs.writeFileSync(path.join(protectedRoot, "secret.txt"), "secret", "utf8");
    const alias = path.join(root, "alias");
    fs.symlinkSync(protectedRoot, alias, process.platform === "win32" ? "junction" : "dir");
    const adapters = createAdapters([protectedRoot]);
    const list = requireAdapter(adapters, "pige_external_filesystem_list");
    const read = requireAdapter(adapters, "pige_external_filesystem_read_text");

    await expect(execute(list, { path: protectedRoot })).rejects.toMatchObject({
      code: "external_filesystem.protected_path"
    });
    await expect(execute(list, { path: alias })).rejects.toMatchObject({
      code: "external_filesystem.symlink_not_allowed"
    });
    await expect(execute(read, { path: path.join(alias, "secret.txt") })).rejects.toMatchObject({
      code: "external_filesystem.protected_path"
    });
  });

  it("rejects a final filesystem symlink instead of following it", async () => {
    const root = tempRoot();
    const target = path.join(root, "target.txt");
    const alias = path.join(root, "alias.txt");
    fs.writeFileSync(target, "safe", "utf8");
    if (!tryCreateFileSymlink(target, alias)) return;
    const read = requireAdapter(createAdapters(), "pige_external_filesystem_read_text");

    await expect(execute(read, { path: alias })).rejects.toMatchObject({
      code: "external_filesystem.symlink_not_allowed"
    });
  });

  it("returns bounded UTF-8 text with body-free identity and revision receipts", async () => {
    const root = tempRoot();
    const filePath = path.join(root, "note.txt");
    fs.writeFileSync(filePath, "Pige reads UTF-8: 中文", "utf8");
    const read = requireAdapter(createAdapters(), "pige_external_filesystem_read_text");

    const normalized = read.normalizeInput({ path: filePath });
    const identity = read.resourceIdentity(normalized) as Record<string, unknown>;
    const result = await read.execute(normalized, new AbortController().signal, toolContext());

    expect(textContent(result)).toBe("Pige reads UTF-8: 中文");
    expect(result.details).toMatchObject({
      status: "ok",
      byteLength: Buffer.byteLength("Pige reads UTF-8: 中文", "utf8"),
      identityHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      revisionHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u)
    });
    expect(identity).toEqual({ fileHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u) });
    expect(JSON.stringify(identity)).not.toContain(filePath);
  });

  it("rejects oversized and invalid UTF-8 files without returning partial bytes", async () => {
    const root = tempRoot();
    const tooLarge = path.join(root, "large.txt");
    const invalid = path.join(root, "invalid.txt");
    fs.writeFileSync(tooLarge, "12345", "utf8");
    fs.writeFileSync(invalid, Buffer.from([0xc3, 0x28]));
    const read = requireAdapter(createAdapters(), "pige_external_filesystem_read_text");

    await expect(execute(read, { path: tooLarge, maxBytes: 4 })).rejects.toMatchObject({
      code: "external_filesystem.file_too_large"
    });
    await expect(execute(read, { path: invalid })).rejects.toMatchObject({
      code: "external_filesystem.invalid_utf8"
    });
  });

  it("fails filesystem requests closed when already cancelled", async () => {
    const root = tempRoot();
    const filePath = path.join(root, "note.txt");
    fs.writeFileSync(filePath, "text", "utf8");
    const read = requireAdapter(createAdapters(), "pige_external_filesystem_read_text");
    const controller = new AbortController();
    controller.abort();

    await expect(execute(read, { path: filePath }, controller.signal)).rejects.toMatchObject({
      code: "external_filesystem.cancelled"
    });
  });

  it("delegates network validation to SourceFetchService and blocks SSRF", async () => {
    const fetchImpl = vi.fn(async () => new Response("should not run"));
    const sourceFetch = new SourceFetchService({
      lookup: async () => ["127.0.0.1"],
      fetchImpl
    });
    const fetch = requireAdapter(
      createFirstPartyReadonlyNodeOsCapabilityAdapters({ sourceFetch }),
      "pige_external_network_fetch_text"
    );

    await expect(execute(fetch, { url: "http://internal.example/private" })).rejects.toMatchObject({
      code: "url_fetch.private_network_blocked"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("redacts sensitive URL query values, omits raw content, and bounds projected text", async () => {
    const secret = "never-project-this-token";
    const sourceFetch = {
      fetchSnapshot: vi.fn(async (): Promise<ReturnTypeSnapshot> => ({
        originalUrl: `https://example.com/start?api_key=${secret}&page=1`,
        finalUrl: `https://example.com/final?token=${secret}&page=2`,
        contentType: "text/plain",
        rawContent: `raw-${secret}`,
        extractedText: "中文中文中文",
        warnings: ["redirected"]
      }))
    };
    const fetch = requireAdapter(
      createFirstPartyReadonlyNodeOsCapabilityAdapters({ sourceFetch }),
      "pige_external_network_fetch_text"
    );

    const normalized = fetch.normalizeInput({
      url: `https://example.com/start?api_key=${secret}&page=1`,
      maxBytes: 7
    });
    const identity = fetch.resourceIdentity(normalized);
    const result = await fetch.execute(normalized, new AbortController().signal, toolContext());
    const serialized = JSON.stringify(result);

    expect(textContent(result)).toBe("中文");
    expect(result.details).toMatchObject({ byteLength: 6, truncated: true });
    expect(result.details.originalUrl).toContain("api_key=%5Bredacted%5D");
    expect(result.details.finalUrl).toContain("token=%5Bredacted%5D");
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("raw-");
    expect(JSON.stringify(identity)).not.toContain(secret);
    expect(identity).toEqual({ urlHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u) });
  });

  it("propagates network cancellation through the existing fetch owner", async () => {
    let started!: () => void;
    const responseStarted = new Promise<void>((resolve) => { started = resolve; });
    const sourceFetch = new SourceFetchService({
      lookup: async () => ["93.184.216.34"],
      timeoutMs: 5_000,
      fetchImpl: async () => {
        started();
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
          }
        }), { headers: { "content-type": "text/plain" } });
      }
    });
    const fetch = requireAdapter(
      createFirstPartyReadonlyNodeOsCapabilityAdapters({ sourceFetch }),
      "pige_external_network_fetch_text"
    );
    const controller = new AbortController();
    const pending = execute(fetch, { url: "https://example.com/slow" }, controller.signal);
    await responseStarted;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "url_fetch.cancelled" });
  });
});

type ReturnTypeSnapshot = Awaited<ReturnType<SourceFetchService["fetchSnapshot"]>>;

function createAdapters(protectedRoots: readonly string[] = []): readonly PermissionedExternalCapabilityAdapter[] {
  return createFirstPartyReadonlyNodeOsCapabilityAdapters({ protectedRoots, sourceFetch: fetchFixture() });
}

function fetchFixture(): Pick<SourceFetchService, "fetchSnapshot"> {
  return {
    fetchSnapshot: async (url) => ({
      originalUrl: url,
      finalUrl: url,
      contentType: "text/plain",
      rawContent: "fixture",
      extractedText: "fixture",
      warnings: []
    })
  };
}

function requireAdapter(
  adapters: readonly PermissionedExternalCapabilityAdapter[],
  name: string
): PermissionedExternalCapabilityAdapter {
  const adapter = adapters.find((candidate) => candidate.tool.name === name);
  if (!adapter) throw new Error(`Missing adapter ${name}`);
  return adapter;
}

async function execute(
  adapter: PermissionedExternalCapabilityAdapter,
  args: unknown,
  signal = new AbortController().signal
) {
  const normalized = adapter.normalizeInput(args);
  return adapter.execute(normalized, signal, toolContext(signal));
}

function toolContext(signal = new AbortController().signal) {
  return { toolCallId: "tool_call_readonly_node_os_test", signal };
}

function textContent(result: Awaited<ReturnType<PermissionedExternalCapabilityAdapter["execute"]>>): string {
  const first = result.content[0];
  if (!first || first.type !== "text") throw new Error("Expected text tool result.");
  return first.text;
}

function asToolDescriptor(adapter: PermissionedExternalCapabilityAdapter) {
  return {
    ...adapter.tool,
    version: adapter.action.version,
    capability: adapter.permission.capability,
    execute: adapter.execute
  };
}

function tryCreateFileSymlink(target: string, alias: string): boolean {
  try {
    fs.symlinkSync(target, alias, "file");
    return true;
  } catch (caught) {
    if (process.platform === "win32" && caught instanceof Error && "code" in caught && caught.code === "EPERM") return false;
    throw caught;
  }
}

function tempRoot(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-readonly-node-os-")));
  roots.push(root);
  return root;
}
