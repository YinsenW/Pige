import { createHash, randomUUID } from "node:crypto";
import {
  DIAGNOSTICS_PRIVATE_EXCERPT_MAX_UTF8_BYTES,
  DiagnosticsPrivateExcerptTextSchema,
  DiagnosticsReviewedPrivateExcerptSchema,
  type DiagnosticsReviewedPrivateExcerpt,
  type SupportBundlePreview
} from "@pige/schemas";
import { containsRestrictedModelContent } from "./model-egress-content";
import { redactDiagnosticText, redactPaths } from "./diagnostics-export-core";

export function reviewDiagnosticsPrivateExcerpt(input: string): DiagnosticsReviewedPrivateExcerpt {
  const source = DiagnosticsPrivateExcerptTextSchema.parse(input);
  const text = redactPaths(redactDiagnosticText(source));
  if (Buffer.byteLength(text, "utf8") > DIAGNOSTICS_PRIVATE_EXCERPT_MAX_UTF8_BYTES ||
    redactDiagnosticText(text) !== text || redactPaths(text) !== text || containsRestrictedModelContent(text)) {
    throw new TypeError("The private support excerpt did not pass redaction.");
  }
  return DiagnosticsReviewedPrivateExcerptSchema.parse({ text, redactionApplied: text !== source });
}

export function buildSupportBundlePreview(
  estimatedBytes: number,
  generatedAt: string,
  context: Pick<SupportBundlePreview,
    "apiVersion" | "requestId" | "scopeContextId" | "expectedRevision" | "activeVaultId" |
    "selectedOptionalCategories" | "reviewedPrivateExcerpt"
  >
): SupportBundlePreview {
  const selected = context.selectedOptionalCategories;
  return {
    ...context,
    previewId: `supportpreview_${createHash("sha256").update(`${context.requestId}\0${generatedAt}\0${randomUUID()}`).digest("hex").slice(0, 48)}`,
    generatedAt,
    localOnly: true,
    estimatedBytes: Math.min(2 * 1024 * 1024, estimatedBytes +
      (context.reviewedPrivateExcerpt ? Buffer.byteLength(context.reviewedPrivateExcerpt.text, "utf8") : 0)),
    selectedOptionalCategories: selected,
    ...(context.reviewedPrivateExcerpt ? { reviewedPrivateExcerpt: context.reviewedPrivateExcerpt } : {}),
    includedCategories: [
      { id: "app_runtime", label: "App version, platform, and architecture", included: true, reason: "Needed to diagnose platform-specific failures." },
      { id: "diagnostics_health", label: "Diagnostics health summary", included: true, reason: "Redacted operational status only." },
      { id: "recent_errors", label: "Recent redacted diagnostic events", included: true, reason: "Bounded and redacted event summaries." },
      ...(selected.includes("provider_metadata") ? [{ id: "provider_metadata", label: "Redacted model-provider metadata", included: true as const,
        reason: "Aggregate provider types and health only; credentials, URLs, names, and model IDs stay excluded." }] : []),
      ...(selected.includes("private_excerpt") ? [{ id: "private_excerpt", label: "Explicitly reviewed private excerpt", included: true as const,
        reason: "Only the exact redacted text shown in this preview is exported." }] : [])
    ],
    excludedCategories: [
      { id: "secrets", label: "API keys, tokens, cookies, and credentials", included: false, reason: "Secrets are never exported by default." },
      { id: "content", label: "Full notes, source files, conversations, memory, prompts, and model responses", included: false,
        reason: "Support bundles must not duplicate private knowledge content by default." },
      { id: "binaries", label: "Local models, parser binaries, packages, and source artifacts", included: false,
        reason: "Large binaries and artifacts are excluded." },
      ...(!selected.includes("provider_metadata") ? [{ id: "provider_metadata", label: "Model-provider metadata", included: false as const,
        reason: "Provider metadata is included only after explicit preview selection." }] : []),
      ...(!selected.includes("private_excerpt") ? [{ id: "private_excerpt", label: "Private support excerpt", included: false as const,
        reason: "A private excerpt is included only after explicit entry and review." }] : [])
    ],
    privacyWarnings: [
      "The bundle is created locally and is not uploaded automatically.",
      "Paths, emails, and common secret patterns are redacted by default.",
      "Review the preview before exporting.",
      ...(selected.includes("private_excerpt")
        ? ["The optional excerpt shown below is the exact redacted text that will be exported."] : [])
    ]
  };
}

export function estimateSupportBundleBytes(recentEvents: unknown[]): number {
  return Math.min(2 * 1024 * 1024, Buffer.byteLength(JSON.stringify({ recentEvents }, null, 2)) + 4096);
}
