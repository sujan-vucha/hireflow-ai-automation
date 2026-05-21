import { Ollama } from "ollama";
import type { AIProvider } from "./aiClient.types.js";
import { parseJsonWithRepair } from "./jsonRepair.js";

export class OllamaProvider implements AIProvider {
  providerName = "ollama";
  private host = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  private model = process.env.OLLAMA_MODEL || "qwen3:8b";

  async isConfigured(): Promise<boolean> {
    try {
      const response = await fetch(`${this.host.replace(/\/+$/, "")}/api/tags`, { signal: AbortSignal.timeout(2500) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async generateJson<T>(prompt: string, options?: { temperature?: number; maxTokens?: number }): Promise<T> {
    const client = new Ollama({ host: this.host });
    const response = await client.generate({
      model: this.model,
      prompt,
      format: "json",
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.1,
        num_predict: options?.maxTokens ?? 1400
      }
    });

    return parseJsonWithRepair<T>(response.response || "");
  }
}
