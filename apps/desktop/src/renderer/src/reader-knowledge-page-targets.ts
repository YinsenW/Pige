import type { NoteRenderResult } from "@pige/contracts";
import type { ReaderNoteMergeTarget } from "./components/ReaderNoteMergeDialog";

type KnowledgePageType = NoteRenderResult["summary"]["pageType"];

export function createReaderKnowledgePageTargetLoader(getActiveVaultId: () => string | undefined) {
  return async (
    currentPageId: string,
    pageTypes: readonly KnowledgePageType[]
  ): Promise<readonly ReaderNoteMergeTarget[]> => {
    const vaultId = getActiveVaultId();
    if (!vaultId) throw new Error("Knowledge page target owner is unavailable.");
    const result = await window.pige.library.list({ limit: 50, pageTypes });
    if (getActiveVaultId() !== vaultId || result.activeVaultId !== vaultId) {
      throw new Error("Knowledge page target owner changed.");
    }
    return result.pages
      .filter((page) => page.status === "active" && pageTypes.includes(page.pageType) && page.pageId !== currentPageId)
      .map((page) => ({ pageId: page.pageId, title: page.title, updatedAt: page.updatedAt }));
  };
}
