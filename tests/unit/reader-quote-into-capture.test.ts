import { describe, expect, it } from "vitest";
import { appendReaderQuoteToDraft, type ReaderQuoteIntoCapture } from "../../apps/desktop/src/renderer/src/reader-quote-into-capture";

const quote: ReaderQuoteIntoCapture = {
  activeVaultId: "vault_quote_capture",
  pageId: "page_quote_capture",
  renderContextId: `notectx_${"a".repeat(32)}`,
  title: "Durable boundaries",
  selectedText: "First line\r\n\r\nSecond line",
  selection: {
    pageId: "page_quote_capture",
    pageContentHash: `sha256:${"b".repeat(64)}`,
    span: { unit: "utf8_bytes", start: 0, endExclusive: 20 },
    selectedContentHash: `sha256:${"c".repeat(64)}`
  }
};

describe("Reader quote into capture", () => {
  it("builds one Markdown quote without mutating or discarding an existing draft", () => {
    expect(appendReaderQuoteToDraft("Existing draft  \n", quote)).toBe(
      "Existing draft\n\n> First line\n> \n> Second line\n>\n> - Durable boundaries"
    );
    expect(appendReaderQuoteToDraft("", quote)).toBe(
      "> First line\n> \n> Second line\n>\n> - Durable boundaries"
    );
  });
});
