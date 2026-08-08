import { useEffect, useRef } from "react";
import type { PaddleOcrSummary } from "@pige/contracts";

type PaddleOcrPollState = {
  readonly jobId: string;
  attempts: number;
};

type ReadSummary = (
  sequence: number,
  minimumRevision?: number
) => Promise<PaddleOcrSummary | null>;

type MutableValue<T> = { current: T };

export function usePaddleOcrPolling({
  summary,
  readSummary,
  requestSequenceRef,
  onPollLimit
}: {
  readonly summary: PaddleOcrSummary | null;
  readonly readSummary: ReadSummary;
  readonly requestSequenceRef: MutableValue<number>;
  readonly onPollLimit: () => void;
}): void {
  const pollActiveRef = useRef(false);
  const pollStateRef = useRef<PaddleOcrPollState | null>(null);

  useEffect(() => {
    if (!summary?.activeAction || !summary.activeJobId) {
      pollStateRef.current = null;
      return;
    }
    if (pollStateRef.current?.jobId !== summary.activeJobId) {
      pollStateRef.current = { jobId: summary.activeJobId, attempts: 0 };
    }
    const timer = window.setInterval(() => {
      const pollState = pollStateRef.current;
      if (
        !pollState
        || pollState.jobId !== summary.activeJobId
        || pollActiveRef.current
      ) return;
      pollState.attempts += 1;
      if (pollState.attempts > 60) {
        window.clearInterval(timer);
        onPollLimit();
        return;
      }
      const sequence = requestSequenceRef.current + 1;
      requestSequenceRef.current = sequence;
      pollActiveRef.current = true;
      void readSummary(sequence, summary.revision).finally(() => {
        pollActiveRef.current = false;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [onPollLimit, readSummary, requestSequenceRef, summary?.activeAction, summary?.activeJobId, summary?.revision]);

  useEffect(() => () => {
    pollActiveRef.current = false;
    pollStateRef.current = null;
  }, []);
}
