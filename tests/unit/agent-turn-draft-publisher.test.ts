import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTurnDraftEvent } from "@pige/contracts";
import { AgentTurnDraftPublisher } from "../../apps/desktop/src/main/services/agent-turn-draft-publisher";

afterEach(() => vi.useRealTimers());

describe("Agent turn draft publisher", () => {
  it("binds one client turn, coalesces replacements, and emits monotonic sequences", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T03:00:00.000Z"));
    const events: AgentTurnDraftEvent[] = [];
    const publisher = new AgentTurnDraftPublisher({
      clientTurnId: "turn_20260713_1234567890ab",
      minIntervalMs: 80,
      send: (event) => events.push(event)
    });

    publisher.publish(snapshot("First safe replacement."));
    publisher.publish(snapshot("Second safe replacement."));
    publisher.publish(snapshot("Latest safe replacement."));

    expect(events).toEqual([
      expect.objectContaining({ sequence: 1, text: "First safe replacement." })
    ]);
    vi.advanceTimersByTime(80);
    expect(events).toEqual([
      expect.objectContaining({ sequence: 1, text: "First safe replacement." }),
      expect.objectContaining({ sequence: 2, text: "Latest safe replacement." })
    ]);
    expect(events.every((event) => event.apiVersion === 1 && event.kind === "draft_replace")).toBe(true);
  });

  it("ignores wrong-turn, duplicate, invalid, and post-close snapshots", () => {
    const events: AgentTurnDraftEvent[] = [];
    const publisher = new AgentTurnDraftPublisher({
      clientTurnId: "turn_20260713_1234567890ab",
      send: (event) => events.push(event)
    });

    publisher.publish({ ...snapshot("Wrong turn."), clientTurnId: "turn_20260713_wrongturn000" });
    publisher.publish(snapshot("Stable safe text."));
    publisher.publish(snapshot("Stable safe text."));
    publisher.publish({ ...snapshot("Wrong Job binding."), jobId: "job_20260713_otherfixture" });
    publisher.publish(snapshot("Unsafe\u0000control."));
    publisher.close();
    publisher.publish(snapshot("Must not be delivered."));

    expect(events).toEqual([
      expect.objectContaining({ sequence: 1, text: "Stable safe text." })
    ]);
  });

  it("cancels a queued replacement when Pi repairs back to the last visible snapshot", () => {
    vi.useFakeTimers();
    const events: AgentTurnDraftEvent[] = [];
    const publisher = new AgentTurnDraftPublisher({
      clientTurnId: "turn_20260713_1234567890ab",
      minIntervalMs: 80,
      send: (event) => events.push(event)
    });

    publisher.publish(snapshot("Stable visible snapshot."));
    publisher.publish(snapshot("Temporary longer replacement."));
    publisher.publish(snapshot("Stable visible snapshot."));
    vi.advanceTimersByTime(80);

    expect(events).toEqual([
      expect.objectContaining({ sequence: 1, text: "Stable visible snapshot." })
    ]);
  });
});

function snapshot(text: string) {
  return {
    requestId: "job_20260713_streamfixture",
    clientTurnId: "turn_20260713_1234567890ab",
    jobId: "job_20260713_streamfixture",
    conversationId: "conv_20260713_streamfixture",
    conversationEventId: "event_20260713_streamfixture",
    text
  };
}
