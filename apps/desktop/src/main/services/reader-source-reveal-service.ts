import type { NoteRevealSourceRequest, NoteRevealSourceResult } from "@pige/contracts";
import type { NotesService } from "./notes-service";
import { verifyRevealableSourceFile } from "./source-file-access";

export interface ReaderSourceRevealRegistrar {
  revealFile(absolutePath: string): Promise<"revealed" | "cancelled"> | "revealed" | "cancelled";
  openWebUrl(url: string): Promise<void> | void;
}

export class ReaderSourceRevealService {
  readonly #notes: Pick<NotesService, "resolveSourceReveal">;
  readonly #registrar: ReaderSourceRevealRegistrar;

  constructor(
    notes: Pick<NotesService, "resolveSourceReveal">,
    registrar: ReaderSourceRevealRegistrar
  ) {
    this.#notes = notes;
    this.#registrar = registrar;
  }

  async reveal(ownerId: string, request: NoteRevealSourceRequest): Promise<NoteRevealSourceResult> {
    const identity = { ...request } as const;
    const resolved = this.#notes.resolveSourceReveal(ownerId, request);
    if (resolved.status !== "ready") return { ...identity, status: resolved.status };
    const webUrl = resolved.sourceRecord.kind === "url"
      ? revealableWebUrl(resolved.sourceRecord)
      : undefined;
    let absolutePath: string | undefined;
    if (resolved.sourceRecord.kind === "url" && !webUrl) {
      return { ...identity, status: "unavailable" };
    }
    if (resolved.sourceRecord.kind !== "url") {
      try {
        absolutePath = verifyRevealableSourceFile(resolved.vaultPath, resolved.sourceRecord).absolutePath;
      } catch {
        return { ...identity, status: "unavailable" };
      }
    }
    if (!resolved.assertCurrent()) return { ...identity, status: "stale" };
    try {
      if (webUrl) {
        await this.#registrar.openWebUrl(webUrl);
        return { ...identity, status: "revealed" };
      }
      const status = await this.#registrar.revealFile(absolutePath!);
      return { ...identity, status };
    } catch {
      return { ...identity, status: "failed" };
    }
  }
}

function revealableWebUrl(record: Parameters<typeof verifyRevealableSourceFile>[1]): string | undefined {
  if (record.kind !== "url" || !record.original?.uri || record.original.uri.length > 4_096) return undefined;
  try {
    const url = new URL(record.original.uri);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname || url.username || url.password) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}
