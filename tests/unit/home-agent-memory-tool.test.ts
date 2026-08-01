import { describe, expect, it, vi } from "vitest";
import {
  createAuthoredVaultMemoryTool,
  deriveAuthoredMemoryTitle,
  isExactAuthoredQuote
} from "../../apps/desktop/src/main/services/home-agent-memory-tool";

describe("Home authored vault Memory tool", () => {
  it("saves only one exact current-user quote with a Host-derived title", async () => {
    const remember = vi.fn(() => ({ id: "memory_20260801_abcdefghijkl" }));
    const authorize = vi.fn();
    const tool = createAuthoredVaultMemoryTool({
      authoredText: "For future work, I prefer concise summaries with headings.",
      authorize,
      remember
    });
    const args = { kind: "preference", quote: "I prefer concise summaries with headings." } as const;
    const signal = new AbortController().signal;
    const context = { toolCallId: "tool_call_memory_exact", signal };

    expect(tool.authorize?.(args, context)).toBe(true);
    const result = await tool.execute(args, signal, context);

    expect(remember).toHaveBeenCalledWith({
      kind: "preference",
      title: "I prefer concise summaries with headings.",
      body: "I prefer concise summaries with headings."
    });
    expect(result.details).toEqual({
      status: "remembered",
      memoryId: "memory_20260801_abcdefghijkl",
      kind: "preference"
    });
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it("rejects invented text and a second different memory before effect", async () => {
    const remember = vi.fn(() => ({ id: "memory_20260801_abcdefghijkl" }));
    const tool = createAuthoredVaultMemoryTool({
      authoredText: "I prefer short answers. I corrected the date to Friday.",
      authorize: () => undefined,
      remember
    });
    const signal = new AbortController().signal;
    const first = { kind: "preference", quote: "I prefer short answers." } as const;
    const firstContext = { toolCallId: "tool_call_memory_first", signal };
    await tool.authorize?.(first, firstContext);
    await tool.execute(first, signal, firstContext);

    expect(() => tool.authorize?.({
      kind: "correction",
      quote: "I corrected the date to Friday."
    }, { toolCallId: "tool_call_memory_second", signal })).toThrowError(expect.objectContaining({
      code: "agent_runtime.tool_call_invalid"
    }));
    expect(() => tool.authorize?.({
      kind: "preference",
      quote: "I prefer invented model text."
    }, { toolCallId: "tool_call_memory_invented", signal })).toThrowError(expect.objectContaining({
      code: "agent_runtime.tool_input_invalid"
    }));
    expect(remember).toHaveBeenCalledTimes(1);
  });

  it("keeps quote identity exact and derives a bounded Unicode title", () => {
    expect(isExactAuthoredQuote("Keep  two spaces.", "Keep  two spaces.")).toBe(true);
    expect(isExactAuthoredQuote("Keep  two spaces.", "Keep two spaces.")).toBe(false);
    const title = deriveAuthoredMemoryTitle("偏好  简洁\n回答。".repeat(20));
    expect(Array.from(title).length).toBeLessThanOrEqual(120);
    expect(title.endsWith("…")).toBe(true);
  });
});
