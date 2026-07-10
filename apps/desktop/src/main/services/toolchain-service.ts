import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { ToolchainHealth, ToolchainToolStatus } from "@pige/contracts";
import { ToolchainManifestSchema } from "@pige/schemas";

export class ToolchainService {
  readonly #manifestPath: string;
  readonly #resolveModule: (moduleId: string) => string;

  constructor(
    manifestPath = path.resolve(process.cwd(), "resources/toolchain-manifest/toolchain.manifest.json"),
    resolveModule: (moduleId: string) => string = (moduleId) => createRequire(import.meta.url).resolve(moduleId)
  ) {
    this.#manifestPath = manifestPath;
    this.#resolveModule = resolveModule;
  }

  health(): ToolchainHealth {
    const manifest = ToolchainManifestSchema.parse(JSON.parse(fs.readFileSync(this.#manifestPath, "utf8")));
    const tools: ToolchainToolStatus[] = manifest.tools.map((tool) => {
      const resolvedPath = tool.bundledPath ? path.resolve(path.dirname(this.#manifestPath), tool.bundledPath) : undefined;
      const ready = resolvedPath
        ? fs.existsSync(resolvedPath)
        : tool.bundledModule
          ? canResolveModule(tool.bundledModule, this.#resolveModule)
          : false;
      return {
        id: tool.id,
        name: tool.name,
        required: tool.required,
        status: ready ? "ready" : "missing",
        ...(resolvedPath ? { resolvedPath } : {}),
        ...(tool.repairHint ? { repairHint: tool.repairHint } : {})
      };
    });

    const missingRequired = tools.some((tool) => tool.required && tool.status === "missing");
    return {
      status: missingRequired ? "needs_repair" : "ready",
      checkedAt: new Date().toISOString(),
      tools
    };
  }
}

function canResolveModule(moduleId: string, resolveModule: (moduleId: string) => string): boolean {
  try {
    return Boolean(resolveModule(moduleId));
  } catch {
    return false;
  }
}
