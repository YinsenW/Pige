import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateIssueForm,
  validateIssueTemplateConfig,
  validateIssueTemplateDirectory,
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
});
