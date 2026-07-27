import fs from "node:fs";
import path from "node:path";

const TARGETS = Object.freeze({
  "macos-arm64": Object.freeze({
    llamaPackage: "@node-llama-cpp/mac-arm64-metal",
    sqlitePackage: "sqlite-vec-darwin-arm64",
    embeddingBackend: "metal",
    nativeFiles: Object.freeze([
      "node_modules/@node-llama-cpp/mac-arm64-metal/bins/mac-arm64-metal/llama-addon.node",
      "node_modules/@node-llama-cpp/mac-arm64-metal/bins/mac-arm64-metal/libllama.metal.b8390.dylib",
      "node_modules/sqlite-vec-darwin-arm64/vec0.dylib"
    ])
  }),
  "macos-x64": Object.freeze({
    llamaPackage: "@node-llama-cpp/mac-x64",
    sqlitePackage: "sqlite-vec-darwin-x64",
    embeddingBackend: "cpu",
    nativeFiles: Object.freeze([
      "node_modules/@node-llama-cpp/mac-x64/bins/mac-x64/llama-addon.node",
      "node_modules/sqlite-vec-darwin-x64/vec0.dylib"
    ])
  }),
  "windows-x64": Object.freeze({
    llamaPackage: "@node-llama-cpp/win-x64",
    sqlitePackage: "sqlite-vec-windows-x64",
    embeddingBackend: "cpu",
    nativeFiles: Object.freeze([
      "node_modules/@node-llama-cpp/win-x64/bins/win-x64/llama-addon.node",
      "node_modules/sqlite-vec-windows-x64/vec0.dll"
    ])
  })
});

const LLAMA_PACKAGES = Object.freeze([
  "@node-llama-cpp/linux-arm64",
  "@node-llama-cpp/linux-armv7l",
  "@node-llama-cpp/linux-x64",
  "@node-llama-cpp/linux-x64-cuda",
  "@node-llama-cpp/linux-x64-cuda-ext",
  "@node-llama-cpp/linux-x64-vulkan",
  "@node-llama-cpp/mac-arm64-metal",
  "@node-llama-cpp/mac-x64",
  "@node-llama-cpp/win-arm64",
  "@node-llama-cpp/win-x64",
  "@node-llama-cpp/win-x64-cuda",
  "@node-llama-cpp/win-x64-cuda-ext",
  "@node-llama-cpp/win-x64-vulkan"
]);

const SQLITE_PACKAGES = Object.freeze([
  "sqlite-vec-darwin-arm64",
  "sqlite-vec-darwin-x64",
  "sqlite-vec-linux-arm64",
  "sqlite-vec-linux-x64",
  "sqlite-vec-windows-x64"
]);

export function nativeSemanticRuntimeTarget(platform, arch) {
  const target = TARGETS[`${platform}-${arch}`];
  if (!target) throw new Error(`No reviewed native semantic runtime exists for ${platform}-${arch}.`);
  return target;
}

export function pruneNativeSemanticRuntimePackages(root, platform, arch) {
  const target = nativeSemanticRuntimeTarget(platform, arch);
  for (const packageName of [...LLAMA_PACKAGES, ...SQLITE_PACKAGES]) {
    if (packageName === target.llamaPackage || packageName === target.sqlitePackage) continue;
    fs.rmSync(packageRoot(root, packageName), { recursive: true, force: true });
  }
  for (const packageName of [target.llamaPackage, target.sqlitePackage]) {
    if (!fs.existsSync(path.join(packageRoot(root, packageName), "package.json"))) {
      throw new Error(`The reviewed native semantic package is missing: ${packageName}.`);
    }
  }
  return target;
}

export function isAllowedNativeSemanticOptionalPackage(packageName, platform, arch) {
  const target = nativeSemanticRuntimeTarget(platform, arch);
  if (LLAMA_PACKAGES.includes(packageName)) return packageName === target.llamaPackage;
  if (SQLITE_PACKAGES.includes(packageName)) return packageName === target.sqlitePackage;
  return true;
}

export function allNativeSemanticPackageNames() {
  return [...LLAMA_PACKAGES, ...SQLITE_PACKAGES];
}

function packageRoot(root, packageName) {
  return path.join(root, "node_modules", ...packageName.split("/"));
}
