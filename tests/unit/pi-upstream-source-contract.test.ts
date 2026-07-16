import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

interface SourceEntry {
  readonly package: string;
  readonly map: string;
  readonly source: string;
  readonly sha256: string;
}

interface SourceContract {
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly reviewedSourceDiffSha256: string;
  readonly sources: readonly SourceEntry[];
}

const root = process.cwd();
const contract = JSON.parse(fs.readFileSync(
  path.join(root, "tests/fixtures/pi-v0.80.7-source-contract.json"),
  "utf8"
)) as SourceContract;

describe("reviewed Pi v0.80.7 source contract", () => {
  it("pins the audited 0.80.6 to 0.80.7 source transition", () => {
    expect(contract).toMatchObject({
      fromVersion: "0.80.6",
      toVersion: "0.80.7",
      reviewedSourceDiffSha256: "e8442dda88e28e116b1d6fdd18973c5c7f787929a90f1f6cabb7de56fa6fba77"
    });
  });

  it.each(contract.sources)("matches reviewed upstream source $package/$source", (entry) => {
    const packageRoot = path.join(root, "node_modules", ...entry.package.split("/"));
    const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
      readonly version?: string;
    };
    expect(packageJson.version).toBe("0.80.7");
    const sourceMap = JSON.parse(fs.readFileSync(path.join(packageRoot, entry.map), "utf8")) as {
      readonly sources: readonly string[];
      readonly sourcesContent: readonly (string | null)[];
    };
    const index = sourceMap.sources.indexOf(entry.source);
    expect(index).toBeGreaterThanOrEqual(0);
    const source = sourceMap.sourcesContent[index];
    expect(source).not.toBeNull();
    expect(createHash("sha256").update(source ?? "", "utf8").digest("hex")).toBe(entry.sha256);
  });

  it("retains the exact upstream lifecycle and tool-result capabilities Pige adopts", () => {
    const agent = readSource("@earendil-works/pi-agent-core", "dist/agent.js.map", "../src/agent.ts");
    const loop = readSource("@earendil-works/pi-agent-core", "dist/agent-loop.js.map", "../src/agent-loop.ts");
    const types = readSource("@earendil-works/pi-agent-core", "dist/types.js.map", "../src/types.ts");
    const deferred = readSource("@earendil-works/pi-ai", "dist/utils/deferred-tools.js.map", "../../src/utils/deferred-tools.ts");

    expect(agent).toContain("async continue()");
    expect(agent).toContain("steer(message: AgentMessage)");
    expect(agent).toContain("followUp(message: AgentMessage)");
    expect(agent).toContain("abort()");
    expect(loop).toContain('executionMode === "sequential"');
    expect(loop).toContain("executeToolCallsParallel");
    expect(loop).toContain("addedToolNames: finalized.result.addedToolNames");
    expect(types).toContain("addedToolNames?: string[]");
    expect(types).toContain("onUpdate?: AgentToolUpdateCallback<TDetails>");
    expect(deferred).toContain("export function splitDeferredTools");
  });
});

function readSource(packageName: string, mapPath: string, sourcePath: string): string {
  const sourceMap = JSON.parse(fs.readFileSync(
    path.join(root, "node_modules", ...packageName.split("/"), mapPath),
    "utf8"
  )) as {
    readonly sources: readonly string[];
    readonly sourcesContent: readonly (string | null)[];
  };
  const index = sourceMap.sources.indexOf(sourcePath);
  if (index < 0 || sourceMap.sourcesContent[index] === null) {
    throw new Error(`Missing reviewed source ${packageName}/${sourcePath}`);
  }
  return sourceMap.sourcesContent[index] ?? "";
}
