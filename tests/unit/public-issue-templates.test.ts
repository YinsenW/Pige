import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateIssueForm,
  validateIssueTemplateConfig,
  validateIssueTemplateDirectory,
  validateSecuritySurface,
  validateSupportSurface,
} from "../../scripts/verify/public-issue-templates.mjs";

describe("public issue template governance", () => {
  it("validates every committed public issue template", async () => {
    const files = await validateIssueTemplateDirectory();
    expect(files).toEqual([
      "bug_report.yml",
      "config.yml",
      "design_review.yml",
      "feature_request.yml",
      "security_contact_request.yml",
    ]);
  });

  it("rejects duplicate form ids and unsafe contact links", () => {
    const invalidForm = `
name: Bug
description: Report a bug
body:
  - type: input
    id: duplicate
    attributes: { label: First }
  - type: textarea
    id: duplicate
    attributes: { label: Second }
`;
    expect(() => validateIssueForm(invalidForm)).toThrow("repeats id duplicate");

    const invalidConfig = `
blank_issues_enabled: false
contact_links:
  - name: Security
    url: http://example.com
    about: Private reporting
`;
    expect(() => validateIssueTemplateConfig(invalidConfig)).toThrow("must use https");
  });

  it("fails when a newly added template is malformed", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pige-issue-templates-"));
    await writeFile(
      path.join(directory, "config.yml"),
      "blank_issues_enabled: false\ncontact_links:\n  - name: Security\n    url: https://example.com\n    about: Private reporting\n",
    );
    await writeFile(path.join(directory, "broken.yml"), "name: Broken\ndescription: Missing body\n");
    await expect(validateIssueTemplateDirectory(directory)).rejects.toThrow("body must be a non-empty array");
  });

  it("verifies the public support and maintainer-triage boundary", async () => {
    await expect(validateSupportSurface()).resolves.toBeUndefined();
  });

  it("fails closed when public bug safety or maintainer triage drifts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pige-support-surface-"));
    const directory = path.join(root, "templates");
    await cp(path.resolve(".github/ISSUE_TEMPLATE"), directory, { recursive: true });
    const supportPath = path.join(root, "SUPPORT.md");
    await writeFile(supportPath, await readFile(path.resolve("SUPPORT.md"), "utf8"));

    const bugPath = path.join(directory, "bug_report.yml");
    const bug = (await readFile(bugPath, "utf8")).replace("This is not a security vulnerability report.\n          required: true", "This is not a security vulnerability report.\n          required: false");
    await writeFile(bugPath, bug);
    await expect(validateSupportSurface({ directory, supportPath })).rejects.toThrow("safety options must be required");

    await cp(path.resolve(".github/ISSUE_TEMPLATE/bug_report.yml"), bugPath);
    const support = (await readFile(supportPath, "utf8")).replace("## Maintainer Triage", "## Triage");
    await writeFile(supportPath, support);
    await expect(validateSupportSurface({ directory, supportPath })).rejects.toThrow("missing ## Maintainer Triage");
  });

  it("verifies the public security disclosure boundary", async () => {
    await expect(validateSecuritySurface()).resolves.toBeUndefined();
  });

  it("fails closed when private reporting or maintainer disclosure drifts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pige-security-surface-"));
    const directory = path.join(root, "templates");
    await cp(path.resolve(".github/ISSUE_TEMPLATE"), directory, { recursive: true });
    const securityPath = path.join(root, "SECURITY.md");
    const security = (await readFile(path.resolve("SECURITY.md"), "utf8")).replace(
      "## Maintainer Handling",
      "## Handling",
    );
    await writeFile(securityPath, security);
    await expect(validateSecuritySurface({ directory, securityPath })).rejects.toThrow("missing ## Maintainer Handling");

    await writeFile(securityPath, await readFile(path.resolve("SECURITY.md"), "utf8"));
    const configPath = path.join(directory, "config.yml");
    const config = (await readFile(configPath, "utf8")).replace("/security/advisories/new", "/issues/new");
    await writeFile(configPath, config);
    await expect(validateSecuritySurface({ directory, securityPath })).rejects.toThrow(
      "must expose private vulnerability reporting",
    );
  });
});
