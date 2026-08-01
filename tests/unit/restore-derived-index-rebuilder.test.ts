import { describe, expect, it, vi } from "vitest";
import { rebuildRestoreDerivedIndexes } from "../../apps/desktop/src/main/services/restore-derived-index-rebuilder";

describe("restore derived index rebuilder", () => {
  it("rebuilds durable SQLite truth before an enabled semantic index", async () => {
    const order: string[] = [];
    const result = { status: "ready", indexGeneration: "index_generation_1" } as never;
    const rebuilt = await rebuildRestoreDerivedIndexes("/safe/restored-vault", {
      rebuildInWorker: vi.fn(async () => { order.push("database"); return result; }),
      initialize: vi.fn(() => { order.push("initialize"); })
    }, {
      rebuild: vi.fn(async () => { order.push("semantic"); return "ready" as const; })
    });
    expect(rebuilt).toBe(result);
    expect(order).toEqual(["database", "initialize", "semantic"]);
  });

  it("accepts a disabled optional semantic asset and keeps enabled failures retryable", async () => {
    const database = {
      rebuildInWorker: vi.fn(async () => ({ status: "ready" }) as never),
      initialize: vi.fn()
    };
    await expect(rebuildRestoreDerivedIndexes("/safe/restored-vault", database, {
      rebuild: async () => "skipped"
    })).resolves.toMatchObject({ status: "ready" });
    await expect(rebuildRestoreDerivedIndexes("/safe/restored-vault", database, {
      rebuild: async () => "unavailable"
    })).rejects.toMatchObject({ code: "restore.index_rebuild_failed" });
  });
});
