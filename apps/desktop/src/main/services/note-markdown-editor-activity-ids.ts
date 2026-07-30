import { createHash } from "node:crypto";

export function createUserPageUpdateUndoOperationId(operationId: string): string {
  return createActivityOperationId(operationId, "undo");
}

export function createUserPageUpdateRedoOperationId(operationId: string): string {
  return createActivityOperationId(operationId, "redo");
}

function createActivityOperationId(operationId: string, action: "undo" | "redo"): string {
  const dateKey = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(operationId)?.[1];
  if (!dateKey) throw new Error("The Markdown Activity operation identity is invalid.");
  const suffix = createHash("sha256")
    .update(`pige.note-markdown-editor.${action}.v1\0${operationId}`, "utf8")
    .digest("hex").slice(0, 16);
  return `op_${dateKey}_${suffix}`;
}
