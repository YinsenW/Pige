import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import yauzl from "yauzl";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PADDLE_TOOL_ID = "paddleocr_local";
const WRAPPER_DESTINATION = "pige/paddle_ocr_wrapper.py";
const SPDX_VERSION = "SPDX-2.3";
const CYCLONEDX_VERSION = "1.6";

export async function buildPaddleOcrReleaseBundle(input) {
  const parserManifestPath = requireRegularFile(input.parserManifestPath, "reviewed parser manifest");
  const wheelLockPath = requireRegularFile(input.wheelLockPath, "selected-wheel lock");
  const artifactRoot = requireDirectory(input.artifactRoot, "artifact root");
  const legalRoot = requireDirectory(input.legalRoot, "legal root");
  const wrapperPath = requireRegularFile(input.wrapperPath, "fixed PaddleOCR wrapper");
  const outputPath = requireAbsentOutput(input.outputPath);

  const parserManifestBytes = readBoundedFile(parserManifestPath, 2 * 1024 * 1024);
  const wheelLockBytes = readBoundedFile(wheelLockPath, 8 * 1024 * 1024);
  const parserManifest = parseReviewedPaddleOcrManifest(parseJson(parserManifestBytes, "reviewed parser manifest"));
  const wheelLock = parseSelectedWheelLock(parseJson(wheelLockBytes, "selected-wheel lock"), parserManifest);
  verifyInputFiles({ artifactRoot, legalRoot, wrapperPath, parserManifest, wheelLock });

  const temporaryPath = `${outputPath}.tmp-${randomUUID()}`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  fs.mkdirSync(temporaryPath, { mode: 0o700 });
  try {
    const extractionRoot = path.join(temporaryPath, ".release-extraction");
    fs.mkdirSync(extractionRoot, { mode: 0o700 });
    await materializePythonRuntime({ temporaryPath, extractionRoot, artifactRoot, parserManifest, wheelLock });
    await materializeWheels({ temporaryPath, artifactRoot, wheelLock });
    await materializeModels({ temporaryPath, extractionRoot, artifactRoot, parserManifest, wheelLock });
    copyVerifiedFile(wrapperPath, path.join(temporaryPath, WRAPPER_DESTINATION), wheelLock.wrapper, false);
    materializeLegalFiles({ temporaryPath, legalRoot, wheelLock });
    writeSupplyChainMetadata({
      temporaryPath,
      parserManifest,
      parserManifestBytes,
      wheelLock,
      wheelLockBytes
    });
    fs.rmSync(extractionRoot, { recursive: true, force: true });

    const files = collectPackageFiles(temporaryPath, wheelLock.limits)
      .filter((entry) => entry.path !== "manifest.json");
    const localToolManifest = {
      schemaVersion: 1,
      toolId: PADDLE_TOOL_ID,
      version: parserManifest.engineVersion,
      platform: wheelLock.platform === "macos-arm64" ? "macos" : "windows",
      architecture: wheelLock.platform === "macos-arm64" ? "arm64" : "x64",
      capabilities: ["ocr.image"],
      license: wheelLock.bundleLicense,
      files
    };
    writeExclusiveJson(path.join(temporaryPath, "manifest.json"), localToolManifest, 0o600);
    fs.renameSync(temporaryPath, outputPath);
    return Object.freeze({
      outputPath,
      manifest: localToolManifest,
      packageSha256: computePackageSha256(outputPath, localToolManifest),
      sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
      fileCount: files.length
    });
  } catch (caught) {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
    throw caught;
  }
}

export function parseSelectedWheelLock(value, parserManifest) {
  const record = requireObject(value, "selected-wheel lock");
  assertExactKeys(record, [
    "schemaVersion", "toolId", "catalogVersion", "engineVersion", "platform", "pythonAbi",
    "bundleLicense", "wrapper", "limits", "wheels", "legal"
  ], "selected-wheel lock");
  if (record.schemaVersion !== 1 || record.toolId !== PADDLE_TOOL_ID) {
    fail("Selected-wheel lock identity is invalid.");
  }
  if (record.catalogVersion !== parserManifest.catalogVersion || record.engineVersion !== parserManifest.engineVersion) {
    fail("Selected-wheel lock does not match the reviewed parser catalog.");
  }
  const platform = requireEnum(record.platform, parserManifest.platforms, "selected-wheel lock platform");
  const pythonAbi = requireString(record.pythonAbi, "pythonAbi", 2, 32);
  if (pythonAbi !== "cp313") fail("Selected-wheel lock must target the reviewed CPython ABI.");
  const bundleLicense = parseLicense(record.bundleLicense, "bundleLicense");
  const wrapper = parseFileIdentity(record.wrapper, "wrapper");
  const limits = parseLimits(record.limits);
  const wheels = parseWheels(record.wheels, platform);
  const legal = parseLegalRecords(record.legal);
  validateWheelClosure(wheels, parserManifest, platform);
  validateLegalCoverage(legal, wheels, parserManifest);
  return Object.freeze({
    schemaVersion: 1,
    toolId: PADDLE_TOOL_ID,
    catalogVersion: parserManifest.catalogVersion,
    engineVersion: parserManifest.engineVersion,
    platform,
    pythonAbi,
    bundleLicense,
    wrapper,
    limits,
    wheels,
    legal
  });
}

export function parseReviewedPaddleOcrManifest(value) {
  const record = requireObject(value, "reviewed parser manifest");
  if (record.schemaVersion !== 1 || record.id !== PADDLE_TOOL_ID) fail("Reviewed parser manifest identity is invalid.");
  const catalogVersion = requireString(record.catalogVersion, "catalogVersion", 1, 80);
  if (!/^20[0-9]{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/u.test(catalogVersion)) {
    fail("Reviewed parser catalogVersion must be an exact calendar date.");
  }
  const engineVersion = requireString(record.engineVersion, "engineVersion", 1, 80);
  if (
    record.executionBoundary !== "isolated_managed_python_process" ||
    record.networkAccessDuringOcr !== false || record.hiddenDownloads !== false
  ) fail("Reviewed parser manifest does not preserve the offline managed-runtime boundary.");
  const materialization = requireObject(record.materialization, "materialization");
  if (
    materialization.mode !== "release_preassembled_verified_bundle" ||
    materialization.userMachinePackageResolution !== false || materialization.userMachineSourceBuild !== false
  ) fail("Reviewed parser manifest does not require a preassembled release bundle.");
  const platforms = requireUniqueStrings(record.platforms, "platforms", 2);
  if (JSON.stringify(platforms) !== JSON.stringify(["macos-arm64", "windows-x64"])) {
    fail("Reviewed parser manifest has an unsupported platform set.");
  }
  const capabilities = requireUniqueStrings(record.capabilities, "capabilities", 64);
  const runtime = requireObject(record.pythonRuntime, "pythonRuntime");
  const runtimeAssets = parseReviewedAssets(runtime.assets, "pythonRuntime.assets", platforms);
  const pythonPackages = parseReviewedPythonPackages(record.pythonPackages);
  const paddle = requireObject(record.paddlePaddle, "paddlePaddle");
  if (paddle.backend !== "cpu") fail("Reviewed PaddlePaddle backend must remain CPU-only.");
  const paddleVersion = requireString(paddle.version, "paddlePaddle.version", 1, 80);
  const paddleLicense = requireString(paddle.license, "paddlePaddle.license", 1, 120);
  const paddleAssets = parseReviewedAssets(paddle.assets, "paddlePaddle.assets", platforms, {
    name: "paddlepaddle",
    version: paddleVersion,
    license: paddleLicense
  });
  const models = parseReviewedModels(record.models);
  return Object.freeze({
    catalogVersion,
    engineVersion,
    platforms,
    capabilities,
    pythonRuntime: {
      implementation: requireString(runtime.implementation, "pythonRuntime.implementation", 1, 80),
      version: requireString(runtime.version, "pythonRuntime.version", 1, 80),
      license: requireString(runtime.projectLicense, "pythonRuntime.projectLicense", 1, 120),
      assets: runtimeAssets
    },
    pythonPackages,
    paddlePaddle: { name: "paddlepaddle", version: paddleVersion, license: paddleLicense, assets: paddleAssets },
    models
  });
}

function parseReviewedAssets(value, label, platforms, shared = undefined) {
  if (!Array.isArray(value) || value.length !== platforms.length) fail(`${label} must cover every reviewed platform.`);
  const assets = value.map((entry, index) => {
    const asset = requireObject(entry, `${label}[${index}]`);
    const platform = requireEnum(asset.platform, platforms, `${label}[${index}].platform`);
    const url = requireReviewedUrl(asset.url, `${label}[${index}].url`);
    return Object.freeze({
      ...(shared ?? {}),
      platform,
      filename: reviewedUrlFilename(url),
      url,
      sizeBytes: requirePositiveSize(asset.sizeBytes, `${label}[${index}].sizeBytes`),
      sha256: requireSha256(asset.sha256, `${label}[${index}].sha256`)
    });
  });
  if (new Set(assets.map((asset) => asset.platform)).size !== platforms.length) fail(`${label} contains duplicate platforms.`);
  return assets.sort((left, right) => compareText(left.platform, right.platform));
}

function parseReviewedPythonPackages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) fail("Reviewed Python packages are invalid.");
  const packages = value.map((entry, index) => {
    const item = requireObject(entry, `pythonPackages[${index}]`);
    const filename = requireSafeFilename(item.filename, `pythonPackages[${index}].filename`);
    const url = requireReviewedUrl(item.url, `pythonPackages[${index}].url`);
    if (filename !== reviewedUrlFilename(url) || !filename.endsWith(".whl")) fail("Reviewed Python package is not an exact wheel.");
    return Object.freeze({
      name: normalizePythonName(requireString(item.name, "python package name", 1, 120)),
      version: requireString(item.version, "python package version", 1, 80),
      license: requireString(item.license, "python package license", 1, 120),
      filename,
      url,
      sizeBytes: requirePositiveSize(item.sizeBytes, "python package size"),
      sha256: requireSha256(item.sha256, "python package sha256")
    });
  }).sort((left, right) => compareText(left.name, right.name));
  if (new Set(packages.map((item) => item.name)).size !== packages.length) fail("Reviewed Python packages contain a duplicate name.");
  return packages;
}

function parseReviewedModels(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) fail("Reviewed OCR models are invalid.");
  const models = value.map((entry, index) => {
    const model = requireObject(entry, `models[${index}]`);
    const id = requireSafeId(model.id, `models[${index}].id`);
    const url = requireReviewedUrl(model.url, `models[${index}].url`);
    const filename = reviewedUrlFilename(url);
    if (!filename.endsWith(".tar")) fail("Reviewed OCR model must be a tar archive.");
    return Object.freeze({
      id,
      directoryName: `${id}_infer`,
      role: requireString(model.role, "model role", 1, 80),
      license: requireString(model.license, "model license", 1, 120),
      filename,
      url,
      sizeBytes: requirePositiveSize(model.sizeBytes, "model size"),
      sha256: requireSha256(model.sha256, "model sha256")
    });
  }).sort((left, right) => compareText(left.id, right.id));
  if (new Set(models.map((model) => model.id.toLocaleLowerCase("en-US"))).size !== models.length) {
    fail("Reviewed OCR models contain a case-colliding ID.");
  }
  if (new Set(models.map((model) => model.filename.toLocaleLowerCase("en-US"))).size !== models.length) {
    fail("Reviewed OCR models contain a case-colliding artifact filename.");
  }
  return models;
}

function parseWheels(value, platform) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 512) fail("Selected-wheel lock has an invalid wheel set.");
  const wheels = value.map((entry, index) => {
    const wheel = requireObject(entry, `wheels[${index}]`);
    assertExactKeys(wheel, [
      "name", "version", "filename", "sizeBytes", "sha256", "metadataSha256", "license", "purl", "dependencies"
    ], `wheels[${index}]`);
    const name = normalizePythonName(requireString(wheel.name, "wheel name", 1, 120));
    const version = requireString(wheel.version, "wheel version", 1, 80);
    const filename = requireSafeFilename(wheel.filename, "wheel filename");
    assertPaddleOcrWheelFilename(filename, name, version, platform);
    const dependencies = requireStringList(wheel.dependencies, "wheel dependencies", 128, true)
      .map(normalizePythonName)
      .sort(compareText);
    if (dependencies.includes(name)) fail(`Wheel ${name} cannot depend on itself.`);
    return Object.freeze({
      name,
      version,
      filename,
      sizeBytes: requirePositiveSize(wheel.sizeBytes, "wheel sizeBytes"),
      sha256: requireSha256(wheel.sha256, "wheel sha256"),
      metadataSha256: requireSha256(wheel.metadataSha256, "wheel metadataSha256"),
      license: requireString(wheel.license, "wheel license", 1, 160),
      purl: requirePurl(wheel.purl, name, version),
      dependencies
    });
  });
  const sorted = [...wheels].sort((left, right) => compareText(left.name, right.name));
  if (JSON.stringify(wheels.map((wheel) => wheel.name)) !== JSON.stringify(sorted.map((wheel) => wheel.name))) {
    fail("Selected wheels must be sorted by normalized package name.");
  }
  if (new Set(wheels.map((wheel) => wheel.name)).size !== wheels.length) fail("Selected-wheel lock contains duplicate packages.");
  return wheels;
}

function parseLegalRecords(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1024) fail("Selected-wheel legal inventory is invalid.");
  const records = value.map((entry, index) => {
    const record = requireObject(entry, `legal[${index}]`);
    assertExactKeys(record, ["componentId", "licenseExpression", "files"], `legal[${index}]`);
    const componentId = requireComponentId(record.componentId, `legal[${index}].componentId`);
    const licenseExpression = requireString(record.licenseExpression, "licenseExpression", 1, 160);
    if (!Array.isArray(record.files) || record.files.length === 0 || record.files.length > 64) {
      fail(`Legal component ${componentId} has no bounded license inventory.`);
    }
    let hasLicense = false;
    const files = record.files.map((fileValue, fileIndex) => {
      const file = requireObject(fileValue, `legal[${index}].files[${fileIndex}]`);
      assertExactKeys(file, ["path", "kind", "sizeBytes", "sha256"], "legal file");
      const kind = requireEnum(file.kind, ["license", "notice"], "legal file kind");
      if (kind === "license") hasLicense = true;
      return Object.freeze({
        path: requireSafeRelativePath(file.path, "legal file path"),
        kind,
        sizeBytes: requirePositiveSize(file.sizeBytes, "legal file sizeBytes"),
        sha256: requireSha256(file.sha256, "legal file sha256")
      });
    }).sort((left, right) => compareText(left.path, right.path));
    if (!hasLicense) fail(`Legal component ${componentId} is missing a license text.`);
    return Object.freeze({ componentId, licenseExpression, files });
  });
  const sorted = [...records].sort((left, right) => compareText(left.componentId, right.componentId));
  if (JSON.stringify(records.map((record) => record.componentId)) !== JSON.stringify(sorted.map((record) => record.componentId))) {
    fail("Legal component records must be sorted.");
  }
  if (new Set(records.map((record) => record.componentId)).size !== records.length) fail("Legal component IDs must be unique.");
  return records;
}

function parseLimits(value) {
  const limits = requireObject(value, "limits");
  assertExactKeys(limits, ["maxFiles", "maxFileBytes", "maxTotalBytes", "maxArchiveEntries", "maxArchiveExpandedBytes"], "limits");
  return Object.freeze({
    maxFiles: requireInteger(limits.maxFiles, "maxFiles", 1, 1_000_000),
    maxFileBytes: requireInteger(limits.maxFileBytes, "maxFileBytes", 1, 2 ** 40),
    maxTotalBytes: requireInteger(limits.maxTotalBytes, "maxTotalBytes", 1, 2 ** 44),
    maxArchiveEntries: requireInteger(limits.maxArchiveEntries, "maxArchiveEntries", 1, 1_000_000),
    maxArchiveExpandedBytes: requireInteger(limits.maxArchiveExpandedBytes, "maxArchiveExpandedBytes", 1, 2 ** 44)
  });
}

function validateWheelClosure(wheels, parserManifest, platform) {
  const wheelByName = new Map(wheels.map((wheel) => [wheel.name, wheel]));
  const expectedRoots = [
    ...parserManifest.pythonPackages.map((item) => item.name),
    parserManifest.paddlePaddle.name
  ].sort(compareText);
  for (const rootName of expectedRoots) if (!wheelByName.has(rootName)) fail(`Selected-wheel lock is missing reviewed root ${rootName}.`);
  for (const wheel of wheels) {
    for (const dependency of wheel.dependencies) {
      if (!wheelByName.has(dependency)) fail(`Selected wheel ${wheel.name} has missing dependency ${dependency}.`);
    }
  }
  const reachable = new Set();
  const pending = [...expectedRoots];
  while (pending.length > 0) {
    const name = pending.pop();
    if (reachable.has(name)) continue;
    reachable.add(name);
    pending.push(...wheelByName.get(name).dependencies);
  }
  if (reachable.size !== wheels.length) fail("Selected-wheel lock contains packages outside the reviewed dependency closure.");
  for (const reviewed of parserManifest.pythonPackages) assertReviewedWheel(wheelByName.get(reviewed.name), reviewed);
  const paddleAsset = parserManifest.paddlePaddle.assets.find((asset) => asset.platform === platform);
  assertReviewedWheel(wheelByName.get(parserManifest.paddlePaddle.name), paddleAsset);
}

function assertReviewedWheel(actual, reviewed) {
  if (
    actual.version !== reviewed.version || actual.filename !== reviewed.filename || actual.sizeBytes !== reviewed.sizeBytes ||
    actual.sha256 !== reviewed.sha256 || actual.license !== reviewed.license
  ) fail(`Selected wheel ${reviewed.name} differs from the reviewed parser manifest.`);
}

function validateLegalCoverage(legal, wheels, parserManifest) {
  const expected = new Set([
    "runtime:cpython",
    "wrapper:pige",
    ...wheels.map((wheel) => `wheel:${wheel.name}`),
    ...parserManifest.models.map((model) => `model:${model.id}`)
  ]);
  const actual = new Set(legal.map((record) => record.componentId));
  if (actual.size !== expected.size || [...expected].some((id) => !actual.has(id))) {
    fail("Legal inventory must cover exactly the runtime, wrapper, selected wheels, and reviewed models.");
  }
  const legalById = new Map(legal.map((record) => [record.componentId, record]));
  const runtimeLegal = legalById.get("runtime:cpython");
  if (runtimeLegal.licenseExpression !== parserManifest.pythonRuntime.license) {
    fail("CPython legal identity differs from the reviewed parser manifest.");
  }
  if (!runtimeLegal.files.some((file) =>
    file.kind === "license" && file.path === "runtime/python-build-standalone-MPL-2.0.txt"
  )) {
    fail("python-build-standalone MPL-2.0 license evidence is missing from the reviewed runtime inventory.");
  }
  for (const wheel of wheels) {
    if (legalById.get(`wheel:${wheel.name}`).licenseExpression !== wheel.license) {
      fail(`Wheel ${wheel.name} legal identity differs from the selected lock.`);
    }
  }
  for (const model of parserManifest.models) {
    if (legalById.get(`model:${model.id}`).licenseExpression !== model.license) {
      fail(`Model ${model.id} legal identity differs from the reviewed parser manifest.`);
    }
  }
  if (legalById.get("wrapper:pige").licenseExpression !== "Apache-2.0") {
    fail("Pige wrapper legal identity must remain Apache-2.0.");
  }
}

function verifyInputFiles({ artifactRoot, legalRoot, wrapperPath, parserManifest, wheelLock }) {
  const runtime = parserManifest.pythonRuntime.assets.find((asset) => asset.platform === wheelLock.platform);
  const paddle = parserManifest.paddlePaddle.assets.find((asset) => asset.platform === wheelLock.platform);
  const artifactIdentities = [
    runtime,
    ...wheelLock.wheels.map((wheel) => ({
      filename: wheel.filename, sizeBytes: wheel.sizeBytes, sha256: wheel.sha256
    })),
    ...parserManifest.models,
  ];
  if (!artifactIdentities.some((item) => item.filename === paddle.filename)) artifactIdentities.push(paddle);
  const expectedNames = artifactIdentities.map((item) => item.filename).sort(compareText);
  if (new Set(expectedNames).size !== expectedNames.length) fail("Release artifacts contain a filename collision.");
  const actualNames = listFlatRegularFiles(artifactRoot);
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) fail("Artifact root must contain exactly the locked release artifacts.");
  for (const identity of artifactIdentities) verifyFileIdentity(path.join(artifactRoot, identity.filename), identity, identity.filename);
  verifyFileIdentity(wrapperPath, wheelLock.wrapper, "fixed PaddleOCR wrapper");

  const expectedLegal = wheelLock.legal.flatMap((record) => record.files.map((file) => file.path)).sort(compareText);
  if (new Set(expectedLegal).size !== expectedLegal.length) fail("Legal source paths must be globally unique.");
  const actualLegal = collectRelativeRegularFiles(legalRoot);
  if (JSON.stringify(actualLegal) !== JSON.stringify(expectedLegal)) fail("Legal root must contain exactly the locked license and notice files.");
  for (const record of wheelLock.legal) {
    for (const file of record.files) verifyFileIdentity(path.join(legalRoot, ...file.path.split("/")), file, file.path);
  }
}

async function materializePythonRuntime({ temporaryPath, extractionRoot, artifactRoot, parserManifest, wheelLock }) {
  const runtime = parserManifest.pythonRuntime.assets.find((asset) => asset.platform === wheelLock.platform);
  const runtimeExtraction = path.join(extractionRoot, "runtime");
  fs.mkdirSync(runtimeExtraction, { mode: 0o700 });
  await extractTarArchive(
    path.join(artifactRoot, runtime.filename),
    runtimeExtraction,
    wheelLock.limits,
    { allowedSymbolicLinks: wheelLock.platform === "macos-arm64" ? ["python/bin/python3"] : [], allowHardLinks: true }
  );
  materializeRequiredRuntimeAliases(runtimeExtraction, wheelLock.platform);
  const roots = fs.readdirSync(runtimeExtraction).sort(compareText);
  if (JSON.stringify(roots) !== JSON.stringify(["python"])) fail("Python runtime archive must contain exactly the python root.");
  copyTreeWithoutLinks(path.join(runtimeExtraction, "python"), path.join(temporaryPath, "python"), wheelLock.limits);
  const executable = wheelLock.platform === "macos-arm64"
    ? path.join(temporaryPath, "python/bin/python3")
    : path.join(temporaryPath, "python/python.exe");
  requireRegularFile(executable, "reviewed Python executable");
}

async function materializeModels({ temporaryPath, extractionRoot, artifactRoot, parserManifest, wheelLock }) {
  const modelsRoot = path.join(temporaryPath, "models");
  fs.mkdirSync(modelsRoot, { mode: 0o700 });
  for (const model of parserManifest.models) {
    const modelExtraction = path.join(extractionRoot, `model-${safeOutputSegment(model.id)}`);
    fs.mkdirSync(modelExtraction, { mode: 0o700 });
    await extractTarArchive(
      path.join(artifactRoot, model.filename),
      modelExtraction,
      wheelLock.limits,
      { allowedSymbolicLinks: [], allowHardLinks: false }
    );
    const roots = fs.readdirSync(modelExtraction).sort(compareText);
    if (JSON.stringify(roots) !== JSON.stringify([model.directoryName])) {
      fail(`Model archive ${model.id} must contain exactly ${model.directoryName}.`);
    }
    copyTreeWithoutLinks(
      path.join(modelExtraction, model.directoryName),
      path.join(modelsRoot, model.directoryName),
      wheelLock.limits
    );
  }
}

async function materializeWheels({ temporaryPath, artifactRoot, wheelLock }) {
  const sitePackages = wheelLock.platform === "macos-arm64"
    ? path.join(temporaryPath, "python/lib/python3.13/site-packages")
    : path.join(temporaryPath, "python/Lib/site-packages");
  fs.mkdirSync(sitePackages, { recursive: true, mode: 0o700 });
  const reservedPaths = new Set(collectRelativeEntries(temporaryPath).map((entry) => entry.toLocaleLowerCase("en-US")));
  for (const wheel of wheelLock.wheels) {
    await extractWheel({
      wheelPath: path.join(artifactRoot, wheel.filename),
      wheel,
      platform: wheelLock.platform,
      packageRoot: temporaryPath,
      sitePackages,
      reservedPaths,
      limits: wheelLock.limits
    });
  }
}

async function extractWheel({ wheelPath, wheel, platform, packageRoot, sitePackages, reservedPaths, limits }) {
  const archive = await openZip(wheelPath);
  const expectedMetadataPath = rootWheelMetadataPath(wheel.filename);
  let entryCount = 0;
  let expandedBytes = 0;
  let metadataBytes;
  try {
    await new Promise((resolve, reject) => {
      archive.on("error", reject);
      archive.on("end", resolve);
      archive.on("entry", (entry) => {
        void (async () => {
          entryCount += 1;
          expandedBytes += entry.uncompressedSize;
          if (entryCount > limits.maxArchiveEntries || expandedBytes > limits.maxArchiveExpandedBytes || entry.uncompressedSize > limits.maxFileBytes) {
            fail(`Wheel ${wheel.filename} exceeds locked extraction limits.`);
          }
          const archivePath = requireSafeArchivePath(entry.fileName, `wheel ${wheel.filename}`);
          const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
          if ((unixMode & 0o170000) === 0o120000) fail(`Wheel ${wheel.filename} contains a symbolic link.`);
          if (archivePath.endsWith("/")) {
            archive.readEntry();
            return;
          }
          const destination = resolveWheelDestination({ archivePath, wheel, platform, packageRoot, sitePackages });
          const relativeDestination = toPosix(path.relative(packageRoot, destination));
          reserveOutputPath(relativeDestination, reservedPaths);
          const bytes = await readZipEntry(archive, entry, limits.maxFileBytes);
          if (archivePath === expectedMetadataPath) {
            if (metadataBytes) fail(`Wheel ${wheel.filename} contains duplicate METADATA.`);
            metadataBytes = bytes;
          }
          writeExclusiveFile(destination, bytes, isWheelScript(archivePath) && platform === "macos-arm64" ? 0o700 : 0o600);
          archive.readEntry();
        })().catch(reject);
      });
      archive.readEntry();
    });
  } finally {
    archive.close();
  }
  if (!metadataBytes || sha256(metadataBytes) !== wheel.metadataSha256) {
    fail(`Wheel ${wheel.filename} METADATA does not match the selected lock.`);
  }
  assertWheelMetadata(metadataBytes.toString("utf8"), wheel);
}

function rootWheelMetadataPath(filename) {
  const [distribution, version] = filename.slice(0, -4).split("-");
  if (!distribution || !version) fail(`Wheel ${filename} has no canonical root metadata path.`);
  return `${distribution}-${version}.dist-info/METADATA`;
}

function resolveWheelDestination({ archivePath, wheel, platform, packageRoot, sitePackages }) {
  const dataPrefixPattern = new RegExp(`^[^/]+\\.data/(purelib|platlib|data|scripts|headers)/(.+)$`, "u");
  const match = dataPrefixPattern.exec(archivePath);
  if (!match) return resolveWithin(sitePackages, archivePath, `wheel ${wheel.filename}`);
  const [, scheme, relativePath] = match;
  if (scheme === "purelib" || scheme === "platlib") return resolveWithin(sitePackages, relativePath, "wheel library data");
  if (scheme === "data") return resolveWithin(path.join(packageRoot, "python"), relativePath, "wheel data");
  if (scheme === "scripts") {
    const scriptsRoot = platform === "macos-arm64"
      ? path.join(packageRoot, "python/bin")
      : path.join(packageRoot, "python/Scripts");
    return resolveWithin(scriptsRoot, relativePath, "wheel scripts");
  }
  return resolveWithin(path.join(packageRoot, "python/include", safeOutputSegment(wheel.name)), relativePath, "wheel headers");
}

async function extractTarArchive(archivePath, destinationRoot, limits, linkPolicy) {
  let entries = 0;
  let expandedBytes = 0;
  const foldedPaths = new Set();
  await tar.x({
    file: archivePath,
    cwd: destinationRoot,
    gzip: archivePath.endsWith(".gz"),
    strict: true,
    preservePaths: false,
    filter: (entryPath, entry) => {
      const safePath = requireSafeArchivePath(entryPath, path.basename(archivePath));
      const folded = safePath.toLocaleLowerCase("en-US");
      if (foldedPaths.has(folded)) fail(`Archive ${path.basename(archivePath)} contains a path collision.`);
      foldedPaths.add(folded);
      entries += 1;
      expandedBytes += Number(entry.size ?? 0);
      if (entries > limits.maxArchiveEntries || expandedBytes > limits.maxArchiveExpandedBytes || Number(entry.size ?? 0) > limits.maxFileBytes) {
        fail(`Archive ${path.basename(archivePath)} exceeds locked extraction limits.`);
      }
      if (!["File", "OldFile", "Directory", "SymbolicLink", "Link"].includes(entry.type)) {
        fail(`Archive ${path.basename(archivePath)} contains unsupported entry type ${entry.type}.`);
      }
      if (entry.type === "SymbolicLink") {
        assertConfinedArchiveLink(safePath, entry.linkpath, entry.type, path.basename(archivePath));
        return linkPolicy.allowedSymbolicLinks.includes(safePath);
      }
      if (entry.type === "Link") {
        if (!linkPolicy.allowHardLinks) fail(`Archive ${path.basename(archivePath)} contains a forbidden hard link.`);
        assertConfinedArchiveLink(safePath, entry.linkpath, entry.type, path.basename(archivePath));
      }
      return true;
    }
  });
}

function materializeRequiredRuntimeAliases(runtimeRoot, platform) {
  const requiredAliases = platform === "macos-arm64" ? ["python/bin/python3"] : [];
  for (const relativePath of requiredAliases) {
    const aliasPath = path.join(runtimeRoot, ...relativePath.split("/"));
    const stats = fs.lstatSync(aliasPath);
    if (stats.isFile() && !stats.isSymbolicLink()) continue;
    if (!stats.isSymbolicLink()) fail(`Required runtime alias ${relativePath} is not a regular file or safe link.`);
    const resolved = fs.realpathSync(aliasPath);
    assertExistingPathWithinRoot(runtimeRoot, resolved, `runtime alias ${relativePath}`);
    const targetStats = fs.statSync(resolved);
    if (!targetStats.isFile()) fail(`Required runtime alias ${relativePath} does not target a regular file.`);
    fs.unlinkSync(aliasPath);
    copyRegularFile(resolved, aliasPath, targetStats.mode & 0o777);
  }
  collectRelativeRegularFiles(runtimeRoot);
}

function copyTreeWithoutLinks(sourceRoot, destinationRoot, limits) {
  const sourceStats = fs.lstatSync(sourceRoot);
  if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) fail("Release input tree must be a non-symlink directory.");
  if (fs.existsSync(destinationRoot)) fail(`Release output collision: ${destinationRoot}.`);
  fs.mkdirSync(destinationRoot, { mode: sourceStats.mode & 0o777 });
  let files = 0;
  let bytes = 0;
  const visit = (sourceDirectory, destinationDirectory) => {
    const entries = fs.readdirSync(sourceDirectory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const sourcePath = path.join(sourceDirectory, entry.name);
      const destinationPath = path.join(destinationDirectory, entry.name);
      const stats = fs.lstatSync(sourcePath);
      if (stats.isSymbolicLink()) fail("Release tree copy cannot preserve symbolic links.");
      if (stats.isDirectory()) {
        fs.mkdirSync(destinationPath, { mode: stats.mode & 0o777 });
        visit(sourcePath, destinationPath);
      } else if (stats.isFile()) {
        files += 1;
        bytes += stats.size;
        if (files > limits.maxArchiveEntries || bytes > limits.maxArchiveExpandedBytes || stats.size > limits.maxFileBytes) {
          fail("Release tree copy exceeds locked limits.");
        }
        copyRegularFile(sourcePath, destinationPath, stats.mode & 0o777);
      } else {
        fail("Release tree contains a non-regular entry.");
      }
    }
  };
  visit(sourceRoot, destinationRoot);
}

function materializeLegalFiles({ temporaryPath, legalRoot, wheelLock }) {
  const outputRecords = [];
  for (const record of wheelLock.legal) {
    const componentRoot = `legal/${safeOutputSegment(record.componentId)}`;
    const outputFiles = [];
    for (const file of record.files) {
      const destination = `${componentRoot}/${file.path}`;
      copyVerifiedFile(
        path.join(legalRoot, ...file.path.split("/")),
        path.join(temporaryPath, ...destination.split("/")),
        file,
        false
      );
      outputFiles.push({ ...file, path: destination });
    }
    outputRecords.push({
      componentId: record.componentId,
      licenseExpression: record.licenseExpression,
      files: outputFiles
    });
  }
  writeExclusiveJson(path.join(temporaryPath, "legal/THIRD-PARTY-NOTICES.json"), {
    schemaVersion: 1,
    toolId: PADDLE_TOOL_ID,
    components: outputRecords
  }, 0o600);
  const notice = [
    "Pige managed PaddleOCR bundle",
    "",
    "This bundle contains the following reviewed components. Complete license and notice texts are stored beside this file.",
    "",
    ...outputRecords.flatMap((record) => [
      `${record.componentId} — ${record.licenseExpression}`,
      ...record.files.map((file) => `  ${file.kind}: ${file.path}`)
    ]),
    ""
  ].join("\n");
  writeExclusiveFile(path.join(temporaryPath, "legal/NOTICE.txt"), Buffer.from(notice, "utf8"), 0o600);
}

function writeSupplyChainMetadata({ temporaryPath, parserManifest, parserManifestBytes, wheelLock, wheelLockBytes }) {
  writeExclusiveFile(
    path.join(temporaryPath, "supply-chain/paddleocr-local.parser.manifest.json"),
    parserManifestBytes,
    0o600
  );
  writeExclusiveFile(
    path.join(temporaryPath, "supply-chain/selected-wheels.lock.json"),
    wheelLockBytes,
    0o600
  );
  const components = supplyChainComponents(parserManifest, wheelLock);
  const inputIdentity = sha256(Buffer.concat([parserManifestBytes, Buffer.from("\0"), wheelLockBytes]));
  const namespace = `https://pige.ai/spdx/paddleocr-local/${wheelLock.platform}/${inputIdentity}`;
  const documentSpdxId = "SPDXRef-DOCUMENT";
  const spdxPackages = components.map((component, index) => ({
    SPDXID: `SPDXRef-Package-${index + 1}`,
    name: component.name,
    versionInfo: component.version,
    downloadLocation: component.url ?? "NONE",
    filesAnalyzed: false,
    licenseConcluded: component.license,
    licenseDeclared: component.license,
    copyrightText: "See bundled legal inventory",
    checksums: [{ algorithm: "SHA256", checksumValue: component.sha256 }],
    externalRefs: component.purl ? [{
      referenceCategory: "PACKAGE-MANAGER",
      referenceType: "purl",
      referenceLocator: component.purl
    }] : []
  }));
  const created = `${parserManifest.catalogVersion}T00:00:00Z`;
  writeExclusiveJson(path.join(temporaryPath, "sbom/paddleocr.spdx.json"), {
    spdxVersion: SPDX_VERSION,
    dataLicense: "CC0-1.0",
    SPDXID: documentSpdxId,
    name: `pige-paddleocr-${wheelLock.platform}`,
    documentNamespace: namespace,
    creationInfo: { created, creators: ["Organization: Pige"] },
    packages: spdxPackages,
    relationships: spdxPackages.map((component) => ({
      spdxElementId: documentSpdxId,
      relationshipType: "DESCRIBES",
      relatedSpdxElement: component.SPDXID
    }))
  }, 0o600);

  const bundleRef = `pkg:generic/pige-paddleocr-bundle@${encodeURIComponent(parserManifest.engineVersion)}?platform=${wheelLock.platform}`;
  writeExclusiveJson(path.join(temporaryPath, "sbom/paddleocr.cdx.json"), {
    bomFormat: "CycloneDX",
    specVersion: CYCLONEDX_VERSION,
    serialNumber: deterministicUuid(inputIdentity),
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": bundleRef,
        name: "pige-paddleocr-bundle",
        version: parserManifest.engineVersion,
        licenses: [{ expression: wheelLock.bundleLicense.spdxId }],
        properties: [{ name: "pige:platform", value: wheelLock.platform }]
      }
    },
    components: components.map((component) => ({
      type: component.type,
      "bom-ref": component.ref,
      name: component.name,
      version: component.version,
      ...(component.purl ? { purl: component.purl } : {}),
      licenses: [{ expression: component.license }],
      hashes: [{ alg: "SHA-256", content: component.sha256 }]
    })),
    dependencies: [
      { ref: bundleRef, dependsOn: components.map((component) => component.ref).sort(compareText) },
      ...components.map((component) => ({
        ref: component.ref,
        dependsOn: component.dependencies.map((name) => `pkg:pypi/${name}@${wheelLock.wheels.find((wheel) => wheel.name === name)?.version}`).sort(compareText)
      }))
    ].sort((left, right) => compareText(left.ref, right.ref))
  }, 0o600);
}

function supplyChainComponents(parserManifest, wheelLock) {
  const legalById = new Map(wheelLock.legal.map((record) => [record.componentId, record]));
  const runtime = parserManifest.pythonRuntime.assets.find((asset) => asset.platform === wheelLock.platform);
  const components = [{
    id: "runtime:cpython",
    type: "framework",
    ref: `pkg:generic/cpython@${parserManifest.pythonRuntime.version}?platform=${wheelLock.platform}`,
    name: "CPython",
    version: parserManifest.pythonRuntime.version,
    sha256: runtime.sha256,
    url: runtime.url,
    dependencies: []
  }, ...wheelLock.wheels.map((wheel) => ({
    id: `wheel:${wheel.name}`,
    type: "library",
    ref: wheel.purl,
    purl: wheel.purl,
    name: wheel.name,
    version: wheel.version,
    sha256: wheel.sha256,
    dependencies: wheel.dependencies
  })), ...parserManifest.models.map((model) => ({
    id: `model:${model.id}`,
    type: "machine-learning-model",
    ref: `pkg:generic/${model.id}@${parserManifest.catalogVersion}`,
    name: model.id,
    version: parserManifest.catalogVersion,
    sha256: model.sha256,
    url: model.url,
    dependencies: []
  })), {
    id: "wrapper:pige",
    type: "application",
    ref: `pkg:generic/pige-paddleocr-wrapper@${parserManifest.catalogVersion}`,
    name: "pige-paddleocr-wrapper",
    version: parserManifest.catalogVersion,
    sha256: wheelLock.wrapper.sha256,
    dependencies: []
  }];
  return components.map((component) => ({
    ...component,
    license: legalById.get(component.id).licenseExpression
  })).sort((left, right) => compareText(left.ref, right.ref));
}

function collectPackageFiles(rootPath, limits) {
  const relativeFiles = collectRelativeRegularFiles(rootPath).filter((entry) => !entry.startsWith(".release-extraction/"));
  if (relativeFiles.length > limits.maxFiles) fail("Release bundle exceeds locked file-count limit.");
  let total = 0;
  return relativeFiles.map((relativePath) => {
    const absolutePath = path.join(rootPath, ...relativePath.split("/"));
    const stats = fs.lstatSync(absolutePath);
    if (stats.size > limits.maxFileBytes) fail(`Release bundle file exceeds locked size: ${relativePath}.`);
    total += stats.size;
    if (total > limits.maxTotalBytes) fail("Release bundle exceeds locked aggregate-size limit.");
    return Object.freeze({
      path: relativePath,
      sizeBytes: stats.size,
      sha256: `sha256:${sha256File(absolutePath)}`,
      executable: wheelExecutable(relativePath, stats.mode)
    });
  });
}

function computePackageSha256(rootPath, manifest) {
  const hash = createHash("sha256");
  hash.update("pige-local-tool-package-v1\0", "utf8");
  const manifestBytes = fs.readFileSync(path.join(rootPath, "manifest.json"));
  updateFramedHash(hash, "manifest.json", manifestBytes);
  for (const file of [...manifest.files].sort((left, right) => left.path.localeCompare(right.path))) {
    updateFramedHash(hash, file.path, fs.readFileSync(path.join(rootPath, ...file.path.split("/"))));
  }
  return `sha256:${hash.digest("hex")}`;
}

function updateFramedHash(hash, relativePath, bytes) {
  hash.update(`entry\0${relativePath}\0${bytes.length}\0`, "utf8");
  hash.update(bytes);
}

function assertWheelMetadata(content, wheel) {
  if (content.includes("\0") || content.length > 4 * 1024 * 1024) fail(`Wheel ${wheel.filename} METADATA is invalid.`);
  const fields = new Map();
  for (const line of content.replaceAll("\r\n", "\n").split("\n")) {
    const match = /^([A-Za-z0-9-]+):\s*(.*)$/u.exec(line);
    if (match && !fields.has(match[1].toLowerCase())) fields.set(match[1].toLowerCase(), match[2]);
  }
  if (normalizePythonName(fields.get("name") ?? "") !== wheel.name || fields.get("version") !== wheel.version) {
    fail(`Wheel ${wheel.filename} METADATA identity is invalid.`);
  }
  const requirements = content.replaceAll("\r\n", "\n").split("\n").flatMap((line) => {
    const match = /^Requires-Dist:\s*([A-Za-z0-9._-]+)(.*)$/u.exec(line);
    return match ? [{ name: normalizePythonName(match[1]), conditional: match[2].includes(";") }] : [];
  });
  const metadataNames = new Set(requirements.map((requirement) => requirement.name));
  for (const dependency of wheel.dependencies) {
    if (!metadataNames.has(dependency)) fail(`Wheel ${wheel.filename} lock contains dependency absent from METADATA: ${dependency}.`);
  }
  for (const requirement of requirements) {
    if (!requirement.conditional && !wheel.dependencies.includes(requirement.name)) {
      fail(`Wheel ${wheel.filename} lock omits unconditional dependency ${requirement.name}.`);
    }
  }
}

export function assertPaddleOcrWheelFilename(filename, name, version, platform) {
  if (!filename.endsWith(".whl")) fail("Selected artifacts must be wheels; sdists and source archives are forbidden.");
  const prefix = `${name.replaceAll("-", "_")}-${version.replaceAll("-", "_")}-`;
  if (!filename.toLocaleLowerCase("en-US").startsWith(prefix.toLocaleLowerCase("en-US"))) {
    fail(`Wheel filename does not match ${name}@${version}.`);
  }
  const tags = filename.slice(prefix.length, -4).split("-");
  if (tags.length < 3 || tags.length > 4) fail(`Wheel ${filename} has invalid compatibility tags.`);
  const [pythonTag, abiTag, platformTag] = tags.slice(-3);
  const pythonTags = pythonTag.split(".");
  const abiTags = abiTag.split(".");
  const pythonCompatible = pythonTags.some((tag) =>
    (tag === "py3" && abiTags.includes("none")) ||
    (tag === "cp313" && abiTags.some((abi) => abi === "cp313" || abi === "abi3" || abi === "none")) ||
    (/^cp(?:3[2-9]|31[0-3])$/u.test(tag) && abiTags.includes("abi3"))
  );
  const platformCompatible = platformTag.split(".").every((tag) => tag === "any" || (platform === "macos-arm64"
    ? /^macosx_[0-9_]+_(?:arm64|universal2)$/u.test(tag)
    : tag === "win_amd64"));
  if (!pythonCompatible || !platformCompatible) fail(`Wheel ${filename} is incompatible with ${platform}.`);
}

function assertConfinedArchiveLink(entryPath, linkPathValue, type, archiveName) {
  if (typeof linkPathValue !== "string" || linkPathValue.length === 0 || linkPathValue.length > 1024 || linkPathValue.includes("\0") || linkPathValue.includes("\\")) {
    fail(`Archive ${archiveName} has an invalid link target.`);
  }
  const base = type === "SymbolicLink" ? path.posix.dirname(entryPath) : ".";
  const resolved = path.posix.normalize(path.posix.join(base, linkPathValue));
  if (path.posix.isAbsolute(linkPathValue) || resolved === ".." || resolved.startsWith("../")) {
    fail(`Archive ${archiveName} link escapes its extraction root.`);
  }
}

function parseLicense(value, label) {
  const record = requireObject(value, label);
  assertExactKeys(record, ["spdxId", "name"], label);
  const spdxId = requireString(record.spdxId, `${label}.spdxId`, 1, 80);
  const name = record.name === undefined ? undefined : requireString(record.name, `${label}.name`, 1, 160);
  return Object.freeze({ spdxId, ...(name ? { name } : {}) });
}

function parseFileIdentity(value, label) {
  const record = requireObject(value, label);
  assertExactKeys(record, ["sizeBytes", "sha256"], label);
  return Object.freeze({
    sizeBytes: requirePositiveSize(record.sizeBytes, `${label}.sizeBytes`),
    sha256: requireSha256(record.sha256, `${label}.sha256`)
  });
}

function verifyFileIdentity(filePath, identity, label) {
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== identity.sizeBytes || sha256File(filePath) !== identity.sha256) {
    fail(`${label} does not match its locked size and SHA-256.`);
  }
}

function copyVerifiedFile(sourcePath, destinationPath, identity, executable) {
  verifyFileIdentity(sourcePath, identity, path.basename(sourcePath));
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
  if (fs.existsSync(destinationPath)) fail(`Release output collision: ${destinationPath}.`);
  fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destinationPath, executable ? 0o700 : 0o600);
}

function copyRegularFile(sourcePath, destinationPath, mode) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
  fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destinationPath, mode & 0o111 ? 0o700 : 0o600);
}

function writeExclusiveFile(filePath, bytes, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, bytes, { flag: "wx", mode });
}

function writeExclusiveJson(filePath, value, mode) {
  writeExclusiveFile(filePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"), mode);
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false, decodeStrings: true, strictFileNames: true, validateEntrySizes: true }, (error, zipfile) => {
      if (error || !zipfile) reject(error ?? new Error("Unable to open wheel archive."));
      else resolve(zipfile);
    });
  });
}

function readZipEntry(archive, entry, maxBytes) {
  return new Promise((resolve, reject) => {
    archive.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error("Unable to read wheel entry."));
        return;
      }
      const chunks = [];
      let length = 0;
      stream.on("data", (chunk) => {
        length += chunk.length;
        if (length > maxBytes) stream.destroy(new Error("Wheel entry exceeds its locked limit."));
        else chunks.push(chunk);
      });
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks, length)));
    });
  });
}

function reserveOutputPath(relativePath, reservedPaths) {
  const folded = relativePath.toLocaleLowerCase("en-US");
  if (reservedPaths.has(folded)) fail(`Release output path collision: ${relativePath}.`);
  reservedPaths.add(folded);
}

function requireSafeArchivePath(value, label) {
  if (typeof value !== "string") fail(`${label} contains a non-text archive path.`);
  let normalized = value;
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  if (!normalized) return value.endsWith("/") ? "./" : fail(`${label} contains an empty archive path.`);
  const safe = requireSafeRelativePath(normalized, `${label} archive path`);
  return value.endsWith("/") ? `${safe}/` : safe;
}

function requireSafeRelativePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 || value.includes("\0") || value.includes("\\") || value.includes("%") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    fail(`${label} is not a safe relative path.`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..") || path.posix.normalize(value) !== value) {
    fail(`${label} contains an unsafe segment.`);
  }
  return value;
}

function requireSafeFilename(value, label) {
  const filename = requireString(value, label, 1, 240);
  if (filename !== path.basename(filename) || filename.includes("\\") || filename.includes("/") || filename.includes("\0") || filename === "." || filename === "..") {
    fail(`${label} is invalid.`);
  }
  return filename;
}

function requireComponentId(value, label) {
  const id = requireString(value, label, 1, 180);
  if (!/^(?:runtime|wrapper|wheel|model):[A-Za-z0-9._-]+$/u.test(id)) fail(`${label} is invalid.`);
  return id;
}

function requireSafeId(value, label) {
  const id = requireString(value, label, 1, 128);
  if (!SAFE_ID_PATTERN.test(id)) fail(`${label} is invalid.`);
  return id;
}

function requirePurl(value, name, version) {
  const purl = requireString(value, "wheel purl", 1, 512);
  const expected = `pkg:pypi/${name}@${version}`;
  if (purl !== expected) fail(`Wheel purl must be ${expected}.`);
  return purl;
}

function requireReviewedUrl(value, label) {
  const text = requireString(value, label, 1, 2048);
  let url;
  try {
    url = new URL(text);
  } catch {
    fail(`${label} is invalid.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) fail(`${label} must be a plain HTTPS URL.`);
  return url.href;
}

function reviewedUrlFilename(value) {
  const url = new URL(value);
  const filename = decodeURIComponent(path.posix.basename(url.pathname));
  return requireSafeFilename(filename, "reviewed URL filename");
}

function requireObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function assertExactKeys(record, allowed, label) {
  const allowedKeys = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) fail(`${label} contains an unsupported field.`);
}

function requireString(value, label, minimum, maximum) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum || value.includes("\0")) fail(`${label} is invalid.`);
  return value;
}

function requireUniqueStrings(value, label, maximum) {
  return requireStringList(value, label, maximum, false);
}

function requireStringList(value, label, maximum, allowEmpty) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maximum) fail(`${label} is invalid.`);
  const strings = value.map((item, index) => requireString(item, `${label}[${index}]`, 1, 160));
  if (new Set(strings).size !== strings.length) fail(`${label} must contain unique values.`);
  return strings;
}

function requireEnum(value, allowed, label) {
  if (typeof value !== "string" || !allowed.includes(value)) fail(`${label} is invalid.`);
  return value;
}

function requireInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${label} is outside its supported range.`);
  return value;
}

function requirePositiveSize(value, label) {
  return requireInteger(value, label, 1, 2 ** 44);
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) fail(`${label} must be an exact lowercase SHA-256.`);
  return value;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${label} is invalid JSON.`);
  }
}

function readBoundedFile(filePath, maximum) {
  const stats = fs.lstatSync(filePath);
  if (stats.size <= 0 || stats.size > maximum) fail(`${path.basename(filePath)} is empty or exceeds its limit.`);
  return fs.readFileSync(filePath);
}

function requireRegularFile(value, label) {
  const filePath = path.resolve(requireString(value, label, 1, 4096));
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(`${label} must be a regular non-symlink file.`);
  return filePath;
}

function requireDirectory(value, label) {
  const directoryPath = path.resolve(requireString(value, label, 1, 4096));
  const stats = fs.lstatSync(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail(`${label} must be a non-symlink directory.`);
  return directoryPath;
}

function requireAbsentOutput(value) {
  const outputPath = path.resolve(requireString(value, "outputPath", 1, 4096));
  if (fs.existsSync(outputPath)) fail("Release bundle output must not already exist.");
  return outputPath;
}

function listFlatRegularFiles(rootPath) {
  return fs.readdirSync(rootPath, { withFileTypes: true }).map((entry) => {
    const stats = fs.lstatSync(path.join(rootPath, entry.name));
    if (!entry.isFile() || stats.isSymbolicLink()) fail(`${path.basename(rootPath)} must contain only regular files.`);
    return entry.name;
  }).sort(compareText);
}

function collectRelativeRegularFiles(rootPath) {
  const files = [];
  const visit = (directoryPath, relativeDirectory) => {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name));
    const folded = new Set();
    for (const entry of entries) {
      const foldedName = entry.name.toLocaleLowerCase("en-US");
      if (folded.has(foldedName)) fail(`Case-colliding paths exist under ${relativeDirectory || "."}.`);
      folded.add(foldedName);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directoryPath, entry.name);
      const stats = fs.lstatSync(absolutePath);
      if (stats.isSymbolicLink()) fail(`Symlink is forbidden in release input/output: ${relativePath}.`);
      if (stats.isDirectory()) visit(absolutePath, relativePath);
      else if (stats.isFile()) files.push(relativePath);
      else fail(`Non-regular release entry is forbidden: ${relativePath}.`);
    }
  };
  visit(rootPath, "");
  return files.sort(compareText);
}

function collectRelativeEntries(rootPath) {
  const entries = [];
  const visit = (directoryPath, relativeDirectory) => {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      entries.push(relativePath);
      if (entry.isDirectory()) visit(path.join(directoryPath, entry.name), relativePath);
    }
  };
  visit(rootPath, "");
  return entries;
}

function resolveWithin(rootPath, relativePath, label) {
  const safePath = requireSafeRelativePath(relativePath, label);
  const root = path.resolve(rootPath);
  const resolved = path.resolve(root, ...safePath.split("/"));
  assertWithinRoot(root, resolved, label);
  return resolved;
}

function assertWithinRoot(rootPath, candidatePath, label) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) fail(`${label} escapes its root.`);
}

function assertExistingPathWithinRoot(rootPath, candidatePath, label) {
  const root = fs.realpathSync(rootPath);
  const candidate = fs.realpathSync(candidatePath);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) fail(`${label} escapes its root.`);
}

function normalizePythonName(value) {
  return value.trim().toLocaleLowerCase("en-US").replace(/[-_.]+/gu, "-");
}

function safeOutputSegment(value) {
  return value.replace(/[^A-Za-z0-9._-]/gu, "_");
}

function isWheelScript(archivePath) {
  return /^[^/]+\.data\/scripts\//u.test(archivePath);
}

function wheelExecutable(relativePath, mode) {
  if (relativePath.startsWith("python/Scripts/") || relativePath.endsWith(".exe") || relativePath.endsWith(".bat") || relativePath.endsWith(".cmd")) return false;
  return (mode & 0o111) !== 0;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function deterministicUuid(hex) {
  const value = hex.slice(0, 32).split("");
  value[12] = "5";
  value[16] = ((Number.parseInt(value[16], 16) & 0x3) | 0x8).toString(16);
  return `urn:uuid:${value.slice(0, 8).join("")}-${value.slice(8, 12).join("")}-${value.slice(12, 16).join("")}-${value.slice(16, 20).join("")}-${value.slice(20).join("")}`;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function fail(message) {
  throw new Error(message);
}

function parseCliOptions(argumentsValue) {
  const options = {};
  for (const argument of argumentsValue) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(argument);
    if (!match || Object.hasOwn(options, match[1])) fail(`Invalid or duplicate release-bundle option: ${argument}.`);
    options[match[1]] = match[2];
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseCliOptions(process.argv.slice(2));
  const required = ["parser-manifest", "wheel-lock", "artifacts", "legal", "wrapper", "output"];
  if (Object.keys(options).some((name) => !required.includes(name)) || required.some((name) => !options[name])) {
    throw new Error(`Usage: node ${path.basename(process.argv[1])} ${required.map((name) => `--${name}=<path>`).join(" ")}`);
  }
  const result = await buildPaddleOcrReleaseBundle({
    parserManifestPath: options["parser-manifest"],
    wheelLockPath: options["wheel-lock"],
    artifactRoot: options.artifacts,
    legalRoot: options.legal,
    wrapperPath: options.wrapper,
    outputPath: options.output
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
