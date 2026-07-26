export function hasObjectErrorCode(value: unknown, code: string): boolean {
  return Boolean(value && typeof value === "object" && "code" in value && value.code === code);
}
