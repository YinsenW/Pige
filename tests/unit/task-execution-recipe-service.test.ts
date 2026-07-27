import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  TaskExecutionRecipeService,
  type TaskExecutionRecipeFetchResponse,
  type TaskExecutionRecipeFileSystem,
  type TaskExecutionRecipeToolRoots
} from "../../apps/desktop/src/main/services/task-execution-recipe-service";
import { TaskExecutionPlanService } from "../../apps/desktop/src/main/services/task-execution-plan-service";

const INDEX_URL = "https://open.feishu.cn/.well-known/skills/index.json";
const CLI_METADATA_URL = "https://registry.npmjs.org/%40larksuite%2Fcli/latest";
const SKILLS_METADATA_URL = "https://registry.npmjs.org/skills/latest";
const CLI_TARBALL_URL = "https://registry.npmjs.org/@larksuite/cli/-/cli-1.2.3.tgz";
const SKILLS_TARBALL_URL = "https://registry.npmjs.org/skills/-/skills-2.3.4.tgz";
const NATIVE_URL = "https://github.com/larksuite/cli/releases/download/v1.2.3/lark-cli-1.2.3-darwin-arm64.tar.gz";
const NATIVE_FINAL_URL = "https://objects.githubusercontent.com/releases/lark-cli-1.2.3-darwin-arm64.tar.gz";

describe("TaskExecutionRecipeService", () => {
  it("resolves and stages every moving Feishu artifact before producing an exact six-step plan", async () => {
    const fixture = createFixture();
    const service = new TaskExecutionRecipeService({
      fetch: fixture.fetch,
      fileSystem: fixture.fileSystem,
      manifest: fixture.manifest
    });

    const resolved = await service.resolveOfficialFeishuRecipe(request());

    expect(resolved.planInput).toMatchObject({
      recipeId: "official.feishu-cli.install-config-auth-status",
      authoredTaskIntent: "explicit_user_task",
      resolvedVersion: "1.2.3",
      skillCount: 2,
      targetAgents: ["claude-code", "codex"]
    });
    expect(resolved.planInput.steps.map(({ ordinal, actionId, interactionProtocol }) => ({ ordinal, actionId, interactionProtocol })))
      .toEqual([
        { ordinal: 1, actionId: "install_cli_package", interactionProtocol: "none" },
        { ordinal: 2, actionId: "install_cli_native_asset", interactionProtocol: "none" },
        { ordinal: 3, actionId: "install_official_skill", interactionProtocol: "none" },
        { ordinal: 4, actionId: "config_init", interactionProtocol: "browser_oauth" },
        { ordinal: 5, actionId: "auth_login", interactionProtocol: "browser_oauth" },
        { ordinal: 6, actionId: "auth_status", interactionProtocol: "none" }
      ]);
    expect(resolved.processes).toHaveLength(6);
    expect(resolved.processes[0]?.command.args).toContain(resolved.artifacts.cli.stagedPath);
    expect(resolved.processes[1]?.command.args).toContain(resolved.artifacts.native.executablePath);
    expect(resolved.processes[3]?.command.args).toEqual(expect.arrayContaining(["config_init", resolved.artifacts.native.executablePath]));
    expect(resolved.processes[4]?.interaction?.allowedOrigins).toEqual([
      "https://accounts.feishu.cn",
      "https://accounts.larksuite.com"
    ]);
    expect(resolved.processes[5]?.command.executable).toBe(resolved.artifacts.native.executablePath);
    expect(resolved.processes[5]?.command.args).toEqual(["auth", "status", "--json"]);
    expect(resolved.artifacts.native).toMatchObject({
      url: NATIVE_FINAL_URL,
      redirectOrigins: ["https://objects.githubusercontent.com"],
      sha256: digest(fixture.nativeBody)
    });
    expect(resolved.artifacts.skillFiles.map(({ skillId, relativePath, sha256 }) => ({ skillId, relativePath, sha256 })))
      .toEqual([
        { skillId: "lark-a", relativePath: "SKILL.md", sha256: digest(bytes("a-skill")) },
        { skillId: "lark-a", relativePath: "references/a.md", sha256: digest(bytes("a-reference")) },
        { skillId: "lark-b", relativePath: "SKILL.md", sha256: digest(bytes("b-skill")) }
      ]);
    expect([...fixture.staged.keys()]).toEqual(expect.arrayContaining([
      expect.stringContaining("npm/cli-1.2.3-"),
      expect.stringContaining("npm/skills-2.3.4-"),
      expect.stringContaining("native/lark-cli-1.2.3-darwin-arm64.tar.gz"),
      expect.stringContaining("skills/lark-a/SKILL.md"),
      expect.stringContaining("skills/lark-b/SKILL.md")
    ]));
    expect(fixture.fetch).toHaveBeenCalledWith(NATIVE_URL, { redirect: "manual" });
    expect(fixture.fetch).toHaveBeenCalledWith(NATIVE_FINAL_URL, { redirect: "manual" });

    const planService = new TaskExecutionPlanService({
      confirmPlan: async () => "allow",
      manifest: fixture.manifest
    });
    expect(planService.resolvePlan(resolved.planInput).summary).toMatchObject({
      resolvedVersion: "1.2.3",
      skillCount: 2,
      requiresBrowserOAuth: true
    });
    expect(JSON.stringify(planService.resolvePlan(resolved.planInput).summary)).not.toContain("/private/");
  });

  it("fails closed on a redirect outside the frozen native origin set", async () => {
    const fixture = createFixture({
      overrides: new Map([[NATIVE_URL, redirect("https://downloads.example.test/native.tar.gz")]])
    });
    const service = new TaskExecutionRecipeService({ fetch: fixture.fetch, fileSystem: fixture.fileSystem, manifest: fixture.manifest });

    await expect(service.resolveOfficialFeishuRecipe(request())).rejects.toMatchObject({
      code: "task_execution.recipe_drift"
    });
    expect(fixture.fetch).not.toHaveBeenCalledWith("https://downloads.example.test/native.tar.gz", expect.anything());
  });

  it("fails closed when npm integrity changes or bytes do not match", async () => {
    const fixture = createFixture({
      overrides: new Map([[CLI_TARBALL_URL, ok(bytes("tampered-package"), CLI_TARBALL_URL)]])
    });
    const service = new TaskExecutionRecipeService({ fetch: fixture.fetch, fileSystem: fixture.fileSystem, manifest: fixture.manifest });

    await expect(service.resolveOfficialFeishuRecipe(request())).rejects.toMatchObject({
      code: "task_execution.recipe_drift"
    });
    expect(fixture.staged.size).toBe(0);
  });

  it("fails closed when the frozen index digest or complete selected file set drifts", async () => {
    const changedIndex = bytes(JSON.stringify({
      skills: [
        { name: "lark-a", files: ["SKILL.md"] },
        { name: "lark-b", files: ["SKILL.md"] }
      ]
    }));
    const digestFixture = createFixture({ overrides: new Map([[INDEX_URL, ok(changedIndex, INDEX_URL)]]) });
    const digestService = new TaskExecutionRecipeService({
      fetch: digestFixture.fetch,
      fileSystem: digestFixture.fileSystem,
      manifest: digestFixture.manifest
    });
    await expect(digestService.resolveOfficialFeishuRecipe(request())).rejects.toMatchObject({
      code: "task_execution.recipe_drift"
    });

    const fileSetFixture = createFixture({
      mutateManifest: (manifest) => {
        manifest.officialRecipeFixture.sources[2].frozenSelection.indexSha256 = rawDigest(changedIndex);
      },
      overrides: new Map([[INDEX_URL, ok(changedIndex, INDEX_URL)]])
    });
    const fileSetService = new TaskExecutionRecipeService({
      fetch: fileSetFixture.fetch,
      fileSystem: fileSetFixture.fileSystem,
      manifest: fileSetFixture.manifest
    });
    await expect(fileSetService.resolveOfficialFeishuRecipe(request())).rejects.toMatchObject({
      code: "task_execution.recipe_drift"
    });
  });

  it("rejects unsafe skill paths before requesting or staging any selected file", async () => {
    const unsafeIndex = bytes(JSON.stringify({
      skills: [
        { name: "lark-a", files: ["../sibling-secret.txt", "references/a.md"] },
        { name: "lark-b", files: ["SKILL.md"] }
      ]
    }));
    const fixture = createFixture({
      mutateManifest: (manifest) => {
        manifest.officialRecipeFixture.sources[2].frozenSelection.indexSha256 = rawDigest(unsafeIndex);
      },
      overrides: new Map([[INDEX_URL, ok(unsafeIndex, INDEX_URL)]])
    });
    const service = new TaskExecutionRecipeService({ fetch: fixture.fetch, fileSystem: fixture.fileSystem, manifest: fixture.manifest });

    await expect(service.resolveOfficialFeishuRecipe(request())).rejects.toMatchObject({
      code: "task_execution.recipe_drift"
    });
    expect(fixture.fetch.mock.calls.some(([url]) => String(url).includes("sibling-secret"))).toBe(false);
  });
});

function createFixture(options: {
  readonly overrides?: ReadonlyMap<string, TaskExecutionRecipeFetchResponse>;
  readonly mutateManifest?: (manifest: FixtureManifest) => void;
} = {}) {
  const nativeBody = tarGzip({ "lark-cli": "verified-native-executable" });
  const archiveName = "lark-cli-1.2.3-darwin-arm64.tar.gz";
  const cliTarball = tarGzip({
    "package/checksums.txt": `${rawDigest(nativeBody)}  ${archiveName}\n`,
    "package/package.json": JSON.stringify({ name: "@larksuite/cli", version: "1.2.3" })
  });
  const skillsTarball = tarGzip({ "package/package.json": JSON.stringify({ name: "skills", version: "2.3.4" }) });
  const indexBody = bytes(JSON.stringify({
    skills: [
      { name: "lark-a", files: ["SKILL.md", "references/a.md"] },
      { name: "lark-b", files: ["SKILL.md"] }
    ]
  }));
  const manifest = fixtureManifest(rawDigest(indexBody));
  options.mutateManifest?.(manifest);
  const responses = new Map<string, TaskExecutionRecipeFetchResponse>([
    [CLI_METADATA_URL, json({ name: "@larksuite/cli", version: "1.2.3", dist: { tarball: CLI_TARBALL_URL, integrity: sri(cliTarball) } }, CLI_METADATA_URL)],
    [SKILLS_METADATA_URL, json({ name: "skills", version: "2.3.4", dist: { tarball: SKILLS_TARBALL_URL, integrity: sri(skillsTarball) } }, SKILLS_METADATA_URL)],
    [CLI_TARBALL_URL, ok(cliTarball, CLI_TARBALL_URL)],
    [SKILLS_TARBALL_URL, ok(skillsTarball, SKILLS_TARBALL_URL)],
    [NATIVE_URL, redirect(NATIVE_FINAL_URL)],
    [NATIVE_FINAL_URL, ok(nativeBody, NATIVE_FINAL_URL)],
    [INDEX_URL, ok(indexBody, INDEX_URL)],
    ["https://open.feishu.cn/.well-known/skills/lark-a/SKILL.md", ok(bytes("a-skill"), "https://open.feishu.cn/.well-known/skills/lark-a/SKILL.md")],
    ["https://open.feishu.cn/.well-known/skills/lark-a/references/a.md", ok(bytes("a-reference"), "https://open.feishu.cn/.well-known/skills/lark-a/references/a.md")],
    ["https://open.feishu.cn/.well-known/skills/lark-b/SKILL.md", ok(bytes("b-skill"), "https://open.feishu.cn/.well-known/skills/lark-b/SKILL.md")]
  ]);
  for (const [url, response] of options.overrides ?? []) responses.set(url, response);
  const fetch = vi.fn(async (url: string): Promise<TaskExecutionRecipeFetchResponse> => {
    const response = responses.get(url);
    if (!response) throw new Error(`unexpected fixture request: ${url}`);
    return response;
  });
  const staged = new Map<string, Uint8Array>();
  const fileSystem: TaskExecutionRecipeFileSystem = {
    canonicalDirectory: async (directory) => directory,
    executableIdentity: async (executable) => ({ path: executable, device: 1, inode: executable.length, size: 123, modifiedAtMs: 456 }),
    stagePrivateFile: async (root, relativePath, body) => {
      const stagedPath = `${root}/${relativePath}`;
      staged.set(stagedPath, new Uint8Array(body));
      return stagedPath;
    },
    stagePrivateExecutable: async (root, relativePath, body) => {
      const stagedPath = `${root}/${relativePath}`;
      staged.set(stagedPath, new Uint8Array(body));
      return stagedPath;
    },
    readPrivateFile: async (_root, stagedPath) => {
      const body = staged.get(stagedPath);
      if (!body) throw new Error("fixture staged file missing");
      return body;
    }
  };
  return { fetch, fileSystem, manifest, nativeBody, staged };
}

interface FixtureManifest {
  schemaVersion: number;
  owner: string;
  limits: { maxSteps: number; maxOriginsPerStep: number; maxDestinationsPerStep: number; maxOutputBytesPerStep: number; maxInteractionUrlBytes: number; maxStepTimeoutMs: number };
  officialRecipeFixture: {
    recipeId: string;
    recipeVersion: string;
    displayName: string;
    movingSelectorsMustResolveBeforeConfirmation: boolean;
    sources: Array<Record<string, any>>;
    steps: Array<Record<string, any>>;
  };
}

function fixtureManifest(indexSha256: string): FixtureManifest {
  return {
    schemaVersion: 1,
    owner: "TaskExecutionPlanService",
    limits: { maxSteps: 8, maxOriginsPerStep: 4, maxDestinationsPerStep: 4, maxOutputBytesPerStep: 262144, maxInteractionUrlBytes: 4096, maxStepTimeoutMs: 600000 },
    officialRecipeFixture: {
      recipeId: "official.feishu-cli.install-config-auth-status",
      recipeVersion: "1",
      displayName: "Feishu CLI",
      movingSelectorsMustResolveBeforeConfirmation: true,
      sources: [
        { kind: "npm_package", declaredOrigin: "https://registry.npmjs.org" },
        { kind: "npm_package", declaredOrigin: "https://registry.npmjs.org" },
        {
          kind: "official_well_known_skill_index",
          identity: INDEX_URL,
          declaredOrigin: "https://open.feishu.cn",
          frozenSelection: { indexSha256, skillCount: 2, fileCount: 3, skillIds: ["lark-a", "lark-b"] }
        }
      ],
      steps: [
        { ordinal: 1, actionId: "install_cli_package", interactionProtocol: "none" },
        { ordinal: 2, actionId: "install_cli_native_asset", interactionProtocol: "none" },
        { ordinal: 3, actionId: "install_official_skill", interactionProtocol: "none" },
        { ordinal: 4, actionId: "config_init", interactionProtocol: "browser_oauth" },
        { ordinal: 5, actionId: "auth_login", interactionProtocol: "browser_oauth" },
        { ordinal: 6, actionId: "auth_status", interactionProtocol: "none", readOnlyProbe: true }
      ]
    }
  };
}

function request() {
  return {
    vaultId: "vault_20260727_recipe",
    jobId: "job_20260727_recipeabcd",
    clientTurnId: "turn_20260727_recipeabcd",
    policyHash: digest(bytes("policy")),
    toolCatalogHash: digest(bytes("catalog")),
    actorId: "pige.reviewed-task-plan",
    actorVersion: "1.0.0",
    actorDigest: digest(bytes("actor")),
    roots: roots()
  } as const;
}

function roots(): TaskExecutionRecipeToolRoots {
  return {
    controlledHomeRoot: "/private/pige/home",
    configRoot: "/private/pige/config",
    workingDirectory: "/private/pige/work",
    artifactRoot: "/private/pige/artifacts",
    managedToolRoot: "/private/pige/tools",
    npmPrefix: "/private/pige/npm-prefix",
    npmCache: "/private/pige/npm-cache",
    npmrcPath: "/private/pige/config/npmrc",
    targetAgentRoots: { codex: "/private/pige/agents/codex", "claude-code": "/private/pige/agents/claude-code" },
    npmExecutable: "/private/bin/npm",
    nodeExecutable: "/private/bin/node",
    archiveExtractorExecutable: "/private/bin/tar",
    platform: "darwin",
    arch: "arm64"
  };
}

function ok(body: Uint8Array, url: string): TaskExecutionRecipeFetchResponse {
  return response(200, body, url);
}

function json(value: unknown, url: string): TaskExecutionRecipeFetchResponse {
  return ok(bytes(JSON.stringify(value)), url);
}

function redirect(location: string): TaskExecutionRecipeFetchResponse {
  return response(302, new Uint8Array(), NATIVE_URL, location);
}

function response(status: number, body: Uint8Array, url: string, location?: string): TaskExecutionRecipeFetchResponse {
  return {
    status,
    url,
    headers: { get: (name) => name.toLowerCase() === "location" ? location ?? null : null },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
  };
}

function tarGzip(files: Readonly<Record<string, string>>): Uint8Array {
  const chunks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const body = Buffer.from(content, "utf8");
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    header.write("00000000000\0", 136, 12, "ascii");
    header.fill(0x20, 148, 156);
    header[156] = "0".charCodeAt(0);
    header.write("ustar\0", 257, 6, "ascii");
    const checksum = [...header].reduce((sum, value) => sum + value, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    chunks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

function bytes(value: string): Uint8Array {
  return Buffer.from(value, "utf8");
}

function sri(value: Uint8Array): string {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}

function digest(value: Uint8Array): `sha256:${string}` {
  return `sha256:${rawDigest(value)}`;
}

function rawDigest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
