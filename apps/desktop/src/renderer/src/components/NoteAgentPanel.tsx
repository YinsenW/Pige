import {
  useEffect,
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
  readonly title: string;
  readonly description: string;
  readonly removed: string;
  readonly added: string;
  readonly state: "ready" | "resolving";
};

export type NoteAgentModelOption = {
  readonly id: string;
  readonly name: string;
  readonly providerName?: string;
  readonly selected: boolean;
  readonly ready: boolean;
};

export type NoteAgentModelEgressPrompt =
  | { readonly kind: "loading" | "unknown" }
  | {
      readonly kind: "ready" | "resolving";
      readonly reasonMessageKey: string;
      readonly errorMessageKey?: string;
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
  readonly modelEgressPrompt?: NoteAgentModelEgressPrompt | null;
  readonly onClose: () => void;
  readonly onDraftChange: (value: string) => void;
  readonly onSubmit?: () => void;
  readonly onCancel?: () => void;
  readonly onRetry?: () => void;
  readonly onAttach?: () => void;
  readonly onOpenModels?: (opener: HTMLButtonElement) => void;
  readonly onSelectModel?: (modelId: string) => Promise<boolean>;
  readonly onModelEgressDecision?: (decision: "allow_once" | "deny") => void;
  readonly onOpenCitation?: (pageId: string) => void;
  readonly onCopyMessage?: (messageId: string) => void;
  readonly onProposalAction?: (proposalId: string, action: "reject" | "later" | "apply") => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const paneRef = useRef<HTMLElement | null>(null);
  const modelSwitcherRef = useRef<HTMLButtonElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const modelOptionRefs = useRef(new Map<string, HTMLButtonElement>());
  const composingRef = useRef(false);
  const compositionRaceRef = useRef(false);
  const compositionTimerRef = useRef<number | undefined>(undefined);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSwitchFailed, setModelSwitchFailed] = useState(false);

  const selectedModel = props.models.find((model) => model.selected);
  const modelName = selectedModel?.name ?? props.t("note.agentOpenModels");
  const composerReady = props.composerDisabled !== true && props.availability === "ready" && selectedModel?.ready === true;
  const submitReady = composerReady && props.draft.trim().length > 0 && props.onSubmit !== undefined;

  useEffect(() => {
    if (!props.modal) return;
    const frame = window.requestAnimationFrame(() => focusFirstControl(paneRef.current));
    return () => window.cancelAnimationFrame(frame);
  }, [props.modal]);

  useEffect(() => () => {
    if (compositionTimerRef.current !== undefined) window.clearTimeout(compositionTimerRef.current);
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

        <div className="note-agent-thread" aria-busy={props.availability === "running"}>
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
              {props.messages.map((message) => (
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
                        aria-label={props.t("note.agentCopy")}
                        disabled={!props.onCopyMessage}
                        onClick={() => props.onCopyMessage?.(message.id)}
                      >
                        <PigeIcon name="copy" size={16} />
                      </button>
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
              ))}
              {props.proposal ? (
                <section className="proposal-panel" aria-label={props.t("note.proposalTitle")} aria-busy={props.proposal.state === "resolving"}>
                  <h2>{props.proposal.title}</h2>
                  <p>{props.proposal.description}</p>
                  <div className="diff-preview">
                    <div className="diff-line remove">− {props.proposal.removed}</div>
                    <div className="diff-line add">+ {props.proposal.added}</div>
                  </div>
                  <div className="proposal-actions">
                    {(["reject", "later", "apply"] as const).map((action) => (
                      <button
                        key={action}
                        className={action === "apply" ? "primary-button" : "quiet-button"}
                        type="button"
                        disabled={props.proposal?.state === "resolving" || !props.onProposalAction}
                        onClick={() => props.proposal && props.onProposalAction?.(props.proposal.id, action)}
                      >
                        {props.t(`note.proposal.${action}`)}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          )}

          {props.modelEgressPrompt ? (
            <div className="model-egress-prompt note-agent-egress-prompt" role="group" aria-labelledby="note-agent-egress-title">
              <strong id="note-agent-egress-title">{props.t("home.modelEgress.title")}</strong>
              <span>
                {props.modelEgressPrompt.kind === "ready" || props.modelEgressPrompt.kind === "resolving"
                  ? props.t(props.modelEgressPrompt.reasonMessageKey)
                  : props.t(props.modelEgressPrompt.kind === "unknown"
                    ? "home.modelEgress.unknown"
                    : "home.modelEgress.loading")}
              </span>
              {props.modelEgressPrompt.kind === "ready" && props.modelEgressPrompt.errorMessageKey ? (
                <span className="error">{props.t(props.modelEgressPrompt.errorMessageKey)}</span>
              ) : null}
              {props.modelEgressPrompt.kind === "ready" || props.modelEgressPrompt.kind === "resolving" ? (
                <div className="model-egress-actions">
                  <button
                    className="ghost"
                    type="button"
                    disabled={props.modelEgressPrompt.kind === "resolving"}
                    onClick={() => props.onModelEgressDecision?.("deny")}
                  >
                    {props.t("home.modelEgress.deny")}
                  </button>
                  <button
                    type="button"
                    disabled={props.modelEgressPrompt.kind === "resolving"}
                    onClick={() => props.onModelEgressDecision?.("allow_once")}
                  >
                    {props.modelEgressPrompt.kind === "resolving"
                      ? props.t("home.modelEgress.saving")
                      : props.t("home.modelEgress.allowOnce")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : props.availability === "running" ? (
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
