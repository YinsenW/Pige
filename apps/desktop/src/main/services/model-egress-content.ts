export function containsRestrictedModelContent(value: string): boolean {
  const candidates = [value];
  for (let depth = 0; depth < 3; depth += 1) {
    const previous = candidates.at(-1) ?? value;
    const normalized = previous.replace(/\\(["'\\])/gu, "$1");
    if (normalized === previous) break;
    candidates.push(normalized);
  }
  return candidates.some((candidate) =>
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(candidate) ||
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/iu.test(candidate) ||
    /\bAKIA[A-Z0-9]{16}\b/u.test(candidate) ||
    /\b(?:sk-ant-|sk-)[A-Za-z0-9_-]{12,}\b/u.test(candidate) ||
    /(?:^|[\s{[(,"'])["']?(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?(?!\[redacted-secret\](?:["'\s,}\]]|$))[^\s"',}\]]+/imu.test(candidate) ||
    /(?:file:\/\/\/(?:Users|home|Volumes|private|var|tmp|etc)\/[^\s"'`)}\],]+|(?:^|[^A-Za-z0-9:/])\/(?:Users|home|Volumes|private|var|tmp|etc)\/[^\s"'`)}\],]+)/imu.test(candidate) ||
    /(?:^|[^A-Za-z0-9])[A-Z]:\\(?:Users|Documents and Settings|ProgramData)\\[^\s"'`)}\],]+/imu.test(candidate) ||
    /(?:^|[^A-Za-z0-9])\\\\[^\s\\"'`)}\],]+\\[^\s"'`)}\],]+/u.test(candidate)
  );
}
