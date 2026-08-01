import { useRef, useState } from "react";
import type { OcrImageTestRequest, OcrImageTestResult } from "@pige/contracts";

export interface OcrImageTestApi {
  readonly testOcrImage: (request: OcrImageTestRequest) => Promise<OcrImageTestResult>;
}

export function OcrImageTestControl(props: {
  readonly api: OcrImageTestApi;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const activeRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<OcrImageTestResult | null>(null);

  const run = async (): Promise<void> => {
    if (activeRef.current) return;
    const request: OcrImageTestRequest = {
      apiVersion: 1,
      requestId: `ocrimagetest_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`
    };
    activeRef.current = true;
    setPending(true);
    setResult(null);
    try {
      setResult(await props.api.testOcrImage(request));
    } catch {
      setResult({
        apiVersion: 1,
        requestId: request.requestId,
        status: "failed"
      });
    } finally {
      activeRef.current = false;
      setPending(false);
    }
  };

  return <>
    <div className="settings-row tall" data-ocr-image-test>
      <div className="settings-row-copy">
        <strong>{props.t("capabilities.ocrTest.title")}</strong>
        <span>{props.t("capabilities.ocrTest.description")}</span>
      </div>
      <button className="settings-button" type="button" disabled={pending} onClick={() => void run()}>
        {props.t(pending ? "capabilities.ocrTest.running" : "capabilities.ocrTest.choose")}
      </button>
    </div>
    {result?.status === "ready" ? <div className="settings-inline-status" role="status" aria-live="polite">
      <strong>{props.t("capabilities.ocrTest.ready")}</strong>
      <span>{result.preview.engine} · {result.preview.blockCount} {props.t("capabilities.ocrTest.blocks")}</span>
      {result.preview.text ? <pre className="ocr-test-preview" tabIndex={0}>{result.preview.text}</pre> : <span>{props.t("capabilities.ocrTest.empty")}</span>}
      {result.preview.truncated ? <span>{props.t("capabilities.ocrTest.truncated")}</span> : null}
    </div> : result && result.status !== "cancelled" ? <p className="settings-inline-status error" role="alert">
      {props.t(`capabilities.ocrTest.${result.status}`)}
    </p> : null}
  </>;
}
