import { useEffect, useRef } from "react";
import type { ReaderSelectionCreatePageAction } from "@pige/contracts";

const actions: readonly ReaderSelectionCreatePageAction[] = [
  "create_note", "create_claim", "create_question", "create_concept", "create_entity", "create_topic"
];
const labelKeys: Record<ReaderSelectionCreatePageAction, string> = {
  create_note: "note.selection.createNote",
  create_claim: "note.selection.createClaim",
  create_question: "note.selection.createQuestion",
  create_concept: "note.selection.createConcept",
  create_entity: "note.selection.createEntity",
  create_topic: "note.selection.createTopic"
};

export function ReaderSelectionCreateChooser(props: {
  readonly ownerIdentity: string;
  readonly onChoose: (action: ReaderSelectionCreatePageAction) => void;
  readonly onCancel: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLElement>(null); const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { firstRef.current?.focus({ preventScroll: true }); }, [props.ownerIdentity]);
  const cancel = (): void => props.onCancel();
  return <div className="confirmation-backdrop"><section ref={dialogRef} className="confirmation-dialog" role="dialog" aria-modal="true"
    aria-labelledby="reader-selection-create-title" aria-describedby="reader-selection-create-description"
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel(); return; } if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []); const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) return event.preventDefault(); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }}>
    <div className="confirmation-copy"><h2 id="reader-selection-create-title">{props.t("note.selection.turnInto")}</h2>
      <p id="reader-selection-create-description">{props.t("note.selection.turnIntoDescription")}</p></div>
    <div className="confirmation-actions">{actions.map((action, index) => <button ref={index === 0 ? firstRef : undefined} key={action} type="button" className="secondary"
      data-selection-create-action={action} onClick={() => props.onChoose(action)}>{props.t(labelKeys[action])}</button>)}
      <button type="button" className="secondary" onClick={cancel}>{props.t("note.selection.turnIntoCancel")}</button></div>
  </section></div>;
}
