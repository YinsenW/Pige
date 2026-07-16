import { describe, expect, it } from "vitest";
import type { SpeechSessionEvent } from "@pige/contracts";
import {
  SpeechService,
  type SpeechNativePort,
  type SpeechNativeProbeResult,
  type SpeechPermissionPort
} from "../../apps/desktop/src/main/services/speech-service";

const request = { requestId: `speechreq_${"a".repeat(16)}`, languageTag: "en-US" } as const;

describe("speech service", () => {
  it("projects helper-owned permission without prompting during availability", async () => {
    const native = new FakeNative();
    const permission = new FakePermission();
    native.probeResult = { status: "supported", permission: "not-determined" };
    const service = createService(native, permission);

    await expect(service.availability({ languageTag: "en-US" })).resolves.toMatchObject({
      status: "supported",
      permission: "not-determined"
    });
    await expect(service.start(7, request, () => undefined)).resolves.toMatchObject({
      status: "started",
      metering: "available"
    });
  });

  it("fails closed off macOS and for denied permission", async () => {
    const unsupported = new SpeechService({
      native: new FakeNative(),
      permission: new FakePermission(),
      platform: "win32",
      systemVersion: "26.0"
    });
    await expect(unsupported.availability({ languageTag: "en-US" })).resolves.toEqual({
      status: "unsupported",
      reason: "unsupported_platform",
      canOpenSystemSettings: false
    });

    const permission = new FakePermission();
    const deniedNative = new FakeNative();
    deniedNative.probeResult = { status: "supported", permission: "denied" };
    const denied = createService(deniedNative, permission);
    await expect(denied.start(1, request, () => undefined)).resolves.toMatchObject({
      status: "blocked",
      error: { code: "speech.permission_denied", userAction: "open_settings" }
    });

    const deniedOnDemandNative = new FakeNative();
    deniedOnDemandNative.probeResult = { status: "supported", permission: "not-determined" };
    deniedOnDemandNative.startResult = { status: "blocked", reason: "permission_denied" };
    await expect(createService(deniedOnDemandNative, permission).start(2, request, () => undefined)).resolves.toMatchObject({
      status: "blocked",
      error: { code: "speech.permission_denied", userAction: "open_settings" }
    });
  });

  it("publishes monotonic meter and replacement transcript events and retains the final transcript", async () => {
    const native = new FakeNative();
    const service = createService(native, new FakePermission());
    const events: SpeechSessionEvent[] = [];
    const started = await service.start(3, request, (event) => events.push(event));
    if (started.status !== "started") throw new Error("session did not start");

    native.emitMeter(110, 0.25);
    native.emitMeter(90, 0.9);
    native.emitTranscript("hello");
    native.emitTranscript("hello");
    native.emitMeter(220, 4);
    native.finalTranscript = "hello world";
    const stopped = await service.stop(3, { sessionId: started.sessionId });

    expect(stopped).toMatchObject({
      status: "stopped",
      sequence: 4,
      transcript: "hello world"
    });
    expect(events).toEqual([
      expect.objectContaining({ kind: "meter", sequence: 1, elapsedMs: 110, level: 0.25 }),
      expect.objectContaining({ kind: "transcript_replace", sequence: 2, transcript: "hello", final: false }),
      expect.objectContaining({ kind: "meter", sequence: 3, elapsedMs: 220, level: 1 }),
      expect.objectContaining({ kind: "transcript_replace", sequence: 4, transcript: "hello world", final: true })
    ]);
  });

  it("enforces one owner and closes sessions on cancel or renderer destruction", async () => {
    const native = new FakeNative();
    const service = createService(native, new FakePermission());
    const started = await service.start(11, request, () => undefined);
    if (started.status !== "started") throw new Error("session did not start");

    await expect(service.start(12, { ...request, requestId: `speechreq_${"b".repeat(16)}` }, () => undefined))
      .resolves.toMatchObject({ status: "blocked", error: { code: "speech.session_busy" } });
    await expect(service.stop(12, { sessionId: started.sessionId })).resolves.toEqual({
      status: "stale_session",
      sessionId: started.sessionId
    });
    await service.cancelOwner(11);
    expect(native.cancelCount).toBe(1);
    await expect(service.cancel(11, { sessionId: started.sessionId })).resolves.toEqual({
      status: "stale_session",
      sessionId: started.sessionId
    });
  });

  it("serializes concurrent starts before permission and native ownership are established", async () => {
    const native = new FakeNative();
    let releaseProbe: (() => void) | undefined;
    native.probeDelay = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const service = createService(native, new FakePermission());
    const first = service.start(21, request, () => undefined);
    await Promise.resolve();
    await expect(service.start(22, { ...request, requestId: `speechreq_${"c".repeat(16)}` }, () => undefined))
      .resolves.toMatchObject({ status: "blocked", error: { code: "speech.session_busy" } });
    releaseProbe?.();
    await expect(first).resolves.toMatchObject({ status: "started" });
  });

  it("cancels an owner-bound pending start before microphone capture can become active", async () => {
    const native = new FakeNative();
    let releaseStart: (() => void) | undefined;
    native.startDelay = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const service = createService(native, new FakePermission());
    const starting = service.start(31, request, () => undefined);
    await native.startEntered;
    await service.cancelOwner(31);
    releaseStart?.();
    await expect(starting).resolves.toMatchObject({
      status: "blocked",
      error: { code: "speech.start_canceled" }
    });
    expect(native.cancelCount).toBeGreaterThanOrEqual(1);
  });

  it("cancels the exact pending request before the renderer receives a session id", async () => {
    const native = new FakeNative();
    let releaseStart: (() => void) | undefined;
    native.startDelay = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const service = createService(native, new FakePermission());
    const starting = service.start(32, request, () => undefined);
    await native.startEntered;
    await expect(service.cancel(32, { requestId: request.requestId })).resolves.toEqual({
      status: "canceled",
      requestId: request.requestId
    });
    releaseStart?.();
    await expect(starting).resolves.toMatchObject({
      status: "blocked",
      error: { code: "speech.start_canceled" }
    });
    expect(native.cancelCount).toBeGreaterThanOrEqual(1);
  });

  it("shares one finalization result across concurrent stop calls", async () => {
    const native = new FakeNative();
    let releaseStop: (() => void) | undefined;
    native.stopDelay = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    const service = createService(native, new FakePermission());
    const started = await service.start(41, request, () => undefined);
    if (started.status !== "started") throw new Error("session did not start");

    const first = service.stop(41, { sessionId: started.sessionId });
    const second = service.stop(41, { sessionId: started.sessionId });
    releaseStop?.();
    const [left, right] = await Promise.all([first, second]);

    expect(left).toEqual(right);
    expect(left).toMatchObject({ status: "stopped", transcript: "final" });
    expect(native.stopCount).toBe(1);
  });
});

class FakeNative implements SpeechNativePort {
  finalTranscript = "final";
  cancelCount = 0;
  probeResult: SpeechNativeProbeResult = { status: "supported", permission: "granted" };
  probeDelay: Promise<void> | undefined;
  startResult: Awaited<ReturnType<SpeechNativePort["start"]>> = { status: "started", metering: "available" };
  startDelay: Promise<void> | undefined;
  stopDelay: Promise<void> | undefined;
  stopCount = 0;
  readonly startEntered: Promise<void>;
  #markStartEntered: (() => void) | undefined;
  #transcript: ((value: string) => void) | undefined;
  #meter: ((elapsedMs: number, level: number) => void) | undefined;

  constructor() {
    this.startEntered = new Promise<void>((resolve) => {
      this.#markStartEntered = resolve;
    });
  }

  async probe(): Promise<SpeechNativeProbeResult> {
    await this.probeDelay;
    return this.probeResult;
  }

  async start(input: Parameters<SpeechNativePort["start"]>[0]): ReturnType<SpeechNativePort["start"]> {
    this.#markStartEntered?.();
    await this.startDelay;
    this.#transcript = input.onTranscript;
    this.#meter = input.onMeter;
    return this.startResult;
  }

  async stop(): Promise<string> {
    this.stopCount += 1;
    await this.stopDelay;
    return this.finalTranscript;
  }

  async cancel(): Promise<void> {
    this.cancelCount += 1;
  }

  emitTranscript(value: string): void {
    this.#transcript?.(value);
  }

  emitMeter(elapsedMs: number, level: number): void {
    this.#meter?.(elapsedMs, level);
  }
}

class FakePermission implements SpeechPermissionPort {
  canOpenSystemSettings(): boolean {
    return true;
  }

  async openSystemSettings(): Promise<boolean> {
    return true;
  }
}

function createService(native: SpeechNativePort, permission: SpeechPermissionPort): SpeechService {
  return new SpeechService({ native, permission, platform: "darwin", systemVersion: "26.5.2" });
}
