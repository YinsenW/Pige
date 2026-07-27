import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { PigeDomainError } from "@pige/domain";
import { openPromise, validateFileName } from "yauzl";
import taskExecutionPlanManifest from "../../../../../resources/task-execution-plan.manifest.json";
import type { NormalizedCommandExecutionRequest } from "./command-execution-service";
import type {
  ResolveTaskExecutionPlanInput,
  TaskExecutionInteractionProtocol
} from "./task-execution-plan-service";

const RECIPE_ID = "official.feishu-cli.install-config-auth-status";
const NPM_ORIGIN = "https://registry.npmjs.org";
const SKILLS_ORIGIN = "https://open.feishu.cn";
const GITHUB_ORIGINS = new Set(["https://github.com", "https://objects.githubusercontent.com"]);
const OAUTH_ORIGINS = ["https://accounts.feishu.cn", "https://accounts.larksuite.com"] as const;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 16 * 1024 * 1024;
const MAX_NATIVE_BYTES = 256 * 1024 * 1024;
const MAX_SKILL_FILE_BYTES = 4 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface TaskExecutionRecipeFetchResponse {
  readonly status: number;
  readonly url: string;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type TaskExecutionRecipeFetch = (
  url: string,
  init: { readonly redirect: "manual"; readonly signal?: AbortSignal }
) => Promise<TaskExecutionRecipeFetchResponse>;

export interface TaskExecutionRecipeExecutableIdentity {
  readonly path: string;
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly modifiedAtMs: number;
}

export interface TaskExecutionRecipeFileSystem {
  canonicalDirectory(directory: string): Promise<string>;
  executableIdentity(executable: string): Promise<TaskExecutionRecipeExecutableIdentity>;
  stagePrivateFile(root: string, relativePath: string, body: Uint8Array): Promise<string>;
  stagePrivateExecutable(root: string, relativePath: string, body: Uint8Array): Promise<string>;
  readPrivateFile?(root: string, stagedPath: string): Promise<Uint8Array>;
}

export interface TaskExecutionRecipeToolRoots {
  readonly controlledHomeRoot: string;
  readonly configRoot: string;
  readonly workingDirectory: string;
  readonly artifactRoot: string;
  readonly managedToolRoot: string;
  readonly npmPrefix: string;
  readonly npmCache: string;
  readonly npmrcPath: string;
  readonly targetAgentRoots: Readonly<Record<string, string>>;
  readonly npmExecutable: string;
  readonly nodeExecutable: string;
  readonly archiveExtractorExecutable: string;
  readonly platform: "darwin" | "linux" | "win32";
  readonly arch: "x64" | "arm64" | "riscv64";
}

export interface ResolveOfficialTaskExecutionRecipeRequest {
  readonly vaultId: string;
  readonly jobId: string;
  readonly clientTurnId: string;
  readonly policyHash: string;
  readonly toolCatalogHash: string;
  readonly actorId: string;
  readonly actorVersion: string;
  readonly actorDigest: string;
  readonly roots: TaskExecutionRecipeToolRoots;
  readonly signal?: AbortSignal;
}

export interface ResolvedTaskExecutionRecipeProcess {
  readonly ordinal: number;
  readonly actionId: string;
  readonly command: NormalizedCommandExecutionRequest;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly interaction?: {
    readonly kind: "browser_oauth";
    readonly allowedOrigins: readonly string[];
  };
}

export interface ResolvedTaskExecutionRecipe {
  readonly planInput: ResolveTaskExecutionPlanInput;
  readonly processes: readonly ResolvedTaskExecutionRecipeProcess[];
  readonly artifacts: {
    readonly cli: ResolvedNpmArtifact;
    readonly skills: ResolvedNpmArtifact;
    readonly native: ResolvedNativeArtifact;
    readonly skillIndexDigest: `sha256:${string}`;
    readonly skillFiles: readonly ResolvedSkillFile[];
  };
}

export interface ResolvedNpmArtifact {
  readonly name: string;
  readonly version: string;
  readonly tarballUrl: string;
  readonly sri: string;
  readonly sha256: `sha256:${string}`;
  readonly stagedPath: string;
}

export interface ResolvedNativeArtifact {
  readonly url: string;
  readonly redirectOrigins: readonly string[];
  readonly sha256: `sha256:${string}`;
  readonly stagedPath: string;
  readonly executablePath: string;
  readonly executableSha256: `sha256:${string}`;
  readonly executableIdentity: TaskExecutionRecipeExecutableIdentity;
}

export interface ResolvedSkillFile {
  readonly skillId: string;
  readonly relativePath: string;
  readonly sourceUrl: string;
  readonly sha256: `sha256:${string}`;
  readonly stagedPath: string;
}

interface FrozenRecipe {
  readonly recipeVersion: string;
  readonly indexUrl: string;
  readonly indexSha256: string;
  readonly skillIds: readonly string[];
  readonly skillCount: number;
  readonly fileCount: number;
  readonly maxTimeoutMs: number;
}

interface CanonicalRoots extends TaskExecutionRecipeToolRoots {
  readonly controlledHomeRoot: string;
  readonly configRoot: string;
  readonly workingDirectory: string;
  readonly artifactRoot: string;
  readonly managedToolRoot: string;
  readonly npmPrefix: string;
  readonly npmCache: string;
  readonly targetAgentRoots: Readonly<Record<string, string>>;
}

interface FetchedBody {
  readonly body: Uint8Array;
  readonly finalUrl: string;
  readonly redirectOrigins: readonly string[];
}

export class TaskExecutionRecipeService {
  readonly #fetch: TaskExecutionRecipeFetch;
  readonly #fileSystem: TaskExecutionRecipeFileSystem;
  readonly #recipe: FrozenRecipe;

  constructor(options: {
    readonly fetch: TaskExecutionRecipeFetch;
    readonly fileSystem?: TaskExecutionRecipeFileSystem;
    readonly manifest?: unknown;
  }) {
    if (!options || typeof options.fetch !== "function") throw recipeInvalid();
    this.#fetch = options.fetch;
    this.#fileSystem = options.fileSystem ?? createNodeTaskExecutionRecipeFileSystem();
    this.#recipe = parseFrozenRecipe(options.manifest ?? taskExecutionPlanManifest);
  }

  async resolveOfficialFeishuRecipe(
    request: ResolveOfficialTaskExecutionRecipeRequest
  ): Promise<ResolvedTaskExecutionRecipe> {
    request.signal?.throwIfAborted();
    const roots = await canonicalizeRoots(this.#fileSystem, request.roots);
    const nodeIdentity = await this.#fileSystem.executableIdentity(request.roots.nodeExecutable);
    const cli = await this.#resolveNpmArtifact("@larksuite/cli", "cli", roots.artifactRoot, request.signal);
    const skills = await this.#resolveNpmArtifact("skills", "skills", roots.artifactRoot, request.signal);
    const native = await this.#resolveNativeArtifact(cli, roots, request.signal);
    const skillSnapshot = await this.#resolveSkillSnapshot(roots, request.signal);

    const environment = environmentFor(roots, nodeIdentity, native.executableIdentity);
    const environmentProfileHash = hashCanonical("pige.task_execution.environment.v1", environment);
    const processDefinitions = processDefinitionsFor({
      roots,
      cli,
      skills,
      native,
      skillSnapshot,
      nodeIdentity,
      timeoutMs: this.#recipe.maxTimeoutMs
    });
    const processes = Object.freeze(processDefinitions.map(({ ordinal, actionId, command, environment: processEnv, interaction }) =>
      Object.freeze({ ordinal, actionId, command, environment: Object.freeze(processEnv), ...(interaction ? { interaction } : {}) })));
    const planInput: ResolveTaskExecutionPlanInput = Object.freeze({
      vaultId: request.vaultId,
      jobId: request.jobId,
      clientTurnId: request.clientTurnId,
      authoredTaskIntent: "explicit_user_task",
      policyHash: request.policyHash,
      toolCatalogHash: request.toolCatalogHash,
      recipeId: RECIPE_ID,
      actorId: request.actorId,
      actorVersion: request.actorVersion,
      actorDigest: request.actorDigest,
      environment,
      steps: Object.freeze(processDefinitions.map((definition) => Object.freeze({
        ordinal: definition.ordinal,
        adapterId: `pige.feishu.${definition.actionId}`,
        adapterVersion: this.#recipe.recipeVersion,
        adapterDigest: hashCanonical("pige.task_execution.adapter.v1", {
          actionId: definition.actionId,
          command: definition.command,
          interaction: definition.interaction ?? null
        }),
        actionId: definition.actionId,
        normalizedExecutableIdentity: definition.command.executable,
        argv: definition.command.args,
        canonicalWorkingDirectory: definition.command.workingDirectory,
        environmentProfileHash,
        networkOrigins: originsFor(definition.actionId),
        destinations: destinationsFor(definition.actionId, roots),
        interactionProtocol: (definition.interaction?.kind ?? "none") as TaskExecutionInteractionProtocol,
        timeoutMs: definition.command.timeoutMs,
        inputHash: hashCanonical("pige.task_execution.step_input.v1", {
          command: definition.command,
          environment: definition.environment,
          artifacts: artifactBindingsFor(definition.actionId, cli, skills, native, skillSnapshot)
        }),
        postconditionProbeId: `probe.${definition.actionId}`,
        recoveryMode: "probe_then_adopt" as const
      }))),
      resolvedVersion: cli.version,
      integrities: Object.freeze([cli.sha256, native.sha256, skills.sha256, skillSnapshot.indexDigest]),
      destinationRoots: Object.freeze(["Pige managed tools", "Reviewed Agent skill roots", "Private Feishu config"]),
      skillCount: this.#recipe.skillCount,
      targetAgents: Object.freeze(Object.keys(roots.targetAgentRoots).sort())
    });
    return Object.freeze({
      planInput,
      processes,
      artifacts: Object.freeze({
        cli,
        skills,
        native,
        skillIndexDigest: skillSnapshot.indexDigest,
        skillFiles: skillSnapshot.files
      })
    });
  }

  async #resolveNpmArtifact(
    packageName: string,
    fileStem: string,
    artifactRoot: string,
    signal?: AbortSignal
  ): Promise<ResolvedNpmArtifact> {
    const metadataUrl = `${NPM_ORIGIN}/${encodeURIComponent(packageName)}/latest`;
    const metadataBody = await this.#fetchBody(metadataUrl, new Set([NPM_ORIGIN]), MAX_METADATA_BYTES, signal);
    const metadata = parseJsonRecord(metadataBody.body);
    const version = requireSemver(metadata.version);
    if (metadata.name !== packageName) throw recipeInvalid();
    const dist = asRecord(metadata.dist);
    const tarballUrl = requireExactUrl(dist.tarball, NPM_ORIGIN);
    const sri = requireSri(dist.integrity);
    const tarball = await this.#fetchBody(tarballUrl, new Set([NPM_ORIGIN]), MAX_PACKAGE_BYTES, signal);
    verifySri(tarball.body, sri);
    const sha256 = digest(tarball.body);
    const stagedPath = await this.#fileSystem.stagePrivateFile(
      artifactRoot,
      `npm/${fileStem}-${version}-${sha256.slice("sha256:".length, "sha256:".length + 16)}.tgz`,
      tarball.body
    );
    return Object.freeze({ name: packageName, version, tarballUrl, sri, sha256, stagedPath });
  }

  async #resolveNativeArtifact(
    cli: ResolvedNpmArtifact,
    roots: CanonicalRoots,
    signal?: AbortSignal
  ): Promise<ResolvedNativeArtifact> {
    const platform = ({ darwin: "darwin", linux: "linux", win32: "windows" } as const)[roots.platform];
    const arch = ({ x64: "amd64", arm64: "arm64", riscv64: "riscv64" } as const)[roots.arch];
    const extension = roots.platform === "win32" ? ".zip" : ".tar.gz";
    const archiveName = `lark-cli-${cli.version}-${platform}-${arch}${extension}`;
    const checksum = checksumFromNpmTarball(await readStaged(this.#fileSystem, roots.artifactRoot, cli.stagedPath), archiveName);
    const url = `https://github.com/larksuite/cli/releases/download/v${cli.version}/${archiveName}`;
    const fetched = await this.#fetchBody(url, GITHUB_ORIGINS, MAX_NATIVE_BYTES, signal);
    const sha256 = digest(fetched.body);
    if (sha256 !== `sha256:${checksum}`) throw recipeDrift();
    const stagedPath = await this.#fileSystem.stagePrivateFile(
      roots.artifactRoot,
      `native/${archiveName}`,
      fetched.body
    );
    const executableBytes = roots.platform === "win32"
      ? await readNativeZipExecutable(stagedPath)
      : readNativeTarExecutable(fetched.body);
    const executablePath = await this.#fileSystem.stagePrivateExecutable(
      roots.artifactRoot,
      `native/executable/${roots.platform === "win32" ? "lark-cli.exe" : "lark-cli"}`,
      executableBytes
    );
    const executableSha256 = digest(executableBytes);
    const executableIdentity = await this.#fileSystem.executableIdentity(executablePath);
    return Object.freeze({
      url: fetched.finalUrl,
      redirectOrigins: fetched.redirectOrigins,
      sha256,
      stagedPath,
      executablePath,
      executableSha256,
      executableIdentity
    });
  }

  async #resolveSkillSnapshot(roots: CanonicalRoots, signal?: AbortSignal): Promise<{
    readonly indexDigest: `sha256:${string}`;
    readonly files: readonly ResolvedSkillFile[];
    readonly installManifestPath: string;
  }> {
    const fetched = await this.#fetchBody(this.#recipe.indexUrl, new Set([SKILLS_ORIGIN]), MAX_INDEX_BYTES, signal);
    const indexDigest = digest(fetched.body);
    if (indexDigest !== `sha256:${this.#recipe.indexSha256}`) throw recipeDrift();
    const record = parseJsonRecord(fetched.body);
    const entries = asArray(record.skills).map(asRecord);
    const ids = entries.map((entry) => requireSkillId(entry.name));
    if (canonicalJson(ids) !== canonicalJson(this.#recipe.skillIds) || ids.length !== this.#recipe.skillCount) {
      throw recipeDrift();
    }
    const identities: Array<{ readonly skillId: string; readonly relativePath: string }> = [];
    for (const entry of entries) {
      const skillId = requireSkillId(entry.name);
      for (const file of asArray(entry.files)) identities.push({ skillId, relativePath: requireRelativeFile(file) });
    }
    if (identities.length !== this.#recipe.fileCount || new Set(identities.map(({ skillId, relativePath }) => `${skillId}/${relativePath}`)).size !== identities.length) {
      throw recipeDrift();
    }
    const files = await Promise.all(identities.map(async ({ skillId, relativePath }): Promise<ResolvedSkillFile> => {
      const sourceUrl = `${SKILLS_ORIGIN}/.well-known/skills/${encodeURIComponent(skillId)}/${encodePath(relativePath)}`;
      const body = await this.#fetchBody(sourceUrl, new Set([SKILLS_ORIGIN]), MAX_SKILL_FILE_BYTES, signal);
      const sha256 = digest(body.body);
      const stagedPath = await this.#fileSystem.stagePrivateFile(
        roots.artifactRoot,
        `skills/${skillId}/${relativePath}`,
        body.body
      );
      return Object.freeze({ skillId, relativePath, sourceUrl, sha256, stagedPath });
    }));
    const installManifest = Buffer.from(canonicalJson({
      schemaVersion: 1,
      files: files.map(({ skillId, relativePath, sha256, stagedPath }) => ({ skillId, relativePath, sha256, stagedPath })),
      targetAgentRoots: roots.targetAgentRoots,
      copyOrSymlinkMode: "copy",
      overwriteSet: []
    }), "utf8");
    const installManifestPath = await this.#fileSystem.stagePrivateFile(
      roots.artifactRoot,
      `skills/install-${indexDigest.slice("sha256:".length, "sha256:".length + 16)}.json`,
      installManifest
    );
    return Object.freeze({ indexDigest, files: Object.freeze(files), installManifestPath });
  }

  async #fetchBody(
    initialUrl: string,
    allowedOrigins: ReadonlySet<string>,
    maxBytes: number,
    signal?: AbortSignal
  ): Promise<FetchedBody> {
    let current = requireAllowedUrl(initialUrl, allowedOrigins);
    const redirectOrigins: string[] = [];
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      signal?.throwIfAborted();
      let response: TaskExecutionRecipeFetchResponse;
      try {
        response = await this.#fetch(current, { redirect: "manual", ...(signal ? { signal } : {}) });
      } catch {
        throw recipeUnavailable();
      }
      const responseUrl = requireAllowedUrl(response.url || current, allowedOrigins);
      if (responseUrl !== current) throw recipeDrift();
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === 3) throw recipeDrift();
        const location = response.headers.get("location");
        if (!location) throw recipeDrift();
        const next = requireAllowedUrl(new URL(location, current).href, allowedOrigins);
        const origin = new URL(next).origin;
        if (!redirectOrigins.includes(origin)) redirectOrigins.push(origin);
        current = next;
        continue;
      }
      if (response.status !== 200) throw recipeUnavailable();
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw recipeDrift();
      return Object.freeze({ body: bytes, finalUrl: current, redirectOrigins: Object.freeze(redirectOrigins) });
    }
    throw recipeDrift();
  }
}

export function createNodeTaskExecutionRecipeFileSystem(): TaskExecutionRecipeFileSystem {
  const stage = async (root: string, relativePath: string, body: Uint8Array, mode: number): Promise<string> => {
    const canonicalRoot = await fs.realpath(root);
    const target = confinedPath(canonicalRoot, relativePath);
    const parent = path.dirname(target);
    await fs.mkdir(parent, { recursive: true, mode: 0o700 });
    const canonicalParent = await fs.realpath(parent);
    if (!isWithin(canonicalRoot, canonicalParent)) throw recipeInvalid();
    const temporary = path.join(canonicalParent, `.${path.basename(target)}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, body, { flag: "wx", mode });
      await fs.rename(temporary, target);
    } catch (caught) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      if ((caught as NodeJS.ErrnoException).code !== "EEXIST") throw caught;
    }
    const canonicalTarget = await fs.realpath(target);
    const stats = await fs.stat(canonicalTarget);
    if (!isWithin(canonicalRoot, canonicalTarget) || !stats.isFile()) throw recipeInvalid();
    const current = new Uint8Array(await fs.readFile(canonicalTarget));
    if (digest(current) !== digest(body)) throw recipeDrift();
    if (mode & 0o111) await fs.chmod(canonicalTarget, mode);
    return canonicalTarget;
  };
  return Object.freeze({
    canonicalDirectory: async (directory: string) => {
      const canonical = await fs.realpath(directory);
      const stats = await fs.stat(canonical);
      if (!stats.isDirectory()) throw recipeInvalid();
      return canonical;
    },
    executableIdentity: async (executable: string) => {
      const canonical = await fs.realpath(executable);
      const stats = await fs.stat(canonical);
      if (!stats.isFile() || (stats.mode & 0o111) === 0) throw recipeInvalid();
      return Object.freeze({ path: canonical, device: stats.dev, inode: stats.ino, size: stats.size, modifiedAtMs: stats.mtimeMs });
    },
    stagePrivateFile: (root: string, relativePath: string, body: Uint8Array) => stage(root, relativePath, body, 0o600),
    stagePrivateExecutable: (root: string, relativePath: string, body: Uint8Array) => stage(root, relativePath, body, 0o700)
  });
}

async function canonicalizeRoots(
  fileSystem: TaskExecutionRecipeFileSystem,
  roots: TaskExecutionRecipeToolRoots
): Promise<CanonicalRoots> {
  const entries = await Promise.all([
    roots.controlledHomeRoot,
    roots.configRoot,
    roots.workingDirectory,
    roots.artifactRoot,
    roots.managedToolRoot,
    roots.npmPrefix,
    roots.npmCache,
    ...Object.values(roots.targetAgentRoots)
  ].map((value) => fileSystem.canonicalDirectory(value)));
  let offset = 0;
  const next = (): string => entries[offset++]!;
  const targetAgentRoots: Record<string, string> = {};
  const fixed = {
    controlledHomeRoot: next(), configRoot: next(), workingDirectory: next(), artifactRoot: next(),
    managedToolRoot: next(), npmPrefix: next(), npmCache: next()
  };
  for (const key of Object.keys(roots.targetAgentRoots).sort()) targetAgentRoots[key] = next();
  if (Object.keys(targetAgentRoots).length === 0) throw recipeInvalid();
  return Object.freeze({ ...roots, ...fixed, targetAgentRoots: Object.freeze(targetAgentRoots) });
}

function processDefinitionsFor(input: {
  readonly roots: CanonicalRoots;
  readonly cli: ResolvedNpmArtifact;
  readonly skills: ResolvedNpmArtifact;
  readonly native: ResolvedNativeArtifact;
  readonly skillSnapshot: { readonly installManifestPath: string; readonly indexDigest: string };
  readonly nodeIdentity: TaskExecutionRecipeExecutableIdentity;
  readonly timeoutMs: number;
}): readonly ResolvedTaskExecutionRecipeProcess[] {
  const { roots } = input;
  const environment = processEnvironment(roots, input.nodeIdentity, input.native.executableIdentity);
  const command = (
    identity: TaskExecutionRecipeExecutableIdentity,
    args: readonly string[],
    timeoutMs = input.timeoutMs
  ): NormalizedCommandExecutionRequest => Object.freeze({
    executable: identity.path,
    args: Object.freeze([...args]),
    workingDirectory: roots.workingDirectory,
    timeoutMs,
    executableIdentity: Object.freeze({
      pathHash: digest(Buffer.from(identity.path, "utf8")),
      device: identity.device,
      inode: identity.inode,
      size: identity.size,
      modifiedAtMs: identity.modifiedAtMs
    })
  });
  const cliPackageDestination = path.join(roots.managedToolRoot, "packages", `lark-cli-${input.cli.version}.tgz`);
  const cliBinaryDestination = path.join(roots.managedToolRoot, "bin", roots.platform === "win32" ? "lark-cli.exe" : "lark-cli");
  const promote = (source: string, sha256: string, destination: string, mode: string) => [
    "-e", FILE_PROMOTER_SOURCE, "--", roots.managedToolRoot, source, sha256, destination, mode
  ];
  const definitions: Array<ResolvedTaskExecutionRecipeProcess> = [
    definition(1, "install_cli_package", command(input.nodeIdentity, promote(input.cli.stagedPath, input.cli.sha256, cliPackageDestination, "600")), environment),
    definition(2, "install_cli_native_asset", command(input.nodeIdentity, promote(input.native.executablePath, input.native.executableSha256, cliBinaryDestination, "700")), environment),
    definition(3, "install_official_skill", command(input.nodeIdentity, ["-e", SKILL_INSTALLER_SOURCE, "--", input.skillSnapshot.installManifestPath]), environment),
    definition(4, "config_init", command(input.nodeIdentity, ["-e", OAUTH_WRAPPER_SOURCE, "--", "config_init", input.native.executablePath]), environment, configInteraction()),
    definition(5, "auth_login", command(input.nodeIdentity, ["-e", OAUTH_WRAPPER_SOURCE, "--", "auth_login", input.native.executablePath]), environment, oauthInteraction()),
    definition(6, "auth_status", command(input.native.executableIdentity, ["auth", "status", "--json"]), environment)
  ];
  return Object.freeze(definitions);
}

function definition(
  ordinal: number,
  actionId: string,
  command: NormalizedCommandExecutionRequest,
  environment: NodeJS.ProcessEnv,
  interaction?: ResolvedTaskExecutionRecipeProcess["interaction"]
): ResolvedTaskExecutionRecipeProcess {
  return Object.freeze({ ordinal, actionId, command, environment: Object.freeze({ ...environment }), ...(interaction ? { interaction } : {}) });
}

function oauthInteraction(): ResolvedTaskExecutionRecipeProcess["interaction"] {
  return Object.freeze({ kind: "browser_oauth", allowedOrigins: Object.freeze([...OAUTH_ORIGINS]) });
}

function configInteraction(): ResolvedTaskExecutionRecipeProcess["interaction"] {
  return Object.freeze({ kind: "browser_oauth", allowedOrigins: Object.freeze([SKILLS_ORIGIN]) });
}

function environmentFor(
  roots: CanonicalRoots,
  nodeIdentity: TaskExecutionRecipeExecutableIdentity,
  nativeIdentity: TaskExecutionRecipeExecutableIdentity
): ResolveTaskExecutionPlanInput["environment"] {
  const targetRoots = Object.values(roots.targetAgentRoots);
  const executableDirectories = [...new Set([
    path.dirname(nodeIdentity.path),
    path.dirname(nativeIdentity.path)
  ])];
  return Object.freeze({
    controlledHomeRoot: roots.controlledHomeRoot,
    configRoot: roots.configRoot,
    sanitizedPathEntries: Object.freeze(executableDirectories),
    descendantExecutableIdentities: Object.freeze([nodeIdentity.path, nativeIdentity.path]),
    canonicalWorkingDirectory: roots.workingDirectory,
    temporaryDirectoryPolicy: "plan_private_delete_after_adoption",
    localeProfile: "en-US.UTF-8",
    npmRegistry: NPM_ORIGIN,
    npmPrefix: roots.npmPrefix,
    npmCache: roots.npmCache,
    npmConfigProvenance: "pige_generated_exact",
    targetAgentRoots: Object.freeze(targetRoots),
    networkOrigins: Object.freeze([NPM_ORIGIN, SKILLS_ORIGIN, ...GITHUB_ORIGINS, ...OAUTH_ORIGINS]),
    destinations: Object.freeze([roots.managedToolRoot, ...targetRoots, roots.configRoot]),
    secretHandleVersions: Object.freeze({ "feishu.oauth": "1" })
  });
}

function processEnvironment(
  roots: CanonicalRoots,
  nodeIdentity: TaskExecutionRecipeExecutableIdentity,
  nativeIdentity: TaskExecutionRecipeExecutableIdentity
): NodeJS.ProcessEnv {
  const executableDirectories = [...new Set([
    path.dirname(nodeIdentity.path),
    path.dirname(nativeIdentity.path)
  ])];
  return Object.freeze({
    HOME: roots.controlledHomeRoot,
    XDG_CONFIG_HOME: roots.configRoot,
    PATH: executableDirectories.join(path.delimiter),
    TMPDIR: roots.artifactRoot,
    npm_config_registry: NPM_ORIGIN,
    npm_config_prefix: roots.npmPrefix,
    npm_config_cache: roots.npmCache,
    npm_config_userconfig: roots.npmrcPath,
    ELECTRON_RUN_AS_NODE: "1",
    DISABLE_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8"
  });
}

function originsFor(actionId: string): readonly string[] {
  if (actionId === "config_init") return [SKILLS_ORIGIN];
  if (actionId === "auth_login") return OAUTH_ORIGINS;
  if (actionId === "auth_status") return [];
  if (actionId === "install_cli_native_asset") return [...GITHUB_ORIGINS].sort();
  if (actionId === "install_official_skill") return [SKILLS_ORIGIN];
  return [NPM_ORIGIN];
}

function destinationsFor(actionId: string, roots: CanonicalRoots): readonly string[] {
  if (actionId === "install_cli_package" || actionId === "install_cli_native_asset") return [roots.managedToolRoot];
  if (actionId === "install_official_skill") return Object.values(roots.targetAgentRoots);
  if (actionId === "config_init" || actionId === "auth_login") return [roots.configRoot];
  return [];
}

function artifactBindingsFor(
  actionId: string,
  cli: ResolvedNpmArtifact,
  skills: ResolvedNpmArtifact,
  native: ResolvedNativeArtifact,
  skillSnapshot: { readonly indexDigest: string }
): unknown {
  if (actionId === "install_cli_package") return { cli: { version: cli.version, sri: cli.sri, sha256: cli.sha256 } };
  if (actionId === "install_cli_native_asset") return { native: { url: native.url, sha256: native.sha256 } };
  if (actionId === "install_official_skill") return { skills: { version: skills.version, sri: skills.sri, sha256: skills.sha256, indexDigest: skillSnapshot.indexDigest } };
  return null;
}

async function readStaged(fileSystem: TaskExecutionRecipeFileSystem, root: string, stagedPath: string): Promise<Uint8Array> {
  if (fileSystem.readPrivateFile) return await fileSystem.readPrivateFile(root, stagedPath);
  return new Uint8Array(await fs.readFile(stagedPath));
}

function readNativeTarExecutable(archive: Uint8Array): Uint8Array {
  let tar: Uint8Array;
  try { tar = gunzipSync(archive); } catch { throw recipeDrift(); }
  let executable: Uint8Array | undefined;
  let entries = 0;
  for (let offset = 0; offset + 512 <= tar.byteLength;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    entries += 1;
    if (entries > 16 || !validTarHeaderChecksum(header)) throw recipeDrift();
    const name = readTarText(header.subarray(0, 100));
    const size = Number.parseInt(readTarText(header.subarray(124, 136)).trim() || "0", 8);
    const type = String.fromCharCode(header[156] ?? 0);
    if (
      !name || name.includes("\\") || name.startsWith("/") || name.split("/").includes("..") ||
      !Number.isSafeInteger(size) || size < 0 || size > MAX_NATIVE_BYTES || offset + 512 + size > tar.byteLength ||
      !["\0", "0", "5"].includes(type)
    ) throw recipeDrift();
    const body = tar.subarray(offset + 512, offset + 512 + size);
    if (path.posix.basename(name) === "lark-cli") {
      if (type === "5" || executable || size === 0) throw recipeDrift();
      executable = new Uint8Array(body);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!executable) throw recipeDrift();
  return executable;
}

async function readNativeZipExecutable(archivePath: string): Promise<Uint8Array> {
  let zipFile: Awaited<ReturnType<typeof openPromise>>;
  try {
    zipFile = await openPromise(archivePath, {
      autoClose: false,
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true
    });
  } catch { throw recipeDrift(); }
  try {
    if (zipFile.entryCount < 1 || zipFile.entryCount > 16) throw recipeDrift();
    let executable: Uint8Array | undefined;
    for await (const entry of zipFile.eachEntry()) {
      const name = entry.fileName;
      const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
      const fileType = unixMode & 0o170000;
      if (
        validateFileName(name) || name.includes("\\") || name.startsWith("/") ||
        entry.isEncrypted() || !entry.canDecodeFileData() ||
        !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 ||
        entry.uncompressedSize > MAX_NATIVE_BYTES ||
        (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000)
      ) throw recipeDrift();
      if (path.posix.basename(name) !== "lark-cli.exe") continue;
      if (name.endsWith("/") || executable || entry.uncompressedSize === 0) throw recipeDrift();
      const stream = await zipFile.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        total += bytes.byteLength;
        if (total > MAX_NATIVE_BYTES) throw recipeDrift();
        chunks.push(bytes);
      }
      if (total !== entry.uncompressedSize) throw recipeDrift();
      executable = new Uint8Array(Buffer.concat(chunks));
    }
    if (!executable) throw recipeDrift();
    return executable;
  } finally {
    zipFile.close();
  }
}

function validTarHeaderChecksum(header: Uint8Array): boolean {
  const expected = Number.parseInt(readTarText(header.subarray(148, 156)).trim() || "0", 8);
  if (!Number.isSafeInteger(expected)) return false;
  let actual = 0;
  for (let index = 0; index < header.byteLength; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index] ?? 0;
  }
  return actual === expected;
}

function checksumFromNpmTarball(body: Uint8Array, archiveName: string): string {
  let tar: Uint8Array;
  try { tar = gunzipSync(body); } catch { throw recipeDrift(); }
  for (let offset = 0; offset + 512 <= tar.byteLength;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const name = readTarText(header.subarray(0, 100));
    const sizeText = readTarText(header.subarray(124, 136)).trim();
    const size = Number.parseInt(sizeText || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.byteLength) throw recipeDrift();
    const content = tar.subarray(offset + 512, offset + 512 + size);
    if (name === "package/checksums.txt") {
      const expected = Buffer.from(content).toString("utf8").split("\n").map((line) => line.trim()).find((line) => line.endsWith(`  ${archiveName}`));
      const checksum = expected?.slice(0, 64);
      if (!checksum || !SHA256_PATTERN.test(checksum)) throw recipeDrift();
      return checksum;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw recipeDrift();
}

function readTarText(bytes: Uint8Array): string {
  const zero = bytes.indexOf(0);
  return Buffer.from(zero < 0 ? bytes : bytes.subarray(0, zero)).toString("utf8");
}

function parseFrozenRecipe(input: unknown): FrozenRecipe {
  const manifest = asRecord(input);
  if (manifest.schemaVersion !== 1 || manifest.owner !== "TaskExecutionPlanService") throw recipeInvalid();
  const limits = asRecord(manifest.limits);
  const fixture = asRecord(manifest.officialRecipeFixture);
  if (fixture.recipeId !== RECIPE_ID || fixture.movingSelectorsMustResolveBeforeConfirmation !== true) throw recipeInvalid();
  const source = asArray(fixture.sources).map(asRecord).find((candidate) => candidate.kind === "official_well_known_skill_index");
  if (!source) throw recipeInvalid();
  const frozen = asRecord(source.frozenSelection);
  const skillIds = asArray(frozen.skillIds).map(requireSkillId);
  const indexUrl = requireExactUrl(source.identity, SKILLS_ORIGIN);
  const indexSha256 = asString(frozen.indexSha256);
  if (!SHA256_PATTERN.test(indexSha256)) throw recipeInvalid();
  return Object.freeze({
    recipeVersion: requireVersion(fixture.recipeVersion),
    indexUrl,
    indexSha256,
    skillIds: Object.freeze(skillIds),
    skillCount: requireBoundedInteger(frozen.skillCount, 1, 128),
    fileCount: requireBoundedInteger(frozen.fileCount, 1, 4096),
    maxTimeoutMs: requireBoundedInteger(limits.maxStepTimeoutMs, 1, 3_600_000)
  });
}

function parseJsonRecord(body: Uint8Array): Record<string, unknown> {
  try { return asRecord(JSON.parse(Buffer.from(body).toString("utf8"))); } catch { throw recipeDrift(); }
}

function requireExactUrl(value: unknown, origin: string): string {
  const url = asString(value);
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.origin !== origin || parsed.username || parsed.password || parsed.hash) throw recipeInvalid();
  return parsed.href;
}

function requireAllowedUrl(value: string, origins: ReadonlySet<string>): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw recipeDrift(); }
  if (parsed.protocol !== "https:" || !origins.has(parsed.origin) || parsed.username || parsed.password || parsed.hash) throw recipeDrift();
  return parsed.href;
}

function requireSri(value: unknown): string {
  const sri = asString(value);
  if (!/^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/u.test(sri)) throw recipeDrift();
  return sri;
}

function verifySri(body: Uint8Array, sri: string): void {
  const separator = sri.indexOf("-");
  const algorithm = sri.slice(0, separator);
  const expected = sri.slice(separator + 1);
  const actual = createHash(algorithm).update(body).digest("base64");
  if (actual !== expected) throw recipeDrift();
}

function requireVersion(value: unknown): string {
  const version = asString(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(version)) throw recipeDrift();
  return version;
}

function requireSemver(value: unknown): string {
  const version = asString(value);
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/u.test(version)) throw recipeDrift();
  return version;
}

function requireSkillId(value: unknown): string {
  const id = asString(value);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(id)) throw recipeDrift();
  return id;
}

function requireRelativeFile(value: unknown): string {
  const file = asString(value);
  if (file.length === 0 || file.length > 512 || path.posix.isAbsolute(file) || file.includes("\\") || file.split("/").some((part) => !part || part === "." || part === "..")) {
    throw recipeDrift();
  }
  return file;
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function confinedPath(root: string, relativePath: string): string {
  const safe = requireRelativeFile(relativePath);
  const target = path.resolve(root, ...safe.split("/"));
  if (!isWithin(root, target)) throw recipeInvalid();
  return target;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function digest(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hashCanonical(domain: string, value: unknown): `sha256:${string}` {
  return digest(Buffer.from(`${domain}\0${canonicalJson(value)}`, "utf8"));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw recipeInvalid();
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw recipeInvalid();
  return value;
}

function asString(value: unknown): string {
  if (typeof value !== "string") throw recipeInvalid();
  return value;
}

function requireBoundedInteger(value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw recipeInvalid();
  return value as number;
}

function recipeInvalid(): PigeDomainError {
  return new PigeDomainError("task_execution.recipe_invalid", "The reviewed task recipe is invalid.");
}

function recipeDrift(): PigeDomainError {
  return new PigeDomainError("task_execution.recipe_drift", "The reviewed task recipe changed before confirmation.");
}

function recipeUnavailable(): PigeDomainError {
  return new PigeDomainError("task_execution.recipe_unavailable", "The reviewed task recipe could not be resolved.");
}

const FILE_PROMOTER_SOURCE = [
  "const fs=require('node:fs'),p=require('node:path'),c=require('node:crypto');",
  "const [rootArg,source,expected,destination,modeText]=process.argv.slice(1);",
  "const root=fs.realpathSync(rootArg),rel=p.relative(root,destination);",
  "if(!rel||rel.startsWith('..')||p.isAbsolute(rel))throw new Error('destination outside reviewed root');",
  "const fd=fs.openSync(source,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);",
  "let body;try{const st=fs.fstatSync(fd);if(!st.isFile())throw new Error('source invalid');body=fs.readFileSync(fd);}finally{fs.closeSync(fd);}",
  "const hash='sha256:'+c.createHash('sha256').update(body).digest('hex');if(hash!==expected)throw new Error('source drift');",
  "fs.mkdirSync(p.dirname(destination),{recursive:true,mode:0o700});const parent=fs.realpathSync(p.dirname(destination));",
  "const parentRel=p.relative(root,parent);if(parentRel.startsWith('..')||p.isAbsolute(parentRel))throw new Error('destination parent drift');",
  "const target=p.join(parent,p.basename(destination)),mode=Number.parseInt(modeText,8);",
  "if(fs.existsSync(target)){const st=fs.lstatSync(target);if(!st.isFile()||st.isSymbolicLink())throw new Error('destination conflict');const current=fs.readFileSync(target);const currentHash='sha256:'+c.createHash('sha256').update(current).digest('hex');if(currentHash!==expected)throw new Error('destination conflict');fs.chmodSync(target,mode);process.exit(0);}",
  "const temp=p.join(parent,'.'+p.basename(target)+'.'+process.pid+'.tmp');let out;try{out=fs.openSync(temp,'wx',mode);fs.writeFileSync(out,body);fs.fsyncSync(out);fs.closeSync(out);out=undefined;fs.renameSync(temp,target);fs.chmodSync(target,mode);const dir=fs.openSync(parent,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}finally{if(out!==undefined)fs.closeSync(out);try{fs.unlinkSync(temp);}catch{}}"
].join("");

const SKILL_INSTALLER_SOURCE = [
  "const fs=require('node:fs'),p=require('node:path'),c=require('node:crypto');",
  "const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const roots=Object.values(m.targetAgentRoots).map(r=>fs.realpathSync(r));",
  "const seen=new Set();for(const f of m.files){if(!/^[a-z0-9][a-z0-9-]*$/.test(f.skillId)||f.relativePath.split('/').some(x=>!x||x==='.'||x==='..'))throw new Error('skill identity invalid');const b=fs.readFileSync(f.stagedPath);const h='sha256:'+c.createHash('sha256').update(b).digest('hex');if(h!==f.sha256)throw new Error('skill snapshot drift');for(const r of roots){const d=p.resolve(r,'skills',f.skillId,...f.relativePath.split('/')),rel=p.relative(r,d);if(rel.startsWith('..')||p.isAbsolute(rel)||seen.has(d))throw new Error('skill destination invalid');seen.add(d);if(fs.existsSync(d)){const st=fs.lstatSync(d);if(!st.isFile()||st.isSymbolicLink())throw new Error('skill destination conflict');const old='sha256:'+c.createHash('sha256').update(fs.readFileSync(d)).digest('hex');if(old!==f.sha256)throw new Error('skill destination conflict');}}}",
  "for(const f of m.files){const b=fs.readFileSync(f.stagedPath);for(const r of roots){const requested=p.resolve(r,'skills',f.skillId,...f.relativePath.split('/'));fs.mkdirSync(p.dirname(requested),{recursive:true,mode:0o700});const parent=fs.realpathSync(p.dirname(requested)),rel=p.relative(r,parent);if(rel.startsWith('..')||p.isAbsolute(rel))throw new Error('skill parent drift');const d=p.join(parent,p.basename(requested));if(fs.existsSync(d))continue;const t=p.join(parent,'.'+p.basename(d)+'.'+process.pid+'.tmp');let fd;try{fd=fs.openSync(t,'wx',0o600);fs.writeFileSync(fd,b);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(t,d);}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(t);}catch{}}}}"
].join("");

const OAUTH_WRAPPER_SOURCE = [
  "const{spawn}=require('node:child_process');const [mode,bin]=process.argv.slice(1);",
  "const emit=(url,deviceCode)=>process.stdout.write(JSON.stringify({type:'browser_oauth',url,...(deviceCode?{deviceCode}:{})})+'\\n');",
  "const run=(args,onData)=>new Promise((resolve,reject)=>{const child=spawn(bin,args,{stdio:['ignore','pipe','pipe'],env:process.env});let out='',err='';const add=(key,chunk)=>{const text=chunk.toString('utf8');if(key==='out')out+=text;else err+=text;if(out.length+err.length>131072){child.kill();reject(new Error('oauth output too large'));return;}onData?.(text);};child.stdout.on('data',c=>add('out',c));child.stderr.on('data',c=>add('err',c));child.on('error',reject);child.on('close',code=>code===0?resolve({out,err}):reject(new Error('oauth command failed')));process.once('SIGTERM',()=>child.kill('SIGTERM'));});",
  "const find=(value,keys)=>{if(!value||typeof value!=='object')return undefined;for(const key of keys){if(typeof value[key]==='string')return value[key];}for(const child of Object.values(value)){const found=find(child,keys);if(found)return found;}return undefined;};",
  "(async()=>{if(mode==='config_init'){let pending='',sent=false;await run(['config','init','--new'],chunk=>{pending=(pending+chunk).slice(-65536);const match=pending.match(/https:\\/\\/open\\.feishu\\.cn\\/page\\/cli\\?[^\\s]+/u);if(match&&!sent){sent=true;emit(match[0]);}});if(!sent)throw new Error('config interaction missing');process.stdout.write('configuration completed\\n');return;}",
  "if(mode==='auth_login'){const first=await run(['auth','login','--recommend','--no-wait','--json']);let payload;try{payload=JSON.parse(first.out);}catch{throw new Error('login protocol invalid');}const url=find(payload,['verification_uri_complete','verification_url','verificationUriComplete','url']);const code=find(payload,['device_code','deviceCode']);if(!url||!code||!/^https:\\/\\/(accounts\\.feishu\\.cn|accounts\\.larksuite\\.com)\\//u.test(url))throw new Error('login interaction invalid');emit(url,code);await run(['auth','login','--device-code',code,'--json']);process.stdout.write('authorization completed\\n');return;}throw new Error('oauth mode invalid');})().catch(()=>process.exit(1));"
].join("");
