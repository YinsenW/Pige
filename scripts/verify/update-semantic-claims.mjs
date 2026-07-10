import fs from "node:fs";
import path from "node:path";
import { createSemanticClaimLedger } from "./traceability.mjs";

const root = process.cwd();
const outputPath = path.join(root, "resources/traceability/semantic-claims.manifest.json");

if (!process.argv.includes("--accept-semantic-change")) {
  console.error("Refusing to rewrite the independent semantic-claims lock without --accept-semantic-change.");
  console.error("Review the locked PRD contract sections, P0 scope, Requirement, capability, Build, Exit, Deferred, phase-state, evidence, and open-gap diff together before accepting it.");
  process.exit(1);
}

const ledger = createSemanticClaimLedger(root);
fs.writeFileSync(outputPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
console.log(`Updated ${path.relative(root, outputPath)} with ${ledger.claimCount} independently keyed per-claim digests after explicit semantic-change acceptance.`);
