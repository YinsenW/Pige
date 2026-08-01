export function restoreActivityFocus(operationId: string): void {
  window.setTimeout(() => {
    const redo = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-activity-redo-id]"))
      .find((element) => element.dataset.activityRedoId === operationId && !element.disabled);
    const undo = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-activity-undo-id]"))
      .find((element) => element.dataset.activityUndoId === operationId && !element.disabled);
    const row = Array.from(document.querySelectorAll<HTMLElement>("[data-activity-row-id]"))
      .find((element) => element.dataset.activityRowId === operationId);
    (redo ?? undo ?? row ?? document.querySelector<HTMLElement>("#settings-history-title") ??
      document.querySelector<HTMLTextAreaElement>('[data-home-composer="true"]'))?.focus();
  }, 0);
}

export function restoreActivityOpenFocus(operationId: string): void {
  window.setTimeout(() => {
    const open = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-activity-open-id]"))
      .find((element) => element.dataset.activityOpenId === operationId && !element.disabled);
    const row = Array.from(document.querySelectorAll<HTMLElement>("[data-activity-row-id]"))
      .find((element) => element.dataset.activityRowId === operationId);
    (open ?? row)?.focus();
  }, 0);
}

export function restoreKnowledgeTreeFocus(focusKey: string | null): void {
  window.setTimeout(() => {
    const exact = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-knowledge-open-key]"))
      .find((element) => element.dataset.knowledgeOpenKey === focusKey && !element.disabled);
    (exact ?? document.querySelector<HTMLElement>("#knowledge-tree-heading"))?.focus();
  }, 0);
}
