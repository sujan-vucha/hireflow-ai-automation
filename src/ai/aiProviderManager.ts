import { OllamaProvider } from "./ollamaClient.js";
import type { AIProvider } from "./aiClient.types.js";

export type ProviderStatus = {
  provider: AIProvider | null;
  providerUsed: "ollama" | "fallback";
  ollamaAvailable: boolean;
  fallbackAIUsed: boolean;
};

export async function getAIProvider(): Promise<ProviderStatus> {
  const ollama = new OllamaProvider();
  const ollamaAvailable = await ollama.isConfigured();
  if (ollamaAvailable) {
    return {
      provider: ollama,
      providerUsed: "ollama",
      ollamaAvailable: true,
      fallbackAIUsed: false
    };
  }

  return {
    provider: null,
    providerUsed: "fallback",
    ollamaAvailable: false,
    fallbackAIUsed: true
  };
}
