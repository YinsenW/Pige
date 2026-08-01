import type { NoteRenderResult, ReaderSelectionIdentity } from "@pige/contracts";

export type ReaderQuoteIntoCapture = {
  readonly activeVaultId: string;
  readonly pageId: string;
  readonly renderContextId: string;
  readonly title: string;
  readonly selectedText: string;
  readonly selection: ReaderSelectionIdentity;
};

export function createReaderQuoteIntoCapture(
  activeVaultId: string | undefined,
  note: NoteRenderResult,
  selection: ReaderSelectionIdentity,
  selectedText: string
): ReaderQuoteIntoCapture | null {
  const renderContextId = note.renderContextId;
  if (!activeVaultId || !renderContextId || !selectedText || selection.pageId !== note.summary.pageId) return null;
  return { activeVaultId, pageId: note.summary.pageId, renderContextId, title: note.summary.title, selectedText, selection };
}

export function appendReaderQuoteToDraft(currentDraft: string, quote: ReaderQuoteIntoCapture): string {
  const quoted = quote.selectedText
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const block = `${quoted}\n>\n> - ${quote.title}`;
  return currentDraft.length === 0 ? block : `${currentDraft.replace(/\s+$/u, "")}\n\n${block}`;
}
