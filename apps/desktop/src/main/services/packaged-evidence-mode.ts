import fs from "node:fs";
import path from "node:path";

export const PACKAGED_RUNTIME_SMOKE_ARGUMENT = "--pige-packaged-runtime-smoke-report=";
export const PACKAGED_MEMORY_EVIDENCE_ARGUMENT = "--pige-packaged-memory-evidence-report=";

export type PackagedEvidenceMode =
  | { readonly kind: "none" }
  | { readonly kind: "runtime_smoke"; readonly reportPath: string }
  | { readonly kind: "memory"; readonly reportPath: string };

export function resolvePackagedEvidenceMode(input: {
  readonly argv: readonly string[];
  readonly isPackaged: boolean;
  readonly tempPath: string;
}): PackagedEvidenceMode {
  const candidates = [
    {
      kind: "runtime_smoke" as const,
      name: PACKAGED_RUNTIME_SMOKE_ARGUMENT.slice(0, -1),
      prefix: PACKAGED_RUNTIME_SMOKE_ARGUMENT
    },
    {
      kind: "memory" as const,
      name: PACKAGED_MEMORY_EVIDENCE_ARGUMENT.slice(0, -1),
      prefix: PACKAGED_MEMORY_EVIDENCE_ARGUMENT
    }
  ].flatMap((candidate) => input.argv
    .filter((value) => value.startsWith(candidate.name))
    .map((value) => ({ ...candidate, value })));
  if (candidates.length === 0) return { kind: "none" };
  if (!input.isPackaged || candidates.length !== 1) {
    throw new Error("Packaged evidence mode arguments are invalid.");
  }

  const candidate = candidates[0];
  const requestedPath = candidate?.value.startsWith(candidate.prefix)
    ? candidate.value.slice(candidate.prefix.length)
    : undefined;
  if (!candidate || !requestedPath || !path.isAbsolute(requestedPath)) {
    throw new Error("Packaged evidence report path is invalid.");
  }
  const reportPath = path.resolve(requestedPath);
  if (fs.existsSync(reportPath)) {
    throw new Error("Packaged evidence report already exists.");
  }
  const tempRoot = fs.realpathSync(input.tempPath);
  const reportParent = fs.realpathSync(path.dirname(reportPath));
  const relativeParent = path.relative(tempRoot, reportParent);
  if (
    !relativeParent ||
    relativeParent === ".." ||
    relativeParent.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeParent)
  ) {
    throw new Error("Packaged evidence report must be beneath the system temporary root.");
  }
  assertCanonicalDirectoryChain(tempRoot, reportParent);
  return { kind: candidate.kind, reportPath };
}

function assertCanonicalDirectoryChain(root: string, target: string): void {
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("Packaged evidence report parent is not a canonical directory.");
    }
  }
}
