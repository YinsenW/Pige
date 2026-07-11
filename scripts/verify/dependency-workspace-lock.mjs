import path from "node:path";

export function verifyWorkspaceLockUsage({
  lockfile,
  file,
  section,
  name,
  version,
  manifestVersion
}) {
  if (!lockfile?.packages || typeof lockfile.packages !== "object") {
    throw new Error("package-lock.json must contain a packages object.");
  }

  const workspace = file === "package.json" ? "" : path.posix.dirname(file.replaceAll("\\", "/"));
  const workspaceEntry = lockfile.packages[workspace];
  if (!workspaceEntry || typeof workspaceEntry !== "object") {
    throw new Error(`package-lock.json is missing workspace entry ${workspace || "<root>"} for ${file}.`);
  }
  const lockEdge = workspaceEntry[section]?.[name];
  if (lockEdge !== version) {
    throw new Error(
      `package-lock.json workspace edge ${workspace || "<root>"} ${section}.${name} is ${String(lockEdge)}, expected ${version}.`
    );
  }

  const nestedPath = workspace ? `${workspace}/node_modules/${name}` : `node_modules/${name}`;
  const rootPath = `node_modules/${name}`;
  const installedPath = lockfile.packages[nestedPath] ? nestedPath : rootPath;
  const installed = lockfile.packages[installedPath];
  if (!installed || typeof installed !== "object") {
    throw new Error(`package-lock.json is missing ${name} used by ${file}.`);
  }

  const expected = String(manifestVersion).replace(/^[~^]/, "");
  if (installed.version !== expected) {
    throw new Error(
      `package-lock.json installed entry ${installedPath} has ${name}@${String(installed.version)}, manifest expects ${expected}.`
    );
  }
  return installedPath;
}
