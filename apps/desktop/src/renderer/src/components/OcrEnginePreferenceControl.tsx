import { useEffect, useRef, useState } from "react";
import type {
  OcrEnginePreference,
  OcrEnginePreferenceRequest,
  OcrEnginePreferenceResult,
  SetOcrEnginePreferenceRequest,
  SetOcrEnginePreferenceResult
} from "@pige/contracts";

type Translate = (key: string) => string;
type Notice = "stale" | "failed" | null;

export interface OcrEnginePreferenceApi {
  readonly ocrEnginePreference: (
    request: OcrEnginePreferenceRequest
  ) => Promise<OcrEnginePreferenceResult>;
  readonly setOcrEnginePreference: (
    request: SetOcrEnginePreferenceRequest
  ) => Promise<SetOcrEnginePreferenceResult>;
}

export function OcrEnginePreferenceControl(props: {
  readonly api: OcrEnginePreferenceApi;
  readonly t: Translate;
}): React.JSX.Element {
  const [summary, setSummary] = useState<Extract<
    OcrEnginePreferenceResult,
    { status: "ready" }
  >["summary"] | null>(null);
  const [draft, setDraft] = useState<OcrEnginePreference>("automatic");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const sequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const selectRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    const requestId = createRequestId();
    void props.api.ocrEnginePreference({ apiVersion: 1, requestId }).then((result) => {
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      if (result.requestId !== requestId || result.status !== "ready") {
        setNotice("failed");
      } else {
        setSummary(result.summary);
        setDraft(result.summary.preference);
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

  const update = async (preference: OcrEnginePreference): Promise<void> => {
    const current = summary;
    if (!current || pending) return;
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    setDraft(preference);
    setPending(true);
    setNotice(null);
    try {
      const requestId = createRequestId();
      const result = await props.api.setOcrEnginePreference({
        apiVersion: 1,
        requestId,
        expectedRevision: current.revision,
        preference
      });
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      if (result.requestId !== requestId) {
        setNotice("failed");
      } else if (result.status === "failed") {
        setNotice("failed");
      } else {
        setSummary(result.summary);
        setDraft(result.summary.preference);
        setNotice(result.status === "stale" ? "stale" : null);
      }
    } catch {
      if (mountedRef.current && sequence === sequenceRef.current) setNotice("failed");
    } finally {
      if (mountedRef.current && sequence === sequenceRef.current) {
        setPending(false);
        window.setTimeout(() => selectRef.current?.focus(), 0);
      }
    }
  };

  return (
    <div className="settings-row tall" data-ocr-engine-preference={draft}>
      <div className="settings-row-copy">
        <strong>{props.t("capabilities.ocrEngine.title")}</strong>
        <span id="capabilities-ocr-engine-description">
          {props.t("capabilities.ocrEngine.description")}
        </span>
      </div>
      <div className="settings-row-control">
        <select
          ref={selectRef}
          className="settings-select"
          aria-label={props.t("capabilities.ocrEngine.title")}
          aria-describedby={`capabilities-ocr-engine-description${notice ? " capabilities-ocr-engine-notice" : ""}`}
          disabled={loading || pending || !summary}
          value={draft}
          onChange={(event) => void update(event.target.value as OcrEnginePreference)}
        >
          <option value="automatic">{props.t("capabilities.ocrEngine.automatic")}</option>
          <option value="platform_native">{props.t("capabilities.ocrEngine.platformNative")}</option>
          <option value="paddleocr_local">{props.t("capabilities.ocrEngine.paddle")}</option>
        </select>
      </div>
      {notice ? (
        <p
          className="settings-inline-status error"
          id="capabilities-ocr-engine-notice"
          role={notice === "failed" ? "alert" : "status"}
          aria-live="polite"
        >
          {props.t(`capabilities.ocrEngine.notice.${notice}`)}
        </p>
      ) : null}
    </div>
  );
}

function createRequestId(): `ocrenginereq_${string}` {
  return `ocrenginereq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}
