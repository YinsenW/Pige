import fs from "node:fs";
import path from "node:path";

export function markSourceAsLegacyAgentIngestFixture(vaultPath: string, sourceId: string): void {
  const root = path.join(vaultPath, ".pige", "source-records");
  const sourceRecordPath = findNamedFile(root, `${sourceId}.json`);
  if (!sourceRecordPath) throw new Error(`Missing legacy SourceRecord fixture for ${sourceId}.`);
  const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
    semanticOrchestration?: unknown;
    metadata: Record<string, unknown>;
  };
  delete sourceRecord.semanticOrchestration;
  delete sourceRecord.metadata.semanticOrchestration;
  fs.writeFileSync(sourceRecordPath, `${JSON.stringify(sourceRecord, null, 2)}\n`, "utf8");
}

function findNamedFile(root: string, name: string): string | undefined {
  if (!fs.existsSync(root)) return undefined;
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && entry.name === name) return candidate;
    }
  }
  return undefined;
}
