import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillRegistryFileSchema } from "@pige/schemas";
import { ExternalWebSkillRuntimeService } from "../../apps/desktop/src/main/services/external-web-skill-runtime-service";
import { HighRiskConfirmationService } from "../../apps/desktop/src/main/services/high-risk-confirmation-service";
import { PermissionBrokerService } from "../../apps/desktop/src/main/services/permission-broker-service";
import { PermissionedExternalCapabilityRegistry } from "../../apps/desktop/src/main/services/permissioned-external-capability-service";
import { SkillRegistryService, parseSkillManifest } from "../../apps/desktop/src/main/services/skill-registry-service";
import { SourceFetchService } from "../../apps/desktop/src/main/services/source-fetch-service";

const roots: string[] = [];
const VAULT_ID = "vault_20260729_externalweb";
const JOB_ID = "job_20260729_externalweb";
const CLIENT_TURN_ID = "turn_20260729_externalwebabcdef";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ExternalWebSkillRuntimeService", () => {
  it("registers one explicit exact Skill and reads only after canonical per-call confirmation", async () => {
    const fixture = createFixture();
    seedRuntime(fixture.machineRoot, "reviewed-web", true);
    const service = runtime(fixture);

    expect(service.toolsForTurn(turn(fixture.vaultPath, "neutral_attachment", undefined))).toEqual([]);
    const tools = service.toolsForTurn(turn(fixture.vaultPath, "explicit_user_task", "Use the enabled web Skill."));
    expect(tools.map((tool) => tool.name)).toEqual(["pige_external_web_read"]);
    const execution = tools[0]!.execute(
      { url: "https://api.example.com/article" },
      new AbortController().signal,
      { toolCallId: "tool_call_external_web_1", signal: new AbortController().signal }
    );

    await vi.waitFor(() => expect(fixture.confirmations.pending()).toMatchObject({
      status: "pending",
      confirmation: {
        effect: "external_web_skill_https_read",
        presentation: {
          action: "read_external_web",
          target: "reviewed_https_origin",
          subject: {
            kind: "external_web_skill",
            value: "Reviewed Web",
            origin: "https://api.example.com"
          }
        }
      }
    }));
    expect(fixture.fetchImpl).not.toHaveBeenCalled();
    const pending = fixture.confirmations.pending();
    if (pending.status !== "pending") throw new Error("Expected confirmation.");
    await fixture.confirmations.resolve({
      apiVersion: 1,
      confirmationId: pending.confirmation.confirmationId,
      expectedRevision: pending.revision,
      decision: "allow"
    });

    await expect(execution).resolves.toMatchObject({
      content: [{ type: "text", text: "reviewed response" }],
      details: { status: "ready", origin: "https://api.example.com" }
    });
    expect(fixture.fetchImpl).toHaveBeenCalledOnce();
  });

  it("fails closed for ambiguity and for registry drift after confirmation", async () => {
    const fixture = createFixture();
    seedRuntime(fixture.machineRoot, "reviewed-web", true);
    const registry = new SkillRegistryService(fixture.machineRoot);
    const service = runtime(fixture, registry);
    const explicit = turn(fixture.vaultPath, "explicit_user_task", "Read the reviewed origin.");
    const tool = service.toolsForTurn(explicit)[0]!;
    const execution = tool.execute(
      { url: "https://api.example.com/article" },
      new AbortController().signal,
      { toolCallId: "tool_call_external_web_drift", signal: new AbortController().signal }
    );
    await vi.waitFor(() => expect(fixture.confirmations.pending()).toMatchObject({ status: "pending" }));
    expect(registry.disable({
      apiVersion: 1,
      activeVaultId: VAULT_ID,
      skillId: "reviewed-web",
      expectedRevision: 3
    })).toMatchObject({ status: "committed" });
    const pending = fixture.confirmations.pending();
    if (pending.status !== "pending") throw new Error("Expected confirmation.");
    await fixture.confirmations.resolve({
      apiVersion: 1,
      confirmationId: pending.confirmation.confirmationId,
      expectedRevision: pending.revision,
      decision: "allow"
    });
    await expect(execution).rejects.toMatchObject({ code: "permission.binding_changed" });
    expect(fixture.fetchImpl).not.toHaveBeenCalled();

    seedRuntime(fixture.machineRoot, "second-web", true, 4);
    expect(registry.enable({
      apiVersion: 1,
      requestId: "skill_lifecycle_request_0123456789abcdef",
      activeVaultId: VAULT_ID,
      skillId: "reviewed-web",
      expectedRegistryRevision: 4
    })).toMatchObject({ status: "committed" });
    expect(service.toolsForTurn(explicit)).toEqual([]);
  });
});

function createFixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-external-web-runtime-")));
  roots.push(root);
  const machineRoot = path.join(root, "machine");
  const vaultPath = path.join(root, "vault");
  fs.mkdirSync(machineRoot);
  fs.mkdirSync(vaultPath);
  const confirmations = new HighRiskConfirmationService();
  const broker = new PermissionBrokerService({
    rootPath: machineRoot,
    unsafeAllowUnfenced: true,
    confirmations
  });
  const fetchImpl = vi.fn(async () => new Response("reviewed response", {
    headers: { "content-type": "text/plain" }
  }));
  const fetcher = new SourceFetchService({ lookup: async () => ["93.184.216.34"], fetchImpl });
  return { machineRoot, vaultPath, confirmations, broker, fetcher, fetchImpl };
}

function runtime(
  fixture: ReturnType<typeof createFixture>,
  registry = new SkillRegistryService(fixture.machineRoot)
): ExternalWebSkillRuntimeService {
  return new ExternalWebSkillRuntimeService({
    registry,
    fetcher: fixture.fetcher,
    capabilities: {
      toolsForTurn: (adapter, runtimeTurn) => new PermissionedExternalCapabilityRegistry(
        [adapter],
        fixture.broker
      ).toolsForTurn(runtimeTurn)
    }
  });
}

function turn(
  vaultPath: string,
  authoredTaskIntent: "explicit_user_task" | "neutral_attachment",
  authoredText: string | undefined
) {
  return {
    vaultPath,
    vaultId: VAULT_ID,
    jobId: JOB_ID,
    clientTurnId: CLIENT_TURN_ID,
    authoredTaskIntent,
    authoredText,
    policyContextId: "policy_context_external_web",
    policyHash: digest("policy"),
    runtimeKind: "desktop_local" as const,
    clientCapabilityTier: "desktop_full" as const,
    confirmationOwner: { kind: "agent_turn" as const, clientTurnId: CLIENT_TURN_ID },
    assertCurrent: vi.fn()
  };
}

function seedRuntime(root: string, id: string, enabled: boolean, revision = 3): void {
  const source = [
    "---",
    `id: ${id}`,
    "name: Reviewed Web",
    "version: 1.0.0",
    "description: Read one reviewed public origin.",
    "scope: machine_local",
    "kind: external_web",
    "capabilities:",
    "  - read_current_source",
    "  - external_network",
    "dataBoundary: [local, network]",
    "runtime:",
    "  adapter: pige_readonly_https_v1",
    "  origin: https://api.example.com",
    "---",
    "",
    "## Procedure",
    "",
    "Read only the reviewed origin.",
    ""
  ].join("\n");
  const parsed = parseSkillManifest(source);
  const installed = path.join(root, "skills", "installed", parsed.id);
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, "SKILL.md"), source);
  fs.writeFileSync(path.join(installed, ".pige-install.json"), `${JSON.stringify({
    schemaVersion: 1,
    requestId: `skillreq_${id.replace(/[^a-z0-9]/gu, "")}0123456789abcdef`,
    stagingId: `skillstage_${"a".repeat(32)}`,
    manifestSha256: digest(source),
    bundleSha256: digest(source),
    enabled: false,
    source: "local_markdown",
    warnings: []
  })}\n`);
  const registryPath = path.join(root, "skills", "registry.json");
  const existing = fs.existsSync(registryPath)
    ? SkillRegistryFileSchema.parse(JSON.parse(fs.readFileSync(registryPath, "utf8")))
    : { schemaVersion: 1 as const, revision, skills: [] };
  const registry = SkillRegistryFileSchema.parse({
    schemaVersion: 1,
    revision,
    skills: [...existing.skills, {
      id,
      version: "1.0.0",
      manifestSha256: digest(source),
      enabled,
      trust: "user_confirmed",
      installedAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z"
    }]
  });
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
