import type {
  App,
  Details as ChildProcessGoneDetails,
  Event as ElectronEvent,
  RenderProcessGoneDetails,
  WebContents
} from "electron";
import type { DiagnosticEvent } from "./diagnostics-service";

export interface DiagnosticsRuntimeFaultSink {
  readonly recordEvent: (event: DiagnosticEvent) => void;
}

export interface DiagnosticsRuntimeFaultObserverOptions {
  readonly app: App;
  readonly process: NodeJS.Process;
  readonly diagnostics: DiagnosticsRuntimeFaultSink;
}

export function installDiagnosticsRuntimeFaultObserver(
  options: DiagnosticsRuntimeFaultObserverOptions
): () => void {
  const record = (event: DiagnosticEvent): void => {
    try {
      options.diagnostics.recordEvent(event);
    } catch {
      // A diagnostics failure must never replace or recursively amplify the runtime fault.
    }
  };
  const onMainFault = (_error: unknown, origin: NodeJS.UncaughtExceptionOrigin): void => {
    record({
      level: "error",
      code: "runtime.main_process_fault",
      message: "The Main process encountered an unhandled runtime fault.",
      redactedDetails: {
        kind: origin === "unhandledRejection" ? "unhandled_rejection" : "uncaught_exception"
      }
    });
  };
  const onRendererGone = (
    _event: ElectronEvent,
    _webContents: WebContents,
    details: RenderProcessGoneDetails
  ): void => {
    if (details.reason === "clean-exit") return;
    record({
      level: "error",
      code: "runtime.renderer_process_gone",
      message: "A renderer process stopped unexpectedly.",
      redactedDetails: { kind: details.reason, exitCode: normalizeExitCode(details.exitCode) }
    });
  };
  const onChildGone = (_event: ElectronEvent, details: ChildProcessGoneDetails): void => {
    if (details.reason === "clean-exit") return;
    record({
      level: "error",
      code: "runtime.child_process_gone",
      message: "A child process stopped unexpectedly.",
      redactedDetails: {
        kind: details.reason,
        type: normalizeChildType(details.type),
        exitCode: normalizeExitCode(details.exitCode)
      }
    });
  };

  options.process.on("uncaughtExceptionMonitor", onMainFault);
  options.app.on("render-process-gone", onRendererGone);
  options.app.on("child-process-gone", onChildGone);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    options.process.off("uncaughtExceptionMonitor", onMainFault);
    options.app.off("render-process-gone", onRendererGone);
    options.app.off("child-process-gone", onChildGone);
  };
}

function normalizeExitCode(value: number): number {
  return Number.isSafeInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647 ? value : 0;
}

function normalizeChildType(value: ChildProcessGoneDetails["type"]): string {
  return value.toLowerCase().replaceAll(" ", "_");
}
