import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = "resources/documentation-quality/documentation-leanness.manifest.json";
const documentMapPath = "resources/documentation-quality/document-map.manifest.json";
const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath), "utf8"));
const documentMap = JSON.parse(fs.readFileSync(path.join(root, documentMapPath), "utf8"));

const excludedLifecycles = new Set(["Historical", "Prototype evidence"]);
const standardMetadata = /^(?:status|baseline date|last reviewed|review trigger|owner|audience|scope|source of truth|document owner|version):\s*\S/iu;
const normativeSignal = /(?:\b(?:always|cannot|default|do not|does not|enforce[ds]?|exclude[ds]?|include[ds]?|may not|must|must not|never|only|preserve[ds]?|remain[\w-]*|require[ds]?|shall|should|should not)\b|必须|不得|禁止|只能|默认|应当|不应|绝不|不可|需要)/iu;
const stableIdPattern = /\b(?:PIGE-[A-Z]+-\d+|EV-[A-Z0-9-]+|D-\d{8}-[A-Z0-9-]+|[BMPET]\d+(?:\.\d+)?)\b/giu;
const approvableKinds = new Set([
  "external-url",
  "fenced-exact",
  "list-window",
  "multiline-block",
  "paragraph-exact",
  "short-normative-line",
  "table-row",
  "table-window"
]);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label, failures) {
  if (!isPlainObject(value)) {
    failures.push(`${label} must be an object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    failures.push(`${label} keys must be exactly ${wanted.join(", ")}; found ${actual.join(", ")}`);
    return false;
  }
  return true;
}

function requireString(value, label, failures, minimumLength = 1) {
  if (typeof value !== "string" || value.trim().length < minimumLength) failures.push(`${label} must be a non-empty string of at least ${minimumLength} characters`);
}

function requireSafeInteger(value, label, failures, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    failures.push(`${label} must be a safe integer between ${minimum} and ${maximum}`);
  }
}

function requireFiniteNumber(value, label, failures, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    failures.push(`${label} must be a finite number between ${minimum} and ${maximum}`);
  }
}

function uniqueStringArray(value, label, failures, { nonEmpty = true } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    failures.push(`${label} must be ${nonEmpty ? "a non-empty" : "an"} array of non-empty strings`);
    return [];
  }
  if (new Set(value).size !== value.length) failures.push(`${label} must not contain duplicates`);
  return value;
}

function sorted(values) {
  return [...values].sort();
}

function validateManifestShape(value, map) {
  const failures = [];
  const rootKeys = [
    "alwaysRead",
    "baseline",
    "budgets",
    "copyPastePolicy",
    "fileCountPolicy",
    "ownerRules",
    "schemaVersion",
    "staleChannelFragments",
    "traceManifests"
  ];
  exactKeys(value, rootKeys, "documentation-leanness manifest", failures);
  if (value?.schemaVersion !== 2) failures.push("documentation-leanness manifest schemaVersion must be 2");

  const baselineKeys = ["capturedAt", "markdownBytes", "markdownFiles", "markdownLines", "markdownWords"];
  exactKeys(value?.baseline, baselineKeys, "baseline", failures);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value?.baseline?.capturedAt ?? "")) failures.push("baseline.capturedAt must be an ISO date");
  for (const key of baselineKeys.filter((key) => key !== "capturedAt")) {
    requireSafeInteger(value?.baseline?.[key], `baseline.${key}`, failures);
  }

  const budgetKeys = [
    "maximumAlwaysReadWords",
    "maximumMarkdownBytes",
    "maximumMarkdownFiles",
    "maximumMarkdownLines",
    "maximumMarkdownWords",
    "maximumTraceManifestBytes",
    "maximumTraceManifestLines"
  ];
  exactKeys(value?.budgets, budgetKeys, "budgets", failures);
  for (const key of budgetKeys) requireSafeInteger(value?.budgets?.[key], `budgets.${key}`, failures);

  exactKeys(value?.fileCountPolicy, ["mode", "rule"], "fileCountPolicy", failures);
  if (value?.fileCountPolicy?.mode !== "reviewed_ratchet") failures.push("fileCountPolicy.mode must be reviewed_ratchet");
  requireString(value?.fileCountPolicy?.rule, "fileCountPolicy.rule", failures, 80);

  const alwaysRead = uniqueStringArray(value?.alwaysRead, "alwaysRead", failures);
  uniqueStringArray(value?.traceManifests, "traceManifests", failures);
  const entryPaths = uniqueStringArray(map?.entryBudget?.paths, "document-map entryBudget.paths", failures);
  if (JSON.stringify(sorted(alwaysRead)) !== JSON.stringify(sorted(entryPaths))) {
    failures.push("alwaysRead must exactly match document-map entryBudget.paths");
  }
  if (!Number.isSafeInteger(map?.entryBudget?.maximumWords) || map.entryBudget.maximumWords <= 0) {
    failures.push("document-map entryBudget.maximumWords must be a positive safe integer");
  } else if (value?.budgets?.maximumAlwaysReadWords !== map.entryBudget.maximumWords) {
    failures.push("budgets.maximumAlwaysReadWords must exactly match document-map entryBudget.maximumWords");
  }

  const policyKeys = [
    "approvedGroups",
    "externalUrl",
    "fencedBlock",
    "listWindow",
    "longParagraph",
    "maximumUnapprovedGroups",
    "multilineBlock",
    "shortNormativeLine",
    "tableData"
  ];
  const policy = value?.copyPastePolicy;
  exactKeys(policy, policyKeys, "copyPastePolicy", failures);
  if (policy?.maximumUnapprovedGroups !== 0) failures.push("copyPastePolicy.maximumUnapprovedGroups must be exactly 0");

  exactKeys(policy?.shortNormativeLine, ["minimumCharacters", "minimumLexicalUnits"], "copyPastePolicy.shortNormativeLine", failures);
  requireSafeInteger(policy?.shortNormativeLine?.minimumCharacters, "copyPastePolicy.shortNormativeLine.minimumCharacters", failures, 20, 36);
  requireSafeInteger(policy?.shortNormativeLine?.minimumLexicalUnits, "copyPastePolicy.shortNormativeLine.minimumLexicalUnits", failures, 3, 6);

  exactKeys(policy?.listWindow, ["minimumCharacters", "minimumItems"], "copyPastePolicy.listWindow", failures);
  requireSafeInteger(policy?.listWindow?.minimumCharacters, "copyPastePolicy.listWindow.minimumCharacters", failures, 60, 100);
  requireSafeInteger(policy?.listWindow?.minimumItems, "copyPastePolicy.listWindow.minimumItems", failures, 2, 3);

  exactKeys(policy?.tableData, ["minimumCharacters", "minimumRows", "singleRowMinimumCharacters"], "copyPastePolicy.tableData", failures);
  requireSafeInteger(policy?.tableData?.minimumCharacters, "copyPastePolicy.tableData.minimumCharacters", failures, 80, 120);
  requireSafeInteger(policy?.tableData?.minimumRows, "copyPastePolicy.tableData.minimumRows", failures, 2, 2);
  requireSafeInteger(policy?.tableData?.singleRowMinimumCharacters, "copyPastePolicy.tableData.singleRowMinimumCharacters", failures, 120, 200);

  exactKeys(policy?.multilineBlock, ["minimumCharacters", "minimumLines"], "copyPastePolicy.multilineBlock", failures);
  requireSafeInteger(policy?.multilineBlock?.minimumCharacters, "copyPastePolicy.multilineBlock.minimumCharacters", failures, 80, 140);
  requireSafeInteger(policy?.multilineBlock?.minimumLines, "copyPastePolicy.multilineBlock.minimumLines", failures, 2, 3);

  exactKeys(
    policy?.longParagraph,
    ["minimumCharacters", "minimumContainment", "minimumJaccard", "minimumLengthRatio", "minimumLexicalUnits"],
    "copyPastePolicy.longParagraph",
    failures
  );
  requireSafeInteger(policy?.longParagraph?.minimumCharacters, "copyPastePolicy.longParagraph.minimumCharacters", failures, 120, 180);
  requireSafeInteger(policy?.longParagraph?.minimumLexicalUnits, "copyPastePolicy.longParagraph.minimumLexicalUnits", failures, 20, 28);
  requireFiniteNumber(policy?.longParagraph?.minimumLengthRatio, "copyPastePolicy.longParagraph.minimumLengthRatio", failures, 0.55, 0.7);
  requireFiniteNumber(policy?.longParagraph?.minimumJaccard, "copyPastePolicy.longParagraph.minimumJaccard", failures, 0.6, 0.72);
  requireFiniteNumber(policy?.longParagraph?.minimumContainment, "copyPastePolicy.longParagraph.minimumContainment", failures, 0.8, 0.88);

  exactKeys(
    policy?.fencedBlock,
    ["minimumCharacters", "minimumContainment", "minimumLengthRatio", "minimumLines"],
    "copyPastePolicy.fencedBlock",
    failures
  );
  requireSafeInteger(policy?.fencedBlock?.minimumCharacters, "copyPastePolicy.fencedBlock.minimumCharacters", failures, 100, 160);
  requireSafeInteger(policy?.fencedBlock?.minimumLines, "copyPastePolicy.fencedBlock.minimumLines", failures, 3, 5);
  requireFiniteNumber(policy?.fencedBlock?.minimumLengthRatio, "copyPastePolicy.fencedBlock.minimumLengthRatio", failures, 0.6, 0.75);
  requireFiniteNumber(policy?.fencedBlock?.minimumContainment, "copyPastePolicy.fencedBlock.minimumContainment", failures, 0.86, 0.94);

  exactKeys(policy?.externalUrl, ["minimumOccurrences"], "copyPastePolicy.externalUrl", failures);
  requireSafeInteger(policy?.externalUrl?.minimumOccurrences, "copyPastePolicy.externalUrl.minimumOccurrences", failures, 2, 2);

  if (!Array.isArray(policy?.approvedGroups)) failures.push("copyPastePolicy.approvedGroups must be an array");
  const mappedPaths = new Set((map?.documents ?? []).map((row) => row?.[0]).filter((entry) => typeof entry === "string"));
  const approvalIds = new Set();
  const approvalFingerprints = new Set();
  for (const [index, approval] of (policy?.approvedGroups ?? []).entries()) {
    const label = `copyPastePolicy.approvedGroups[${index}]`;
    exactKeys(approval, ["canonicalOwner", "expectedOccurrences", "fingerprint", "id", "kind", "rationale", "reviewTrigger"], label, failures);
    requireString(approval?.id, `${label}.id`, failures);
    if (approvalIds.has(approval?.id)) failures.push(`${label}.id is duplicated`);
    approvalIds.add(approval?.id);
    if (!approvableKinds.has(approval?.kind)) failures.push(`${label}.kind is not approvable`);
    if (!/^[a-f0-9]{64}$/u.test(approval?.fingerprint ?? "")) failures.push(`${label}.fingerprint must be a lowercase SHA-256 digest`);
    const approvalKey = `${approval?.kind}:${approval?.fingerprint}`;
    if (approvalFingerprints.has(approvalKey)) failures.push(`${label} duplicates an approved fingerprint`);
    approvalFingerprints.add(approvalKey);
    requireString(approval?.canonicalOwner, `${label}.canonicalOwner`, failures);
    requireString(approval?.rationale, `${label}.rationale`, failures, 30);
    requireString(approval?.reviewTrigger, `${label}.reviewTrigger`, failures, 20);
    if (!Array.isArray(approval?.expectedOccurrences) || approval.expectedOccurrences.length < 2) {
      failures.push(`${label}.expectedOccurrences must contain at least two path/count records`);
    }
    const occurrencePaths = new Set();
    for (const [occurrenceIndex, occurrence] of (approval?.expectedOccurrences ?? []).entries()) {
      const occurrenceLabel = `${label}.expectedOccurrences[${occurrenceIndex}]`;
      exactKeys(occurrence, ["count", "path"], occurrenceLabel, failures);
      requireString(occurrence?.path, `${occurrenceLabel}.path`, failures);
      requireSafeInteger(occurrence?.count, `${occurrenceLabel}.count`, failures);
      if (occurrencePaths.has(occurrence?.path)) failures.push(`${occurrenceLabel}.path is duplicated`);
      occurrencePaths.add(occurrence?.path);
      if (!mappedPaths.has(occurrence?.path)) failures.push(`${occurrenceLabel}.path is not document-map governed`);
    }
    if (!occurrencePaths.has(approval?.canonicalOwner)) failures.push(`${label}.canonicalOwner must be one of expectedOccurrences`);
  }

  if (!Array.isArray(value?.ownerRules) || value.ownerRules.length === 0) failures.push("ownerRules must be a non-empty array");
  const ownerRuleIds = new Set();
  for (const [index, rule] of (value?.ownerRules ?? []).entries()) {
    const label = `ownerRules[${index}]`;
    exactKeys(rule, ["forbidden", "id", "owner", "ownerMarker"], label, failures);
    requireString(rule?.id, `${label}.id`, failures);
    requireString(rule?.owner, `${label}.owner`, failures);
    requireString(rule?.ownerMarker, `${label}.ownerMarker`, failures);
    if (ownerRuleIds.has(rule?.id)) failures.push(`${label}.id is duplicated`);
    ownerRuleIds.add(rule?.id);
    if (!Array.isArray(rule?.forbidden) || rule.forbidden.length === 0) failures.push(`${label}.forbidden must be non-empty`);
    for (const [forbiddenIndex, forbidden] of (rule?.forbidden ?? []).entries()) {
      const forbiddenLabel = `${label}.forbidden[${forbiddenIndex}]`;
      exactKeys(forbidden, ["fragment", "path"], forbiddenLabel, failures);
      requireString(forbidden?.path, `${forbiddenLabel}.path`, failures);
      requireString(forbidden?.fragment, `${forbiddenLabel}.fragment`, failures);
    }
  }

  if (!isPlainObject(value?.staleChannelFragments) || Object.keys(value.staleChannelFragments).length === 0) {
    failures.push("staleChannelFragments must be a non-empty object");
  }
  for (const [file, fragments] of Object.entries(value?.staleChannelFragments ?? {})) {
    requireString(file, "staleChannelFragments path", failures);
    uniqueStringArray(fragments, `staleChannelFragments.${file}`, failures);
  }
  return failures;
}

function collectMarkdown(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "artifacts", "coverage", "dist", "node_modules"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectMarkdown(absolute, files);
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
  return files;
}

function lines(text) {
  return (text.match(/\n/gu) ?? []).length;
}

function words(text) {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/u).length;
}

function result(id, failures, detail) {
  return { id, passed: failures.length === 0, detail: failures.length === 0 ? detail : failures.join("; ") };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeInline(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, "$1 $2")
    .replace(/\[([^\]]+)\]\[[^\]]+\]/gu, "$1")
    .replace(/[`*_~]/gu, "")
    .replace(/\\([\\`*{}[\]()#+.!|>_-])/gu, "$1")
    .replace(/[^\p{L}\p{N}_:/@.#?&=%+\-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeCode(value) {
  return value
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.trim().replace(/\s+/gu, " "))
    .join("\n")
    .replace(/^\n+|\n+$/gu, "");
}

function lexicalUnits(value) {
  return value.match(/[\p{L}\p{N}_-]+/gu) ?? [];
}

function codePointLength(value) {
  return [...value].length;
}

function stableIds(value) {
  return sorted(new Set(value.match(stableIdPattern) ?? []).values()).map((entry) => entry.toLocaleUpperCase("en-US"));
}

function stableIdsMatch(left, right) {
  return JSON.stringify(stableIds(left)) === JSON.stringify(stableIds(right));
}

function isPureReferenceLine(value) {
  const text = value.trim().replace(/^(?:[-+*]|\d+[.)])\s+/u, "");
  return /^(?:\[[^\]]+\]\([^)]+\)|`?[^\s]+\.md(?:#[^\s]+)?`?|https?:\/\/\S+|[^:]+:\s*https?:\/\/\S+)\s*[.;]?$/u.test(text);
}

function parseMarkdownDocument(document) {
  const rawLines = document.text.split(/\r?\n/u);
  const records = [];
  const fences = [];
  let fence;
  let htmlComment = false;
  let yaml = rawLines[0]?.trim() === "---";
  let seenHeading = false;

  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index];
    const line = index + 1;
    const trimmed = raw.trim();
    if (yaml) {
      if (index > 0 && trimmed === "---") yaml = false;
      records.push({ kind: "break", line, raw });
      continue;
    }
    if (htmlComment) {
      if (trimmed.includes("-->")) htmlComment = false;
      records.push({ kind: "break", line, raw });
      continue;
    }
    if (!fence && trimmed.startsWith("<!--")) {
      if (!trimmed.includes("-->")) htmlComment = true;
      records.push({ kind: "break", line, raw });
      continue;
    }

    const fenceMarker = raw.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (fence) {
      const closes = fenceMarker && fenceMarker[1][0] === fence.marker && fenceMarker[1].length >= fence.length && fenceMarker[2].trim() === "";
      if (closes) {
        fences.push({ ...fence, end: line, text: fence.content.join("\n") });
        fence = undefined;
        records.push({ kind: "break", line, raw });
      } else {
        fence.content.push(raw);
      }
      continue;
    }
    if (fenceMarker) {
      fence = {
        content: [],
        info: fenceMarker[2].trim().split(/\s+/u)[0] ?? "",
        length: fenceMarker[1].length,
        marker: fenceMarker[1][0],
        start: line
      };
      records.push({ kind: "break", line, raw });
      continue;
    }

    if (!trimmed) {
      records.push({ kind: "blank", line, raw });
      continue;
    }
    if (/^#{1,6}\s+/u.test(trimmed)) {
      seenHeading = true;
      records.push({ kind: "heading", line, raw });
      continue;
    }
    if (!seenHeading && standardMetadata.test(trimmed)) {
      records.push({ kind: "metadata", line, raw });
      continue;
    }
    if (/^>/u.test(trimmed)) {
      records.push({ kind: "quote", line, raw });
      continue;
    }
    if (/^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/u.test(trimmed)) {
      records.push({ kind: "table-delimiter", line, raw });
      continue;
    }
    if (/^\|.*\|$/u.test(trimmed)) {
      records.push({ kind: "table", line, raw });
      continue;
    }
    const list = raw.match(/^(\s*)(?:[-+*]|\d+[.)])\s+(.+)$/u);
    if (list) {
      records.push({ content: list[2], indent: list[1].length, kind: "list", line, raw });
      continue;
    }
    records.push({ kind: "plain", line, raw });
  }
  if (fence) fences.push({ ...fence, end: rawLines.length, text: fence.content.join("\n") });
  return { ...document, fences, records };
}

function independentOccurrences(occurrences) {
  for (let left = 0; left < occurrences.length; left += 1) {
    for (let right = left + 1; right < occurrences.length; right += 1) {
      const a = occurrences[left];
      const b = occurrences[right];
      if (a.path !== b.path || a.end < b.start || b.end < a.start) return true;
    }
  }
  return false;
}

function uniqueOccurrences(units) {
  const seen = new Set();
  const values = [];
  for (const unit of units) {
    const key = `${unit.path}:${unit.start}:${unit.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    values.push({ end: unit.end, path: unit.path, start: unit.start });
  }
  return values;
}

function exactDuplicateGroups(units, code, kind) {
  const grouped = new Map();
  for (const unit of units) {
    if (!unit.normalized) continue;
    const values = grouped.get(unit.normalized) ?? [];
    values.push(unit);
    grouped.set(unit.normalized, values);
  }
  const groups = [];
  for (const [normalized, values] of grouped) {
    const occurrences = uniqueOccurrences(values);
    if (!independentOccurrences(occurrences)) continue;
    groups.push({
      approvable: approvableKinds.has(kind),
      code,
      fingerprint: sha256(`${kind}\0${normalized}`),
      kind,
      occurrences,
      snippet: values[0].snippet ?? normalized.slice(0, 180)
    });
  }
  return groups;
}

function shortNormativeUnits(document, policy) {
  const units = [];
  for (const record of document.records) {
    if (!["list", "plain"].includes(record.kind)) continue;
    const source = record.kind === "list" ? record.content : record.raw.trim();
    if (source.endsWith(":") || isPureReferenceLine(source)) continue;
    const normalized = normalizeInline(source);
    const characterCount = codePointLength(normalized);
    const unitCount = lexicalUnits(normalized).length;
    const cjkNormative = /(?:必须|不得|禁止|只能|默认|应当|不应|绝不|不可|需要)/u.test(normalized) && characterCount >= 12;
    if (!normativeSignal.test(normalized)) continue;
    if (!cjkNormative && (characterCount < policy.minimumCharacters || unitCount < policy.minimumLexicalUnits)) continue;
    units.push({ end: record.line, normalized, path: document.path, snippet: source, start: record.line });
  }
  return units;
}

function paragraphUnits(document, policy) {
  const units = [];
  let run = [];
  let sequence = 0;
  const flush = () => {
    if (run.length === 0) return;
    const normalized = normalizeInline(run.map((record) => record.raw).join(" "));
    if (lexicalUnits(normalized).length >= policy.minimumLexicalUnits || codePointLength(normalized) >= policy.minimumCharacters) {
      units.push({
        end: run.at(-1).line,
        normalized,
        path: document.path,
        sequence,
        snippet: run.map((record) => record.raw.trim()).join(" ").slice(0, 220),
        start: run[0].line
      });
      sequence += 1;
    }
    run = [];
  };
  for (const record of document.records) {
    if (record.kind === "plain") run.push(record);
    else flush();
  }
  flush();
  return units;
}

function listWindowUnits(document, policy) {
  const units = [];
  let run = [];
  const flush = () => {
    for (let index = 0; index + policy.minimumItems <= run.length; index += 1) {
      const window = run.slice(index, index + policy.minimumItems);
      const normalized = window.map((record) => normalizeInline(record.content)).join("\n");
      if (codePointLength(normalized) < policy.minimumCharacters) continue;
      units.push({
        end: window.at(-1).line,
        normalized,
        path: document.path,
        snippet: window.map((record) => record.raw.trim()).join(" / ").slice(0, 220),
        start: window[0].line
      });
    }
    run = [];
  };
  for (const record of document.records) {
    if (record.kind === "list" && (run.length === 0 || record.indent === run[0].indent)) run.push(record);
    else {
      flush();
      if (record.kind === "list") run.push(record);
    }
  }
  flush();
  return units;
}

function splitTableRow(value) {
  const text = value.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  const cells = [];
  let cell = "";
  let escaped = false;
  let inlineCode = false;
  for (const character of text) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
      cell += character;
    } else if (character === "`") {
      inlineCode = !inlineCode;
      cell += character;
    } else if (character === "|" && !inlineCode) {
      cells.push(normalizeInline(cell));
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(normalizeInline(cell));
  return cells.join(" | ");
}

function tableUnits(document, policy) {
  const rows = [];
  const windows = [];
  let run = [];
  const flush = () => {
    const delimiter = run.findIndex((record) => record.kind === "table-delimiter");
    if (delimiter < 0) {
      run = [];
      return;
    }
    const data = run.slice(delimiter + 1).filter((record) => record.kind === "table");
    for (const record of data) {
      const normalized = splitTableRow(record.raw);
      if (codePointLength(normalized) >= policy.singleRowMinimumCharacters) {
        rows.push({ end: record.line, normalized, path: document.path, snippet: record.raw.trim().slice(0, 220), start: record.line });
      }
    }
    for (let index = 0; index + policy.minimumRows <= data.length; index += 1) {
      const window = data.slice(index, index + policy.minimumRows);
      const normalized = window.map((record) => splitTableRow(record.raw)).join("\n");
      if (codePointLength(normalized) < policy.minimumCharacters) continue;
      windows.push({
        end: window.at(-1).line,
        normalized,
        path: document.path,
        snippet: window.map((record) => record.raw.trim()).join(" / ").slice(0, 220),
        start: window[0].line
      });
    }
    run = [];
  };
  for (const record of document.records) {
    if (["table", "table-delimiter"].includes(record.kind)) run.push(record);
    else flush();
  }
  flush();
  return { rows, windows };
}

function multilineUnits(document, policy) {
  const units = [];
  let run = [];
  const normalizedRecord = (record) => {
    if (record.kind === "list") return normalizeInline(record.content);
    if (record.kind === "table") return splitTableRow(record.raw);
    return normalizeInline(record.raw);
  };
  const flush = () => {
    for (let index = 0; index + policy.minimumLines <= run.length; index += 1) {
      const window = run.slice(index, index + policy.minimumLines);
      if (new Set(window.map((record) => record.kind)).size < 2) continue;
      const normalized = window.map((record) => `${record.kind}:${normalizedRecord(record)}`).join("\n");
      if (codePointLength(normalized) < policy.minimumCharacters) continue;
      units.push({
        end: window.at(-1).line,
        normalized,
        path: document.path,
        snippet: window.map((record) => record.raw.trim()).join(" / ").slice(0, 220),
        start: window[0].line
      });
    }
    run = [];
  };
  for (const record of document.records) {
    if (["list", "plain", "table"].includes(record.kind)) run.push(record);
    else flush();
  }
  flush();
  return units;
}

function fencedUnits(document, policy) {
  return document.fences
    .map((fence, sequence) => {
      const normalized = normalizeCode(fence.text);
      return {
        end: fence.end,
        info: fence.info.toLocaleLowerCase("en-US"),
        normalized,
        path: document.path,
        sequence,
        snippet: normalized.replace(/\n/gu, " / ").slice(0, 220),
        start: fence.start
      };
    })
    .filter((unit) => unit.normalized.split("\n").filter(Boolean).length >= policy.minimumLines || codePointLength(unit.normalized) >= policy.minimumCharacters);
}

function declarationUnits(document) {
  const units = [];
  const pattern = /^\s*(?:export\s+)?(?:declare\s+)?(type|interface|enum)\s+([A-Za-z_$][\w$]*)\b/gmu;
  for (const fence of document.fences) {
    for (const match of fence.text.matchAll(pattern)) {
      const preceding = fence.text.slice(0, match.index);
      const line = fence.start + 1 + (preceding.match(/\n/gu) ?? []).length;
      units.push({
        declaration: `${match[1]}:${match[2]}`,
        end: line,
        normalized: `${match[1]}:${match[2]}`,
        path: document.path,
        snippet: `${match[1]} ${match[2]}`,
        start: line
      });
    }
  }
  for (const record of document.records.filter((entry) => ["list", "plain"].includes(entry.kind))) {
    const match = record.raw.match(/^\s*(?:export\s+)?(?:declare\s+)?(type|interface|enum)\s+([A-Za-z_$][\w$]*)\b/u);
    if (!match) continue;
    units.push({
      declaration: `${match[1]}:${match[2]}`,
      end: record.line,
      normalized: `${match[1]}:${match[2]}`,
      path: document.path,
      snippet: `${match[1]} ${match[2]}`,
      start: record.line
    });
  }
  return units;
}

function normalizedExternalUrl(value) {
  try {
    const parsed = new URL(value.replace(/[.,;:!?]+$/u, ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
    const hostname = parsed.hostname.toLocaleLowerCase("en-US");
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "example.com" || hostname.endsWith(".example.com") || hostname.endsWith(".invalid")) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

function urlUnits(document) {
  const units = [];
  const addFromLine = (raw, line) => {
    const seen = new Set();
    for (const match of raw.matchAll(/https?:\/\/[^\s<>\])}"']+/gu)) {
      const normalized = normalizedExternalUrl(match[0]);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      units.push({ end: line, normalized, path: document.path, snippet: normalized, start: line });
    }
  };
  for (const record of document.records) {
    if (!["break", "metadata"].includes(record.kind)) addFromLine(record.raw, record.line);
  }
  for (const fence of document.fences) {
    for (const [index, line] of fence.text.split("\n").entries()) addFromLine(line, fence.start + index + 1);
  }
  return units;
}

function shingles(values, size) {
  const result = new Set();
  for (let index = 0; index + size <= values.length; index += 1) result.add(values.slice(index, index + size).join("\u0001"));
  return result;
}

function proseFeatures(value) {
  const tokens = lexicalUnits(value);
  if (tokens.length >= 3) return shingles(tokens, 3);
  return shingles([...value.replace(/\s+/gu, "")], 8);
}

function codeFeatures(value) {
  const tokens = value.match(/[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|[^\s]/gu) ?? [];
  return shingles(tokens, 2);
}

function similarity(left, right) {
  let intersection = 0;
  for (const feature of left) if (right.has(feature)) intersection += 1;
  const union = left.size + right.size - intersection;
  return {
    containment: Math.min(left.size, right.size) === 0 ? 0 : intersection / Math.min(left.size, right.size),
    jaccard: union === 0 ? 0 : intersection / union
  };
}

function pairIsIndependent(left, right, { requireNonAdjacent = false } = {}) {
  if (left.path !== right.path) return true;
  if (!(left.end < right.start || right.end < left.start)) return false;
  if (requireNonAdjacent && Number.isInteger(left.sequence) && Number.isInteger(right.sequence)) return Math.abs(left.sequence - right.sequence) > 1;
  return true;
}

function nearParagraphGroups(units, policy) {
  const groups = [];
  for (let leftIndex = 0; leftIndex < units.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < units.length; rightIndex += 1) {
      const left = units[leftIndex];
      const right = units[rightIndex];
      if (left.normalized === right.normalized || !pairIsIndependent(left, right, { requireNonAdjacent: true }) || !stableIdsMatch(left.normalized, right.normalized)) continue;
      const lengthRatio = Math.min(codePointLength(left.normalized), codePointLength(right.normalized)) / Math.max(codePointLength(left.normalized), codePointLength(right.normalized));
      if (lengthRatio < policy.minimumLengthRatio) continue;
      const score = similarity(proseFeatures(left.normalized), proseFeatures(right.normalized));
      if (score.jaccard < policy.minimumJaccard && score.containment < policy.minimumContainment) continue;
      const normalizedPair = sorted([left.normalized, right.normalized]).join("\0");
      groups.push({
        approvable: false,
        code: "DUP-LONG-PARAGRAPH",
        fingerprint: sha256(`paragraph-near\0${normalizedPair}`),
        kind: "paragraph-near",
        occurrences: uniqueOccurrences([left, right]),
        snippet: `${left.snippet} <> ${right.snippet}`.slice(0, 240),
        similarity: score
      });
    }
  }
  return groups;
}

function nearFencedGroups(units, policy) {
  const groups = [];
  for (let leftIndex = 0; leftIndex < units.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < units.length; rightIndex += 1) {
      const left = units[leftIndex];
      const right = units[rightIndex];
      if (left.normalized === right.normalized || !pairIsIndependent(left, right, { requireNonAdjacent: true }) || !stableIdsMatch(left.normalized, right.normalized)) continue;
      if (left.info && right.info && left.info !== right.info) continue;
      const leftFeatures = codeFeatures(left.normalized);
      const rightFeatures = codeFeatures(right.normalized);
      if (Math.min(leftFeatures.size, rightFeatures.size) < 8) continue;
      const lengthRatio = Math.min(codePointLength(left.normalized), codePointLength(right.normalized)) / Math.max(codePointLength(left.normalized), codePointLength(right.normalized));
      if (lengthRatio < policy.minimumLengthRatio) continue;
      const score = similarity(leftFeatures, rightFeatures);
      if (score.containment < policy.minimumContainment) continue;
      const normalizedPair = sorted([left.normalized, right.normalized]).join("\0");
      groups.push({
        approvable: false,
        code: "DUP-FENCED-HIGH-COVERAGE",
        fingerprint: sha256(`fenced-near\0${normalizedPair}`),
        kind: "fenced-near",
        occurrences: uniqueOccurrences([left, right]),
        snippet: `${left.snippet} <> ${right.snippet}`.slice(0, 240),
        similarity: score
      });
    }
  }
  return groups;
}

function decisionLedgerOwnerRole(ownerRole) {
  const normalized = String(ownerRole ?? "").toLocaleLowerCase("en-US");
  return normalized.includes("accepted") && normalized.includes("superseded") && normalized.includes("decision");
}

function governedDuplicationDocuments(files, map, reader = read) {
  const records = new Map((map?.documents ?? []).map((row) => [row?.[0], { lifecycle: row?.[4], ownerRole: row?.[2] }]));
  return files
    .filter((file) => {
      const record = records.get(file);
      return !excludedLifecycles.has(record?.lifecycle) && !decisionLedgerOwnerRole(record?.ownerRole);
    })
    .map((file) => ({ path: file, text: reader(file) }));
}

function detectCopyPasteGroups(documents, policy) {
  const parsed = documents.map(parseMarkdownDocument);
  const shortLines = parsed.flatMap((document) => shortNormativeUnits(document, policy.shortNormativeLine));
  const paragraphs = parsed.flatMap((document) => paragraphUnits(document, policy.longParagraph));
  const listWindows = parsed.flatMap((document) => listWindowUnits(document, policy.listWindow));
  const tables = parsed.map((document) => tableUnits(document, policy.tableData));
  const multiline = parsed.flatMap((document) => multilineUnits(document, policy.multilineBlock));
  const fences = parsed.flatMap((document) => fencedUnits(document, policy.fencedBlock));
  const declarations = parsed.flatMap(declarationUnits);
  const urls = parsed.flatMap(urlUnits);
  return [
    ...exactDuplicateGroups(shortLines, "DUP-SHORT-NORMATIVE", "short-normative-line"),
    ...exactDuplicateGroups(paragraphs, "DUP-LONG-PARAGRAPH-EXACT", "paragraph-exact"),
    ...nearParagraphGroups(paragraphs, policy.longParagraph),
    ...exactDuplicateGroups(listWindows, "DUP-LIST-WINDOW", "list-window"),
    ...exactDuplicateGroups(tables.flatMap((entry) => entry.rows), "DUP-TABLE-ROW", "table-row"),
    ...exactDuplicateGroups(tables.flatMap((entry) => entry.windows), "DUP-TABLE-WINDOW", "table-window"),
    ...exactDuplicateGroups(multiline, "DUP-MULTILINE-BLOCK", "multiline-block"),
    ...exactDuplicateGroups(fences, "DUP-FENCED-EXACT", "fenced-exact"),
    ...nearFencedGroups(fences, policy.fencedBlock),
    ...exactDuplicateGroups(declarations, "DUP-NAMED-DECLARATION", "named-declaration"),
    ...exactDuplicateGroups(urls, "DUP-EXTERNAL-URL", "external-url")
  ];
}

function occurrenceCounts(group) {
  const counts = new Map();
  for (const occurrence of group.occurrences) counts.set(occurrence.path, (counts.get(occurrence.path) ?? 0) + 1);
  return sorted(counts.entries().map(([pathValue, count]) => `${pathValue}:${count}`));
}

function applyApprovals(groups, policy) {
  const approvalFailures = [];
  const approved = new Set();
  const groupIndex = new Map(groups.map((group) => [`${group.kind}:${group.fingerprint}`, group]));
  for (const approval of policy.approvedGroups) {
    const key = `${approval.kind}:${approval.fingerprint}`;
    const group = groupIndex.get(key);
    if (!group || !group.approvable) {
      approvalFailures.push(`stale approved duplicate ${approval.id}`);
      continue;
    }
    const expected = sorted(approval.expectedOccurrences.map((entry) => `${entry.path}:${entry.count}`));
    const actual = occurrenceCounts(group);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      approvalFailures.push(`approved duplicate ${approval.id} occurrence set drifted; expected ${expected.join(", ")}, found ${actual.join(", ")}`);
      continue;
    }
    approved.add(key);
  }
  return {
    approvalFailures,
    unapproved: groups.filter((group) => !approved.has(`${group.kind}:${group.fingerprint}`))
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function runCopyPasteSelfTests(policy, realManifest, realDocumentMap) {
  const failures = [];
  const base = [
    {
      path: "a.md",
      text: "Status: Active\nLast reviewed: 2026-07-10\n\n# Shared heading\n\n| ID | Rule |\n| --- | --- |\n| SAMPLE-A-001 | Alpha-specific behavior stays local to this fixture. |\n\n```ts\nconst sample = 1;\n```\n"
    },
    {
      path: "b.md",
      text: "Status: Active\nLast reviewed: 2026-07-10\n\n# Shared heading\n\n| ID | Rule |\n| --- | --- |\n| SAMPLE-B-002 | Beta-specific behavior stays local to this fixture. |\n\n```ts\nconst sample = 1;\n```\n"
    }
  ];
  if (detectCopyPasteGroups(base, policy).length !== 0) failures.push("copy/paste safe controls for metadata, headings, table headers, distinct stable IDs, and short fenced examples did not pass");

  const cases = [
    {
      code: "DUP-SHORT-NORMATIVE",
      label: "cross-file short normative line",
      mutate(value) {
        const line = "Secrets must never be written to local diagnostics by default.";
        value[0].text += `\n${line}\n`;
        value[1].text += `\n${line}\n`;
      }
    },
    {
      code: "DUP-SHORT-NORMATIVE",
      label: "same-file short normative line",
      mutate(value) {
        const line = "Destructive actions must always require explicit confirmation.";
        value[0].text += `\n${line}\n\n${line}\n`;
      }
    },
    {
      code: "DUP-LIST-WINDOW",
      label: "consecutive list window",
      mutate(value) {
        const block = "\n- Durable source evidence must remain user-owned and reviewable.\n- Rebuildable indexes must never become the durable source of truth.\n- Sensitive mutations must require a scoped permission decision.\n";
        value[0].text += block;
        value[1].text += block;
      }
    },
    {
      code: "DUP-TABLE-WINDOW",
      label: "table data window",
      mutate(value) {
        const block = "\n| ID | Requirement | Owner |\n| --- | --- | --- |\n| SAMPLE-SAFE-101 | Durable evidence remains locally inspectable and recoverable after restart. | Evidence Owner |\n| SAMPLE-SAFE-102 | Sensitive actions require a bounded and reviewable permission decision. | Permission Owner |\n";
        value[0].text += block;
        value[1].text += block;
      }
    },
    {
      code: "DUP-MULTILINE-BLOCK",
      label: "mixed multiline block",
      mutate(value) {
        const block = "\nThe owning service validates the durable record before processing begins.\n- The operation must preserve the selected evidence revision for later review.\nThe completion summary names every changed durable object without exposing private paths.\n";
        value[0].text += block;
        value[1].text += block;
      }
    },
    {
      code: "DUP-FENCED-EXACT",
      label: "exact fenced block",
      mutate(value) {
        const block = "\n```ts\nconst sourceRevision = loadRevision();\nvalidateRevision(sourceRevision);\nwriteResult(sourceRevision);\nrecordOperation(sourceRevision);\n```\n";
        value[0].text += block;
        value[1].text += block;
      }
    },
    {
      code: "DUP-FENCED-HIGH-COVERAGE",
      label: "high-coverage fenced block",
      mutate(value) {
        value[0].text += "\n```ts\nconst sourceRevision = loadCurrentRevision();\nvalidateSourceRevision(sourceRevision);\nconst selectedEvidence = packageSelectedEvidence(sourceRevision);\nwriteBoundedResult(selectedEvidence, sourceRevision);\nrecordRedactedOperation(sourceRevision);\n```\n";
        value[1].text += "\n```ts\nconst sourceRevision = loadCurrentRevision();\nvalidateSourceRevision(sourceRevision);\nconst selectedEvidence = packageSelectedEvidence(sourceRevision);\nwriteVerifiedResult(selectedEvidence, sourceRevision);\nrecordRedactedOperation(sourceRevision);\n```\n";
      }
    },
    {
      code: "DUP-NAMED-DECLARATION",
      label: "same-name declaration",
      mutate(value) {
        value[0].text += "\n```ts\ninterface SharedRuntimePolicy { alpha: string }\n```\n";
        value[1].text += "\n```ts\ninterface SharedRuntimePolicy { beta: number }\n```\n";
      }
    },
    {
      code: "DUP-EXTERNAL-URL",
      label: "repeated external URL",
      mutate(value) {
        value[0].text += "\nReference: https://standards.example.org/pige-contract\n";
        value[1].text += "\nReference: https://standards.example.org/pige-contract\n";
      }
    },
    {
      code: "DUP-LONG-PARAGRAPH",
      label: "near long paragraph",
      mutate(value) {
        value[0].text += "\nThe runtime validates the selected source revision before model invocation, packages only bounded evidence with stable citations, checks the same revision after the response, records a redacted operation summary, and preserves the original user-owned evidence so retry and recovery remain deterministic across application restarts.\n";
        value[1].text += "\nThe runtime validates the selected source revision before model invocation, packages only bounded evidence with stable citations, checks the same revision after the response, records a compact operation summary, and preserves the original user-owned evidence so retry and recovery remain deterministic across application restarts.\n";
      }
    }
  ];
  for (const testCase of cases) {
    const mutated = clone(base);
    const before = JSON.stringify(mutated);
    testCase.mutate(mutated);
    if (before === JSON.stringify(mutated)) {
      failures.push(`${testCase.label} mutation was a no-op`);
      continue;
    }
    const codes = new Set(detectCopyPasteGroups(mutated, policy).map((group) => group.code));
    if (!codes.has(testCase.code)) failures.push(`${testCase.label} mutation did not produce ${testCase.code}`);
  }

  const lifecycleMap = {
    documents: [
      ["active.md", "Owner contract", "Active owner", "Read", "Maintain"],
      ["history.md", "Historical/research", "Historical audit", "Do not read", "Historical"],
      ["prototype.md", "Historical/research", "Prototype", "Do not read", "Prototype evidence"],
      ["ledger.md", "Routing/control", "Accepted and superseded durable decisions", "Search", "Maintain"]
    ]
  };
  const lifecycleFiles = ["active.md", "history.md", "prototype.md", "ledger.md"];
  const selected = governedDuplicationDocuments(lifecycleFiles, lifecycleMap, (file) => `# ${file}\n\nA repeated historical sentence must remain available for audit context.`);
  if (JSON.stringify(selected.map((entry) => entry.path)) !== JSON.stringify(["active.md"])) {
    failures.push("document-map Historical, Prototype evidence, and decision-ledger derivation did not exclude exactly the governed non-active categories");
  }

  const policyCases = [
    {
      expected: "maximumUnapprovedGroups must be exactly 0",
      label: "raised duplicate allowance",
      mutate(value) { value.copyPastePolicy.maximumUnapprovedGroups = 1; }
    },
    {
      expected: "budgets keys must be exactly",
      label: "missing numeric budget",
      mutate(value) { delete value.budgets.maximumMarkdownBytes; }
    },
    {
      expected: "alwaysRead must exactly match",
      label: "always-read drift",
      mutate(value) { value.alwaysRead = value.alwaysRead.slice(1); }
    },
    {
      expected: "documentation-leanness manifest keys must be exactly",
      label: "arbitrary path exclusion",
      mutate(value) { value.pathExclusions = ["docs/PRD.md"]; }
    }
  ];
  for (const testCase of policyCases) {
    const mutated = clone(realManifest);
    const before = JSON.stringify(mutated);
    testCase.mutate(mutated);
    if (before === JSON.stringify(mutated)) {
      failures.push(`${testCase.label} mutation was a no-op`);
      continue;
    }
    const diagnostics = validateManifestShape(mutated, realDocumentMap);
    if (!diagnostics.some((diagnostic) => diagnostic.includes(testCase.expected))) {
      failures.push(`${testCase.label} mutation was not rejected with ${testCase.expected}`);
    }
  }
  return { failures, mutationCount: cases.length + policyCases.length };
}

function describeDuplicate(group) {
  const locations = group.occurrences.map((occurrence) => `${occurrence.path}:${occurrence.start}${occurrence.end === occurrence.start ? "" : `-${occurrence.end}`}`).join(" <> ");
  const score = group.similarity ? ` similarity=${group.similarity.jaccard.toFixed(2)}/${group.similarity.containment.toFixed(2)}` : "";
  return `${group.code} ${locations}${score} ${String(group.snippet).replace(/\s+/gu, " ").slice(0, 180)}`;
}

const manifestFailures = validateManifestShape(manifest, documentMap);
if (manifestFailures.length > 0) {
  console.error("Invalid documentation leanness manifest:");
  for (const failure of manifestFailures) console.error(`- ${failure}`);
  process.exit(1);
}

const selfTest = runCopyPasteSelfTests(manifest.copyPastePolicy, manifest, documentMap);
if (process.argv.includes("--self-test-copy-paste")) {
  if (selfTest.failures.length > 0) {
    for (const failure of selfTest.failures) console.error(`FAIL ${failure}`);
    process.exit(1);
  }
  console.log(`Copy/paste detector self-test OK: ${selfTest.mutationCount} non-no-op mutations and false-positive controls passed.`);
  process.exit(0);
}

const markdownFiles = collectMarkdown(root).sort();
const markdownTexts = markdownFiles.map((file) => read(file));
const metrics = {
  markdownFiles: markdownFiles.length,
  markdownLines: markdownTexts.reduce((sum, text) => sum + lines(text), 0),
  markdownWords: markdownTexts.reduce((sum, text) => sum + words(text), 0),
  markdownBytes: markdownTexts.reduce((sum, text) => sum + Buffer.byteLength(text), 0),
  alwaysReadWords: manifest.alwaysRead.reduce((sum, file) => sum + words(read(file)), 0),
  traceManifestLines: manifest.traceManifests.reduce((sum, file) => sum + lines(read(file)), 0),
  traceManifestBytes: manifest.traceManifests.reduce((sum, file) => sum + Buffer.byteLength(read(file)), 0)
};

const checks = new Map();

{
  const failures = [];
  if (metrics.alwaysReadWords > manifest.budgets.maximumAlwaysReadWords) {
    failures.push(`always-read context is ${metrics.alwaysReadWords} words; budget is ${manifest.budgets.maximumAlwaysReadWords}`);
  }
  for (const file of manifest.alwaysRead) if (!markdownFiles.includes(file)) failures.push(`missing always-read file ${file}`);
  checks.set("LEN-001", result("LEN-001", failures, `Always-read context is ${metrics.alwaysReadWords} words within the exact document-map budget.`));
}

{
  const failures = [...selfTest.failures];
  for (const rule of manifest.ownerRules) {
    if (!fs.existsSync(path.join(root, rule.owner))) {
      failures.push(`${rule.id} owner is missing: ${rule.owner}`);
      continue;
    }
    if (!read(rule.owner).includes(rule.ownerMarker)) failures.push(`${rule.id} owner marker is missing from ${rule.owner}`);
    for (const forbidden of rule.forbidden) {
      if (read(forbidden.path).includes(forbidden.fragment)) failures.push(`${rule.id} is redefined in ${forbidden.path}`);
    }
  }
  for (const [file, fragments] of Object.entries(manifest.staleChannelFragments)) {
    for (const fragment of fragments) if (read(file).includes(fragment)) failures.push(`${file} retains stale IPC alias ${fragment}`);
  }
  const governedDocuments = governedDuplicationDocuments(markdownFiles, documentMap);
  const duplicateGroups = detectCopyPasteGroups(governedDocuments, manifest.copyPastePolicy);
  const approval = applyApprovals(duplicateGroups, manifest.copyPastePolicy);
  failures.push(...approval.approvalFailures);
  if (approval.unapproved.length > manifest.copyPastePolicy.maximumUnapprovedGroups) {
    const displayed = approval.unapproved.slice(0, 60).map(describeDuplicate);
    const remainder = approval.unapproved.length - displayed.length;
    failures.push(`unapproved copy/paste groups (${approval.unapproved.length}): ${displayed.join("; ")}${remainder > 0 ? `; ... ${remainder} more` : ""}`);
  }
  checks.set(
    "LEN-002",
    result(
      "LEN-002",
      failures,
      `Single-owner rules pass; zero unapproved short-line, list, table, multiline, fenced, declaration, URL, or near-paragraph groups remain; ${selfTest.mutationCount} mutation cases passed.`
    )
  );
}

{
  const failures = [];
  if (metrics.traceManifestLines > manifest.budgets.maximumTraceManifestLines) {
    failures.push(`trace manifests use ${metrics.traceManifestLines} lines; budget is ${manifest.budgets.maximumTraceManifestLines}`);
  }
  if (metrics.traceManifestBytes > manifest.budgets.maximumTraceManifestBytes) {
    failures.push(`trace manifests use ${metrics.traceManifestBytes} bytes; budget is ${manifest.budgets.maximumTraceManifestBytes}`);
  }
  for (const file of ["docs/MILESTONES.md", "docs/V0_1_IMPLEMENTATION_PLAYBOOK.md"]) {
    const manualRows = read(file).split("\n").filter((line) => /^\|.*PIGE-[A-Z]+-\d+/u.test(line));
    if (manualRows.length > 0) failures.push(`${file} retains ${manualRows.length} manual Requirement gate rows`);
  }
  const lock = JSON.parse(read("resources/traceability/semantic-claims.manifest.json"));
  const digestCount = Object.values(lock.claims ?? {}).reduce(
    (sum, group) => sum + (group && typeof group === "object" && !Array.isArray(group) ? Object.keys(group).length : 0),
    0
  );
  const digestsAreCompactSha256 = Object.values(lock.claims ?? {}).every((group) =>
    group && typeof group === "object" && !Array.isArray(group)
      && Object.values(group).every((digest) => /^b64u:[A-Za-z0-9_-]{43}$/u.test(digest))
  );
  if (lock.schemaVersion !== 3 || lock.algorithm !== "sha256-base64url(canonical claim JSON)" || !digestsAreCompactSha256 || digestCount !== lock.claimCount || digestCount === 0) {
    failures.push("semantic claims are not stored as an explicit per-claim SHA-256 digest map");
  }
  checks.set("LEN-003", result("LEN-003", failures, `Trace projections use ${metrics.traceManifestLines} lines and ${metrics.traceManifestBytes} bytes without manual gate rows.`));
}

{
  const failures = [];
  if (metrics.markdownFiles > manifest.budgets.maximumMarkdownFiles) {
    failures.push(`Markdown inventory grew to ${metrics.markdownFiles}; budget is ${manifest.budgets.maximumMarkdownFiles}. Raise the ratchet only with a distinct owner role and lifecycle review.`);
  }
  if (!fs.existsSync(path.join(root, documentMapPath))) failures.push(`missing external document inventory ${documentMapPath}`);
  checks.set("LEN-004", result("LEN-004", failures, `Markdown inventory is bounded at ${metrics.markdownFiles} files and the full map is outside default context.`));
}

{
  const failures = [];
  if (metrics.markdownLines > manifest.budgets.maximumMarkdownLines) failures.push(`governed Markdown uses ${metrics.markdownLines} lines; budget is ${manifest.budgets.maximumMarkdownLines}`);
  if (metrics.markdownWords > manifest.budgets.maximumMarkdownWords) failures.push(`governed Markdown uses ${metrics.markdownWords} words; budget is ${manifest.budgets.maximumMarkdownWords}`);
  if (metrics.markdownBytes > manifest.budgets.maximumMarkdownBytes) failures.push(`governed Markdown uses ${metrics.markdownBytes} bytes; budget is ${manifest.budgets.maximumMarkdownBytes}`);
  const reduction = 100 * (1 - metrics.markdownLines / manifest.baseline.markdownLines);
  if (reduction < 5) failures.push(`physical Markdown reduction is only ${reduction.toFixed(2)}%; minimum is 5%`);
  checks.set("LEN-005", result("LEN-005", failures, `Governed Markdown is ${metrics.markdownLines} lines, ${metrics.markdownWords} words, and ${metrics.markdownBytes} bytes; line reduction is ${reduction.toFixed(2)}% from baseline.`));
}

const requested = process.argv.includes("--check") ? process.argv[process.argv.indexOf("--check") + 1] : undefined;
const selectedChecks = requested ? [checks.get(requested)] : [...checks.values()];
if (selectedChecks.some((entry) => entry === undefined)) {
  console.error(`Unknown documentation leanness check: ${requested}`);
  process.exit(1);
}

for (const check of selectedChecks) console.log(`${check.passed ? "PASS" : "FAIL"} ${check.id}: ${check.detail}`);
if (selectedChecks.some((check) => !check.passed)) process.exit(1);
if (!requested) console.log(`Documentation leanness OK: ${JSON.stringify(metrics)}`);
