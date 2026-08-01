import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditNoTelemetry } from "./no-telemetry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const privacyStatements = [
  "does not run product analytics, background telemetry, automatic crash upload, or automatic diagnostic upload",
  "Pressing Send transmits the exact user-authored and",
  "URL capture fetches a pasted link and stores the result locally as a source",
  "Model/tool/Apple speech assets download only through explicit flows",
  "Brokered Skill/package `external_network` grants",
  "No diagnostics are uploaded automatically",
  "v0.1 does not include Pige Cloud, mobile apps, cloud sync, remote telemetry, or a hosted Agent backend",
];

const sourceFacts = {
  "apps/desktop/src/main/index.ts": [
    "adapter: new NoNetworkUpdateCheckAdapter()",
  ],
  "apps/desktop/src/main/services/model-provider-connection.ts": [
    "readonly cloudBoundary: CloudBoundary",
    "this.#fetchWithTimeout",
  ],
  "apps/desktop/src/main/services/pi-agent-provider-binding.ts": [
    "ScopedCredentialStore",
    "denyAmbientAuthContext",
    'source: "pige_credential_store"',
  ],
  "apps/desktop/src/main/services/source-fetch-service.ts": [
    '"permissioned_external_network"',
    '"external_network"',
    '"url_fetch.private_network_blocked"',
  ],
  "apps/desktop/src/main/services/external-web-skill-runtime-service.ts": [
    "requiredHttpsOrigin",
    'target: "reviewed_https_origin"',
  ],
  "apps/desktop/src/main/services/local-semantic-retrieval-service.ts": [
    "LocalSemanticRetrievalInstallRequest",
    "ASSET_URL",
  ],
  "apps/desktop/src/main/services/local-reranker-service.ts": [
    "LocalRerankerInstallRequest",
    "ASSET_URL",
  ],
  "apps/desktop/src/main/services/paddle-ocr-lifecycle-service.ts": [
    "PaddleOcrInstallRequest",
    "async install(",
  ],
  "apps/desktop/src/main/services/speech-service.ts": [
    "SpeechAssetInstallRequest",
    "installLanguageAsset(",
  ],
  "apps/desktop/src/main/services/task-execution-recipe-service.ts": [
    "NPM_ORIGIN",
    "SKILLS_ORIGIN",
    "GITHUB_ORIGINS",
  ],
};

const expectedNetworkPrimitiveOwners = new Set([
  "apps/desktop/src/main/index.ts",
  "apps/desktop/src/main/services/electron-updater-adapter.ts",
  "apps/desktop/src/main/services/local-reranker-service.ts",
  "apps/desktop/src/main/services/local-semantic-retrieval-service.ts",
  "apps/desktop/src/main/services/model-provider-connection.ts",
  "apps/desktop/src/main/services/paddle-ocr-bundle-materializer.ts",
  "apps/desktop/src/main/services/pi-package-manager-service.ts",
  "apps/desktop/src/main/services/source-fetch-service.ts",
]);

function productionTypeScriptFiles(repositoryRoot) {
  const start = path.join(repositoryRoot, "apps", "desktop", "src", "main");
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.isFile() && filePath.endsWith(".ts")) files.push(filePath);
    }
  };
  visit(start);
  return files;
}

export function auditPublicPrivacySurface(repositoryRoot = root) {
  const failures = auditNoTelemetry(repositoryRoot).map((failure) => `no-telemetry: ${failure}`);
  const privacy = fs.readFileSync(path.join(repositoryRoot, "PRIVACY.md"), "utf8");
  for (const statement of privacyStatements) {
    if (!privacy.includes(statement)) failures.push(`PRIVACY.md is missing data-flow promise: ${statement}`);
  }

  for (const [relativePath, facts] of Object.entries(sourceFacts)) {
    const source = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    for (const fact of facts) {
      if (!source.includes(fact)) failures.push(`${relativePath} is missing privacy owner fact: ${fact}`);
    }
  }

  const actualOwners = productionTypeScriptFiles(repositoryRoot)
    .filter((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      return /from\s+["']undici["']|await\s+fetch\s*\(|\?\?\s*fetch\b|FetchLike\s*=\s*typeof\s+fetch|electron-updater/u.test(source);
    })
    .map((filePath) => path.relative(repositoryRoot, filePath).split(path.sep).join("/"))
    .sort();
  const expectedOwners = [...expectedNetworkPrimitiveOwners].sort();
  for (const owner of actualOwners) {
    if (!expectedNetworkPrimitiveOwners.has(owner)) failures.push(`unreviewed production network owner: ${owner}`);
  }
  for (const owner of expectedOwners) {
    if (!actualOwners.includes(owner)) failures.push(`reviewed production network owner disappeared: ${owner}`);
  }
  return failures.sort((left, right) => left.localeCompare(right));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = auditPublicPrivacySurface();
  if (failures.length > 0) {
    console.error("Public privacy data-flow verification failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Public privacy data-flow verification passed: public copy, telemetry policy, and production network owners align.");
}
