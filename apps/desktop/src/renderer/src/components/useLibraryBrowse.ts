import { useEffect, useRef, useState } from "react";
import type { LibraryBrowseResult, LibraryListResult } from "@pige/contracts";
import { appendLibraryBrowsePage } from "./library-panel-model";

type ReadyBrowse = Extract<LibraryBrowseResult, { status: "ready" }>;
interface Continuation {
  readonly snapshotId: ReadyBrowse["snapshotId"];
  readonly cursor: NonNullable<ReadyBrowse["nextCursor"]>;
}

export function useLibraryBrowse(
  activeVaultId: string | undefined,
  onError: (message: string | null) => void,
  genericError: string
) {
  const [libraryList, setLibraryList] = useState<LibraryListResult | null>(null);
  const [continuation, setContinuation] = useState<Continuation | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const sequence = useRef(0);
  const browseInFlightRef = useRef(false);
  const activeVaultIdRef = useRef(activeVaultId);
  activeVaultIdRef.current = activeVaultId;

  useEffect(() => {
    sequence.current += 1;
    setLibraryList(null);
    setContinuation(null);
    browseInFlightRef.current = false;
    setLoadingMore(false);
    setLoadMoreFailed(false);
    onError(null);
  }, [activeVaultId]);

  const refresh = async (): Promise<void> => {
    const owner = activeVaultIdRef.current;
    const requestSequence = ++sequence.current;
    onError(null);
    setLoadMoreFailed(false);
    browseInFlightRef.current = true;
    setLoadingMore(false);
    try {
      if (!owner) throw new Error("Library owner is unavailable.");
      const result = await window.pige.library.browse({
        apiVersion: 1, requestId: requestId(), activeVaultId: owner, limit: 50
      });
      if (requestSequence !== sequence.current || activeVaultIdRef.current !== owner) return;
      if (result.status !== "ready" || result.activeVaultId !== owner) throw new Error("Library browse failed.");
      setLibraryList({
        scannedAt: result.scannedAt, activeVaultId: result.activeVaultId, total: result.total,
        invalidPageCount: result.invalidPageCount, pages: result.pages
      });
      setContinuation(result.nextCursor ? { snapshotId: result.snapshotId, cursor: result.nextCursor } : null);
    } catch {
      if (requestSequence !== sequence.current) return;
      onError(genericError);
      setContinuation(null);
    } finally {
      if (requestSequence === sequence.current) browseInFlightRef.current = false;
    }
  };

  const loadMore = async (): Promise<void> => {
    const owner = activeVaultIdRef.current;
    const next = continuation;
    const current = libraryList;
    if (!owner || !next || !current || browseInFlightRef.current) return;
    const requestSequence = sequence.current;
    browseInFlightRef.current = true;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const result = await window.pige.library.browse({
        apiVersion: 1, requestId: requestId(), activeVaultId: owner, limit: 50,
        snapshotId: next.snapshotId, cursor: next.cursor
      });
      if (requestSequence !== sequence.current || activeVaultIdRef.current !== owner) return;
      if (result.status !== "ready" || result.snapshotId !== next.snapshotId) throw new Error("Stale Library continuation.");
      const appended = appendLibraryBrowsePage(current, result);
      if (!appended) throw new Error("Library continuation boundary mismatch.");
      setLibraryList(appended);
      setContinuation(result.nextCursor ? { snapshotId: result.snapshotId, cursor: result.nextCursor } : null);
    } catch {
      if (requestSequence === sequence.current) setLoadMoreFailed(true);
    } finally {
      if (requestSequence === sequence.current) {
        browseInFlightRef.current = false;
        setLoadingMore(false);
      }
    }
  };

  return {
    libraryList, refresh, loadMore, canLoadMore: continuation !== null, loadingMore, loadMoreFailed
  };
}

function requestId(): `library_browse_request_${string}` {
  return `library_browse_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}
