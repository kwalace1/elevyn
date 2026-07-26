import type { AICompletionRequest, AICompletionResponse } from '../../../src/types/index.js';
import type { AIProvider } from './provider.js';

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2';

/**
 * Local-first default provider. Talks to Ollama's OpenAI-compatible chat API.
 */
export class OllamaProvider implements AIProvider {
  readonly id = 'ollama';
  readonly displayName = 'Ollama';

  constructor(
    private readonly baseUrl = OLLAMA_BASE,
    private readonly model = DEFAULT_MODEL,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(1500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const started = Date.now();
    const model = request.model ?? this.model;

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        options: {
          temperature: request.temperature ?? 0.4,
        },
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as {
      message?: { content?: string };
      model?: string;
    };

    return {
      content: data.message?.content?.trim() ?? '',
      provider: this.id,
      model: data.model ?? model,
      latencyMs: Date.now() - started,
    };
  }
}
