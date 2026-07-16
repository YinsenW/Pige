import {
  createModels,
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Api,
  type AuthContext,
  type Credential,
  type CredentialStore,
  type Model,
  type ProviderStreams
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { PigeDomainError } from "@pige/domain";
import { resolveModelCapabilities } from "./model-capability-registry";
import type { ModelProviderRuntimeConfig } from "./model-provider-registry";
import { normalizeProviderBaseUrl } from "./provider-base-url";

export type PiFauxResponse =
  | {
      readonly kind: "tool_call";
      readonly toolName: string;
      readonly args: Readonly<Record<string, unknown>>;
      readonly toolCallId?: unknown;
    }
  | {
      readonly kind: "tool_calls";
      readonly calls: readonly {
        readonly toolName: string;
        readonly args: Readonly<Record<string, unknown>>;
        readonly toolCallId?: unknown;
      }[];
    }
  | {
      readonly kind: "text";
      readonly text: string;
    };

export interface ScopedPiBinding {
  readonly mode: "provider" | "faux";
  readonly model: Model<Api>;
  readonly streamSimple: StreamFn;
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const KEYLESS_PROVIDER_TRANSPORT_SENTINEL = "pige-keyless-provider";

const denyAmbientAuthContext: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false
};

export function createPiBinding(
  config: ModelProviderRuntimeConfig,
  fauxResponses?: readonly PiFauxResponse[]
): ScopedPiBinding {
  return fauxResponses ? createFauxBinding(config, fauxResponses) : createProviderBinding(config);
}

function createProviderBinding(config: ModelProviderRuntimeConfig): ScopedPiBinding {
  const api = toPiApi(config.provider.endpointProtocol);
  const baseUrl = resolveProviderBaseUrl(config);
  const providerId = `pige:${config.provider.id}`;
  const keyless = config.apiKey === undefined && config.provider.authRequirement !== "api_key";
  const model = resolveModelCapabilities({ config, api, providerId, baseUrl }).model;
  const credentials = new ScopedCredentialStore(providerId, config.apiKey);
  const models = createModels({ credentials, authContext: denyAmbientAuthContext });
  models.setProvider(createProvider({
    id: providerId,
    name: config.provider.displayName,
    baseUrl,
    auth: config.apiKey ? {
        apiKey: {
          name: "Pige brokered provider credential",
          resolve: async ({ credential }) => credential?.key
            ? { auth: { apiKey: credential.key }, source: "pige_credential_store" }
            : undefined
        }
      } : keyless ? {
        apiKey: {
          name: "Pige keyless provider",
          resolve: async () => ({
            auth: {
              apiKey: KEYLESS_PROVIDER_TRANSPORT_SENTINEL,
              headers: { Authorization: null, "x-api-key": null }
            },
            source: "pige_keyless_provider"
          })
        }
      } : {},
    models: [model],
    api: providerStreams(config.provider.endpointProtocol)
  }));
  const selected = models.getModel(providerId, config.model.modelId);
  if (!selected) {
    throw new PigeDomainError("model_provider.model_not_found", "The selected model is unavailable in the scoped Pi runtime.");
  }
  return {
    mode: "provider",
    model: selected,
    streamSimple: (selectedModel, context, options) => models.streamSimple(selectedModel, context, options)
  };
}

function resolveProviderBaseUrl(config: ModelProviderRuntimeConfig): string {
  if (config.provider.baseUrl) return normalizeProviderBaseUrl(config.provider.baseUrl);
  if (config.provider.providerKind === "openai" || config.provider.providerKind === "anthropic") {
    return defaultBaseUrl(config.provider.endpointProtocol);
  }
  throw new PigeDomainError(
    "model_provider.base_url_missing",
    "Compatible and custom providers require an explicit endpoint."
  );
}

function toPiApi(endpointProtocol: ModelProviderRuntimeConfig["provider"]["endpointProtocol"]): Api {
  switch (endpointProtocol) {
    case "openai_responses":
      return "openai-responses";
    case "openai_chat_completions":
      return "openai-completions";
    case "anthropic_messages":
      return "anthropic-messages";
    default:
      throw unsupportedEndpointProtocolError();
  }
}

function defaultBaseUrl(
  endpointProtocol: ModelProviderRuntimeConfig["provider"]["endpointProtocol"]
): string {
  return endpointProtocol === "anthropic_messages"
    ? DEFAULT_ANTHROPIC_BASE_URL
    : DEFAULT_OPENAI_BASE_URL;
}

function providerStreams(
  endpointProtocol: ModelProviderRuntimeConfig["provider"]["endpointProtocol"]
): ProviderStreams {
  switch (endpointProtocol) {
    case "openai_responses":
      return openAIResponsesApi();
    case "openai_chat_completions":
      return openAICompletionsApi();
    case "anthropic_messages":
      return anthropicMessagesApi();
    default:
      throw unsupportedEndpointProtocolError();
  }
}

function unsupportedEndpointProtocolError(): PigeDomainError {
  return new PigeDomainError(
    "model_provider.protocol_unsupported",
    "The selected provider endpoint protocol is unavailable."
  );
}

function createFauxBinding(
  config: ModelProviderRuntimeConfig,
  responses: readonly PiFauxResponse[]
): ScopedPiBinding {
  const providerId = `pige-faux:${config.provider.id}`;
  const faux = fauxProvider({
    provider: providerId,
    models: [{ id: config.model.modelId, name: config.model.displayName ?? config.model.modelId }]
  });
  faux.setResponses(responses.map((response, index) => {
    if (response.kind === "text") return fauxAssistantMessage(fauxText(response.text));
    if (response.kind === "tool_calls") {
      return fauxAssistantMessage(response.calls.map((call, callIndex) => {
        const generated = fauxToolCall(call.toolName, call.args, {
          id: `pi_tool_${index + 1}_${callIndex + 1}`
        });
        return Object.prototype.hasOwnProperty.call(call, "toolCallId")
          ? { ...generated, id: call.toolCallId } as typeof generated
          : generated;
      }), { stopReason: "toolUse" });
    }
    const generatedCall = fauxToolCall(response.toolName, response.args, {
      id: `pi_tool_${index + 1}`
    });
    const toolCall = Object.prototype.hasOwnProperty.call(response, "toolCallId")
      ? { ...generatedCall, id: response.toolCallId } as typeof generatedCall
      : generatedCall;
    return fauxAssistantMessage(toolCall, { stopReason: "toolUse" });
  }));
  const models = createModels({ authContext: denyAmbientAuthContext });
  models.setProvider(faux.provider);
  const selected = models.getModel(providerId, config.model.modelId);
  if (!selected) {
    throw new PigeDomainError("model_provider.model_not_found", "The selected faux model is unavailable in the scoped Pi runtime.");
  }
  return {
    mode: "faux",
    model: selected,
    streamSimple: (selectedModel, context, options) => models.streamSimple(selectedModel, context, options)
  };
}

class ScopedCredentialStore implements CredentialStore {
  readonly #providerId: string;
  readonly #credential: Credential | undefined;

  constructor(providerId: string, apiKey: string | undefined) {
    this.#providerId = providerId;
    this.#credential = apiKey ? { type: "api_key", key: apiKey } : undefined;
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return providerId === this.#providerId ? this.#credential : undefined;
  }

  async modify(
    _providerId: string,
    _fn: (current: Credential | undefined) => Promise<Credential | undefined>
  ): Promise<Credential | undefined> {
    throw new PigeDomainError("model_provider.credential_mutation_forbidden", "The scoped Pi runtime cannot mutate provider credentials.");
  }

  async delete(): Promise<void> {
    throw new PigeDomainError("model_provider.credential_mutation_forbidden", "The scoped Pi runtime cannot mutate provider credentials.");
  }
}
