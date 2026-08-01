import { describe, expect, it, vi } from "vitest";
import {
  ProviderApiKeyManagementRequestSchema,
  ProviderApiKeyManagementResultSchema
} from "@pige/schemas";
import { openReviewedProviderApiKeyManagement } from "../../apps/desktop/src/main/services/model-provider-presets";

const request = {
  apiVersion: 1 as const,
  requestId: "providerhelp_abcdefghijklmnop",
  presetId: "openai"
};

describe("provider API key management", () => {
  it("opens only the reviewed preset URL without projecting it", async () => {
    const openExternal = vi.fn(async () => undefined);
    const result = await openReviewedProviderApiKeyManagement(request, openExternal);

    expect(openExternal).toHaveBeenCalledExactlyOnceWith("https://platform.openai.com/api-keys");
    expect(result).toEqual({ ...request, status: "opened" });
    expect(JSON.stringify(result)).not.toContain("https://");
  });

  it("fails closed for unknown, local, and failed external targets", async () => {
    const openExternal = vi.fn(async () => undefined);
    await expect(openReviewedProviderApiKeyManagement(
      { ...request, presetId: "unknown" }, openExternal
    )).resolves.toMatchObject({ status: "unavailable" });
    await expect(openReviewedProviderApiKeyManagement(
      { ...request, presetId: "ollama" }, openExternal
    )).resolves.toMatchObject({ status: "unavailable" });
    expect(openExternal).not.toHaveBeenCalled();

    await expect(openReviewedProviderApiKeyManagement(request, async () => {
      throw new Error("private shell failure");
    })).resolves.toEqual({ ...request, status: "failed" });
  });

  it("keeps the renderer boundary identity-only and body-free", () => {
    expect(ProviderApiKeyManagementRequestSchema.parse(request)).toEqual(request);
    expect(ProviderApiKeyManagementResultSchema.parse({ ...request, status: "opened" }))
      .toEqual({ ...request, status: "opened" });
    expect(() => ProviderApiKeyManagementRequestSchema.parse({
      ...request,
      url: "https://attacker.invalid",
      apiKey: "secret"
    })).toThrow();
    expect(() => ProviderApiKeyManagementResultSchema.parse({
      ...request,
      status: "failed",
      error: "private shell failure"
    })).toThrow();
  });
});
