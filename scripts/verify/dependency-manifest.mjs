import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "resources/dependency-manifest/dependencies.manifest.json");
const waiverPath = path.join(root, "resources/dependency-manifest/dependency-waivers.manifest.json");
const techArchitecture = fs.readFileSync(path.join(root, "docs/TECH_ARCHITECTURE.md"), "utf8");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const waivers = JSON.parse(fs.readFileSync(waiverPath, "utf8"));

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.records)) {
  fail("Dependency manifest must use schemaVersion 1 and records array.");
}

const registryRefs = new Set();
const packageRecords = new Map();
const usedNpmPackages = new Map();

for (const record of manifest.records) {
  const required = [
    "registryRef",
    "name",
    "category",
    "status",
    "usage",
    "packageManager",
    "packageId",
    "version",
    "upstreamUrl",
    "license",
    "noticeRequired",
    "distributionMode",
    "checksumPolicy",
    "dataBoundary",
    "ownerService",
    "platforms",
    "sizeClass",
    "updatePolicy",
    "replacementPath",
    "lastReviewedAt",
    "reviewedBy"
  ];
  for (const field of required) {
    if (!(field in record)) fail(`Dependency record ${record.registryRef ?? "<unknown>"} is missing ${field}.`);
  }
  if (registryRefs.has(record.registryRef)) fail(`Duplicate dependency registryRef: ${record.registryRef}`);
  registryRefs.add(record.registryRef);
  if (!techArchitecture.includes(record.registryRef)) fail(`Missing Technical Architecture registry ref: ${record.registryRef}`);
  if (record.packageManager === "npm") packageRecords.set(record.packageId, record.version);
}

const workspacePackageJsons = [
  "package.json",
  ...fs.readdirSync(path.join(root, "apps")).map((name) => `apps/${name}/package.json`),
  ...fs.readdirSync(path.join(root, "packages")).map((name) => `packages/${name}/package.json`)
].filter((file) => fs.existsSync(path.join(root, file)));

for (const file of workspacePackageJsons) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  for (const section of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(pkg[section] ?? {})) {
      if (name.startsWith("@pige/")) continue;
      usedNpmPackages.set(name, { file, version });
      if (!packageRecords.has(name)) fail(`${file} uses ${name} without dependency manifest record.`);
      if (packageRecords.get(name) !== version) fail(`${file} uses ${name}@${version}, manifest has ${packageRecords.get(name)}.`);
    }
  }
}

const lockfilePath = path.join(root, "package-lock.json");
if (!fs.existsSync(lockfilePath)) {
  fail("package-lock.json is required for reproducible npm installs.");
}

const lockfile = JSON.parse(fs.readFileSync(lockfilePath, "utf8"));
if (!lockfile.packages || typeof lockfile.packages !== "object") {
  fail("package-lock.json must contain a packages object.");
}

for (const [name, usage] of usedNpmPackages.entries()) {
  const lockEntry = lockfile.packages[`node_modules/${name}`];
  if (!lockEntry) fail(`package-lock.json is missing ${name} used by ${usage.file}.`);
  const expected = packageRecords.get(name)?.replace(/^[~^]/, "");
  if (lockEntry.version !== expected) {
    fail(`package-lock.json has ${name}@${lockEntry.version}, manifest expects ${expected}.`);
  }
}

if (waivers.schemaVersion !== 1 || !Array.isArray(waivers.waivers)) {
  fail("Dependency waiver manifest must use schemaVersion 1 and waivers array.");
}

const today = new Date().toISOString().slice(0, 10);
for (const waiver of waivers.waivers) {
  if (!waiver.expiresAt || waiver.expiresAt < today) fail(`Expired dependency waiver: ${waiver.registryRef}`);
}

console.log(`Dependency manifest OK: ${manifest.records.length} records, ${waivers.waivers.length} waivers.`);
