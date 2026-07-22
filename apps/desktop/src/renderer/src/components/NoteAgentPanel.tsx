import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { PigeIcon } from "./PigeIcon";
import { ConversationMarkdown } from "./ConversationMarkdown";
import pigeMarkUrl from "../../../../../../resources/brand/pige-icon/master/pige-icon-1024.png";

export type NoteAgentAvailability = "unavailable" | "ready" | "running" | "failed";

export type NoteAgentMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly body: string;
  readonly timestamp?: string;
  readonly provisional?: boolean;
  readonly citations?: readonly {
    readonly pageId: string;
    readonly label: string;
  }[];
};

export type NoteAgentProposal = {
  readonly id: string;
  readonly action: "translate" | "polish" | "expand";
  readonly revision: number;
  readonly lines: readonly {
    readonly kind: "context" | "removed" | "added";
    readonly text: string;
  }[];
  readonly state: "ready" | "resolving" | "applied" | "rejected" | "conflicted";
  readonly errorMessageKey?: string;
};

export type NoteAgentModelOption = {
  readonly id: string;
  readonly name: string;
  readonly providerName?: string;
  readonly selected: boolean;
  readonly ready: boolean;
};

export function NoteAgentPanel(props: {
  readonly modal: boolean;
  readonly noteTitle: string;
  readonly availability: NoteAgentAvailability;
  readonly composerDisabled?: boolean;
  readonly messages: readonly NoteAgentMessage[];
  readonly proposal: NoteAgentProposal | null;
  readonly draft: string;
  readonly models: readonly NoteAgentModelOption[];
  readonly switchingModel: boolean;
  readonly errorMessageKey?: string;
  readonly onClose: () => void;
  readonly onDraftChange: (value: string) => void;
  readonly onSubmit?: () => void;
  readonly onCancel?: () => void;
  readonly onRetry?: () => void;
  readonly onAttach?: () => void;
  readonly onOpenModels?: (opener: HTMLButtonElement) => void;
  readonly onSelectModel?: (modelId: string) => Promise<boolean>;
  readonly onOpenCitation?: (pageId: string) => void;
  readonly onCopyMessage?: (messageId: string) => Promise<boolean> | boolean;
  readonly onProposalAction?: (proposalId: string, action: "reject" | "later" | "apply") => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const paneRef = useRef<HTMLElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const followThreadRef = useRef(true);
  const modelSwitcherRef = useRef<HTMLButtonElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const modelOptionRefs = useRef(new Map<string, HTMLButtonElement>());
  const proposalPanelRef = useRef<HTMLElement | null>(null);
  const previousProposalStateRef = useRef<NoteAgentProposal["state"] | null>(null);
  const composingRef = useRef(false);
  const compositionRaceRef = useRef(false);
  const compositionTimerRef = useRef<number | undefined>(undefined);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSwitchFailed, setModelSwitchFailed] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<{
    readonly messageId: string;
    readonly status: "copying" | "copied" | "failed";
  } | null>(null);
  const copyRequestSequenceRef = useRef(0);

  const selectedModel = props.models.find((model) => model.selected);
  const modelName = selectedModel?.name ?? props.t("note.agentOpenModels");
  const composerReady = props.composerDisabled !== true && props.availability === "ready" && selectedModel?.ready === true;
  const submitReady = composerReady && props.draft.trim().length > 0 && props.onSubmit !== undefined;
  const threadFollowKey = [
    props.messages.length,
    props.messages.at(-1)?.id ?? "none",
    props.messages.at(-1)?.body.length ?? 0,
    props.availability,
    props.proposal?.state ?? "none"
  ].join(":");

  useEffect(() => {
    if (!props.modal) return;
    const frame = window.requestAnimationFrame(() => focusFirstControl(paneRef.current));
    return () => window.cancelAnimationFrame(frame);
  }, [props.modal]);

  useEffect(() => () => {
    if (compositionTimerRef.current !== undefined) window.clearTimeout(compositionTimerRef.current);
    copyRequestSequenceRef.current += 1;
  }, []);

  useEffect(() => {
    if (copyFeedback && !props.messages.some((message) => message.id === copyFeedback.messageId)) {
      copyRequestSequenceRef.current += 1;
      setCopyFeedback(null);
    }
  }, [copyFeedback, props.messages]);

  useEffect(() => {
    const previousState = previousProposalStateRef.current;
    const nextState = props.proposal?.state ?? null;
    previousProposalStateRef.current = nextState;
    if (
      previousState !== null &&
      previousState !== nextState &&
      (nextState === "applied" || nextState === "rejected" || nextState === "conflicted")
    ) {
      window.requestAnimationFrame(() => proposalPanelRef.current?.focus({ preventScroll: true }));
    }
  }, [props.proposal?.state]);

  useLayoutEffect(() => {
    const thread = threadRef.current;
    if (!thread || !followThreadRef.current) return;
    thread.scrollTop = thread.scrollHeight;
  }, [threadFollowKey]);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    const observer = new window.MutationObserver(() => {
      if (followThreadRef.current) thread.scrollTop = thread.scrollHeight;
    });
    observer.observe(thread, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const dismiss = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !modelMenuRef.current?.contains(event.target) &&
        event.target !== modelSwitcherRef.current
      ) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [modelMenuOpen]);

  const closeModelMenu = (restoreFocus: boolean): void => {
    setModelMenuOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => modelSwitcherRef.current?.focus());
  };

  const openModelMenu = (): void => {
    if (props.models.length === 0 || props.switchingModel || props.availability === "unavailable") return;
    setModelSwitchFailed(false);
    setModelMenuOpen(true);
    const focusId = selectedModel?.id ?? props.models[0]?.id;
    window.requestAnimationFrame(() => {
      if (focusId) modelOptionRefs.current.get(focusId)?.focus();
    });
  };

  const moveModelFocus = (delta: 1 | -1): void => {
    const options = props.models
      .map((model) => modelOptionRefs.current.get(model.id))
      .filter((option): option is HTMLButtonElement => option !== undefined);
    if (options.length === 0) return;
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = index < 0 ? (delta === 1 ? 0 : options.length - 1) : (index + delta + options.length) % options.length;
    options[next]?.focus();
  };

  const selectModel = async (modelId: string): Promise<void> => {
    if (!props.onSelectModel || props.switchingModel) return;
    if (modelId === selectedModel?.id) {
      closeModelMenu(true);
      return;
    }
    setModelSwitchFailed(false);
    const changed = await props.onSelectModel(modelId);
    if (changed) closeModelMenu(true);
    else setModelSwitchFailed(true);
  };

  const submit = (): void => {
    if (submitReady) props.onSubmit?.();
  };

  const copyMessage = async (messageId: string): Promise<void> => {
    if (!props.onCopyMessage || (copyFeedback?.messageId === messageId && copyFeedback.status === "copying")) return;
    const requestSequence = copyRequestSequenceRef.current + 1;
    copyRequestSequenceRef.current = requestSequence;
    setCopyFeedback({ messageId, status: "copying" });
    try {
      const copied = await props.onCopyMessage(messageId);
      if (copyRequestSequenceRef.current !== requestSequence) return;
      setCopyFeedback({ messageId, status: copied ? "copied" : "failed" });
    } catch {
      if (copyRequestSequenceRef.current !== requestSequence) return;
      setCopyFeedback({ messageId, status: "failed" });
    }
  };

  return (
    <aside
      ref={paneRef}
      className="note-agent"
      id="note-agent-pane"
      aria-label={props.t("note.agentTitle")}
      aria-modal={props.modal ? "true" : undefined}
      role={props.modal ? "dialog" : undefined}
      onKeyDown={(event) => {
        if (props.modal) containFocus(event, event.currentTarget, props.onClose);
      }}
    >
      <div className="note-agent-inner">
        <header className="note-agent-header">
          <PigeIcon name="file" size={16} />
          <span title={props.noteTitle}>{props.noteTitle}</span>
          <PigeIcon name="collapse" size={14} />
          <button
            className="icon-button"
            type="button"
            aria-label={props.t("note.agentHide")}
            title={props.t("note.agentHide")}
            onClick={props.onClose}
          >
            <PigeIcon name="close" size={17} />
          </button>
        </header>

        <div
          ref={threadRef}
          className="note-agent-thread"
          aria-busy={props.availability === "running"}
          onScroll={(event) => {
            const thread = event.currentTarget;
            followThreadRef.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 48;
          }}
        >
          {props.availability === "unavailable" ? (
            <section className="note-agent-state" role="status" aria-live="polite" aria-atomic="true">
              <img src={pigeMarkUrl} alt="" />
              <strong>{props.t("development.capability.note_agent")}</strong>
              <p>{props.t("development.state.unavailable")}</p>
            </section>
          ) : props.messages.length === 0 && !props.proposal ? (
            props.availability === "ready" ? (
              <section className="note-agent-state note-agent-empty" role="status">
                <img src={pigeMarkUrl} alt="" />
                <strong>{props.t("note.agentTitle")}</strong>
                <p>{props.t("note.agentEmpty")}</p>
              </section>
            ) : null
          ) : (
            <div className="note-agent-messages" aria-label={props.t("note.agentTitle")}>
              {props.messages.map((message) => {
                const messageCopyStatus = copyFeedback?.messageId === message.id ? copyFeedback.status : null;
                const copyLabel = messageCopyStatus === "copying"
                  ? props.t("note.agentCopying")
                  : messageCopyStatus === "copied"
                    ? props.t("note.agentCopied")
                    : messageCopyStatus === "failed"
                      ? props.t("note.agentCopyFailed")
                      : props.t("note.agentCopy");
                return (
                <article
                  className={`agent-message-card role-${message.role}${message.provisional ? " provisional" : ""}`}
                  key={message.id}
                  data-provisional={message.provisional ? "true" : undefined}
                  aria-busy={message.provisional ? "true" : undefined}
                >
                  <span className="agent-message-role visually-hidden">
                    {props.t(message.role === "assistant" ? "note.agentAssistant" : "note.agentUser")}
                  </span>
                  {message.timestamp ? <time className="visually-hidden">{message.timestamp}</time> : null}
                  <ConversationMarkdown
                    markdown={message.body}
                    t={props.t}
                    {...(message.provisional ? { provisional: true } : {})}
                  />
                  {!message.provisional && message.citations?.length ? (
                    <div className="note-agent-citations" aria-label={props.t("note.agentCitations")}>
                      {message.citations.map((citation) => (
                        <button
                          key={citation.pageId}
                          type="button"
                          disabled={!props.onOpenCitation}
                          onClick={() => props.onOpenCitation?.(citation.pageId)}
                        >
                          {citation.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {message.role === "assistant" && !message.provisional ? (
                    <div className="message-actions" aria-label={props.t("note.agentMessageActions")}>
                      <button
                        type="button"
                        aria-label={copyLabel}
                        title={copyLabel}
                        disabled={!props.onCopyMessage || messageCopyStatus === "copying"}
                        onClick={() => void copyMessage(message.id)}
                      >
                        <PigeIcon
                          name={messageCopyStatus === "copied" ? "check" : messageCopyStatus === "copying" ? "loading" : "copy"}
                          size={16}
                          className={messageCopyStatus === "copying" ? "spinning" : undefined}
                        />
                      </button>
                      {messageCopyStatus === "copied" || messageCopyStatus === "failed" ? (
                        <span className={`message-copy-feedback ${messageCopyStatus}`} role="status" aria-live="polite">
                          {copyLabel}
                        </span>
                      ) : null}
                      <button type="button" aria-label={props.t("note.agentHelpful")} disabled>
                        <PigeIcon name="thumbsUp" size={16} />
                      </button>
                      <button type="button" aria-label={props.t("note.agentNotHelpful")} disabled>
                        <PigeIcon name="thumbsDown" size={16} />
                      </button>
                      <button type="button" aria-label={props.t("note.agentMore")} disabled>
                        <PigeIcon name="more" size={16} />
                      </button>
                    </div>
                  ) : null}
                </article>
                );
              })}
              {props.proposal ? (
                <section
                  ref={proposalPanelRef}
                  className={`proposal-panel state-${props.proposal.state}`}
                  aria-labelledby="note-agent-proposal-title"
                  aria-describedby="note-agent-proposal-description"
                  aria-busy={props.proposal.state === "resolving"}
                  tabIndex={-1}
                >
                  <h2 id="note-agent-proposal-title">{props.t(`note.proposal.action.${props.proposal.action}`)}</h2>
                  <p id="note-agent-proposal-description">{props.t("note.proposal.description")}</p>
                  {props.proposal.lines.length > 0 ? (
                    <div className="diff-preview" aria-label={props.t("note.proposal.preview")}>
                      {props.proposal.lines.map((line, index) => (
                        <div className={`diff-line ${line.kind}`} data-kind={line.kind} key={`${line.kind}-${index}`}>
                          <span className="visually-hidden">{props.t(`note.proposal.line.${line.kind}`)}</span>
                          <span aria-hidden="true">{line.kind === "removed" ? "− " : line.kind === "added" ? "+ " : "  "}</span>
                          <span>{line.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {props.proposal.errorMessageKey ? (
                    <p className="proposal-error" role="alert">
                      {props.t(props.proposal.errorMessageKey)}
                    </p>
                  ) : null}
                  {props.proposal.state === "ready" || props.proposal.state === "resolving" ? (
                    <div className="proposal-actions">
                      {(["reject", "later", "apply"] as const).map((action) => (
                        <button
                          key={action}
                          className={action === "apply" ? "primary-button" : "quiet-button"}
                          type="button"
                          disabled={props.proposal?.state === "resolving" || !props.onProposalAction}
                          onClick={() => props.proposal && props.onProposalAction?.(props.proposal.id, action)}
                        >
                          {props.t(props.proposal?.state === "resolving" && action === "apply"
                            ? "note.proposal.resolving"
                            : `note.proposal.${action}`)}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className={`proposal-result ${props.proposal.state}`} role={props.proposal.state === "conflicted" ? "alert" : "status"}>
                      {props.t(`note.proposal.status.${props.proposal.state}`)}
                    </p>
                  )}
                </section>
              ) : null}
            </div>
          )}

          {props.availability === "running" ? (
            <article className="note-agent-run-state note-agent-loading-message role-assistant" role="status" aria-live="polite">
              <span className="agent-message-role visually-hidden">{props.t("note.agentAssistant")}</span>
              <span className="conversation-loading-dots" aria-hidden="true"><i /><i /><i /></span>
              <span className="visually-hidden">{props.t("note.agentWorking")}</span>
              {props.onCancel ? (
                <button type="button" className="quiet-button" onClick={props.onCancel}>
                  {props.t("home.cancelJob")}
                </button>
              ) : null}
            </article>
          ) : props.availability === "failed" ? (
            <div className="note-agent-run-state error" role="alert">
              <span>{props.t(props.errorMessageKey ?? "error.generic")}</span>
              {props.onRetry ? (
                <button type="button" className="quiet-button" onClick={props.onRetry}>
                  {props.t("home.retryJob")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="note-composer-wrap">
          <section className="note-composer" aria-label={props.t("note.agentComposer")}>
            <textarea
              aria-label={props.t("note.agentComposer")}
              placeholder={props.t("note.agentPlaceholder")}
              value={props.draft}
              disabled={props.composerDisabled === true || props.availability === "unavailable" || props.availability === "running"}
              onChange={(event) => props.onDraftChange(event.target.value)}
              onCompositionStart={() => {
                composingRef.current = true;
                compositionRaceRef.current = false;
                if (compositionTimerRef.current !== undefined) window.clearTimeout(compositionTimerRef.current);
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
                compositionRaceRef.current = true;
                compositionTimerRef.current = window.setTimeout(() => {
                  compositionRaceRef.current = false;
                  compositionTimerRef.current = undefined;
                }, 0);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                if (
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229 ||
                  composingRef.current ||
                  compositionRaceRef.current
                ) return;
                event.preventDefault();
                if (!event.repeat) submit();
              }}
            />
            <div className="note-composer-toolbar">
              <button
                className="attach-button"
                type="button"
                aria-label={props.t("home.attachFile")}
                disabled={!props.onAttach || props.availability !== "ready"}
                onClick={props.onAttach}
              >
                <PigeIcon name="attach" size={18} />
              </button>
              <div className="model-switcher-wrap note-agent-model-switcher-wrap">
                <button
                  ref={modelSwitcherRef}
                  className="model-switcher note-agent-model-switcher"
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={modelMenuOpen}
                  aria-controls="note-agent-model-menu"
                  aria-label={`${props.t("note.agentModelSwitcher")}: ${modelName}, ${props.t(selectedModel?.ready ? "note.agentModelConnected" : "note.agentModelUnavailable")}`}
                  disabled={(props.models.length === 0 && !props.onOpenModels) || props.switchingModel || props.availability === "unavailable"}
                  onClick={(event) => {
                    if (props.models.length === 0) {
                      props.onOpenModels?.(event.currentTarget);
                      return;
                    }
                    if (modelMenuOpen) closeModelMenu(true);
                    else openModelMenu();
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                    event.preventDefault();
                    openModelMenu();
                  }}
                >
                  <span className={selectedModel?.ready ? "model-status-dot connected" : "model-status-dot unavailable"} aria-hidden="true" />
                  <span className="model-switcher-name">{modelName}</span>
                  <PigeIcon name="collapse" size={14} />
                </button>
                {modelMenuOpen ? (
                  <div
                    ref={modelMenuRef}
                    className="model-menu note-agent-model-menu"
                    id="note-agent-model-menu"
                    role="listbox"
                    aria-label={props.t("note.agentModelMenu")}
                    aria-busy={props.switchingModel}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        closeModelMenu(true);
                      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        moveModelFocus(event.key === "ArrowDown" ? 1 : -1);
                      }
                    }}
                  >
                    {props.models.map((model) => (
                      <button
                        key={model.id}
                        ref={(element) => {
                          if (element) modelOptionRefs.current.set(model.id, element);
                          else modelOptionRefs.current.delete(model.id);
                        }}
                        className="model-option"
                        type="button"
                        role="option"
                        aria-selected={model.selected}
                        disabled={props.switchingModel}
                        onClick={() => void selectModel(model.id)}
                      >
                        <span className={model.ready ? "model-status-dot connected" : "model-status-dot unavailable"} aria-hidden="true" />
                        <span className="model-option-copy">
                          <strong>{model.name}</strong>
                          <small>{model.providerName ?? props.t(model.ready ? "note.agentModelConnected" : "note.agentModelUnavailable")}</small>
                        </span>
                        <span className="model-option-check" aria-hidden="true">{model.selected ? "✓" : ""}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                className="send-button"
                type="button"
                aria-label={props.t("note.agentSend")}
                disabled={!submitReady}
                onClick={submit}
              >
                <PigeIcon name="send" size={16} />
              </button>
            </div>
            {modelSwitchFailed ? <p className="note-agent-model-error" role="alert">{props.t("note.agentModelSwitchFailed")}</p> : null}
          </section>
        </div>
      </div>
    </aside>
  );
}

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function focusFirstControl(container: HTMLElement | null): void {
  container?.querySelector<HTMLElement>(focusableSelector)?.focus({ preventScroll: true });
}

function containFocus(
  event: ReactKeyboardEvent<HTMLElement>,
  container: HTMLElement,
  onClose: () => void
): void {
  if (event.key === "Escape") {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key !== "Tab") return;
  const controls = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector));
  if (controls.length === 0) return;
  const first = controls[0]!;
  const last = controls[controls.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
