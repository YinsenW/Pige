import { createHash } from "node:crypto";
import type { AgentSubmitTurnRequest } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  CaptureService,
  type AgentTurnUrlPreservationResult
} from "./capture-service";
import { redactSensitiveUrl } from "./source-fetch-service";
import {
  JobsService,
  type ReserveAgentTurnUrlSourceRequest
} from "./jobs-service";

export interface HomeAgentUrlEvidence {
  readonly sourceId: string;
  readonly pageId: string;
  readonly pagePath: string;
  readonly title: string;
  readonly safeOriginalUrl: string;
  readonly safeFinalUrl: string;
  readonly extractedText: string;
  readonly warnings: readonly string[];
  readonly privateContent: boolean;
  readonly sensitiveContent: boolean;
  readonly inputHash: string;
  readonly evidenceHash: string;
}

export interface FetchHomeAgentUrlRequest {
  readonly jobId: string;
  readonly url: string;
  readonly inputKind: AgentSubmitTurnRequest["inputKind"];
  readonly locale: AgentSubmitTurnRequest["locale"];
  readonly policyHash: string;
  readonly catalogHash: string;
  readonly toolCallId: string;
  readonly signal: AbortSignal;
}

export interface ReadHomeAgentUrlRequest {
  readonly jobId: string;
  readonly sourceId: string;
  readonly inputHash: string;
}

export class HomeAgentUrlService {
  readonly #capture: CaptureService;
  readonly #jobs: JobsService;

  constructor(capture: CaptureService, jobs: JobsService) {
    this.#capture = capture;
    this.#jobs = jobs;
  }

  async fetch(request: FetchHomeAgentUrlRequest): Promise<HomeAgentUrlEvidence> {
    const normalizedUrl = normalizeSubmittedUrl(request.url);
    const inputHash = hashValue(normalizedUrl.safeUrl);
    const reservation: ReserveAgentTurnUrlSourceRequest = {
      toolId: "pige_fetch_url",
      toolVersion: "1",
      inputHash,
      catalogHash: request.catalogHash,
      policyHash: request.policyHash,
      toolCallId: request.toolCallId
    };
    const { sourceId } = this.#jobs.reserveAgentTurnUrlSource(request.jobId, reservation);
    await this.#capture.preserveUrlForAgentTurn({
      url: normalizedUrl.fetchUrl,
      inputKind: request.inputKind,
      userIntent: "unknown",
      locale: request.locale
    }, {
      jobId: request.jobId,
      sourceId,
      inputHash
    }, request.signal, {
      onPublicationStart: () => {
        this.#jobs.markAgentTurnUrlSourcePublicationStarted(request.jobId, sourceId, inputHash);
      }
    });
    this.#jobs.linkAgentTurnUrlSource(request.jobId, sourceId);
    return this.readCurrent({ jobId: request.jobId, sourceId, inputHash });
  }

  readCurrent(request: ReadHomeAgentUrlRequest): HomeAgentUrlEvidence {
    const preserved = this.#capture.readAgentTurnUrlSource({
      jobId: request.jobId,
      sourceId: request.sourceId,
      inputHash: request.inputHash
    });
    const link = this.#jobs.readAgentTurnUrlSourceLink(request.jobId, request.sourceId);
    return toHomeAgentUrlEvidence(preserved, link.pageId, link.pagePath, link.title, request.inputHash);
  }
}

function normalizeSubmittedUrl(value: string): { readonly fetchUrl: string; readonly safeUrl: string } {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new PigeDomainError("url_fetch.invalid_url", "The submitted URL is invalid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PigeDomainError("url_fetch.unsupported_scheme", "Only HTTP and HTTPS URLs can be fetched.");
  }
  if (parsed.username || parsed.password) {
    throw new PigeDomainError("url_fetch.credentials_not_allowed", "Embedded URL credentials are not allowed.");
  }
  parsed.hash = "";
  const fetchUrl = parsed.toString();
  return { fetchUrl, safeUrl: redactSensitiveUrl(fetchUrl) };
}

function toHomeAgentUrlEvidence(
  preserved: AgentTurnUrlPreservationResult,
  pageId: string,
  pagePath: string,
  title: string,
  inputHash: string
): HomeAgentUrlEvidence {
  return {
    sourceId: preserved.sourceId,
    pageId,
    pagePath,
    title,
    safeOriginalUrl: preserved.safeOriginalUrl,
    safeFinalUrl: preserved.safeFinalUrl,
    extractedText: preserved.extractedText,
    warnings: preserved.warnings,
    privateContent: preserved.privateContent,
    sensitiveContent: preserved.sensitiveContent,
    inputHash,
    evidenceHash: hashValue(JSON.stringify({
      schemaVersion: 1,
      sourceId: preserved.sourceId,
      pageId,
      pagePath,
      safeOriginalUrl: preserved.safeOriginalUrl,
      safeFinalUrl: preserved.safeFinalUrl,
      sourceRevisionHash: preserved.sourceRevisionHash,
      artifactChecksum: preserved.artifactChecksum,
      privateContent: preserved.privateContent,
      sensitiveContent: preserved.sensitiveContent
    }))
  };
}

function hashValue(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
