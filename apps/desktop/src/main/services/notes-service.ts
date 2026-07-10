import fs from "node:fs";
import type {
  NoteDocument,
  NoteGetRequest,
  NoteRenderRequest,
  NoteRenderResult,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { renderPigeMarkdownToHtml } from "@pige/markdown";
import { findMarkdownPageById, readMarkdownPageBody } from "./markdown-page-index";

export interface NotesVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export class NotesService {
  readonly #vaults: NotesVaultPort;

  constructor(vaults: NotesVaultPort) {
    this.#vaults = vaults;
  }

  get(request: NoteGetRequest): NoteDocument {
    const vaultPath = this.#requireActiveVaultPath();
    const page = findMarkdownPageById(vaultPath, request.pageId);
    if (!page) {
      throw new PigeDomainError("note_not_found", "The requested Markdown page was not found.");
    }

    const markdownBody = readMarkdownPageBody(page.absolutePath);
    return {
      summary: page.summary,
      markdownBody,
      byteSize: fs.statSync(page.absolutePath).size
    };
  }

  async render(request: NoteRenderRequest): Promise<NoteRenderResult> {
    const document = this.get(request);
    const rendered = await renderPigeMarkdownToHtml(document.markdownBody);
    return {
      summary: document.summary,
      html: rendered.html,
      byteSize: document.byteSize
    };
  }

  #requireActiveVaultPath(): string {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!this.#vaults.current() || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    return vaultPath;
  }
}
