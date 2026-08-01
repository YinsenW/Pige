import { useEffect, useRef, useState } from "react";
import type { AgentSaveAnswerAsNoteRequest } from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";

type SaveState = "idle" | "saving" | "saved" | "stale" | "failed";
type CopyState = "idle" | "copying" | "copied" | "failed";

export function ConversationMessageActions(props: {
  readonly messageId: string;
  readonly markdown: string;
  readonly save?: {
    readonly activeVaultId: string;
    readonly conversationId: string;
    readonly assistantEventId: string;
    readonly onSaved?: (pageId: string) => void;
  };
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const copySequenceRef = useRef(0);
  const copyResetTimerRef = useRef<number | undefined>(undefined);
  const saveSequenceRef = useRef(0);
  const requestIdRef = useRef<string | null>(null);
  const saveIdentity = props.save
    ? `${props.save.activeVaultId}:${props.save.conversationId}:${props.save.assistantEventId}`
    : "copy-only";

  useEffect(() => {
    saveSequenceRef.current += 1;
    requestIdRef.current = null;
    setSaveState("idle");
  }, [saveIdentity]);

  useEffect(() => () => {
    if (copyResetTimerRef.current !== undefined) window.clearTimeout(copyResetTimerRef.current);
  }, []);

  const copy = async (): Promise<void> => {
    const sequence = copySequenceRef.current + 1;
    copySequenceRef.current = sequence;
    if (copyResetTimerRef.current !== undefined) window.clearTimeout(copyResetTimerRef.current);
    setCopyState("copying");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(props.markdown);
      if (sequence !== copySequenceRef.current) return;
      setCopyState("copied");
      copyResetTimerRef.current = window.setTimeout(() => {
        if (sequence === copySequenceRef.current) setCopyState("idle");
      }, 1_800);
    } catch {
      if (sequence === copySequenceRef.current) setCopyState("failed");
    }
  };

  const save = async (): Promise<void> => {
    if (!props.save || saveState === "saving" || saveState === "saved") return;
    const sequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = sequence;
    requestIdRef.current ??= createRequestId();
    const request: AgentSaveAnswerAsNoteRequest = {
      apiVersion: 1,
      requestId: requestIdRef.current,
      activeVaultId: props.save.activeVaultId,
      conversationId: props.save.conversationId,
      assistantEventId: props.save.assistantEventId
    };
    setSaveState("saving");
    try {
      const result = await window.pige.agent.saveAnswerAsNote(request);
      if (sequence !== saveSequenceRef.current) return;
      if (result.status === "saved") {
        setSaveState("saved");
        props.save.onSaved?.(result.pageId);
      } else {
        setSaveState(result.status === "stale" ? "stale" : "failed");
      }
    } catch {
      if (sequence === saveSequenceRef.current) setSaveState("failed");
    }
  };

  const copyLabel = copyState === "copied"
    ? props.t("home.messageCopied")
    : copyState === "failed"
      ? props.t("home.messageCopyFailed")
      : props.t("home.copyMessage");
  const saveLabel = saveState === "saving"
    ? props.t("home.saveAnswerSaving")
    : saveState === "saved"
      ? props.t("home.saveAnswerSaved")
      : saveState === "stale"
        ? props.t("home.saveAnswerStale")
        : saveState === "failed"
          ? props.t("home.saveAnswerFailed")
          : props.t("home.saveAnswer");

  return (
    <div className="conversation-message-actions">
      <button
        type="button"
        data-conversation-action="copy"
        title={copyLabel}
        aria-label={copyLabel}
        aria-busy={copyState === "copying"}
        disabled={copyState === "copying"}
        onClick={() => void copy()}
      >
        <PigeIcon
          name={copyState === "copied" ? "check" : copyState === "copying" ? "loading" : "copy"}
          size={15}
          className={copyState === "copying" ? "spinning" : undefined}
        />
      </button>
      {props.save ? (
        <button
          type="button"
          data-conversation-action="save-answer"
          title={saveLabel}
          aria-label={saveLabel}
          aria-busy={saveState === "saving"}
          disabled={saveState === "saving" || saveState === "saved"}
          onClick={() => void save()}
        >
          <PigeIcon
            name={saveState === "saved" ? "check" : saveState === "saving" ? "loading" : "fileText"}
            size={15}
            className={saveState === "saving" ? "spinning" : undefined}
          />
        </button>
      ) : null}
      {copyState === "copied" || copyState === "failed" ? (
        <span className="visually-hidden" role="status" aria-live="polite">{copyLabel}</span>
      ) : null}
      {saveState !== "idle" && saveState !== "saving" ? (
        <span className="visually-hidden" role="status" aria-live="polite">{saveLabel}</span>
      ) : null}
    </div>
  );
}

function createRequestId(): string {
  return `answersavereq_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}
