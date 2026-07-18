import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { PigeDomainError } from "@pige/domain";
import type { PermissionedExternalCapabilityAdapter } from "../permissioned-external-capability-service";
import { createPigeTextToolResult } from "../pi-agent-tool-boundary";
import {
  hashExternalResource,
  MAX_EXTERNAL_LIST_ENTRIES,
  MAX_EXTERNAL_TEXT_BYTES,
  normalizeExternalAbsolutePath,
  ReadonlyExternalFilesystemCore,
  requireBoundedInteger
} from "./readonly-node-os-capability-core";
import {
  redactSensitiveUrl,
  SourceFetchService,
  type SourceFetchSnapshot
} from "../source-fetch-service";

const ACTOR_DIGEST = digest("pige.first_party.readonly_node_os_capabilities.v1");
const MAX_URL_UTF8_BYTES = 8_192;

export interface ReadonlyNodeOsCapabilityFactoryOptions {
  readonly protectedRoots?: readonly string[];
  readonly sourceFetch?: Pick<SourceFetchService, "fetchSnapshot">;
}

interface ListInput {
  readonly path: string;
  readonly maxEntries: number;
}

interface ReadTextInput {
  readonly path: string;
  readonly maxBytes: number;
}

interface FetchTextInput {
  readonly url: string;
  readonly maxBytes: number;
}

export function createFirstPartyReadonlyNodeOsCapabilityAdapters(
  options: ReadonlyNodeOsCapabilityFactoryOptions = {}
): readonly PermissionedExternalCapabilityAdapter[] {
  const filesystem = new ReadonlyExternalFilesystemCore(
    options.protectedRoots === undefined ? {} : { protectedRoots: options.protectedRoots }
  );
  const sourceFetch = options.sourceFetch ?? new SourceFetchService();
  return Object.freeze([
    createFilesystemListAdapter(filesystem),
    createFilesystemReadTextAdapter(filesystem),
    createNetworkFetchTextAdapter(sourceFetch)
  ]);
}

function createFilesystemListAdapter(
  filesystem: ReadonlyExternalFilesystemCore
): PermissionedExternalCapabilityAdapter {
  return {
    tool: {
      name: "pige_external_filesystem_list",
      label: "List external folder",
      description: "Lists a bounded set of names and entry kinds in one absolute external folder without following the final path as a symlink.",
      parameters: strictObjectSchema({
        path: { type: "string", minLength: 1, maxLength: 4_096 },
        maxEntries: { type: "integer", minimum: 1, maximum: MAX_EXTERNAL_LIST_ENTRIES }
      }, ["path"]),
      outputSchema: strictObjectSchema({
        status: { const: "ok" },
        entryCount: { type: "integer", minimum: 0, maximum: MAX_EXTERNAL_LIST_ENTRIES },
        truncated: { type: "boolean" },
        identityHash: hashSchema(),
        revisionHash: hashSchema()
      }, ["status", "entryCount", "truncated", "identityHash", "revisionHash"]),
      effect: "read_only",
      inputTrust: "model_generated",
      outputTrust: "untrusted_source",
      dataBoundary: externalDataBoundary(),
      execution: "parallel_read_only",
      idempotency: { mode: "idempotent", scope: "tool_call" },
      limits: { maxInputBytes: 8 * 1_024, maxOutputBytes: 384 * 1_024, timeoutMs: 10_000 },
      ownerService: "ReadonlyNodeOsCapabilityService"
    },
    actor: actor(),
    action: {
      id: "filesystem.list_external_folder",
      version: "1",
      labelKey: "permissions.actions.external_filesystem_list"
    },
    permission: {
      capability: "external_filesystem",
      dataBoundary: "filesystem",
      resourceScope: "current_folder",
      resourceKind: "folder",
      reasonCode: "external.filesystem.list"
    },
    normalizeInput: (args): ListInput => {
      const input = exactInput(args, ["path", "maxEntries"]);
      return Object.freeze({
        path: normalizeExternalAbsolutePath(input.path),
        maxEntries: requireBoundedInteger(
          input.maxEntries,
          MAX_EXTERNAL_LIST_ENTRIES,
          MAX_EXTERNAL_LIST_ENTRIES,
          "external_filesystem.invalid_limit"
        )
      });
    },
    resourceIdentity: (input) => ({
      folderHash: hashExternalResource("folder", (input as ListInput).path)
    }),
    resourceCount: () => 1,
    execute: async (input, signal) => {
      const request = input as ListInput;
      const result = await filesystem.list(request.path, request.maxEntries, signal);
      const details = Object.freeze({
        status: "ok",
        entryCount: result.entries.length,
        truncated: result.truncated,
        identityHash: result.identityHash,
        revisionHash: result.revisionHash
      });
      return createPigeTextToolResult(JSON.stringify({ entries: result.entries, truncated: result.truncated }), details);
    }
  };
}

function createFilesystemReadTextAdapter(
  filesystem: ReadonlyExternalFilesystemCore
): PermissionedExternalCapabilityAdapter {
  return {
    tool: {
      name: "pige_external_filesystem_read_text",
      label: "Read external text file",
      description: "Reads one bounded UTF-8 text file by absolute path without following the final path as a symlink.",
      parameters: strictObjectSchema({
        path: { type: "string", minLength: 1, maxLength: 4_096 },
        maxBytes: { type: "integer", minimum: 1, maximum: MAX_EXTERNAL_TEXT_BYTES }
      }, ["path"]),
      outputSchema: strictObjectSchema({
        status: { const: "ok" },
        byteLength: { type: "integer", minimum: 0, maximum: MAX_EXTERNAL_TEXT_BYTES },
        identityHash: hashSchema(),
        revisionHash: hashSchema()
      }, ["status", "byteLength", "identityHash", "revisionHash"]),
      effect: "read_only",
      inputTrust: "model_generated",
      outputTrust: "untrusted_source",
      dataBoundary: externalDataBoundary(),
      execution: "parallel_read_only",
      idempotency: { mode: "idempotent", scope: "tool_call" },
      limits: { maxInputBytes: 8 * 1_024, maxOutputBytes: 384 * 1_024, timeoutMs: 10_000 },
      ownerService: "ReadonlyNodeOsCapabilityService"
    },
    actor: actor(),
    action: {
      id: "filesystem.read_external_text",
      version: "1",
      labelKey: "permissions.actions.external_filesystem_read_text"
    },
    permission: {
      capability: "external_filesystem",
      dataBoundary: "filesystem",
      resourceScope: "current_file",
      resourceKind: "file",
      reasonCode: "external.filesystem.read_text"
    },
    normalizeInput: (args): ReadTextInput => {
      const input = exactInput(args, ["path", "maxBytes"]);
      return Object.freeze({
        path: normalizeExternalAbsolutePath(input.path),
        maxBytes: requireBoundedInteger(
          input.maxBytes,
          MAX_EXTERNAL_TEXT_BYTES,
          MAX_EXTERNAL_TEXT_BYTES,
          "external_filesystem.invalid_limit"
        )
      });
    },
    resourceIdentity: (input) => ({
      fileHash: hashExternalResource("file", (input as ReadTextInput).path)
    }),
    resourceCount: () => 1,
    execute: async (input, signal) => {
      const request = input as ReadTextInput;
      const result = await filesystem.readText(request.path, request.maxBytes, signal);
      return createPigeTextToolResult(result.text, Object.freeze({
        status: "ok",
        byteLength: result.byteLength,
        identityHash: result.identityHash,
        revisionHash: result.revisionHash
      }));
    }
  };
}

function createNetworkFetchTextAdapter(
  sourceFetch: Pick<SourceFetchService, "fetchSnapshot">
): PermissionedExternalCapabilityAdapter {
  return {
    tool: {
      name: "pige_external_network_fetch_text",
      label: "Fetch external text",
      description: "Fetches bounded readable text from one public HTTP or HTTPS URL through Pige's SSRF-safe source fetcher.",
      parameters: strictObjectSchema({
        url: { type: "string", minLength: 1, maxLength: MAX_URL_UTF8_BYTES },
        maxBytes: { type: "integer", minimum: 1, maximum: MAX_EXTERNAL_TEXT_BYTES }
      }, ["url"]),
      outputSchema: strictObjectSchema({
        status: { const: "ok" },
        originalUrl: { type: "string" },
        finalUrl: { type: "string" },
        contentType: { type: "string" },
        byteLength: { type: "integer", minimum: 0, maximum: MAX_EXTERNAL_TEXT_BYTES },
        truncated: { type: "boolean" },
        warnings: { type: "array", items: { type: "string" }, maxItems: 32 }
      }, ["status", "originalUrl", "finalUrl", "contentType", "byteLength", "truncated", "warnings"]),
      effect: "read_only",
      inputTrust: "model_generated",
      outputTrust: "untrusted_source",
      dataBoundary: externalDataBoundary(),
      execution: "parallel_read_only",
      idempotency: { mode: "idempotent", scope: "tool_call" },
      limits: { maxInputBytes: 16 * 1_024, maxOutputBytes: 384 * 1_024, timeoutMs: 30_000 },
      ownerService: "ReadonlyNodeOsCapabilityService"
    },
    actor: actor(),
    action: {
      id: "network.fetch_external_text",
      version: "1",
      labelKey: "permissions.actions.external_network_fetch_text"
    },
    permission: {
      capability: "external_network",
      dataBoundary: "network",
      resourceScope: "current_url",
      resourceKind: "url",
      reasonCode: "external.network.fetch_text"
    },
    normalizeInput: (args): FetchTextInput => {
      const input = exactInput(args, ["url", "maxBytes"]);
      return Object.freeze({
        url: normalizeUrl(input.url),
        maxBytes: requireBoundedInteger(
          input.maxBytes,
          MAX_EXTERNAL_TEXT_BYTES,
          MAX_EXTERNAL_TEXT_BYTES,
          "external_network.invalid_limit"
        )
      });
    },
    resourceIdentity: (input) => ({
      urlHash: hashExternalResource("url", (input as FetchTextInput).url)
    }),
    resourceCount: () => 1,
    execute: async (input, signal) => {
      const request = input as FetchTextInput;
      assertNetworkNotAborted(signal);
      const snapshot = await sourceFetch.fetchSnapshot(request.url, signal);
      assertNetworkNotAborted(signal);
      const projected = projectUtf8(snapshot.extractedText, request.maxBytes);
      const details = projectFetchDetails(snapshot, projected.byteLength, projected.truncated);
      return createPigeTextToolResult(projected.text, details);
    }
  };
}

function projectFetchDetails(
  snapshot: SourceFetchSnapshot,
  byteLength: number,
  truncated: boolean
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    status: "ok",
    originalUrl: redactSensitiveUrl(snapshot.originalUrl),
    finalUrl: redactSensitiveUrl(snapshot.finalUrl),
    contentType: boundedString(snapshot.contentType, 256),
    byteLength,
    truncated,
    warnings: Object.freeze(snapshot.warnings.slice(0, 32).map((warning) => boundedString(warning, 128)))
  });
}

function projectUtf8(value: string, maxBytes: number): {
  readonly text: string;
  readonly byteLength: number;
  readonly truncated: boolean;
} {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return { text: value, byteLength: bytes.byteLength, truncated: false };
  let end = maxBytes;
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  const text = bytes.subarray(0, end).toString("utf8");
  return { text, byteLength: Buffer.byteLength(text, "utf8"), truncated: true };
}

function normalizeUrl(value: unknown): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_URL_UTF8_BYTES) {
    throw new PigeDomainError("external_network.invalid_input", "The external network request is invalid.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new PigeDomainError("external_network.invalid_input", "The external network request is invalid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PigeDomainError("external_network.invalid_input", "The external network request is invalid.");
  }
  parsed.hash = "";
  return parsed.toString();
}

function assertNetworkNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new PigeDomainError("url_fetch.cancelled", "The URL fetch was cancelled.");
  }
}

function exactInput(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PigeDomainError("external_capability.invalid_input", "The external capability input is invalid.");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    throw new PigeDomainError("external_capability.invalid_input", "The external capability input is invalid.");
  }
  return input;
}

function actor(): PermissionedExternalCapabilityAdapter["actor"] {
  return Object.freeze({
    type: "local_tool",
    id: "local_tool.pige.node_os_readonly",
    displayName: "Pige Node/OS Read-only Capabilities",
    version: "1.0.0",
    digest: ACTOR_DIGEST
  });
}

function externalDataBoundary(): PermissionedExternalCapabilityAdapter["tool"]["dataBoundary"] {
  return Object.freeze({
    resourceScope: "none",
    pathAuthority: "host_only",
    sourceIdAuthority: "host_only",
    modelAuthority: "none"
  });
}

function strictObjectSchema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[]
): Readonly<Record<string, unknown>> {
  return Object.freeze({ type: "object", properties, required, additionalProperties: false });
}

function hashSchema(): Readonly<Record<string, unknown>> {
  return Object.freeze({ type: "string", pattern: "^sha256:[a-f0-9]{64}$" });
}

function boundedString(value: string, maxBytes: number): string {
  return projectUtf8(value, maxBytes).text;
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
