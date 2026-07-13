import { describe, expect, it } from "vitest";
import { DatasetIngestWorkerService } from "../../apps/desktop/src/main/services/dataset-ingest-worker-service";
import { OfficeMediaMaterializerWorkerAdapter } from "../../apps/desktop/src/main/services/office-media-materializer-service";
import { OfficeParserWorkerAdapter } from "../../apps/desktop/src/main/services/office-parser-service";

describe("Bundled worker availability", () => {
  it("resolves public package entries when package metadata is not exported", () => {
    const requested: string[] = [];
    const resolveModule = (moduleId: string): string => {
      requested.push(moduleId);
      if (moduleId === "fast-xml-parser/package.json") {
        throw Object.assign(new Error("Package subpath is not exported"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
      }
      return `/synthetic/node_modules/${moduleId}`;
    };

    expect(new DatasetIngestWorkerService(undefined, undefined, resolveModule).isAvailable()).toBe(true);
    expect(new OfficeParserWorkerAdapter(undefined, undefined, resolveModule).isAvailable()).toBe(true);
    expect(new OfficeMediaMaterializerWorkerAdapter(undefined, undefined, resolveModule).isAvailable()).toBe(true);
    expect(requested).toContain("fast-xml-parser");
    expect(requested).not.toContain("fast-xml-parser/package.json");
  });

  it("recognizes the installed worker dependencies from the assembled main-process location", () => {
    expect(new DatasetIngestWorkerService().isAvailable()).toBe(true);
    expect(new OfficeParserWorkerAdapter().isAvailable()).toBe(true);
    expect(new OfficeMediaMaterializerWorkerAdapter().isAvailable()).toBe(true);
  });
});
