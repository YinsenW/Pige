import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const issueTemplateRoot = path.join(root, ".github", "ISSUE_TEMPLATE");
const FORM_TYPES = new Set(["input", "textarea", "dropdown", "checkboxes", "markdown"]);
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function assert(condition, message) {
  if (!condition) throw new Error(`public-issue-templates: ${message}`);
}

function assertRecord(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function assertNonEmptyString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`);
}

function assertOptionalString(value, label) {
  if (value !== undefined) assert(typeof value === "string", `${label} must be a string`);
}

function parseYaml(source, fileName) {
  const document = parseDocument(source, { prettyErrors: true, strict: true, uniqueKeys: true });
  assert(document.errors.length === 0, `${fileName} is invalid YAML: ${document.errors[0]?.message ?? "unknown error"}`);
  return document.toJS({ maxAliasCount: 0 });
}

export function validateIssueForm(source, fileName = "issue-form.yml") {
  const form = assertRecord(parseYaml(source, fileName), fileName);
  assertNonEmptyString(form.name, `${fileName}.name`);
  assertNonEmptyString(form.description, `${fileName}.description`);
  assertOptionalString(form.title, `${fileName}.title`);
  for (const key of ["labels", "assignees"]) {
    if (form[key] === undefined) continue;
    assert(Array.isArray(form[key]), `${fileName}.${key} must be an array`);
    form[key].forEach((value, index) => assertNonEmptyString(value, `${fileName}.${key}[${index}]`));
  }
  assert(Array.isArray(form.body) && form.body.length > 0, `${fileName}.body must be a non-empty array`);

  const ids = new Set();
  form.body.forEach((rawItem, index) => {
    const label = `${fileName}.body[${index}]`;
    const item = assertRecord(rawItem, label);
    assert(FORM_TYPES.has(item.type), `${label}.type is unsupported`);
    const attributes = assertRecord(item.attributes, `${label}.attributes`);

    if (item.type === "markdown") {
      assert(item.id === undefined, `${label}.id is not allowed for markdown`);
      assertNonEmptyString(attributes.value, `${label}.attributes.value`);
      return;
    }

    assertNonEmptyString(item.id, `${label}.id`);
    assert(ID_PATTERN.test(item.id), `${label}.id has invalid characters`);
    assert(!ids.has(item.id), `${fileName} repeats id ${item.id}`);
    ids.add(item.id);
    assertNonEmptyString(attributes.label, `${label}.attributes.label`);
    assertOptionalString(attributes.description, `${label}.attributes.description`);

    if (item.type === "dropdown") {
      assert(Array.isArray(attributes.options) && attributes.options.length > 0, `${label}.attributes.options must be non-empty`);
      attributes.options.forEach((value, optionIndex) =>
        assertNonEmptyString(value, `${label}.attributes.options[${optionIndex}]`),
      );
      if (attributes.multiple !== undefined) {
        assert(typeof attributes.multiple === "boolean", `${label}.attributes.multiple must be boolean`);
      }
    }

    if (item.type === "checkboxes") {
      assert(Array.isArray(attributes.options) && attributes.options.length > 0, `${label}.attributes.options must be non-empty`);
      attributes.options.forEach((rawOption, optionIndex) => {
        const option = assertRecord(rawOption, `${label}.attributes.options[${optionIndex}]`);
        assertNonEmptyString(option.label, `${label}.attributes.options[${optionIndex}].label`);
        if (option.required !== undefined) {
          assert(typeof option.required === "boolean", `${label}.attributes.options[${optionIndex}].required must be boolean`);
        }
      });
    }

    if (item.validations !== undefined) {
      const validations = assertRecord(item.validations, `${label}.validations`);
      if (validations.required !== undefined) {
        assert(typeof validations.required === "boolean", `${label}.validations.required must be boolean`);
      }
    }
  });
}

export function validateIssueTemplateConfig(source, fileName = "config.yml") {
  const config = assertRecord(parseYaml(source, fileName), fileName);
  assert(typeof config.blank_issues_enabled === "boolean", `${fileName}.blank_issues_enabled must be boolean`);
  assert(Array.isArray(config.contact_links) && config.contact_links.length > 0, `${fileName}.contact_links must be non-empty`);
  const names = new Set();
  config.contact_links.forEach((rawLink, index) => {
    const label = `${fileName}.contact_links[${index}]`;
    const link = assertRecord(rawLink, label);
    assertNonEmptyString(link.name, `${label}.name`);
    assert(!names.has(link.name), `${fileName} repeats contact link ${link.name}`);
    names.add(link.name);
    assertNonEmptyString(link.about, `${label}.about`);
    assertNonEmptyString(link.url, `${label}.url`);
    const url = new URL(link.url);
    assert(url.protocol === "https:", `${label}.url must use https`);
  });
}

export async function validateIssueTemplateDirectory(directory = issueTemplateRoot) {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml")).sort();
  assert(files.includes("config.yml"), "config.yml is required");
  assert(files.length > 1, "at least one public issue form is required");
  for (const fileName of files) {
    const source = await readFile(path.join(directory, fileName), "utf8");
    if (fileName === "config.yml") validateIssueTemplateConfig(source, fileName);
    else validateIssueForm(source, fileName);
  }
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = await validateIssueTemplateDirectory();
  console.log(`public issue template verification passed (${files.length} files)`);
}
