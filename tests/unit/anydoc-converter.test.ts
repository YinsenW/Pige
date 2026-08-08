import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapAnyDocError } from "../../apps/desktop/src/main/services/anydoc-converter";

describe("AnyDoc converter error boundary", () => {
  it.each([
    ["unsupported", "parser.docx.unsupported"],
    ["malformed", "parser.docx.invalid"],
    ["encrypted", "parser.docx.encrypted"],
    ["resourceLimit", "parser.docx.resource_limit"],
    ["missingPart", "parser.docx.required_part_missing"],
    ["io", "parser.docx.source_missing"],
    ["unknown", "parser.docx.failed"]
  ])("maps AnyDoc %s failures to body-free Pige errors", (upstreamCode, expectedCode) => {
    const error = mapAnyDocError("docx", { code: upstreamCode, message: "private upstream detail" });

    expect(error).toMatchObject({ code: expectedCode });
    expect(error.message).not.toContain("private upstream detail");
  });

  it("maps encrypted PDFs to the existing password-required taxonomy", () => {
    expect(mapAnyDocError("pdf", { code: "encrypted" })).toMatchObject({
      code: "parser.pdf.password_required"
    });
  });

  it("uses only AnyDoc in-memory byte APIs", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "apps/desktop/src/main/services/anydoc-converter.ts"), "utf8");

    expect(source).toContain("toMarkdownBytes(bytes, nativeFormat)");
    expect(source).toContain("toDocument(bytes, nativeFormat)");
    expect(source).not.toMatch(/\btoMarkdown\s*\(/u);
    expect(source).not.toMatch(/\b(?:fetch|spawn|execFile)\s*\(/u);
  });
});
