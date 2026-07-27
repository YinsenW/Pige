import type { IpcMain, WebContents } from "electron";
import type {
  TaskInteractionChangedEvent,
  TaskInteractionOpenRequest,
  TaskInteractionOpenResult,
  TaskInteractionPendingResult
} from "@pige/contracts";
import {
  TaskInteractionChangedEventSchema,
  TaskInteractionOpenRequestSchema,
  TaskInteractionOpenResultSchema,
  TaskInteractionPendingResultSchema
} from "@pige/schemas";

type Awaitable<T> = T | Promise<T>;

export interface RegisterTaskExecutionIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly readInteraction: () => Awaitable<TaskInteractionPendingResult>;
  readonly openInteraction: (
    request: TaskInteractionOpenRequest
  ) => Awaitable<TaskInteractionOpenResult>;
  readonly subscribeInteractionChanged: (
    listener: (event: TaskInteractionChangedEvent) => void
  ) => () => void;
}

export function registerTaskExecutionIpc(
  options: RegisterTaskExecutionIpcOptions
): () => void {
  const senders = new Map<number, WebContents>();
  const track = (sender: WebContents): void => {
    if (senders.has(sender.id)) return;
    senders.set(sender.id, sender);
    sender.once("destroyed", () => senders.delete(sender.id));
  };

  options.ipcMain.handle("taskExecution.interaction", async (event) => {
    track(event.sender);
    return TaskInteractionPendingResultSchema.parse(await options.readInteraction());
  });

  options.ipcMain.handle("taskExecution.openInteraction", async (event, request: unknown) => {
    track(event.sender);
    const parsed = TaskInteractionOpenRequestSchema.parse(request);
    return TaskInteractionOpenResultSchema.parse(
      await options.openInteraction(parsed)
    );
  });

  return options.subscribeInteractionChanged((event) => {
    const parsed = TaskInteractionChangedEventSchema.parse(event);
    for (const sender of senders.values()) {
      if (!sender.isDestroyed()) sender.send("taskExecution.interactionChanged", parsed);
    }
  });
}
