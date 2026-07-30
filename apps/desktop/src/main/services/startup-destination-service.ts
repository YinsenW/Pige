import {
  StartupDestinationMutationResultSchema,
  StartupDestinationSummarySchema,
  type SetStartupDestinationRequest,
  type StartupDestinationMutationResult,
  type StartupDestinationSummary
} from "@pige/schemas";
import { LocalSettingsStore } from "./local-settings";

export class StartupDestinationService {
  readonly #settings: LocalSettingsStore;

  constructor(settings: LocalSettingsStore) {
    this.#settings = settings;
  }

  summary(): StartupDestinationSummary {
    return project(this.#settings.getStartupDestinationSettings());
  }

  set(request: SetStartupDestinationRequest): StartupDestinationMutationResult {
    try {
      const result = this.#settings.mutateStartupDestinationSettings(
        request.expectedRevision,
        request.destination
      );
      return StartupDestinationMutationResultSchema.parse({
        status: result.status,
        summary: project(result.settings)
      });
    } catch {
      try {
        return StartupDestinationMutationResultSchema.parse({
          status: "failed",
          summary: this.summary()
        });
      } catch {
        return { status: "failed" };
      }
    }
  }
}

function project(settings: { readonly revision: number; readonly destination: "home" | "library" }): StartupDestinationSummary {
  return StartupDestinationSummarySchema.parse({ apiVersion: 1, ...settings });
}
