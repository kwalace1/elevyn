import type { AICompletionRequest, AICompletionResponse } from '../../../src/types/index.js';
import type { AIProvider } from './provider.js';
import { OllamaProvider } from './ollama.js';
import { OpenRouterProvider } from './openrouter.js';
import { ClaudeProvider, GeminiProvider, OpenAIProvider } from './stubs.js';

/**
 * AI Provider Registry
 *
 * Preference order (configurable via ELEVYN_AI_PROVIDER):
 * 1. Explicit preferred id
 * 2. OpenRouter when OPENROUTER_API_KEY is set (fast path for low-power Macs)
 * 3. Ollama when local server is up
 * 4. Any other available registered provider
 *
 * Elevyn stays local-first by default. Cloud is opt-in via env — never required.
 */
export class AIProviderRegistry {
  private providers = new Map<string, AIProvider>();
  private preferredId: string;

  constructor(preferredId = 'ollama') {
    this.preferredId = preferredId;
  }

  register(provider: AIProvider): void {
    this.providers.set(provider.id, provider);
  }

  list(): AIProvider[] {
    return [...this.providers.values()];
  }

  get(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  setPreferred(id: string): void {
    if (!this.providers.has(id)) {
      throw new Error(`Unknown AI provider: ${id}`);
    }
    this.preferredId = id;
  }

  /** Resolve the first available provider, preferring the configured default. */
  async resolve(): Promise<AIProvider | null> {
    const preferred = this.providers.get(this.preferredId);
    if (preferred && (await preferred.isAvailable())) {
      return preferred;
    }

    // Sensible fallback for this product: OpenRouter before slow local CPU inference.
    const fallbackOrder = ['openrouter', 'ollama', 'openai', 'claude', 'gemini'];
    for (const id of fallbackOrder) {
      if (id === this.preferredId) continue;
      const provider = this.providers.get(id);
      if (provider && (await provider.isAvailable())) return provider;
    }

    for (const provider of this.providers.values()) {
      if (fallbackOrder.includes(provider.id)) continue;
      if (await provider.isAvailable()) return provider;
    }

    return null;
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const provider = await this.resolve();
    if (!provider) {
      throw new Error(
        'No AI provider available. Set OPENROUTER_API_KEY or start Ollama.',
      );
    }
    return provider.complete(request);
  }
}

export function createDefaultAIRegistry(): AIProviderRegistry {
  const preferred =
    process.env.ELEVYN_AI_PROVIDER ??
    (process.env.OPENROUTER_API_KEY ? 'openrouter' : 'ollama');

  const registry = new AIProviderRegistry(preferred);
  registry.register(new OllamaProvider());
  registry.register(new OpenRouterProvider());
  registry.register(new OpenAIProvider());
  registry.register(new ClaudeProvider());
  registry.register(new GeminiProvider());
  return registry;
}
