/**
 * Stub providers — same interface as Ollama.
 * Tonight they throw until API keys / SDKs are wired. The registry still lists
 * them so the OS surface never hardcodes a single vendor.
 */

import type { AICompletionRequest, AICompletionResponse } from '../../../src/types/index.js';
import type { AIProvider } from './provider.js';

abstract class CloudStubProvider implements AIProvider {
  abstract readonly id: string;
  abstract readonly displayName: string;

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async complete(_request: AICompletionRequest): Promise<AICompletionResponse> {
    throw new Error(
      `${this.displayName} is not configured yet. Set credentials and replace this stub.`,
    );
  }
}

export class OpenAIProvider extends CloudStubProvider {
  readonly id = 'openai';
  readonly displayName = 'OpenAI';
}

export class ClaudeProvider extends CloudStubProvider {
  readonly id = 'claude';
  readonly displayName = 'Claude';
}

export class GeminiProvider extends CloudStubProvider {
  readonly id = 'gemini';
  readonly displayName = 'Gemini';
}
