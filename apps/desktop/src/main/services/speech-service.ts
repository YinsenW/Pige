import { randomUUID } from "node:crypto";
import type {
  SpeechAvailabilityRequest,
  SpeechAvailabilityResult,
  SpeechCancelRequest,
  SpeechCancelResult,
  SpeechOpenSystemSettingsResult,
  SpeechSessionEvent,
  SpeechSessionRequest,
  SpeechStartRequest,
  SpeechStartResult,
  SpeechStopResult
} from "@pige/contracts";
import type { SpeechPermissionState, SpeechUnavailableReason } from "@pige/schemas";

export interface SpeechNativeProbeResult {
  readonly status: "supported" | "unsupported";
  readonly reason?: Extract<SpeechUnavailableReason, "language_unavailable" | "assets_unavailable" | "service_unavailable">;
  readonly permission: SpeechPermissionState;
}

export type SpeechNativeStartResult =
  | { readonly status: "started"; readonly metering: "available" | "unavailable" }
  | { readonly status: "blocked"; readonly reason: "permission_denied" | "permission_restricted" };

export interface SpeechNativePort {
  probe(languageTag: string): Promise<SpeechNativeProbeResult>;
  start(input: {
    readonly sessionId: string;
    readonly languageTag: string;
    readonly onTranscript: (transcript: string) => void;
    readonly onMeter: (elapsedMs: number, level: number) => void;
    readonly onFailure: () => void;
  }): Promise<SpeechNativeStartResult>;
  stop(sessionId: string): Promise<string>;
  cancel(sessionId: string): Promise<void>;
}

export interface SpeechPermissionPort {
  canOpenSystemSettings(): boolean;
  openSystemSettings(): Promise<boolean>;
}

interface ActiveSpeechSession {
  readonly ownerId: number;
  readonly requestId: string;
  readonly sessionId: string;
  readonly languageTag: string;
  readonly publish: (event: SpeechSessionEvent) => void;
  sequence: number;
  transcript: string;
  lastMeterElapsedMs: number;
  stopPromise?: Promise<SpeechStopResult>;
}

interface PendingSpeechStart {
  readonly ownerId: number;
  readonly requestId: string;
  canceled: boolean;
}

type SpeechErrorSummary = Extract<SpeechAvailabilityResult, { readonly status: "failed" }>["error"];

export interface SpeechServiceOptions {
  readonly native: SpeechNativePort;
  readonly permission: SpeechPermissionPort;
  readonly platform?: NodeJS.Platform;
  readonly systemVersion?: string;
}

export class SpeechService {
  readonly #native: SpeechNativePort;
  readonly #permission: SpeechPermissionPort;
  readonly #platform: NodeJS.Platform;
  readonly #systemVersion: string;
  #active: ActiveSpeechSession | undefined;
  #pendingStart: PendingSpeechStart | undefined;

  constructor(options: SpeechServiceOptions) {
    this.#native = options.native;
    this.#permission = options.permission;
    this.#platform = options.platform ?? process.platform;
    this.#systemVersion = options.systemVersion ?? "0";
  }

  async availability(request: SpeechAvailabilityRequest): Promise<SpeechAvailabilityResult> {
    const platformReason = this.#platformReason();
    if (platformReason) {
      return { status: "unsupported", reason: platformReason, canOpenSystemSettings: false };
    }
    try {
      const probe = await this.#native.probe(request.languageTag);
      if (probe.status === "unsupported") {
        return {
          status: "unsupported",
          reason: probe.reason ?? "service_unavailable",
          canOpenSystemSettings: false
        };
      }
      return {
        status: "supported",
        languageTag: request.languageTag,
        permission: probe.permission,
        canOpenSystemSettings: this.#permission.canOpenSystemSettings()
      };
    } catch {
      return { status: "failed", error: speechError("speech.availability_failed", true, "retry") };
    }
  }

  async start(
    ownerId: number,
    request: SpeechStartRequest,
    publish: (event: SpeechSessionEvent) => void
  ): Promise<SpeechStartResult> {
    if (this.#active || this.#pendingStart) {
      return {
        status: "blocked",
        requestId: request.requestId,
        error: speechError("speech.session_busy", true, "retry")
      };
    }
    const pending: PendingSpeechStart = { ownerId, requestId: request.requestId, canceled: false };
    this.#pendingStart = pending;
    try {
      const availability = await this.availability({ languageTag: request.languageTag });
      if (pending.canceled) return canceledStart(request.requestId);
      if (availability.status !== "supported") {
        return {
          status: "blocked",
          requestId: request.requestId,
          error: speechError(
            availability.status === "unsupported" ? `speech.${availability.reason}` : "speech.availability_failed",
            availability.status === "failed",
            availability.status === "failed" ? "retry" : "none"
          )
        };
      }

      if (availability.permission === "denied" || availability.permission === "restricted") {
        return {
          status: "blocked",
          requestId: request.requestId,
          error: speechError(
            availability.permission === "restricted" ? "speech.permission_restricted" : "speech.permission_denied",
            false,
            this.#permission.canOpenSystemSettings() ? "open_settings" : "none"
          )
        };
      }

      const sessionId = `speech_${randomUUID().replaceAll("-", "")}`;
      const session: ActiveSpeechSession = {
        ownerId,
        requestId: request.requestId,
        sessionId,
        languageTag: request.languageTag,
        publish,
        sequence: 0,
        transcript: "",
        lastMeterElapsedMs: -1
      };
      this.#active = session;
      try {
        const nativeResult = await this.#native.start({
          sessionId,
          languageTag: request.languageTag,
          onTranscript: (transcript) => this.#publishTranscript(session, transcript, false),
          onMeter: (elapsedMs, level) => this.#publishMeter(session, elapsedMs, level),
          onFailure: () => this.#failActiveSession(session)
        });
        if (nativeResult.status === "blocked") {
          if (this.#active === session) this.#active = undefined;
          return {
            status: "blocked",
            requestId: request.requestId,
            error: speechError(
              `speech.${nativeResult.reason}`,
              false,
              this.#permission.canOpenSystemSettings() ? "open_settings" : "none"
            )
          };
        }
        if (pending.canceled) {
          if (this.#active === session) this.#active = undefined;
          await this.#native.cancel(sessionId).catch(() => undefined);
          return canceledStart(request.requestId);
        }
        if (this.#active !== session) {
          return {
            status: "blocked",
            requestId: request.requestId,
            error: speechError("speech.start_failed", true, "retry")
          };
        }
        return {
          status: "started",
          requestId: request.requestId,
          sessionId,
          languageTag: request.languageTag,
          metering: nativeResult.metering
        };
      } catch {
        if (this.#active === session) this.#active = undefined;
        await this.#native.cancel(sessionId).catch(() => undefined);
        return {
          status: "blocked",
          requestId: request.requestId,
          error: speechError("speech.start_failed", true, "retry")
        };
      }
    } finally {
      if (this.#pendingStart === pending) this.#pendingStart = undefined;
    }
  }

  async stop(ownerId: number, request: SpeechSessionRequest): Promise<SpeechStopResult> {
    const session = this.#ownedSession(ownerId, request.sessionId);
    if (!session) return { status: "stale_session", sessionId: request.sessionId };
    if (session.stopPromise) return session.stopPromise;
    session.stopPromise = this.#stopSession(session);
    return session.stopPromise;
  }

  async #stopSession(session: ActiveSpeechSession): Promise<SpeechStopResult> {
    try {
      const transcript = normalizeTranscript(await this.#native.stop(session.sessionId));
      if (this.#active !== session) return { status: "stale_session", sessionId: session.sessionId };
      this.#publishTranscript(session, transcript, true);
      this.#active = undefined;
      return { status: "stopped", sessionId: session.sessionId, sequence: session.sequence, transcript };
    } catch {
      if (this.#active !== session) return { status: "stale_session", sessionId: session.sessionId };
      if (this.#active === session) this.#active = undefined;
      await this.#native.cancel(session.sessionId).catch(() => undefined);
      return {
        status: "failed",
        sessionId: session.sessionId,
        error: speechError("speech.stop_failed", true, "retry")
      };
    }
  }

  async cancel(ownerId: number, request: SpeechCancelRequest): Promise<SpeechCancelResult> {
    if ("requestId" in request) {
      const pending = this.#pendingStart;
      if (pending?.ownerId === ownerId && pending.requestId === request.requestId) {
        pending.canceled = true;
        const pendingSession = this.#active;
        if (pendingSession?.ownerId === ownerId && pendingSession.requestId === request.requestId) {
          this.#active = undefined;
          await this.#native.cancel(pendingSession.sessionId).catch(() => undefined);
        }
        return { status: "canceled", requestId: request.requestId };
      }
      const active = this.#active;
      if (!active || active.ownerId !== ownerId || active.requestId !== request.requestId) {
        return { status: "stale_request", requestId: request.requestId };
      }
      this.#active = undefined;
      await this.#native.cancel(active.sessionId).catch(() => undefined);
      return { status: "canceled", requestId: request.requestId };
    }
    const session = this.#ownedSession(ownerId, request.sessionId);
    if (!session) return { status: "stale_session", sessionId: request.sessionId };
    this.#active = undefined;
    await this.#native.cancel(session.sessionId).catch(() => undefined);
    return { status: "canceled", sessionId: session.sessionId };
  }

  async cancelOwner(ownerId: number): Promise<void> {
    if (this.#pendingStart?.ownerId === ownerId) {
      this.#pendingStart.canceled = true;
    }
    const session = this.#active;
    if (!session || session.ownerId !== ownerId) return;
    this.#active = undefined;
    await this.#native.cancel(session.sessionId).catch(() => undefined);
  }

  async openSystemSettings(): Promise<SpeechOpenSystemSettingsResult> {
    if (this.#platform !== "darwin" || !this.#permission.canOpenSystemSettings()) {
      return { status: "unavailable" };
    }
    try {
      return await this.#permission.openSystemSettings()
        ? { status: "opened" }
        : { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  }

  #platformReason(): "unsupported_platform" | "unsupported_os_version" | undefined {
    if (this.#platform !== "darwin") return "unsupported_platform";
    const major = Number.parseInt(this.#systemVersion.split(".", 1)[0] ?? "0", 10);
    return Number.isFinite(major) && major >= 26 ? undefined : "unsupported_os_version";
  }

  #ownedSession(ownerId: number, sessionId: string): ActiveSpeechSession | undefined {
    const session = this.#active;
    return session?.ownerId === ownerId && session.sessionId === sessionId ? session : undefined;
  }

  #publishTranscript(session: ActiveSpeechSession, transcript: string, final: boolean): void {
    if (this.#active !== session) return;
    const normalized = normalizeTranscript(transcript);
    if (!final && normalized === session.transcript) return;
    session.transcript = normalized;
    session.sequence += 1;
    session.publish({
      apiVersion: 1,
      kind: "transcript_replace",
      sessionId: session.sessionId,
      sequence: session.sequence,
      transcript: normalized,
      final
    });
  }

  #publishMeter(session: ActiveSpeechSession, elapsedMs: number, level: number): void {
    if (this.#active !== session) return;
    const normalizedElapsedMs = Math.max(0, Math.min(86_400_000, Math.trunc(elapsedMs)));
    if (normalizedElapsedMs <= session.lastMeterElapsedMs) return;
    session.lastMeterElapsedMs = normalizedElapsedMs;
    session.sequence += 1;
    session.publish({
      apiVersion: 1,
      kind: "meter",
      sessionId: session.sessionId,
      sequence: session.sequence,
      elapsedMs: normalizedElapsedMs,
      level: Math.max(0, Math.min(1, level))
    });
  }

  #failActiveSession(session: ActiveSpeechSession): void {
    if (this.#active !== session) return;
    session.sequence += 1;
    session.publish({
      apiVersion: 1,
      kind: "session_failed",
      sessionId: session.sessionId,
      sequence: session.sequence,
      error: speechError("speech.session_failed", true, "retry")
    });
    this.#active = undefined;
  }
}

function canceledStart(requestId: string): SpeechStartResult {
  return {
    status: "blocked",
    requestId,
    error: speechError("speech.start_canceled", false, "none")
  };
}

function normalizeTranscript(value: string): string {
  return value.normalize("NFC").slice(0, 32_000);
}

function speechError(
  code: string,
  retryable: boolean,
  userAction: SpeechErrorSummary["userAction"]
): SpeechErrorSummary {
  return {
    code,
    domain: "speech",
    messageKey: `errors.${code}`,
    retryable,
    severity: "warning",
    userAction
  };
}
