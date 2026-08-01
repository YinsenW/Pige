import fs from "node:fs";
import type { NoteRevealGeneratedRequest, NoteRevealGeneratedResult } from "@pige/contracts";

export type NotesGeneratedRevealResolution =
  | { readonly status: "ready"; readonly absolutePath: string; assertCurrent(): boolean }
  | { readonly status: "stale" | "not_found" | "ineligible" };

export interface GeneratedNoteRevealContext {
  readonly vaultId: string; readonly vaultPath: string; readonly pageId: string;
  readonly pageType: string; readonly absolutePath: string; readonly pageContentHash: string;
  readonly generatedByPige: boolean; readonly ownerEpoch: number;
}

export function isPigeGeneratedFrontmatter(raw: string): boolean {
  const lines = raw.split("\n"), parentIndex = lines.indexOf("provenance:");
  if (parentIndex < 0) return false;
  const end = lines.findIndex((line, index) => index > parentIndex && line.length > 0 && !/^\s/u.test(line));
  const match = lines.slice(parentIndex + 1, end < 0 ? lines.length : end)
    .find((line) => line.startsWith("  generated_by:"));
  if (!match) return false;
  const value = match.slice("  generated_by:".length).trim();
  try { return (value.startsWith('"') ? JSON.parse(value) : value) === "pige"; } catch { return false; }
}

const TRASHABLE_ACTIVE_KNOWLEDGE_PAGE_TYPES = new Set(["claim", "concept", "entity", "question", "topic"]);
export function isTrashableKnowledgePage(pageType: string | undefined, status: string | undefined): boolean {
  return pageType === "note" || Boolean(status === "active" && pageType && TRASHABLE_ACTIVE_KNOWLEDGE_PAGE_TYPES.has(pageType));
}

export type TaxonomyKnowledgePageType = "note" | "claim" | "concept" | "entity" | "question";
export type LifecycleKnowledgePageType = TaxonomyKnowledgePageType | "topic";
const RENAMABLE_ACTIVE_KNOWLEDGE_PAGE_TYPES = new Set<TaxonomyKnowledgePageType>(
  ["note", "claim", "concept", "entity", "question"]
);
const LIFECYCLE_KNOWLEDGE_PAGE_TYPES = new Set<LifecycleKnowledgePageType>(
  ["note", "claim", "concept", "entity", "question", "topic"]
);
export function isRenamableKnowledgePage(pageType: string | undefined, status: string | undefined): boolean {
  return Boolean(status === "active" && pageType &&
    RENAMABLE_ACTIVE_KNOWLEDGE_PAGE_TYPES.has(pageType as TaxonomyKnowledgePageType));
}

export function isTaxonomyKnowledgePage(
  pageType: string | undefined,
  status: string | undefined
): pageType is TaxonomyKnowledgePageType {
  return pageType === "note" || Boolean(status === "active" && pageType &&
    RENAMABLE_ACTIVE_KNOWLEDGE_PAGE_TYPES.has(pageType as TaxonomyKnowledgePageType));
}
export function isLifecycleKnowledgePage(pageType: string | undefined, status: string | undefined): boolean {
  return Boolean((status === "active" || status === "archived") && pageType &&
    LIFECYCLE_KNOWLEDGE_PAGE_TYPES.has(pageType as LifecycleKnowledgePageType));
}

export function isRevisionHistoryKnowledgePage(
  pageType: string | undefined,
  status: string | undefined
): boolean {
  return Boolean(status === "active" && pageType &&
    LIFECYCLE_KNOWLEDGE_PAGE_TYPES.has(pageType as LifecycleKnowledgePageType));
}

export function resolveGeneratedNoteReveal(request: NoteRevealGeneratedRequest, input: {
  readonly vaultId: string | undefined; readonly vaultPath: string | undefined;
  readonly ownerEpoch: number | undefined; readonly context: GeneratedNoteRevealContext | undefined;
  readonly publicRevision: (privateRevision: string) => string;
  readonly isCurrent: (context: GeneratedNoteRevealContext) => boolean;
  readonly readContext: () => GeneratedNoteRevealContext | undefined;
}): NotesGeneratedRevealResolution {
  const context = input.context;
  if (!input.vaultId || !input.vaultPath || input.vaultId !== request.activeVaultId || !context ||
    context.vaultId !== request.activeVaultId || context.vaultPath !== input.vaultPath ||
    context.pageId !== request.currentPageId || input.ownerEpoch !== context.ownerEpoch ||
    input.publicRevision(context.pageContentHash) !== request.expectedRevision) return { status: "stale" };
  if (!input.isCurrent(context)) {
    try { fs.lstatSync(context.absolutePath); } catch (caught) {
      if (typeof caught === "object" && caught !== null && "code" in caught && caught.code === "ENOENT") return { status: "not_found" };
    }
    return { status: "stale" };
  }
  if (!context.generatedByPige || context.pageType === "source") return { status: "ineligible" };
  return { status: "ready", absolutePath: context.absolutePath,
    assertCurrent: () => input.readContext() === context && input.ownerEpoch === context.ownerEpoch && input.isCurrent(context) };
}

export interface ReaderGeneratedNoteRevealRegistrar {
  reveal(absolutePath: string): Promise<void> | void;
}

export class ReaderGeneratedNoteRevealService {
  readonly #notes: { resolveGeneratedReveal(ownerId: string, request: NoteRevealGeneratedRequest): NotesGeneratedRevealResolution };
  readonly #registrar: ReaderGeneratedNoteRevealRegistrar;

  constructor(
    notes: { resolveGeneratedReveal(ownerId: string, request: NoteRevealGeneratedRequest): NotesGeneratedRevealResolution },
    registrar: ReaderGeneratedNoteRevealRegistrar
  ) {
    this.#notes = notes;
    this.#registrar = registrar;
  }

  async reveal(ownerId: string, request: NoteRevealGeneratedRequest): Promise<NoteRevealGeneratedResult> {
    const identity = { ...request } as const;
    const resolved = this.#notes.resolveGeneratedReveal(ownerId, request);
    if (resolved.status !== "ready") return { ...identity, status: resolved.status };
    if (!resolved.assertCurrent()) return { ...identity, status: "stale" };
    try {
      await this.#registrar.reveal(resolved.absolutePath);
      return { ...identity, status: "revealed" };
    } catch {
      return { ...identity, status: "failed" };
    }
  }
}
