import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const options = parseOptions(process.argv.slice(2));
if (!options.platform || !options.arch) throw new Error("Package resource preparation requires --platform and --arch.");

const desktopRoot = path.join(root, "apps/desktop");
const desktopPackage = readJson(path.join(desktopRoot, "package.json"));
const lockfile = readJson(path.join(root, "package-lock.json"));
const outputRoot = path.join(root, "artifacts/release-packageability/package-resources");
const legalRoot = path.join(outputRoot, "legal");
const licenseRoot = path.join(legalRoot, "third-party-licenses");
const sbomRoot = path.join(outputRoot, "sbom");

fs.rmSync(path.join(root, "artifacts/release-packageability/macos-arm64"), { recursive: true, force: true });
fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(licenseRoot, { recursive: true });
fs.mkdirSync(sbomRoot, { recursive: true });

const packagesByKey = new Map();
const dependencyEdges = new Map();
const directRuntimeRefs = new Set();
const pending = [];
for (const name of Object.keys(desktopPackage.dependencies ?? {})) {
  pending.push({ name, requesterRoot: desktopRoot, required: true, direct: true });
}

while (pending.length > 0) {
  const request = pending.shift();
  const packageRoot = resolveInstalledPackage(request.requesterRoot, request.name);
  if (!packageRoot) {
    if (request.required) throw new Error(`Missing installed production dependency: ${request.name}`);
    continue;
  }
  const packageJson = readJson(path.join(packageRoot, "package.json"));
  if (packageJson.name?.startsWith("@pige/")) {
    enqueueDependencies(packageJson, packageRoot, undefined, true);
    continue;
  }
  const key = `${packageJson.name}@${packageJson.version}`;
  const bomRef = npmPurl(packageJson.name, packageJson.version);
  const existing = packagesByKey.get(key);
  if (existing && existing.packageRoot !== packageRoot) {
    const existingHash = checksumFile(path.join(existing.packageRoot, "package.json"));
    const currentHash = checksumFile(path.join(packageRoot, "package.json"));
    if (existingHash !== currentHash) throw new Error(`Conflicting installed package bytes for ${key}.`);
  }
  if (!existing) {
    packagesByKey.set(key, { packageRoot, packageJson, bomRef });
    enqueueDependencies(packageJson, packageRoot, bomRef);
  }
  if (request.direct) directRuntimeRefs.add(bomRef);
}

addManualRuntimePackage("electron");

const packages = [...packagesByKey.values()].sort((left, right) => left.bomRef.localeCompare(right.bomRef));
const attributions = [];
const components = [];
for (const entry of packages) {
  const { packageRoot, packageJson, bomRef } = entry;
  const licenseExpression = normalizeLicense(packageJson.license ?? packageJson.licenses?.[0]);
  const shippedLicenseFiles = fs.readdirSync(packageRoot, { withFileTypes: true })
    .filter((candidate) => candidate.isFile() && /^(?:licen[cs]e|copying|notice)(?:[._-]|$)/iu.test(candidate.name))
    .map((candidate) => candidate.name)
    .sort((left, right) => left.localeCompare(right));
  const licenseSources = shippedLicenseFiles.length > 0
    ? shippedLicenseFiles.map((fileName) => ({ fileName, sourcePath: path.join(packageRoot, fileName), source: "package" }))
    : [createFallbackLicenseSource(packageJson, licenseExpression)];
  if (licenseSources.length === 0) {
    throw new Error(`No complete installed license text is available for ${packageJson.name}@${packageJson.version} (${licenseExpression}).`);
  }
  const packageLicenseRoot = path.join(licenseRoot, `${safeName(packageJson.name)}@${safeName(packageJson.version)}`);
  fs.mkdirSync(packageLicenseRoot, { recursive: true });
  const copiedLicenses = licenseSources.map(({ fileName, sourcePath, content, source }) => {
    const destinationPath = path.join(packageLicenseRoot, safeName(fileName));
    if (sourcePath) fs.copyFileSync(sourcePath, destinationPath);
    else fs.writeFileSync(destinationPath, content, "utf8");
    return {
      path: toPosix(path.relative(outputRoot, destinationPath)),
      sha256: checksumFile(destinationPath),
      source
    };
  });
  attributions.push({
    name: packageJson.name,
    version: packageJson.version,
    license: licenseExpression,
    purl: bomRef,
    licenseFiles: copiedLicenses
  });
  components.push({
    type: packageJson.name === "electron" ? "framework" : "library",
    "bom-ref": bomRef,
    ...(packageJson.name.startsWith("@") ? { group: packageJson.name.split("/")[0] } : {}),
    name: packageJson.name.startsWith("@") ? packageJson.name.split("/")[1] : packageJson.name,
    version: packageJson.version,
    purl: bomRef,
    licenses: [{ expression: licenseExpression }],
    ...integrityHashes(packageRoot)
  });
}

const helperPath = path.join(root, "artifacts/native/macos/arm64/pige-vision-ocr");
const helperManifest = readJson(path.join(root, "artifacts/native/macos/arm64/pige-vision-ocr.manifest.json"));
if (!fs.statSync(helperPath).isFile()) throw new Error("The macOS Vision OCR helper must be built before package resources.");
const helperRef = `pkg:generic/pige-vision-ocr@${encodeURIComponent(helperManifest.helperVersion)}`;
components.push({
  type: "file",
  "bom-ref": helperRef,
  name: "pige-vision-ocr",
  version: helperManifest.helperVersion,
  hashes: [{ alg: "SHA-256", content: checksumFile(helperPath).replace("sha256:", "") }],
  properties: [
    { name: "pige:platform", value: helperManifest.platform },
    { name: "pige:arch", value: helperManifest.arch },
    { name: "pige:protocolVersion", value: String(helperManifest.protocolVersion) }
  ]
});

const appRef = "pkg:generic/pige@0.0.0";
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: deterministicSerialNumber(lockfile, options),
  version: 1,
  metadata: {
    component: {
      type: "application",
      "bom-ref": appRef,
      name: "Pige",
      version: desktopPackage.version,
      licenses: [{ expression: "Apache-2.0" }],
      properties: [
        { name: "pige:platform", value: options.platform },
        { name: "pige:arch", value: options.arch }
      ]
    }
  },
  components: components.sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"])),
  dependencies: [
    { ref: appRef, dependsOn: [...directRuntimeRefs, npmPurl("electron", readInstalledVersion("electron")), helperRef].sort() },
    ...packages.map((entry) => ({
      ref: entry.bomRef,
      dependsOn: [...(dependencyEdges.get(entry.bomRef) ?? [])].sort()
    })),
    { ref: helperRef, dependsOn: [] }
  ].sort((left, right) => left.ref.localeCompare(right.ref))
};

const attributionPath = path.join(legalRoot, "third-party-attribution.json");
const sbomPath = path.join(sbomRoot, "pige.cdx.json");
writeJson(attributionPath, {
  schemaVersion: 1,
  platform: options.platform,
  arch: options.arch,
  packages: attributions
});
writeJson(sbomPath, sbom);

const generatedFiles = listFiles(outputRoot)
  .filter((filePath) => !filePath.endsWith("package-resource-manifest.json"))
  .map((filePath) => ({
    path: toPosix(path.relative(outputRoot, filePath)),
    bytes: fs.statSync(filePath).size,
    sha256: checksumFile(filePath)
  }));
writeJson(path.join(outputRoot, "package-resource-manifest.json"), {
  schemaVersion: 1,
  platform: options.platform,
  arch: options.arch,
  packageCount: packages.length,
  files: generatedFiles
});

for (const requiredName of [
  "electron",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "pdfjs-dist",
  "@napi-rs/canvas",
  "mammoth",
  "fast-xml-parser",
  "@mozilla/readability",
  "jsdom",
  "undici"
]) {
  if (!packages.some((entry) => entry.packageJson.name === requiredName)) {
    throw new Error(`Artifact SBOM is missing required component ${requiredName}.`);
  }
}
for (const buildOnlyName of ["@electron/asar", "electron-builder", "typescript", "vite", "vitest"]) {
  if (packages.some((entry) => entry.packageJson.name === buildOnlyName)) {
    throw new Error(`Artifact SBOM must exclude build-only dependency ${buildOnlyName}.`);
  }
}
for (const generatedJsonPath of [attributionPath, sbomPath, path.join(outputRoot, "package-resource-manifest.json")]) {
  const content = fs.readFileSync(generatedJsonPath, "utf8");
  if (content.includes(root) || /(?:\/Users\/|[A-Za-z]:\\Users\\)/u.test(content)) {
    throw new Error(`Package resource metadata contains a private build path: ${path.basename(generatedJsonPath)}`);
  }
}
console.log(`Package resources prepared: ${packages.length} runtime packages, ${generatedFiles.length} attributed files.`);

function enqueueDependencies(packageJson, packageRoot, ownerRef, rootOwned = false) {
  const requiredNames = Object.keys(packageJson.dependencies ?? {});
  const optionalNames = Object.keys(packageJson.optionalDependencies ?? {});
  const peerNames = Object.keys(packageJson.peerDependencies ?? {});
  const childRefs = dependencyEdges.get(ownerRef) ?? new Set();
  if (ownerRef) dependencyEdges.set(ownerRef, childRefs);
  for (const name of [...new Set([...requiredNames, ...optionalNames, ...peerNames])]) {
    const required = requiredNames.includes(name) && !optionalNames.includes(name);
    const childRoot = resolveInstalledPackage(packageRoot, name);
    if (!childRoot) {
      if (required) throw new Error(`Missing installed dependency ${name} required by ${packageJson.name}.`);
      continue;
    }
    const childPackage = readJson(path.join(childRoot, "package.json"));
    if (!childPackage.name?.startsWith("@pige/") && ownerRef) {
      childRefs.add(npmPurl(childPackage.name, childPackage.version));
    }
    if (!childPackage.name?.startsWith("@pige/") && rootOwned) {
      directRuntimeRefs.add(npmPurl(childPackage.name, childPackage.version));
    }
    pending.push({ name, requesterRoot: packageRoot, required, direct: false });
  }
}

function addManualRuntimePackage(name) {
  const packageRoot = resolveInstalledPackage(root, name);
  if (!packageRoot) throw new Error(`Missing installed packaged runtime ${name}.`);
  const packageJson = readJson(path.join(packageRoot, "package.json"));
  const key = `${packageJson.name}@${packageJson.version}`;
  if (!packagesByKey.has(key)) {
    const bomRef = npmPurl(packageJson.name, packageJson.version);
    packagesByKey.set(key, { packageRoot, packageJson, bomRef });
    dependencyEdges.set(bomRef, new Set());
  }
}

function resolveInstalledPackage(requesterRoot, name) {
  const nameParts = name.split("/");
  let current = requesterRoot;
  while (true) {
    const candidate = path.join(current, "node_modules", ...nameParts);
    if (fs.existsSync(path.join(candidate, "package.json"))) return fs.realpathSync(candidate);
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function integrityHashes(packageRoot) {
  const relativePath = toPosix(path.relative(root, packageRoot));
  const integrity = lockfile.packages?.[relativePath]?.integrity;
  const first = typeof integrity === "string" ? integrity.split(/\s+/u)[0] : undefined;
  const separator = first?.indexOf("-") ?? -1;
  if (!first || separator < 1) return {};
  const algorithm = first.slice(0, separator).toUpperCase().replace("SHA", "SHA-");
  const content = Buffer.from(first.slice(separator + 1), "base64").toString("hex");
  return { hashes: [{ alg: algorithm, content }] };
}

function normalizeLicense(license) {
  const expression = typeof license === "string" ? license : license?.type;
  if (!expression || typeof expression !== "string") throw new Error("Every packaged npm component needs license metadata.");
  return expression;
}

function createFallbackLicenseSource(packageJson, expression) {
  if (packageJson.name === "@earendil-works/pi-agent-core" || packageJson.name === "@earendil-works/pi-ai") {
    return {
      fileName: "LICENSE",
      sourcePath: path.join(root, "resources/licenses/pi-MIT.txt"),
      source: "reviewed_upstream_project_license"
    };
  }
  if (packageJson.name === "@napi-rs/canvas-darwin-arm64") {
    return {
      fileName: "LICENSE",
      sourcePath: path.join(root, "node_modules/@napi-rs/canvas/LICENSE"),
      source: "installed_parent_project_license"
    };
  }
  if (expression === "Apache-2.0") {
    return {
      fileName: "LICENSE",
      sourcePath: path.join(root, "LICENSE"),
      source: "canonical_spdx_text"
    };
  }
  const attribution = packageAttribution(packageJson);
  const content = expression === "MIT"
    ? mitLicense(attribution)
    : expression === "BSD-2-Clause"
      ? bsdTwoClauseLicense(attribution)
      : expression === "ISC"
        ? iscLicense(attribution)
        : undefined;
  if (!content) {
    throw new Error(`No complete fallback license template is available for ${packageJson.name}@${packageJson.version} (${expression}).`);
  }
  return { fileName: "LICENSE", content, source: "generated_spdx_with_package_attribution" };
}

function packageAttribution(packageJson) {
  if (typeof packageJson.author === "string" && packageJson.author.trim()) return packageJson.author.trim();
  if (packageJson.author?.name) return packageJson.author.name;
  const maintainers = Array.isArray(packageJson.maintainers)
    ? packageJson.maintainers.map((maintainer) => maintainer?.name ?? maintainer?.email).filter(Boolean)
    : [];
  return maintainers.length > 0 ? maintainers.join(", ") : `${packageJson.name} contributors`;
}

function mitLicense(attribution) {
  return `MIT License\n\nCopyright (c) ${attribution}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`;
}

function bsdTwoClauseLicense(attribution) {
  return `Copyright (c) ${attribution}\nAll rights reserved.\n\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted provided that the following conditions are met:\n\n1. Redistributions of source code must retain the above copyright notice, this\n   list of conditions and the following disclaimer.\n2. Redistributions in binary form must reproduce the above copyright notice,\n   this list of conditions and the following disclaimer in the documentation\n   and/or other materials provided with the distribution.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"\nAND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE\nIMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE\nDISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE\nFOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL\nDAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR\nSERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER\nCAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,\nOR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE\nOF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.\n`;
}

function iscLicense(attribution) {
  return `Copyright (c) ${attribution}\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH\nREGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY\nAND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,\nINDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM\nLOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR\nOTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR\nPERFORMANCE OF THIS SOFTWARE.\n`;
}

function npmPurl(name, version) {
  const encodedName = name.startsWith("@")
    ? `${encodeURIComponent(name.split("/")[0])}/${encodeURIComponent(name.split("/")[1])}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function readInstalledVersion(name) {
  const packageRoot = resolveInstalledPackage(root, name);
  if (!packageRoot) throw new Error(`Missing installed package ${name}.`);
  return readJson(path.join(packageRoot, "package.json")).version;
}

function deterministicSerialNumber(currentLockfile, currentOptions) {
  const digest = createHash("sha256")
    .update(JSON.stringify(currentLockfile))
    .update("\0")
    .update(currentOptions.platform)
    .update("\0")
    .update(currentOptions.arch)
    .digest("hex");
  return `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function listFiles(directoryPath) {
  const files = [];
  const pendingDirectories = [directoryPath];
  while (pendingDirectories.length > 0) {
    const current = pendingDirectories.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pendingDirectories.push(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function checksumFile(filePath) {
  return `sha256:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeName(value) {
  return value.replaceAll("@", "").replaceAll("/", "__").replaceAll(/[^A-Za-z0-9._+-]/gu, "_");
}

function toPosix(value) {
  return value.replaceAll(path.sep, "/");
}

function parseOptions(args) {
  return Object.fromEntries(args.map((argument) => {
    const [key, value] = argument.replace(/^--/u, "").split("=", 2);
    return [key, value];
  }));
}
