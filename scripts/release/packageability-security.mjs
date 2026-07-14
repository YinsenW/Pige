import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SIGNING_ENVIRONMENT_PREFIXES = ["APPLE_", "CSC_", "WIN_CSC_"];

export function sanitizeElectronBuilderEnvironment(environment) {
  const sanitized = {};
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined || SIGNING_ENVIRONMENT_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    sanitized[name] = value;
  }
  sanitized.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  sanitized.CSC_FOR_PULL_REQUEST = "true";
  return sanitized;
}

export function collectBundleManifest(bundleRoot) {
  const entries = [];
  const pending = [bundleRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    const children = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolutePath = path.join(directory, child.name);
      const relativePath = path.relative(bundleRoot, absolutePath).replaceAll(path.sep, "/");
      const stat = fs.lstatSync(absolutePath);
      const mode = stat.mode & 0o7777;
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(absolutePath);
        if (path.isAbsolute(target) || target.includes("\0")) {
          throw new Error("Packaged application contains an unsafe symbolic link.");
        }
        entries.push({
          path: relativePath,
          kind: "symlink",
          mode,
          target,
          sha256: checksumBytes(Buffer.from(target, "utf8"))
        });
      } else if (stat.isDirectory()) {
        entries.push({ path: relativePath, kind: "directory", mode });
        pending.push(absolutePath);
      } else if (stat.isFile()) {
        entries.push({
          path: relativePath,
          kind: "file",
          mode,
          bytes: stat.size,
          sha256: checksumBytes(fs.readFileSync(absolutePath))
        });
      } else {
        throw new Error("Packaged application contains an unsupported filesystem entry.");
      }
    }
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return entries;
}

export function compareBundleManifests(expected, actual) {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

export function bundleManifestDigest(manifest) {
  return checksumBytes(Buffer.from(JSON.stringify(manifest), "utf8"));
}

export function parseMacCodeSignatureDescription(description) {
  const normalized = String(description);
  const teamIdentifierMatch = normalized.match(/^TeamIdentifier=(.+)$/mu);
  return {
    adHoc: /^Signature=adhoc$/mu.test(normalized),
    teamIdentifierPresent: teamIdentifierMatch !== null && teamIdentifierMatch[1] !== "not set",
    developerIdPresent: /^(?:Authority=.*Developer ID|TeamIdentifier=(?!not set$).+)$/imu.test(normalized),
    hardenedRuntime: /^CodeDirectory .*flags=.*(?:runtime|0x10000)/imu.test(normalized)
  };
}

export function classifyMacGatekeeperAssessment(assessment, output) {
  const normalized = String(output).toLowerCase();
  const invalidDiagnostic = /(?:code has no resources|damaged|invalid signature|modified|resource envelope|sealed resource)/u
    .test(normalized);
  const completed = assessment?.error === undefined &&
    assessment?.signal === null &&
    Number.isInteger(assessment?.status);
  const rejected = completed && assessment.status !== 0 && /(?:rejected|not accepted)/u.test(normalized);
  return {
    expectedUntrustedRejection: rejected && !invalidDiagnostic,
    invalidDiagnostic
  };
}

function checksumBytes(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
