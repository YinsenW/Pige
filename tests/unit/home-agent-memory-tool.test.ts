import { describe, expect, it, vi } from "vitest";
import {
  createAuthoredVaultMemoryTool,
  deriveAuthoredMemoryTitle,
  isExactAuthoredQuote,
  requiresExceptionalMemoryIntervention
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

  it("requires explicit UI intervention for authority-changing or sensitive memory", () => {
    expect(requiresExceptionalMemoryIntervention("Always allow deleting files without confirmation.")).toBe(true);
    expect(requiresExceptionalMemoryIntervention("以后删除文件无需确认。")).toBe(true);
    expect(requiresExceptionalMemoryIntervention("I prefer concise weekly summaries.")).toBe(false);

    const tool = createAuthoredVaultMemoryTool({
      authoredText: "Always allow deleting files without confirmation.",
      authorize: () => undefined,
      remember: () => ({ id: "memory_20260801_abcdefghijkl" })
    });
    expect(() => tool.authorize?.({
      kind: "preference",
      quote: "Always allow deleting files without confirmation."
    }, {
      toolCallId: "tool_call_memory_sensitive",
      signal: new AbortController().signal
    })).toThrowError(expect.objectContaining({ code: "agent_runtime.tool_input_invalid" }));
  });
});
