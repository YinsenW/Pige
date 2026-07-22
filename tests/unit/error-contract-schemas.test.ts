import { describe, expect, it } from "vitest";
import {
  DiagnosticErrorSchema,
  JobRecordSchema,
  PigeErrorSchema,
  PigeErrorSummarySchema,
  PigeWarningSchema
} from "@pige/schemas";

const timestamp = "2026-07-10T12:00:00.000Z";

const retryableParserError = {
  code: "parser.tool_missing",
  domain: "parser",
  messageKey: "errors.parser.tool_missing",
  retryable: true,
  severity: "error",
  userAction: "repair_tool",
  redactedDetails: { parser: "pdf", attempts: 1 }
} as const;

describe("shared error taxonomy schemas", () => {
  it("uses one executable vocabulary across API, Job, and diagnostic records", () => {
    const apiError = PigeErrorSchema.parse({
      ...retryableParserError,
      jobId: "job_20260710_abcdef12",
      diagnosticErrorId: "diag_parser_01"
    });
    const jobError = PigeErrorSummarySchema.parse({
      ...retryableParserError,
      diagnosticErrorId: "diag_parser_01"
    });
    const diagnosticError = DiagnosticErrorSchema.parse({
      ...retryableParserError,
      errorId: "diag_parser_01",
      jobId: "job_20260710_abcdef12",
      createdAt: timestamp
    });

    for (const record of [apiError, jobError, diagnosticError]) {
      expect(record).toMatchObject({
        code: "parser.tool_missing",
        domain: "parser",
        messageKey: "errors.parser.tool_missing",
        retryable: true,
        userAction: "repair_tool"
      });
    }
  });

  it("rejects non-namespaced codes and non-scalar redacted metadata", () => {
    expect(() => PigeErrorSummarySchema.parse({
      ...retryableParserError,
      code: "tool_missing"
    })).toThrow();
    expect(() => PigeErrorSummarySchema.parse({
      ...retryableParserError,
      redactedDetails: { nested: { rawPath: "/private/source" } }
    })).toThrow();
    expect(() => PigeErrorSummarySchema.parse({
      ...retryableParserError,
      domain: "ocr"
    })).toThrow();
    expect(PigeErrorSummarySchema.parse({
      code: "agent_ingest.update_content_restricted",
      domain: "agent_ingest",
      messageKey: "errors.agent_runtime.source_turn_failed",
      retryable: false,
      severity: "error",
      userAction: "none"
    })).toMatchObject({ code: "agent_ingest.update_content_restricted", domain: "agent_ingest" });
  });

  it("rejects unknown fields that could bypass the redacted scalar metadata boundary", () => {
    expect(() => PigeWarningSchema.parse({
      code: "parser.output_truncated",
      domain: "parser",
      messageKey: "errors.parser.output_truncated",
      path: "/private/source.pdf"
    })).toThrow();
    expect(() => PigeErrorSummarySchema.parse({
      ...retryableParserError,
      rawPrompt: "private prompt body"
    })).toThrow();
    expect(() => PigeErrorSchema.parse({
      ...retryableParserError,
      body: { sourceText: "private source" }
    })).toThrow();
    expect(() => DiagnosticErrorSchema.parse({
      ...retryableParserError,
      errorId: "diag_parser_01",
      createdAt: timestamp,
      rawBody: "private provider response"
    })).toThrow();
  });

  it("requires durable Job warnings and errors to use the shared structures", () => {
    const warning = PigeWarningSchema.parse({
      code: "parser.output_truncated",
      domain: "parser",
      messageKey: "errors.parser.output_truncated",
      sourceRef: { kind: "source", id: "src_20260710_abcdef12" }
    });
    const job = JobRecordSchema.parse({
      id: "job_20260710_abcdef12",
      class: "parse",
      state: "failed_retryable",
      createdAt: timestamp,
      updatedAt: timestamp,
      warnings: [warning],
      error: retryableParserError,
      message: "Parser dependency is unavailable."
    });

    expect(job.warnings?.[0]?.code).toBe("parser.output_truncated");
    expect(job.error?.userAction).toBe("repair_tool");
    expect(() => JobRecordSchema.parse({ ...job, warnings: ["parser warning"] })).toThrow();
    expect(() => JobRecordSchema.parse({ ...job, error: { code: "parser.failed" } })).toThrow();
  });
});
