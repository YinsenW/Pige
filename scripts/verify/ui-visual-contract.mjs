import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const manifestPath = path.join(root, "resources/ui-visual-contract.manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const stylesheetPath = path.join(root, manifest.rendererStylesheet);
const css = fs.readFileSync(stylesheetPath, "utf8");
const failures = [];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const normalize = (value) => value.replace(/\s+/gu, " ").trim();

for (const [property, expected] of Object.entries(manifest.requiredCustomProperties)) {
  const match = css.match(new RegExp(`${escapeRegExp(property)}\\s*:\\s*([^;]+);`, "u"));
  if (!match) failures.push(`Missing required visual token ${property}.`);
  else if (normalize(match[1]) !== normalize(expected)) {
    failures.push(`${property} expected ${expected}, found ${normalize(match[1])}.`);
  }
}

for (const requirement of manifest.requiredRuleDeclarations) {
  const selectorPattern = escapeRegExp(requirement.selector).replace(/\\ /gu, "\\s+");
  const block = css.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`, "u"));
  if (!block) {
    failures.push(`Missing required selector ${requirement.selector}.`);
    continue;
  }
  const declaration = block[1].match(
    new RegExp(`${escapeRegExp(requirement.property)}\\s*:\\s*([^;]+);`, "u")
  );
  if (!declaration) {
    failures.push(`${requirement.selector} is missing ${requirement.property}.`);
    continue;
  }
  const actual = normalize(declaration[1]);
  if (requirement.value && actual !== normalize(requirement.value)) {
    failures.push(
      `${requirement.selector} ${requirement.property} expected ${requirement.value}, found ${actual}.`
    );
  }
  if (requirement.valueIncludes && !actual.includes(normalize(requirement.valueIncludes))) {
    failures.push(
      `${requirement.selector} ${requirement.property} must include ${requirement.valueIncludes}, found ${actual}.`
    );
  }
}

for (const marker of manifest.requiredStylesheetMarkers) {
  if (!css.includes(marker)) failures.push(`Stylesheet is missing required marker: ${marker}.`);
}

const requiredDocs = ["docs/UI_PROTOTYPE.md", "docs/AI_DEVELOPMENT_GUIDE.md", "docs/QUALITY_AND_TEST_STRATEGY.md"];
for (const relativePath of requiredDocs) {
  const content = fs.readFileSync(path.join(root, relativePath), "utf8");
  if (!content.includes("ui-visual-contract.manifest.json")) {
    failures.push(`${relativePath} does not reference the visual contract manifest.`);
  }
}

if (manifest.referenceBoundary !== "clean-room-observation-only") {
  failures.push("Visual contract must retain the clean-room reference boundary.");
}
if (!manifest.baselinePolicy.syntheticDataOnly) failures.push("Visual baselines must use synthetic data only.");
if (!manifest.baselinePolicy.baselineUpdateRequiresHumanReview) {
  failures.push("Visual baseline updates must require human review.");
}

if (failures.length) {
  console.error("UI visual contract verification failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

const combinations =
  manifest.captureMatrix.viewports.length *
  manifest.captureMatrix.locales.length *
  manifest.captureMatrix.themes.length *
  manifest.captureMatrix.requiredStates.length;
console.log(
  `UI visual contract OK: ${Object.keys(manifest.requiredCustomProperties).length} tokens, ` +
    `${manifest.requiredRuleDeclarations.length} structural rules, ${combinations} governed capture combinations.`
);
