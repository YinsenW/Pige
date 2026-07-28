import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", "node_modules", "artifacts", "coverage", "dist"]);
const ignoredRoots = new Set([path.join(root, "resources", "licenses")]);

function walkMarkdown(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && (ignoredDirectories.has(entry.name) || ignoredRoots.has(full))) continue;
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

function stripHtmlTags(value) {
  let result = "";
  let insideTag = false;
  for (const character of value) {
    if (insideTag) {
      if (character === ">") insideTag = false;
    } else if (character === "<") {
      insideTag = true;
    } else {
      result += character;
    }
  }
  return result;
}

function githubSlug(value) {
  return stripHtmlTags(value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1"))
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

function readInlineDestination(source, openParenthesis) {
  let cursor = openParenthesis + 1;
  const destinationStart = cursor;
  if (source[cursor] === "<") {
    cursor += 1;
    while (cursor < source.length && source[cursor] !== ">" && source[cursor] !== "\n") cursor += 1;
    if (source[cursor] !== ">") return null;
    const value = source.slice(destinationStart, cursor + 1);
    cursor += 1;
    while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
    return source[cursor] === ")" ? { value, close: cursor } : null;
  }

  let depth = 0;
  while (cursor < source.length && source[cursor] !== "\n") {
    const character = source[cursor];
    if (character === "\\") {
      cursor += 2;
      continue;
    }
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      if (depth === 0) return { value: source.slice(destinationStart, cursor), close: cursor };
      depth -= 1;
    } else if ((character === " " || character === "\t") && depth === 0) {
      const value = source.slice(destinationStart, cursor);
      while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
      const delimiter = source[cursor];
      if (delimiter !== "\"" && delimiter !== "'" && delimiter !== "(") return null;
      const closingDelimiter = delimiter === "(" ? ")" : delimiter;
      cursor += 1;
      while (cursor < source.length && source[cursor] !== "\n") {
        if (source[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (source[cursor] === closingDelimiter) break;
        cursor += 1;
      }
      if (source[cursor] !== closingDelimiter) return null;
      cursor += 1;
      while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
      return source[cursor] === ")" ? { value, close: cursor } : null;
    }
    cursor += 1;
  }
  return null;
}

function extractInlineDestinations(source) {
  const destinations = [];
  for (let index = 0; index < source.length; index += 1) {
    const labelStart = source[index] === "[" ? index : source[index] === "!" && source[index + 1] === "[" ? index + 1 : -1;
    if (labelStart < 0) continue;
    let cursor = labelStart + 1;
    while (cursor < source.length && source[cursor] !== "]" && source[cursor] !== "\n") {
      cursor += source[cursor] === "\\" ? 2 : 1;
    }
    if (source[cursor] !== "]" || source[cursor + 1] !== "(") continue;
    const destination = readInlineDestination(source, cursor + 1);
    if (!destination) continue;
    destinations.push({ value: destination.value, index });
    index = destination.close;
  }
  return destinations;
}

function extractDestinations(text) {
  const source = withoutFencedCode(text).replace(/`[^`\n]*`/gu, "");
  const referencePattern = /^\s*\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gmu;
  const destinations = extractInlineDestinations(source);
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
