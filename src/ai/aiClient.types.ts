export interface AIProvider {
  providerName: string;
  isConfigured(): Promise<boolean>;
  generateJson<T>(
    prompt: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<T>;
}
