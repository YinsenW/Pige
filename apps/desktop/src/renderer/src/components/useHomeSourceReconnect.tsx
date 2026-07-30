import { useEffect, useRef, useState } from "react";
import type { JobSummary } from "@pige/contracts";
import { SourceRelinkChangedDialog, type SourceRelinkChangedPreview } from "./SourceRelinkChangedDialog";

export function useHomeSourceReconnect(input: {
  readonly activeVaultId: string | undefined;
  readonly recentJobs: readonly JobSummary[];
  readonly onHomeStateChanged: () => Promise<void>;
  readonly t: (key: string) => string;
}) {
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ readonly kind: "status" | "error"; readonly key: string } | null>(null);
  const [changed, setChanged] = useState<{ readonly job: JobSummary; readonly preview: SourceRelinkChangedPreview & { readonly previewId: string } } | null>(null);
  const sequenceRef = useRef(0);
  const activeRef = useRef<{ readonly sequence: number; readonly activeVaultId: string; readonly waitingJobId: string; readonly expectedJobUpdatedAt: string } | null>(null);
  const vaultRef = useRef(input.activeVaultId);
  const jobsRef = useRef(input.recentJobs);
  vaultRef.current = input.activeVaultId;
  jobsRef.current = input.recentJobs;
  useEffect(() => {
    sequenceRef.current += 1;
    activeRef.current = null;
    setChanged(null);
    setPendingJobId(null);
    setNotice(null);
  }, [input.activeVaultId]);

  const reconnect = async (job: JobSummary, previewId?: string): Promise<void> => {
    const activeVaultId = vaultRef.current;
    if (!activeVaultId || job.canReconnectDependency !== true || activeRef.current) return;
    const identity = { sequence: ++sequenceRef.current, activeVaultId, waitingJobId: job.id, expectedJobUpdatedAt: job.updatedAt };
    activeRef.current = identity;
    setPendingJobId(job.id);
    setNotice({ kind: "status", key: "home.reconnectOriginalSourceChecking" });
    try {
      const result = await window.pige.jobs.reconnectOriginalSource({
        apiVersion: 1,
        requestId: `sourcereconnectreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
        activeVaultId,
        waitingJobId: job.id,
        expectedJobUpdatedAt: job.updatedAt,
        ...(previewId ? { previewId } : {})
      });
      const currentJob = jobsRef.current.find((candidate) => candidate.id === job.id);
      if (activeRef.current !== identity || vaultRef.current !== activeVaultId || currentJob?.updatedAt !== job.updatedAt ||
        result.activeVaultId !== activeVaultId || result.waitingJobId !== job.id || result.expectedJobUpdatedAt !== job.updatedAt) {
        if (activeRef.current === identity) setNotice(null);
        return;
      }
      if (result.status === "reconnected") {
        setChanged(null);
        setNotice({ kind: "status", key: "home.reconnectOriginalSourceResolved" });
        await input.onHomeStateChanged().catch(() => undefined);
      } else if (result.status === "changed") {
        setChanged({ job, preview: result.preview });
        setNotice(null);
      } else if (result.status === "cancelled") setNotice(null);
      else if (result.status === "stale" || result.status === "not_found") {
        setNotice({ kind: "error", key: "home.reconnectOriginalSourceStale" });
      } else setNotice({ kind: "error", key: "home.reconnectOriginalSourceFailed" });
    } catch {
      if (activeRef.current === identity && vaultRef.current === activeVaultId) {
        setNotice({ kind: "error", key: "home.reconnectOriginalSourceFailed" });
      }
    } finally {
      if (activeRef.current === identity) {
        activeRef.current = null;
        setPendingJobId(null);
      }
    }
  };

  return {
    pendingJobId,
    notice,
    reconnect,
    dialog: changed ? <SourceRelinkChangedDialog preview={changed.preview} pending={pendingJobId !== null} t={input.t}
      onCancel={() => setChanged(null)} onConfirm={() => void reconnect(changed.job, changed.preview.previewId)} /> : null
  };
}
