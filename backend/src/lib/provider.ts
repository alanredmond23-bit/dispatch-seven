// provider.ts — maps provider names to client configs used by ws.ts streaming
// Added: multi-provider support to replace LiteLLM proxy (port 8082)
// Supports: Anthropic (native SSE path), OpenAI, Groq, Ollama (all via OpenAI-compatible API)

export type Provider = 'anthropic' | 'openai' | 'groq' | 'ollama';

export interface ProviderConfig {
  type: 'anthropic' | 'openai'; // determines which SDK path ws.ts uses
  model: string;
  apiKey: string;
  baseURL?: string;              // undefined = SDK default; set for Groq/Ollama/custom
}

export function getProviderClient(provider: Provider, model: string): ProviderConfig {
  switch (provider) {
    case 'anthropic':
      return {
        type: 'anthropic',
        model,
        apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      };
    case 'openai':
      return {
        type: 'openai',
        model,
        apiKey: process.env.OPENAI_API_KEY ?? '',
        baseURL: process.env.OPENAI_BASE_URL || undefined,
      };
    case 'groq':
      return {
        type: 'openai',
        model,
        apiKey: process.env.GROQ_API_KEY ?? '',
        baseURL: 'https://api.groq.com/openai/v1',
      };
    case 'ollama':
      return {
        type: 'openai',
        model,
        apiKey: 'ollama', // Ollama ignores API key; required field for OpenAI SDK
        baseURL: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
      };
    default: {
      // Exhaustiveness check — TS will error here if a Provider variant is unhandled
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}
