import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("packaged memory release contract", () => {
  it("runs the exact packaged app evidence on macOS arm64 and Windows x64", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/packageability.yml"), "utf8");
    const runner = fs.readFileSync(path.join(root, "scripts/release/packaged-memory-evidence.mjs"), "utf8");
    const main = fs.readFileSync(path.join(root, "apps/desktop/src/main/index.ts"), "utf8");

    expect(packageJson.scripts["evidence:packaged-memory:mac:arm64"])
      .toContain("--platform=mac --arch=arm64");
    expect(packageJson.scripts["evidence:packaged-memory:win:x64"])
      .toContain("--platform=win --arch=x64");
    expect(workflow).toContain("npm run evidence:packaged-memory:mac:arm64");
    expect(workflow).toContain("npm run evidence:packaged-memory:win:x64");
    expect(workflow).toContain("artifacts/test-reports/packaged-memory/macos-arm64/${{ github.sha }}/report.json");
    expect(workflow).toContain("artifacts/test-reports/packaged-memory/windows-x64/${{ github.sha }}/report.json");
    expect(runner).toContain('`--pige-packaged-memory-evidence-report=${appReportPath}`');
    expect(runner).not.toContain("--disable-gpu");
    expect(runner).toContain("timeout: 25 * 60_000");
    expect(runner).toContain("stat.size > 2 * 1024 * 1024");
    expect(runner).toContain("assertGeneratedReportEnvelope");
    expect(main).toContain("createTemporaryEvidenceVaultOnDisk");
    expect(main).toContain("requestIndexRebuild: (options) => getJobsService().requestIndexRebuild(options)");
    expect(main).toContain('Buffer.byteLength(memoryReport, "utf8") > 2 * 1024 * 1024');
  });
});
