/**
 * AI Provider Interface
 *
 * Architecture decision: Elevyn never talks to a vendor SDK directly from UI or
 * command handlers. Every model backend implements AIProvider so we can swap
 * Ollama → OpenAI → Claude → Gemini without rewriting the OS.
 */

import type { AICompletionRequest, AICompletionResponse } from '../../../src/types/index.js';

export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  isAvailable(): Promise<boolean>;
  complete(request: AICompletionRequest): Promise<AICompletionResponse>;
}
