export function hasObjectErrorCode(value: unknown, code: string): boolean {
  return Boolean(value && typeof value === "object" && "code" in value && value.code === code);
}

export function hasErrorInstanceCode(value: unknown, code: string): boolean {
  return value instanceof Error && "code" in value && value.code === code;
}

export function hasNodeErrnoExceptionCode(value: unknown, code: string): value is NodeJS.ErrnoException {
  return hasErrorInstanceCode(value, code);
}
