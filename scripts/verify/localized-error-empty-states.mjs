import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const locales = ["zh-Hans", "en", "ja", "ko", "fr", "de"];

const reviewedStates = [
  {
    surface: "activity",
    owner: "apps/desktop/src/renderer/src/components/ActivityHistorySettingsPanel.tsx",
    states: {
      "activity.empty": "No recent activity",
      "activity.emptyDescription": "Changes made by Pige will appear here when there is something to review.",
    },
  },
  {
    surface: "home",
    owner: "apps/desktop/src/renderer/src/App.tsx",
    states: { "home.agentState.failed": "The Agent could not complete this request." },
    actions: { "home.retryAnswer": "Try again" },
  },
  {
    surface: "library",
    owner: "apps/desktop/src/renderer/src/App.tsx",
    states: {
      "library.empty": "No notes or source pages yet.",
      "library.emptyDescription": "Add a source or start a conversation; durable local pages will appear here.",
      "library.unavailableTitle": "Library is temporarily unavailable",
      "library.unavailableDescription": "Local knowledge was not deleted. Retry this read without choosing the vault again.",
    },
    actions: { "library.refresh": "Refresh" },
  },
  {
    surface: "knowledge-tree",
    owner: "apps/desktop/src/renderer/src/App.tsx",
    states: {
      "knowledgeTree.empty": "Knowledge Tree has no content yet",
      "knowledgeTree.emptyDescription": "Add notes or sources and Pige can surface real relationships without inventing nodes.",
      "knowledgeTree.degraded": "Knowledge Tree is temporarily unavailable",
      "knowledgeTree.degradedDescription": "Markdown and sources remain safe. Retry the local index without importing them again.",
    },
    actions: { "knowledgeTree.refresh": "Refresh" },
  },
  {
    surface: "models",
    owner: "apps/desktop/src/renderer/src/App.tsx",
    states: { "models.summaryRefreshFailed": "Models could not be loaded. Retry." },
    actions: { "models.retry": "Retry" },
  },
  {
    surface: "packages",
    owner: "apps/desktop/src/renderer/src/components/PiPackagesSettingsPanel.tsx",
    states: {
      "packages.emptyTitle": "No Pi packages installed",
      "packages.emptyDescription": "Enter an exact package name and version to install your first Pi package.",
      "packages.loadFailed": "Package inventory unavailable",
      "packages.loadFailedDescription": "Pige could not read the machine-local package registry. Nothing was changed.",
    },
    actions: { "packages.retry": "Try again" },
  },
  {
    surface: "memory",
    owner: "apps/desktop/src/renderer/src/components/AgentMemorySettingsPanel.tsx",
    states: {
      "memory.emptyTitle": "No saved memories",
      "memory.emptyDescription": "Pige has not saved any vault-scoped memories yet.",
      "memory.loadFailedTitle": "Memory unavailable",
      "memory.loadFailedDescription": "No memory state is inferred. Try loading the current vault again.",
    },
    actions: { "memory.retryLoad": "Try again" },
  },
  {
    surface: "skills",
    owner: "apps/desktop/src/renderer/src/components/SkillsSettingsPanel.tsx",
    states: {
      "skills.emptyTitle": "No Skills installed",
      "skills.emptyDescription": "The verified machine-local registry contains no installed Skills.",
      "skills.loadFailedTitle": "Skill Registry unavailable",
      "skills.loadFailedDescription": "Pige could not read the verified machine-local registry. No inventory state is being inferred.",
    },
    actions: { "skills.retryLoad": "Try again" },
  },
  {
    surface: "diagnostics",
    owner: "apps/desktop/src/renderer/src/App.tsx",
    states: { "system.healthFailed": "Pige could not refresh local health right now." },
    actions: { "system.refreshHealth": "Refresh" },
  },
  {
    surface: "note-agent",
    owner: "apps/desktop/src/renderer/src/components/NoteAgentPanel.tsx",
    states: {
      "note.agentEmpty": "Ask a question grounded in the current note.",
      "development.state.unavailable": "Temporarily unavailable. Nothing was changed.",
    },
    actions: { "note.agentOpenModels": "Open Models" },
  },
];

function readCatalogs(repositoryRoot) {
  return Object.fromEntries(locales.map((locale) => [
    locale,
    JSON.parse(fs.readFileSync(path.join(repositoryRoot, "apps/desktop/src/renderer/src/locales", locale, "messages.json"), "utf8")),
  ]));
}

function placeholderSet(value) {
  return [...value.matchAll(/\{([^}]+)\}/gu)].map((match) => match[1]).sort();
}

function ownerUsesKey(owner, key) {
  if (owner.includes(`"${key}"`)) return true;
  const prefix = key.slice(0, key.lastIndexOf(".") + 1);
  return owner.includes(`\`${prefix}\${`);
}

export function auditLocalizedErrorEmptyStates(repositoryRoot = root) {
  const failures = [];
  const catalogs = readCatalogs(repositoryRoot);

  for (const review of reviewedStates) {
    const owner = fs.readFileSync(path.join(repositoryRoot, review.owner), "utf8");
    const reviewedKeys = { ...review.states, ...(review.actions ?? {}) };
    for (const [key, expectedEnglish] of Object.entries(reviewedKeys)) {
      if (catalogs.en[key] !== expectedEnglish) failures.push(`${review.surface}: reviewed English copy drifted for ${key}`);
      if (!ownerUsesKey(owner, key)) failures.push(`${review.surface}: production owner no longer uses ${key}`);
      for (const locale of locales) {
        const value = catalogs[locale][key];
        if (typeof value !== "string" || value.trim().length === 0) {
          failures.push(`${review.surface}: ${locale} is missing ${key}`);
          continue;
        }
        if (locale !== "en" && value === expectedEnglish) failures.push(`${review.surface}: ${locale} reuses English for ${key}`);
        if (placeholderSet(value).join("|") !== placeholderSet(expectedEnglish).join("|")) {
          failures.push(`${review.surface}: ${locale} placeholder drift for ${key}`);
        }
      }
    }

    for (const key of Object.keys(review.states)) {
      for (const locale of locales) {
        const value = catalogs[locale][key] ?? "";
        if (/\{(?:path|body|prompt|response|secret|token|credential|apiKey)\}/iu.test(value)) {
          failures.push(`${review.surface}: ${locale} exposes private placeholder in ${key}`);
        }
        if (/\/(?:Users|home)\/|[A-Z]:\\\\|file:\/\//u.test(value)) {
          failures.push(`${review.surface}: ${locale} embeds a private path in ${key}`);
        }
      }
    }
  }

  const rendererRoot = path.join(repositoryRoot, "apps/desktop/src/renderer/src");
  const productionSources = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== "locales") visit(entryPath);
      else if (entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name)) productionSources.push(fs.readFileSync(entryPath, "utf8"));
    }
  };
  visit(rendererRoot);
  const renderer = productionSources.join("\n");
  for (const forbidden of [/\b(?:error|err)\.stack\b/u, /\b(?:error|err)\.message\b(?!Key)/u]) {
    if (forbidden.test(renderer)) failures.push(`renderer projects an unlocalized exception field: ${forbidden}`);
  }

  return failures.sort((left, right) => left.localeCompare(right));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = auditLocalizedErrorEmptyStates();
  if (failures.length > 0) {
    console.error("Localized error/empty-state verification failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Localized error/empty-state verification passed: ${reviewedStates.length} release-critical surfaces across ${locales.length} locales.`);
}
