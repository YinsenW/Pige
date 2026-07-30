import { parsePigeFrontmatter } from "@pige/markdown";

export function isEditableMarkdownPage(markdown: string): boolean {
  const pageType = parsePigeFrontmatter(markdown)?.frontmatter.type;
  return pageType === "note" || pageType === "source";
}

export function preservesEditableMarkdownOwnership(before: string, after: string): boolean {
  const beforeFrontmatter = parsePigeFrontmatter(before)?.frontmatter;
  const afterFrontmatter = parsePigeFrontmatter(after)?.frontmatter;
  if (!beforeFrontmatter || !afterFrontmatter || beforeFrontmatter.type !== afterFrontmatter.type) return false;
  if (beforeFrontmatter.type === "note") return true;
  if (beforeFrontmatter.type !== "source" || afterFrontmatter.type !== "source") return false;
  return beforeFrontmatter.id === afterFrontmatter.id &&
    beforeFrontmatter.schema_version === afterFrontmatter.schema_version &&
    beforeFrontmatter.created_at === afterFrontmatter.created_at &&
    beforeFrontmatter.status === afterFrontmatter.status &&
    sameStrings(beforeFrontmatter.source_ids, afterFrontmatter.source_ids);
}

function sameStrings(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}
