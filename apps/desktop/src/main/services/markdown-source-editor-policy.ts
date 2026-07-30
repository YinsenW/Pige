import { parsePigeFrontmatter } from "@pige/markdown";

export function isEditableMarkdownPage(markdown: string): boolean {
  const pageType = parsePigeFrontmatter(markdown)?.frontmatter.type;
  return pageType === "note" || pageType === "source";
}

export function preservesEditableMarkdownOwnership(before: string, after: string): boolean {
  const beforeParsed = parsePigeFrontmatter(before);
  const afterParsed = parsePigeFrontmatter(after);
  const beforeFrontmatter = beforeParsed?.frontmatter;
  const afterFrontmatter = afterParsed?.frontmatter;
  if (!beforeFrontmatter || !afterFrontmatter || beforeFrontmatter.type !== afterFrontmatter.type) return false;
  if (beforeFrontmatter.type === "note") return true;
  if (beforeFrontmatter.type !== "source" || afterFrontmatter.type !== "source") return false;
  return beforeParsed.raw === afterParsed.raw;
}
