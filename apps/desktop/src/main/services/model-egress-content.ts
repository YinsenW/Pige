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
    containsSensitiveUrlParameter(candidate) ||
    /(?:^|[\s{[(,"'])["']?(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?(?!\[redacted-secret\](?:["'\s,}\]]|$))[^\s"',}\]]+/imu.test(candidate) ||
    /(?:file:\/\/\/(?:Users|home|Volumes|private|var|tmp|etc)\/[^\s"'`)}\],]+|(?:^|[^A-Za-z0-9:/])\/(?:Users|home|Volumes|private|var|tmp|etc)\/[^\s"'`)}\],]+)/imu.test(candidate) ||
    /(?:^|[^A-Za-z0-9])[A-Z]:\\(?:Users|Documents and Settings|ProgramData)\\[^\s"'`)}\],]+/imu.test(candidate) ||
    /(?:^|[^A-Za-z0-9])\\\\[^\s\\"'`)}\],]+\\[^\s"'`)}\],]+/u.test(candidate)
  );
}

const SENSITIVE_URL_PARAMETER_KEY_PATTERN = /(?:^|[_-])(?:api[_-]?key|access[_-]?token|auth|authorization|code|credential|key|password|secret|signature|sig|token)(?:$|[_-])/iu;

function containsSensitiveUrlParameter(
  value: string,
  depth = 0,
  seen: Set<string> = new Set()
): boolean {
  if (depth > 3 || value.length > 64 * 1024 || seen.has(value)) return false;
  seen.add(value);
  const candidates = new Set([value]);
  try {
    const decoded = decodeURIComponent(value);
    if (decoded !== value) candidates.add(decoded);
  } catch {
    // Malformed percent encoding is handled by the surrounding restricted-content checks.
  }
  for (const input of candidates) {
    for (const match of input.matchAll(/https?:\/\/[^\s<>"'`]+/giu)) {
      let candidate = match[0];
      while (/[),.;\]}]$/u.test(candidate)) candidate = candidate.slice(0, -1);
      let parsed: URL;
      try {
        parsed = new URL(candidate);
      } catch {
        continue;
      }
      if (parsed.username || parsed.password) return true;
      if (hasSensitiveParameter(parsed.searchParams, depth, seen)) return true;
      if (parsed.hash.length > 1) {
        const fragment = parsed.hash.slice(1);
        const queryStart = fragment.indexOf("?");
        const fragmentQuery = queryStart >= 0 ? fragment.slice(queryStart + 1) : fragment;
        if (hasSensitiveParameter(new URLSearchParams(fragmentQuery), depth, seen)) return true;
      }
    }
  }
  return false;
}

function hasSensitiveParameter(
  parameters: URLSearchParams,
  depth: number,
  seen: Set<string>
): boolean {
  for (const [key, value] of parameters) {
    if (
      (SENSITIVE_URL_PARAMETER_KEY_PATTERN.test(key) || /^awsaccesskeyid$/iu.test(key)) &&
      value.length > 0 &&
      !/^\[redacted(?:-secret)?\]$/iu.test(value)
    ) {
      return true;
    }
    if (depth < 3 && containsSensitiveUrlParameter(value, depth + 1, seen)) return true;
  }
  return false;
}
