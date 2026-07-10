import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", "node_modules", "artifacts", "coverage", "dist"]);

function walkMarkdown(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdown(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files.sort();
}

function withoutFencedCode(text) {
  let fence = null;
  return text
    .split("\n")
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1];
      if (marker && fence === null) {
        fence = marker[0];
        return "";
      }
      if (marker && fence === marker[0]) {
        fence = null;
        return "";
      }
      return fence === null ? line : "";
    })
    .join("\n");
}

function githubSlug(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<[^>]+>/gu, "")
    .replace(/[`*_~]/gu, "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, "")
    .replace(/\s/gu, "-");
}

function collectAnchors(text) {
  const anchors = new Set();
  const counts = new Map();
  const lines = withoutFencedCode(text).split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const atx = lines[index].match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u);
    const setext = index + 1 < lines.length && /^\s*(?:=+|-+)\s*$/u.test(lines[index + 1]) ? lines[index] : null;
    const heading = atx?.[1] ?? setext;
    if (!heading) continue;

    const base = githubSlug(heading);
    if (!base) continue;
    const count = counts.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    counts.set(base, count + 1);
    if (setext) index += 1;
  }

  return anchors;
}

function extractDestinations(text) {
  const destinations = [];
  const source = withoutFencedCode(text).replace(/`[^`\n]*`/gu, "");
  const inlinePattern = /!?\[[^\]\n]*\]\((<[^>\n]+>|(?:\\.|[^)\n])+?)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)/gu;
  const referencePattern = /^\s*\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gmu;

  for (const match of source.matchAll(inlinePattern)) {
    destinations.push({ value: match[1], index: match.index });
  }
  for (const match of source.matchAll(referencePattern)) {
    destinations.push({ value: match[1], index: match.index });
  }
  return destinations;
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

const files = walkMarkdown(root);
const anchorsByFile = new Map(files.map((file) => [path.resolve(file), collectAnchors(fs.readFileSync(file, "utf8"))]));
const failures = [];
let checkedLinks = 0;
let checkedAnchors = 0;

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const destination of extractDestinations(text)) {
    let target = destination.value.trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(target)) continue;

    checkedLinks += 1;
    const [rawPath, rawFragment] = target.split("#", 2);
    const decodedPath = decode(rawPath);
    const decodedFragment = rawFragment === undefined ? undefined : decode(rawFragment);
    const location = `${path.relative(root, file)}:${lineNumber(text, destination.index)}`;

    if (decodedPath === null || decodedFragment === null) {
      failures.push(`${location} -> malformed percent-encoding in ${destination.value}`);
      continue;
    }

    const pathWithoutQuery = decodedPath.split("?", 1)[0];
    const resolved = pathWithoutQuery
      ? path.resolve(pathWithoutQuery.startsWith("/") ? root : path.dirname(file), pathWithoutQuery.replace(/^\//u, ""))
      : path.resolve(file);

    if (!fs.existsSync(resolved)) {
      failures.push(`${location} -> missing target ${destination.value}`);
      continue;
    }

    if (decodedFragment !== undefined && decodedFragment !== "") {
      checkedAnchors += 1;
      const targetAnchors = anchorsByFile.get(path.resolve(resolved));
      if (!targetAnchors) {
        failures.push(`${location} -> anchor target is not a checked Markdown file: ${destination.value}`);
      } else if (!targetAnchors.has(decodedFragment)) {
        failures.push(`${location} -> missing anchor #${decodedFragment} in ${path.relative(root, resolved)}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Invalid local Markdown links:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Markdown links OK: checked ${files.length} Markdown files, ${checkedLinks} local links, and ${checkedAnchors} ${checkedAnchors === 1 ? "anchor" : "anchors"}.`
);
