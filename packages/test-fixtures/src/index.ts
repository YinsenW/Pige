import type { FixtureManifest } from "@pige/schemas";

export * from "./agent-ingest-eval";
export * from "./retrieval-eval";

export function createEmptyFixtureManifest(): FixtureManifest {
  return {
    schemaVersion: 1,
    fixtures: []
  };
}
