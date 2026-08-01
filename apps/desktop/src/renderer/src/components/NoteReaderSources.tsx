import { useId, useState } from "react";
import type {
  NoteReconnectOriginalSourceRequest,
  NoteReconnectOriginalSourceResult,
  NoteRenderResult,
  NoteRevealSourceRequest,
  NoteRevealSourceResult
} from "@pige/contracts";
import { NoteReaderSourceActions, readerSourceActionLabels } from "./ReaderSourceActions";
import { ReaderSourceMetadata } from "./ReaderSourceMetadata";

const COLLAPSED_SOURCE_COUNT = 5;

export function NoteReaderSources(props: {
  readonly note: NoteRenderResult;
  readonly activeVaultId?: string;
  readonly sourceReferenceState: {
    readonly sourceId: string;
    readonly status: "resolving" | "not_found" | "stale" | "failed";
  } | null;
  readonly onOpenSourceReference: (sourceId: string) => void;
  readonly onRevealSource?: (request: NoteRevealSourceRequest) => Promise<NoteRevealSourceResult>;
  readonly onReconnectOriginalSource?: (
    request: NoteReconnectOriginalSourceRequest
  ) => Promise<NoteReconnectOriginalSourceResult>;
  readonly onSourceReconnected?: (render: NoteRenderResult) => void;
  readonly getFocusRoot: () => HTMLElement | null;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const sourceListId = useId();
  const summary = props.note.summary;
  const visibleSourceIds = expanded ? summary.sourceIds : summary.sourceIds.slice(0, COLLAPSED_SOURCE_COUNT);
  return (
    <section className="reader-sources" aria-label={props.t("note.sources")}>
      <h2>{props.t("note.sources")}</h2>
      <div className="reader-source-list" id={sourceListId}>
        {visibleSourceIds.map((sourceId, index) => {
          const sourceLabel = props.t("note.savedSource").replace("{number}", String(index + 1));
          const projectedMetadata = props.note.sourceMetadata?.items[index];
          const sourceMetadata = projectedMetadata?.sourceId === sourceId ? projectedMetadata : undefined;
          return (
            <div key={`${sourceId}:${index}`}>
              <button className="reader-source" type="button" data-reader-source-action="open"
                data-reader-source-open={sourceId} disabled={props.sourceReferenceState?.status === "resolving"}
                aria-busy={props.sourceReferenceState?.sourceId === sourceId && props.sourceReferenceState.status === "resolving"}
                onClick={() => props.onOpenSourceReference(sourceId)}>
                <span className="reader-source-icon" aria-hidden="true">SRC</span>
                <span className="reader-source-copy">
                  <ReaderSourceMetadata fallbackLabel={sourceLabel} metadata={sourceMetadata} t={props.t} />
                  <span role={props.sourceReferenceState?.sourceId === sourceId ? "status" : undefined}
                    aria-live={props.sourceReferenceState?.sourceId === sourceId ? "polite" : undefined}
                    aria-atomic={props.sourceReferenceState?.sourceId === sourceId ? "true" : undefined}>
                    {props.t(props.sourceReferenceState?.sourceId === sourceId
                      ? `note.readerLink.${props.sourceReferenceState.status}`
                      : "note.readerLinkReady")}
                  </span>
                </span>
                <small>{props.t("note.open")}</small>
              </button>
            </div>
          );
        })}
        <NoteReaderSourceActions currentPageId={summary.pageId} sourceIds={summary.sourceIds}
          visibleSourceIds={visibleSourceIds} labels={readerSourceActionLabels(props.t)}
          {...(props.note.refreshableSourceIds ? { refreshableSourceIds: props.note.refreshableSourceIds } : {})}
          sourceLabel={(number) => props.t("note.savedSource").replace("{number}", String(number))}
          t={props.t} getFocusRoot={props.getFocusRoot}
          {...(props.activeVaultId ? { activeVaultId: props.activeVaultId } : {})}
          {...(props.note.renderContextId ? { renderContextId: props.note.renderContextId } : {})}
          {...(props.note.reconnectOriginalSourceIds ? { reconnectOriginalSourceIds: props.note.reconnectOriginalSourceIds } : {})}
          {...(props.note.reconnectOriginalSources ? { reconnectOriginalSources: props.note.reconnectOriginalSources } : {})}
          {...(props.onRevealSource ? { onRevealSource: props.onRevealSource } : {})}
          {...(props.onReconnectOriginalSource ? { onReconnectOriginalSource: props.onReconnectOriginalSource } : {})}
          {...(props.onSourceReconnected ? { onSourceReconnected: props.onSourceReconnected } : {})}
        />
      </div>
      {summary.sourceIds.length > COLLAPSED_SOURCE_COUNT ? (
        <button className="ghost reader-source-overflow" type="button" data-reader-source-disclosure
          aria-controls={sourceListId} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? props.t("note.showFewerSources") : props.t("note.showMoreSources")
            .replace("{count}", String(summary.sourceIds.length - COLLAPSED_SOURCE_COUNT))}
        </button>
      ) : null}
    </section>
  );
}
