import { createHash } from "node:crypto";
import type {
  NoteQuestionState,
  NoteRenderResult,
  NoteSetQuestionStateRequest,
  NoteSetQuestionStateResult
} from "@pige/contracts";
import { parsePigeFrontmatter } from "@pige/markdown";
import type { NoteMarkdownEditorService } from "./note-markdown-editor-service";
import type { NotesService } from "./notes-service";

type QuestionTargetPort = Pick<NotesService, "resolveManagedPageTarget" | "render">;
type QuestionEditorPort = Pick<NoteMarkdownEditorService, "open" | "save">;

const QUESTION_STATES = new Set<NoteQuestionState>([
  "open", "partially_answered", "answered", "stale"
]);

export class QuestionStateService {
  readonly #targets: QuestionTargetPort;
  readonly #editor: QuestionEditorPort;
  readonly #now: () => Date;

  constructor(
    targets: QuestionTargetPort,
    editor: QuestionEditorPort,
    now: () => Date = () => new Date()
  ) {
    this.#targets = targets;
    this.#editor = editor;
    this.#now = now;
  }

  async setState(ownerId: string, request: NoteSetQuestionStateRequest): Promise<NoteSetQuestionStateResult> {
    const target = this.#targets.resolveManagedPageTarget(ownerId, {
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      renderContextId: request.renderContextId,
      expectedRevision: request.expectedRevision
    }, "question");
    if (target.status !== "ready") return closed(request, target.status);
    if (!target.assertCurrent()) return closed(request, "stale");

    const opened = this.#editor.open({
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId
    });
    if (opened.status !== "opened") {
      return closed(request, opened.status === "not_found" ? "not_found" : "failed");
    }
    if (opened.revisionId !== target.pageContentHash || !target.assertCurrent()) {
      return closed(request, "stale");
    }
    const markdown = updateQuestionStateMarkdown(opened.markdown, request.state, this.#now().toISOString());
    if (!markdown) return closed(request, "ineligible");

    const saved = this.#editor.save({
      requestId: internalRequestId(request.requestId),
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      expectedRevisionId: opened.revisionId,
      renderIdentity: opened.renderIdentity,
      markdown
    });
    if (saved.status !== "committed") return closed(request, mapSaveStatus(saved.status));

    let render: NoteRenderResult;
    try {
      render = await this.#targets.render({ pageId: request.currentPageId }, ownerId);
    } catch {
      return closed(request, "failed");
    }
    if (
      !render.renderContextId ||
      render.summary.pageId !== request.currentPageId ||
      render.summary.pageType !== "question" ||
      render.questionState?.state !== request.state ||
      render.questionState.canChange !== true
    ) return closed(request, "failed");
    return {
      ...request,
      status: "committed",
      operationId: saved.operationId,
      render: { ...render, renderContextId: render.renderContextId }
    };
  }
}

export function readQuestionState(rawFrontmatter: string): NoteQuestionState | undefined {
  const section = questionSection(rawFrontmatter);
  if (!section) return undefined;
  const matches = [...section.text.matchAll(/^  state:\s*(?:"([a-z_]+)"|'([a-z_]+)'|([a-z_]+))\s*$/gmu)];
  if (matches.length !== 1) return undefined;
  const state = matches[0]![1] ?? matches[0]![2] ?? matches[0]![3];
  return QUESTION_STATES.has(state as NoteQuestionState) ? state as NoteQuestionState : undefined;
}

export function updateQuestionStateMarkdown(
  markdown: string,
  state: NoteQuestionState,
  updatedAt: string
): string | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  if (
    !parsed ||
    parsed.frontmatter.type !== "question" ||
    parsed.frontmatter.status !== "active" ||
    !QUESTION_STATES.has(state)
  ) return undefined;
  const current = readQuestionState(parsed.raw);
  if (!current || current === state) return undefined;
  const section = questionSection(parsed.raw);
  if (!section) return undefined;
  const stateLines = [...section.text.matchAll(/^  state:\s*(?:"[a-z_]+"|'[a-z_]+'|[a-z_]+)\s*$/gmu)];
  const updatedLines = [...parsed.raw.matchAll(/^updated_at:[^\r\n]*$/gmu)];
  if (stateLines.length !== 1 || updatedLines.length !== 1) return undefined;
  const stateMatch = stateLines[0]!;
  const stateStart = section.start + (stateMatch.index ?? 0);
  const stateEnd = stateStart + stateMatch[0].length;
  const withState = `${parsed.raw.slice(0, stateStart)}  state: "${state}"${parsed.raw.slice(stateEnd)}`;
  const nextRaw = withState.replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${updatedAt}`);
  const rawStart = markdown.indexOf(parsed.raw);
  if (rawStart < 0) return undefined;
  return `${markdown.slice(0, rawStart)}${nextRaw}${markdown.slice(rawStart + parsed.raw.length)}`;
}

function questionSection(raw: string): { readonly start: number; readonly text: string } | undefined {
  const headings = [...raw.matchAll(/^question:\s*$/gmu)];
  if (headings.length !== 1) return undefined;
  const heading = headings[0]!;
  const start = heading.index ?? 0;
  const following = raw.slice(start + heading[0].length);
  const nextTopLevel = following.search(/\r?\n(?=[a-z][a-z0-9_]*:)/u);
  const end = nextTopLevel < 0 ? raw.length : start + heading[0].length + nextTopLevel;
  return { start, text: raw.slice(start, end) };
}

function internalRequestId(requestId: string): string {
  const suffix = createHash("sha256")
    .update(`pige.question-state.v1\0${requestId}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `noteeditreq_${suffix}`;
}

function mapSaveStatus(
  status: "stale" | "not_found" | "invalid" | "failed"
): "stale" | "not_found" | "ineligible" | "failed" {
  return status === "invalid" ? "ineligible" : status;
}

function closed(
  request: NoteSetQuestionStateRequest,
  status: Exclude<NoteSetQuestionStateResult["status"], "committed">
): NoteSetQuestionStateResult {
  return { ...request, status };
}
