/**
 * Apply a brain intent's side effects on the glass (surface, clipboard, memory args).
 * Shared by single-shot replies and multi-step agent runners.
 */

import type { InterpretedIntent, SurfaceCommand } from '../../types/index.js';

export interface IntentEffectHooks {
  onSurface?: (cmd: SurfaceCommand) => void;
  setWorkMode?: (on: boolean) => void;
  setCaptureArmed?: (on: boolean) => void;
}

export function applyIntentEffects(
  intent: InterpretedIntent,
  hooks: IntentEffectHooks,
): void {
  if (intent.type === 'surface' && intent.surface) {
    hooks.onSurface?.(intent.surface);
    const op = intent.surface.op;
    if (
      op === 'work' ||
      op === 'createNote' ||
      op === 'createTask' ||
      op === 'createList' ||
      op === 'startCapture' ||
      op === 'appendCapture' ||
      op === 'timer' ||
      op === 'upsertAgent'
    ) {
      hooks.setWorkMode?.(true);
    } else if (op === 'dashboard') {
      hooks.setWorkMode?.(false);
      hooks.setCaptureArmed?.(false);
    }
    if (op === 'startCapture' || op === 'appendCapture') {
      hooks.setCaptureArmed?.(true);
    } else if (op === 'stopCapture' || op === 'clear') {
      hooks.setCaptureArmed?.(false);
    }
  }

  if (intent.args?.stopCapture === true) {
    hooks.onSurface?.({ op: 'stopCapture' });
    hooks.setCaptureArmed?.(false);
  }

  const actionItems = intent.args?.actionItems;
  if (Array.isArray(actionItems)) {
    for (const item of actionItems) {
      if (typeof item === 'string' && item.trim()) {
        hooks.onSurface?.({ op: 'createTask', text: item.trim() });
        hooks.setWorkMode?.(true);
      }
    }
  }
}
