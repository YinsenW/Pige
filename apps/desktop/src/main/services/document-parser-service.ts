import { PigeDomainError } from "@pige/domain";
import type { JobRecord, SourceKind, SourceRecord } from "@pige/schemas";
import { OfficeParserService } from "./office-parser-service";
import type { DocumentParseSourceResult } from "./parser-artifact-service";
import { PdfParserService } from "./pdf-parser-service";

export interface DocumentParserPort {
  canParse(sourceKind: SourceKind): boolean;
  parseSource(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord
  ): Promise<DocumentParseSourceResult>;
}

export class DocumentParserService implements DocumentParserPort {
  readonly #parsers: readonly DocumentParserPort[];

  constructor(parsers: readonly DocumentParserPort[] = [new PdfParserService(), new OfficeParserService()]) {
    this.#parsers = [...parsers];
  }

  canParse(sourceKind: SourceKind): boolean {
    return this.#parsers.some((parser) => parser.canParse(sourceKind));
  }

  parseSource(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord
  ): Promise<DocumentParseSourceResult> {
    const parser = this.#parsers.find((candidate) => candidate.canParse(sourceRecord.kind));
    if (!parser) {
      throw new PigeDomainError("parser.unsupported_source", "No bundled document parser can process this source kind.");
    }
    return parser.parseSource(vaultPath, sourceRecord, sourceRecordPath, job);
  }
}
