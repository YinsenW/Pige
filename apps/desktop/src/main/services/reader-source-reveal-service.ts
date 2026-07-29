import type { NoteRevealSourceRequest, NoteRevealSourceResult } from "@pige/contracts";
import type { NotesService } from "./notes-service";
import { verifyRevealableSourceFile } from "./source-file-access";

export interface ReaderSourceRevealRegistrar {
  reveal(absolutePath: string): Promise<"revealed" | "cancelled"> | "revealed" | "cancelled";
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
    let absolutePath: string;
    try {
      absolutePath = verifyRevealableSourceFile(resolved.vaultPath, resolved.sourceRecord).absolutePath;
    } catch {
      return { ...identity, status: "unavailable" };
    }
    if (!resolved.assertCurrent()) return { ...identity, status: "stale" };
    try {
      const status = await this.#registrar.reveal(absolutePath);
      return { ...identity, status };
    } catch {
      return { ...identity, status: "failed" };
    }
  }
}
