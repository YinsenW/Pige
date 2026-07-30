import { createHash } from "node:crypto";
import type { NoteAddTagRequest, NoteAddTagResult, NoteEditTaxonomyRequest, NoteEditTaxonomyResult, NoteRenderResult } from "@pige/contracts";
import { createPigeTagKey, normalizePigeTag, parsePigeFrontmatter } from "@pige/markdown";
import type { NoteMarkdownEditorService } from "./note-markdown-editor-service";
import type { NotesService } from "./notes-service";

type NoteTagTargetPort = Pick<NotesService, "resolveTrashTarget" | "render">;
type NoteTagEditorPort = Pick<NoteMarkdownEditorService, "open" | "save">;

export class NoteTagService {
  readonly #targets: NoteTagTargetPort;
  readonly #editor: NoteTagEditorPort;
  readonly #now: () => Date;

  constructor(targets: NoteTagTargetPort, editor: NoteTagEditorPort, now: () => Date = () => new Date()) {
    this.#targets = targets;
    this.#editor = editor;
    this.#now = now;
  }

  async add(ownerId: string, request: NoteAddTagRequest): Promise<NoteAddTagResult> {
    const target = this.#targets.resolveTrashTarget(ownerId, {
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      renderContextId: request.renderContextId,
      expectedRevision: request.expectedRevision
    });
    if (target.status !== "ready") return closedResult(request, target.status);
    if (!target.assertCurrent()) return closedResult(request, "stale");

    const opened = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.currentPageId });
    if (opened.status !== "opened") {
      return closedResult(request, opened.status === "not_found" ? "not_found" : "failed");
    }
    if (opened.revisionId !== target.pageContentHash || !target.assertCurrent()) {
      return closedResult(request, "stale");
    }
    const markdown = addTagToMarkdown(opened.markdown, request.tag, this.#now().toISOString());
    if (!markdown) return closedResult(request, "ineligible");
    const saved = this.#editor.save({
      requestId: internalRequestId(request.requestId),
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown
    });
    if (saved.status !== "committed") return closedResult(request, mapSaveStatus(saved.status));

    let render: NoteRenderResult;
    try {
      render = await this.#targets.render({ pageId: request.currentPageId }, ownerId);
    } catch {
      return closedResult(request, "failed");
    }
    const expectedTagKey = createPigeTagKey(request.tag);
    if (!render.renderContextId || render.summary.pageId !== request.currentPageId ||
      !expectedTagKey || !render.tagging?.tags.some((tag) => createPigeTagKey(tag) === expectedTagKey)) {
      return closedResult(request, "failed");
    }
    return { ...request, status: "committed", operationId: saved.operationId, render };
  }

  async edit(ownerId: string, request: NoteEditTaxonomyRequest): Promise<NoteEditTaxonomyResult> {
    const target = this.#targets.resolveTrashTarget(ownerId, {
      activeVaultId: request.activeVaultId, pageId: request.currentPageId,
      renderContextId: request.renderContextId, expectedRevision: request.expectedRevision
    });
    if (target.status !== "ready") return closedEditResult(request, target.status);
    if (!target.assertCurrent()) return closedEditResult(request, "stale");
    const opened = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.currentPageId });
    if (opened.status !== "opened") return closedEditResult(request, opened.status === "not_found" ? "not_found" : "failed");
    if (opened.revisionId !== target.pageContentHash || !target.assertCurrent()) return closedEditResult(request, "stale");
    const markdown = replaceTaxonomyInMarkdown(opened.markdown, request.tags, request.topics, this.#now().toISOString());
    if (!markdown) return closedEditResult(request, "ineligible");
    const saved = this.#editor.save({
      requestId: internalEditRequestId(request.requestId), activeVaultId: request.activeVaultId,
      pageId: request.currentPageId, expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity, markdown
    });
    if (saved.status !== "committed") return closedEditResult(request, mapSaveStatus(saved.status));
    try {
      const render = await this.#targets.render({ pageId: request.currentPageId }, ownerId);
      if (!render.renderContextId || render.summary.pageId !== request.currentPageId ||
        !sameCanonical(render.tagging?.tags, request.tags) || !sameCanonical(render.tagging?.topics, request.topics)) {
        return closedEditResult(request, "failed");
      }
      return { ...request, status: "committed", operationId: saved.operationId, render };
    } catch {
      return closedEditResult(request, "failed");
    }
  }
}

function internalRequestId(requestId: string): string {
  const suffix = createHash("sha256").update(`pige.note-tag-add.v1\0${requestId}`, "utf8").digest("hex").slice(0, 32);
  return `noteeditreq_${suffix}`;
}

function internalEditRequestId(requestId: string): string {
  const suffix = createHash("sha256").update(`pige.note-taxonomy-edit.v1\0${requestId}`, "utf8").digest("hex").slice(0, 32);
  return `noteeditreq_${suffix}`;
}

function canonicalTaxonomyValue(value: string): string | undefined {
  const result = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return result && !/[\u0000-\u001f\u007f]/u.test(result) ? result : undefined;
}

function replaceTaxonomyInMarkdown(
  markdown: string, requestedTags: readonly string[], requestedTopics: readonly string[], updatedAt: string
): string | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  if (parsed?.frontmatter.type !== "note" || parsed.frontmatter.status !== "active") return undefined;
  const tags = requestedTags.map(normalizePigeTag);
  const topics = requestedTopics.map(canonicalTaxonomyValue);
  if (tags.some((entry) => !entry) || topics.some((entry) => !entry)) return undefined;
  const canonicalTags = tags as string[], canonicalTopics = topics as string[];
  if (new Set(canonicalTags.map(createPigeTagKey)).size !== canonicalTags.length ||
      new Set(canonicalTopics.map((entry) => entry.toLocaleLowerCase("en-US"))).size !== canonicalTopics.length) return undefined;
  if (sameCanonical(parsed.frontmatter.tags ?? [], canonicalTags) && sameCanonical(parsed.frontmatter.topics ?? [], canonicalTopics)) return undefined;
  const rawStart = markdown.indexOf(parsed.raw);
  const updatedMatches = [...parsed.raw.matchAll(/^updated_at:[^\r\n]*$/gmu)];
  if (rawStart < 0 || updatedMatches.length !== 1) return undefined;
  let nextRaw = replaceArrayField(parsed.raw, "tags", canonicalTags);
  if (!nextRaw) return undefined;
  nextRaw = replaceArrayField(nextRaw, "topics", canonicalTopics);
  if (!nextRaw) return undefined;
  nextRaw = nextRaw.replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${updatedAt}`);
  return `${markdown.slice(0, rawStart)}${nextRaw}${markdown.slice(rawStart + parsed.raw.length)}`;
}

function replaceArrayField(raw: string, field: "tags" | "topics", values: readonly string[]): string | undefined {
  const pattern = new RegExp(`^${field}:[^\\r\\n]*$`, "gmu");
  const matches = [...raw.matchAll(pattern)];
  if (matches.length > 1) return undefined;
  if (matches.length === 1) {
    if (matches[0]![0].slice(field.length + 1).trim().length === 0) return undefined;
    return raw.replace(new RegExp(`^${field}:[^\\r\\n]*$`, "mu"), `${field}: ${JSON.stringify(values)}`);
  }
  const sourceIds = /^source_ids:[^\r\n]*$/mu;
  return sourceIds.test(raw)
    ? raw.replace(sourceIds, `${field}: ${JSON.stringify(values)}\n$&`)
    : `${raw.replace(/\s*$/u, "")}\n${field}: ${JSON.stringify(values)}\n`;
}

function sameCanonical(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return !!actual && actual.length === expected.length && actual.every((entry, index) =>
    entry.normalize("NFKC").toLocaleLowerCase("en-US") === expected[index]?.normalize("NFKC").toLocaleLowerCase("en-US"));
}

function addTagToMarkdown(markdown: string, requestedTag: string, updatedAt: string): string | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  const tag = normalizePigeTag(requestedTag);
  if (!tag) return undefined;
  const tagKey = createPigeTagKey(tag);
  if (parsed?.frontmatter.type !== "note" || parsed.frontmatter.status !== "active" || !tagKey) return undefined;
  const tags = parsed.frontmatter.tags ?? [];
  if (tags.length >= 12 || tags.some((current) => createPigeTagKey(current) === tagKey)) return undefined;
  const tagMatches = [...parsed.raw.matchAll(/^tags:[^\r\n]*$/gmu)];
  const updatedMatches = [...parsed.raw.matchAll(/^updated_at:[^\r\n]*$/gmu)];
  const rawStart = markdown.indexOf(parsed.raw);
  if (tagMatches.length > 1 || updatedMatches.length !== 1 || rawStart < 0) return undefined;
  let nextRaw = tagMatches.length === 1
    ? parsed.raw.replace(/^tags:[^\r\n]*$/mu, `tags: ${JSON.stringify([...tags, tag])}`)
    : insertTagsField(parsed.raw, tag);
  nextRaw = nextRaw.replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${updatedAt}`);
  return `${markdown.slice(0, rawStart)}${nextRaw}${markdown.slice(rawStart + parsed.raw.length)}`;
}

function insertTagsField(raw: string, tag: string): string {
  const sourceIds = /^source_ids:[^\r\n]*$/mu;
  if (sourceIds.test(raw)) return raw.replace(sourceIds, `tags: ${JSON.stringify([tag])}\n$&`);
  return `${raw.replace(/\s*$/u, "")}\ntags: ${JSON.stringify([tag])}\n`;
}

function mapSaveStatus(status: "stale" | "not_found" | "invalid" | "failed"):
  "stale" | "not_found" | "ineligible" | "failed" {
  return status === "invalid" ? "ineligible" : status;
}

function closedResult(
  request: NoteAddTagRequest,
  status: Exclude<NoteAddTagResult["status"], "committed">
): NoteAddTagResult {
  return { ...request, status };
}

function closedEditResult(
  request: NoteEditTaxonomyRequest,
  status: Exclude<NoteEditTaxonomyResult["status"], "committed">
): NoteEditTaxonomyResult {
  return { ...request, status };
}
