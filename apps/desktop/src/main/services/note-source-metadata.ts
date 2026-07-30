import { NoteSourceDisplayNameSchema, type NoteSourceMetadataSummary } from "@pige/schemas";
import { reconnectableOriginalSources } from "./reader-source-reconnect-service";
import { readCurrentSourceRecordSnapshot } from "./source-file-access";

export function projectReaderSourceDetails(
  vaultPath: string,
  sourceIds: readonly string[],
  includeReconnect: boolean,
) {
  const metadata = sourceIds.length > 0 ? { sourceMetadata: projectNoteSourceMetadata(vaultPath, sourceIds) } : {};
  if (!includeReconnect) return metadata;
  const reconnectOriginalSources = reconnectableOriginalSources(vaultPath, sourceIds);
  return {
    ...metadata,
    reconnectOriginalSourceIds: reconnectOriginalSources.map((source) => source.sourceId),
    reconnectOriginalSources,
  };
}

export function projectNoteSourceMetadata(
  vaultPath: string,
  sourceIds: readonly string[],
): NoteSourceMetadataSummary {
  return {
    items: sourceIds.slice(0, 5).map((sourceId) => {
      const snapshot = readCurrentSourceRecordSnapshot(vaultPath, sourceId);
      if (!snapshot) return { sourceId, status: "unavailable" as const };
      const record = snapshot.record;
      const displayName = safeDisplayName(record.original?.displayName);
      const artifactKinds = new Set(record.artifacts.map((artifact) => artifact.kind));
      return {
        sourceId,
        status: "current" as const,
        ...(displayName ? { displayName } : {}),
        category: category(record.kind),
        storage: record.storageStrategy === "reference_original" ? "reference_original" as const : "managed_copy" as const,
        extraction: artifactKinds.has("ocr")
          ? "ocr" as const
          : artifactKinds.has("extracted_text") ? "text" as const : "none" as const,
      };
    }),
    remainingCount: Math.max(0, sourceIds.length - 5),
  };
}

function safeDisplayName(value: string | undefined): string | undefined {
  const parsed = NoteSourceDisplayNameSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function category(kind: string): "text" | "web" | "document" | "image" | "data" {
  if (kind === "url") return "web";
  if (kind === "image_file") return "image";
  if (kind === "csv_file" || kind === "xlsx_file" || kind === "sqlite_file") return "data";
  if (kind === "pdf_file" || kind === "docx_file" || kind === "pptx_file") return "document";
  return "text";
}
