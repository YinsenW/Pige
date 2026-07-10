import { PigeDomainError } from "@pige/domain";
import { ProviderBaseUrlSchema } from "@pige/schemas";

const DEFAULT_ERROR_CODE = "model_provider.base_url_invalid";

export function normalizeProviderBaseUrl(value: string): string {
  const parsed = ProviderBaseUrlSchema.safeParse(value);
  if (parsed.success) return parsed.data;

  const issue = parsed.error.issues[0];
  const params = issue && "params" in issue && typeof issue.params === "object" && issue.params !== null
    ? issue.params as Record<string, unknown>
    : undefined;
  const code = typeof params?.pigeErrorCode === "string"
    ? params.pigeErrorCode
    : issue?.code === "too_small"
      ? "model_provider.base_url_empty"
      : DEFAULT_ERROR_CODE;
  throw new PigeDomainError(code, issue?.message ?? "Provider base URL must be valid and safe.");
}
