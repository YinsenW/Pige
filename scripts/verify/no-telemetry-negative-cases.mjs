import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { auditNoTelemetry } from "./no-telemetry.mjs";

const mutations = [
  {
    name: "direct telemetry dependency",
    file: "apps/desktop/package.json",
    body: JSON.stringify({ dependencies: { "@sentry/electron": "1.0.0" } })
  },
  {
    name: "aliased telemetry dependency",
    file: "apps/desktop/package.json",
    body: JSON.stringify({ dependencies: { "local-observer": "npm:@sentry/node@7.0.0" } })
  },
  {
    name: "production SDK import",
    file: "apps/desktop/src/main/index.ts",
    body: 'import posthog from "posthog-node";\nvoid posthog;\n'
  },
  {
    name: "representative telemetry SDK import",
    file: "apps/desktop/src/renderer/telemetry.ts",
    body: 'import { initializeFaro } from "@grafana/faro-web-sdk";\nvoid initializeFaro;\n'
  },
  {
    name: "Electron crash reporter",
    file: "apps/desktop/src/main/index.ts",
    body: 'import { crashReporter } from "electron";\nvoid crashReporter;\n'
  },
  {
    name: "automatic crash upload",
    file: "apps/desktop/src/main/crash-settings.ts",
    body: "export const crashSettings = { uploadToServer: true };\n"
  },
  {
    name: "browser beacon",
    file: "apps/desktop/src/renderer/App.tsx",
    body: 'navigator.sendBeacon("/events", "started");\n'
  },
  {
    name: "collector endpoint",
    file: "apps/desktop/src/main/analytics.ts",
    body: 'export const endpoint = "https://app.posthog.com/capture";\n'
  },
  {
    name: "automatic telemetry config",
    file: "apps/desktop/telemetry.json",
    body: JSON.stringify({ telemetryEnabled: true })
  },
  {
    name: "custom automatic diagnostics transport",
    file: "apps/desktop/src/main/custom-diagnostics.ts",
    body: 'void fetch("https://metrics.example.test/diagnostics/events");\n'
  },
  {
    name: "workflow upload configuration",
    file: ".github/workflows/release.yml",
    body: "env:\n  SENTRY_DSN: ${{ secrets.SENTRY_DSN }}\n"
  }
];

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-no-telemetry-negative-"));
try {
  const cleanRoot = createFixture(root, "clean");
  if (auditNoTelemetry(cleanRoot).length !== 0) throw new Error("Clean no-telemetry fixture was rejected.");

  for (const mutation of mutations) {
    const mutationRoot = createFixture(root, mutation.name.replace(/[^a-z0-9]+/giu, "-"));
    write(mutationRoot, mutation.file, mutation.body);
    const failures = auditNoTelemetry(mutationRoot);
    if (failures.length === 0) throw new Error(`Mutation was not rejected: ${mutation.name}`);
  }

  console.log(`No-telemetry mutation cases OK: ${mutations.length} dependency, alias, SDK, config, transport, crash-upload, endpoint, and workflow paths rejected.`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function createFixture(parent, name) {
  const fixtureRoot = path.join(parent, name);
  write(fixtureRoot, "package.json", JSON.stringify({ private: true }));
  write(fixtureRoot, "apps/desktop/src/main/index.ts", "export const localOnly = true;\n");
  write(fixtureRoot, ".github/workflows/ci.yml", "name: CI\n");
  return fixtureRoot;
}

function write(rootPath, relativePath, body) {
  const filePath = path.join(rootPath, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");
}
