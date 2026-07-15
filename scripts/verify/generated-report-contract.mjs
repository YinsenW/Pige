import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SAFE_SEGMENT = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const FORBIDDEN_KEYS = new Set([
  "apiKey",
  "authorization",
  "body",
  "content",
  "credential",
  "environment",
  "error",
  "path",
  "prompt",
  "response",
  "secret",
  "stderr",
  "stdout",
  "token"
]);
const POSIX_ABSOLUTE_PATH = /(?:^|[\s"'`([{=:,;])\/(?!\/)[^\s"'`\])},;]+/u;
const ROOTED_OR_UNC_PATH =
  /(?:^|[\s"'`([{=:,;])(?:\/{2}|[A-Za-z]:[\\/]|\\+)[^\s"'`\])},;]+/u;
const FILE_URI = /file:\/\/[^\s]+/iu;

export function assertSafeReportSegment(value, label) {
  if (typeof value !== "string" || !SAFE_SEGMENT.test(value)) {
    throw new Error(`Generated report ${label} must be a bounded safe segment.`);
  }
}

export function generatedReportPath(root, suite, platform, buildId) {
  assertSafeReportSegment(suite, "suite");
  assertSafeReportSegment(platform, "platform");
  assertSafeReportSegment(buildId, "build ID");
  return path.join(root, "artifacts", "test-reports", suite, platform, buildId, "report.json");
}

export function assertGeneratedReportEnvelope(report, expectedRecipe) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("Generated report must be an object.");
  }
  for (const key of ["schemaVersion", "status", "generatedAt", "recipe", "recipeSha256", "platform", "buildId"]) {
    if (!(key in report)) throw new Error(`Generated report is missing ${key}.`);
  }
  if (report.schemaVersion !== 1 || !["passed", "failed"].includes(report.status)) {
    throw new Error("Generated report envelope is invalid.");
  }
  if (!Number.isFinite(Date.parse(report.generatedAt))) {
    throw new Error("Generated report timestamp is invalid.");
  }
  if (report.recipe !== expectedRecipe || !SHA256.test(report.recipeSha256)) {
    throw new Error("Generated report recipe identity is invalid.");
  }
  assertSafeReportSegment(report.platform, "platform");
  assertSafeReportSegment(report.buildId, "build ID");
  assertBodyFreeGeneratedReport(report);
}

export function assertBodyFreeGeneratedReport(value, key = "report") {
  if (Array.isArray(value)) {
    for (const child of value) assertBodyFreeGeneratedReport(child, key);
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) {
      const normalizedKey = childKey.replaceAll(/[^A-Za-z0-9]/gu, "").toLowerCase();
      if ([...FORBIDDEN_KEYS].some((forbidden) => normalizedKey.includes(forbidden.toLowerCase()))) {
        throw new Error(`Generated report contains forbidden field ${childKey}.`);
      }
      assertBodyFreeGeneratedReport(child, childKey);
    }
    return;
  }
  if (
    typeof value === "string" &&
    (POSIX_ABSOLUTE_PATH.test(value) || ROOTED_OR_UNC_PATH.test(value) || FILE_URI.test(value))
  ) {
    throw new Error(`Generated report contains an absolute path in ${key}.`);
  }
}

export function writeGeneratedReport(root, reportPath, report, options = {}) {
  const preparedPath = prepareConfinedReportPath(root, reportPath, options);
  const confinedReportPath = preparedPath.reportPath;
  const temporaryPath = `${confinedReportPath}.tmp-${process.pid}-${crypto.randomBytes(12).toString("hex")}`;
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const expectedBytes = Buffer.from(serialized, "utf8");
  let destination;
  let temporaryDescriptor;
  let temporaryIdentity;
  let committed = false;
  try {
    destination = bindExistingFile(confinedReportPath);
    temporaryDescriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0),
      0o600
    );
    fs.writeFileSync(temporaryDescriptor, expectedBytes);
    fs.fsyncSync(temporaryDescriptor);
    temporaryIdentity = fileIdentity(fs.fstatSync(temporaryDescriptor));
    assertHeldTemporaryFile(temporaryDescriptor, temporaryPath, temporaryIdentity, expectedBytes);
    preparedPath.beforeCommit?.({ reportPath: confinedReportPath, temporaryPath });
    assertParentBindings(preparedPath.parentBindings);
    assertHeldTemporaryFile(temporaryDescriptor, temporaryPath, temporaryIdentity, expectedBytes);
    assertDestinationBinding(confinedReportPath, destination);
    if (destination) fs.rmSync(confinedReportPath);
    assertParentBindings(preparedPath.parentBindings);
    assertHeldTemporaryFile(temporaryDescriptor, temporaryPath, temporaryIdentity, expectedBytes);
    preparedPath.beforeRename?.({ reportPath: confinedReportPath, temporaryPath });
    assertParentBindings(preparedPath.parentBindings);
    assertHeldTemporaryFile(temporaryDescriptor, temporaryPath, temporaryIdentity, expectedBytes);
    assertDestinationAbsent(confinedReportPath);
    fs.renameSync(temporaryPath, confinedReportPath);
    assertParentBindings(preparedPath.parentBindings);
    assertNamedFileMatches(confinedReportPath, temporaryIdentity, expectedBytes);
    committed = true;
  } finally {
    if (destination?.descriptor !== undefined) fs.closeSync(destination.descriptor);
    if (temporaryDescriptor !== undefined) fs.closeSync(temporaryDescriptor);
    if (!committed && temporaryIdentity && namedFileHasIdentity(temporaryPath, temporaryIdentity)) {
      fs.rmSync(temporaryPath);
    }
    closeParentBindings(preparedPath.parentBindings);
  }
}

function prepareConfinedReportPath(root, reportPath, options = {}) {
  const resolvedRoot = path.resolve(root);
  const canonicalRoot = fs.realpathSync.native(resolvedRoot);
  const resolvedReportPath = path.resolve(reportPath);
  const relative = path.relative(resolvedRoot, resolvedReportPath);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Generated report path must remain under the repository root.");
  }

  const parentBindings = [];
  const segments = path.dirname(relative).split(path.sep).filter(Boolean);
  let current = canonicalRoot;
  try {
    parentBindings.push(bindDirectory(current));
    for (const segment of segments) {
      const next = path.join(current, segment);
      try {
        const stat = fs.lstatSync(next);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
          throw new Error("Generated report parent must be a real directory.");
        }
      } catch (caught) {
        if (!(caught && typeof caught === "object" && "code" in caught && caught.code === "ENOENT")) throw caught;
        fs.mkdirSync(next, { mode: 0o700 });
      }
      const canonicalNext = fs.realpathSync.native(next);
      if (canonicalNext !== next || path.relative(canonicalRoot, canonicalNext).startsWith(`..${path.sep}`)) {
        throw new Error("Generated report parent escaped the repository root.");
      }
      current = next;
      parentBindings.push(bindDirectory(current));
    }
    return {
      reportPath: path.join(current, path.basename(relative)),
      parentBindings,
      beforeCommit: options.beforeCommit,
      beforeRename: options.beforeRename
    };
  } catch (caught) {
    closeParentBindings(parentBindings);
    throw caught;
  }
}

function bindDirectory(directoryPath) {
  const stat = fs.lstatSync(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync.native(directoryPath) !== directoryPath) {
    throw new Error("Generated report parent must be a real directory.");
  }
  let descriptor;
  if (process.platform !== "win32") {
    descriptor = fs.openSync(
      directoryPath,
      fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0)
    );
    if (!sameIdentity(stat, fs.fstatSync(descriptor))) {
      fs.closeSync(descriptor);
      throw new Error("Generated report parent identity changed.");
    }
  }
  return { path: directoryPath, identity: fileIdentity(stat), descriptor };
}

function assertParentBindings(bindings) {
  for (const binding of bindings) {
    const stat = fs.lstatSync(binding.path);
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      fs.realpathSync.native(binding.path) !== binding.path ||
      !sameIdentity(stat, binding.identity) ||
      (binding.descriptor !== undefined && !sameIdentity(fs.fstatSync(binding.descriptor), binding.identity))
    ) {
      throw new Error("Generated report parent identity changed.");
    }
  }
}

function closeParentBindings(bindings) {
  for (const binding of bindings.toReversed()) {
    if (binding.descriptor !== undefined) fs.closeSync(binding.descriptor);
  }
}

function bindExistingFile(filePath) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (caught) {
    if (caught && typeof caught === "object" && "code" in caught && caught.code === "ENOENT") return undefined;
    throw caught;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Generated report destination must be a regular file.");
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  if (!sameIdentity(stat, fs.fstatSync(descriptor))) {
    fs.closeSync(descriptor);
    throw new Error("Generated report destination identity changed.");
  }
  return { identity: fileIdentity(stat), descriptor };
}

function assertDestinationBinding(filePath, binding) {
  if (!binding) {
    if (fs.existsSync(filePath)) throw new Error("Generated report destination appeared before commit.");
    return;
  }
  const stat = fs.lstatSync(filePath);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    !sameIdentity(stat, binding.identity) ||
    !sameIdentity(fs.fstatSync(binding.descriptor), binding.identity)
  ) {
    throw new Error("Generated report destination identity changed.");
  }
}

function assertDestinationAbsent(filePath) {
  try {
    fs.lstatSync(filePath);
  } catch (caught) {
    if (caught && typeof caught === "object" && "code" in caught && caught.code === "ENOENT") return;
    throw caught;
  }
  throw new Error("Generated report destination appeared before publication.");
}

function assertHeldTemporaryFile(descriptor, temporaryPath, identity, expectedBytes) {
  const heldStat = fs.fstatSync(descriptor);
  if (!heldStat.isFile() || !sameIdentity(heldStat, identity) || heldStat.size !== expectedBytes.length) {
    throw new Error("Generated report temporary file identity changed.");
  }
  const namedStat = fs.lstatSync(temporaryPath);
  if (namedStat.isSymbolicLink() || !namedStat.isFile() || !sameIdentity(namedStat, identity)) {
    throw new Error("Generated report temporary file identity changed.");
  }
  const actualBytes = Buffer.alloc(expectedBytes.length);
  const bytesRead = fs.readSync(descriptor, actualBytes, 0, actualBytes.length, 0);
  if (bytesRead !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) {
    throw new Error("Generated report temporary file bytes changed.");
  }
}

function assertNamedFileMatches(filePath, identity, expectedBytes) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile() || !sameIdentity(stat, identity)) {
    throw new Error("Generated report publication identity changed.");
  }
  const actualBytes = fs.readFileSync(filePath);
  if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) {
    throw new Error("Generated report publication bytes changed.");
  }
}

function namedFileHasIdentity(filePath, identity) {
  try {
    const stat = fs.lstatSync(filePath);
    return !stat.isSymbolicLink() && stat.isFile() && sameIdentity(stat, identity);
  } catch {
    return false;
  }
}

function fileIdentity(stat) {
  return { dev: stat.dev, ino: stat.ino };
}

function sameIdentity(stat, identity) {
  return stat.dev === identity.dev && stat.ino === identity.ino;
}
