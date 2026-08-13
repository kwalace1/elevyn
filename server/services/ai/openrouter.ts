/**
 * OpenRouter provider — OpenAI-compatible chat completions.
 *
 * Co-founder decision for Kevin's 2018 Intel MacBook Air (8GB):
 * Local Ollama is free but too slow for a voice OS. OpenRouter gives Elevyn
 * snappy cloud inference while staying provider-swappable.
 *
 * Default: a small/fast free model (not openrouter/free auto-router, which
 * often picks slow endpoints). Override with OPENROUTER_MODEL.
 */

import type { AICompletionRequest, AICompletionResponse } from '../../../src/types/index.js';
import type { AIProvider } from './provider.js';

const OPENROUTER_BASE =
  process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

/** Fast free default — prefer low-latency small models for spoken replies. */
const DEFAULT_MODEL =
  process.env.OPENROUTER_MODEL ?? 'nvidia/nemotron-nano-9b-v2:free';

const FALLBACK_MODELS = [
  'google/gemma-4-26b-a4b-it:free',
  'openai/gpt-oss-20b:free',
  'inclusionai/ling-3.0-flash:free',
  'openrouter/free',
];

export class OpenRouterProvider implements AIProvider {
  readonly id = 'openrouter';
  readonly displayName = 'OpenRouter';

  constructor(
    private readonly apiKey = process.env.OPENROUTER_API_KEY ?? '',
    private readonly model = DEFAULT_MODEL,
    private readonly baseUrl = OPENROUTER_BASE,
  ) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey.trim());
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    if (!this.apiKey.trim()) {
      throw new Error('OPENROUTER_API_KEY is not set.');
    }

    const started = Date.now();
    const requested = request.model ?? this.model;
    const models = [...new Set([requested, ...FALLBACK_MODELS])];
    const errors: string[] = [];

    for (const model of models) {
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer':
              process.env.OPENROUTER_SITE_URL ?? 'http://localhost:5173',
            'X-Title': process.env.OPENROUTER_APP_NAME ?? 'Elevyn',
          },
          body: JSON.stringify({
            model,
            temperature: request.temperature ?? 0.3,
            // Keep replies short — voice OS doesn't need essays, and tokens = latency.
            max_tokens: request.maxTokens ?? 120,
            messages: request.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
          signal: AbortSignal.timeout(18_000),
        });

        if (!res.ok) {
          const body = await res.text();
          errors.push(`${model}: ${res.status} ${body.slice(0, 180)}`);
          // Authentication / account failures won't improve on another model.
          if (res.status === 401 || res.status === 402 || res.status === 403) {
            break;
          }
          // Rate limit — brief pause then try next model.
          if (res.status === 429) {
            await new Promise((r) => setTimeout(r, 600));
          }
          continue;
        }

        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          model?: string;
        };
        const content = data.choices?.[0]?.message?.content?.trim() ?? '';
        if (!content) {
          errors.push(`${model}: empty response`);
          continue;
        }

        return {
          content,
          provider: this.id,
          model: data.model ?? model,
          latencyMs: Date.now() - started,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${model}: ${message}`);
      }
    }

    throw new Error(`OpenRouter models unavailable: ${errors.join(' | ')}`);
  }
}
