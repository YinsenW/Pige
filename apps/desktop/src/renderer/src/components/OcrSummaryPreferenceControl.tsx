import { useEffect, useRef, useState } from "react";
import type {
  OcrSummaryPreferenceRequest,
  OcrSummaryPreferenceResult,
  SetOcrSummaryPreferenceRequest,
  SetOcrSummaryPreferenceResult
} from "@pige/contracts";

type Translate = (key: string) => string;
type Notice = "stale" | "failed" | null;

export interface OcrSummaryPreferenceApi {
  readonly ocrSummaryPreference: (
    request: OcrSummaryPreferenceRequest
  ) => Promise<OcrSummaryPreferenceResult>;
  readonly setOcrSummaryPreference: (
    request: SetOcrSummaryPreferenceRequest
  ) => Promise<SetOcrSummaryPreferenceResult>;
}

export function OcrSummaryPreferenceControl(props: {
  readonly api: OcrSummaryPreferenceApi;
  readonly t: Translate;
}): React.JSX.Element {
  const [summary, setSummary] = useState<Extract<
    OcrSummaryPreferenceResult,
    { status: "ready" }
  >["summary"] | null>(null);
  const [draft, setDraft] = useState(true);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const sequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const checkboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const sequence = ++sequenceRef.current;
    const requestId = createRequestId();
    void props.api.ocrSummaryPreference({ apiVersion: 1, requestId }).then((result) => {
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      if (result.requestId !== requestId || result.status !== "ready") {
        setNotice("failed");
      } else {
        setSummary(result.summary);
        setDraft(result.summary.excludeLowConfidenceOcr);
        setNotice(null);
      }
      setLoading(false);
    }).catch(() => {
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      setNotice("failed");
      setLoading(false);
    });
    return () => {
      mountedRef.current = false;
      sequenceRef.current += 1;
    };
  }, [props.api]);

  const update = async (excludeLowConfidenceOcr: boolean): Promise<void> => {
    const current = summary;
    if (!current || pending) return;
    const sequence = ++sequenceRef.current;
    setDraft(excludeLowConfidenceOcr);
    setPending(true);
    setNotice(null);
    try {
      const requestId = createRequestId();
      const result = await props.api.setOcrSummaryPreference({
        apiVersion: 1,
        requestId,
        expectedRevision: current.revision,
        excludeLowConfidenceOcr
      });
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      if (result.requestId !== requestId || result.status === "failed") {
        setNotice("failed");
      } else {
        setSummary(result.summary);
        setDraft(result.summary.excludeLowConfidenceOcr);
        setNotice(result.status === "stale" ? "stale" : null);
      }
    } catch {
      if (mountedRef.current && sequence === sequenceRef.current) setNotice("failed");
    } finally {
      if (mountedRef.current && sequence === sequenceRef.current) {
        setPending(false);
        window.setTimeout(() => checkboxRef.current?.focus(), 0);
      }
    }
  };

  return (
    <div className="settings-row tall" data-ocr-summary-preference={draft ? "exclude" : "include"}>
      <div className="settings-row-copy">
        <strong>{props.t("capabilities.ocrSummary.title")}</strong>
        <span id="capabilities-ocr-summary-description">
          {props.t("capabilities.ocrSummary.description")}
        </span>
      </div>
      <div className="settings-row-control">
        <label>
          <input
            ref={checkboxRef}
            type="checkbox"
            aria-describedby={`capabilities-ocr-summary-description${notice ? " capabilities-ocr-summary-notice" : ""}`}
            checked={draft}
            disabled={loading || pending || !summary}
            onChange={(event) => void update(event.currentTarget.checked)}
          />
          {props.t("capabilities.ocrSummary.checkbox")}
        </label>
      </div>
      {notice ? (
        <p
          className="settings-inline-status error"
          id="capabilities-ocr-summary-notice"
          role={notice === "failed" ? "alert" : "status"}
          aria-live="polite"
        >
          {props.t(`capabilities.ocrSummary.notice.${notice}`)}
        </p>
      ) : null}
    </div>
  );
}

function createRequestId(): `ocrsummaryreq_${string}` {
  return `ocrsummaryreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}
