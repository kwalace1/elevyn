/**
 * Multi-step agency — turn chained voice requests into runnable plans.
 */

import type { AgentPlan, AgentStep } from '../../types/index.js';

function step(
  label: string,
  partial: Omit<AgentStep, 'label'>,
): AgentStep {
  return { label, ...partial };
}

/**
 * Detect clear multi-step phrasing and return a plan.
 * Returns null when a single intent is enough.
 */
export function matchAgentPlan(utterance: string): {
  plan: AgentPlan;
  reply: string;
} | null {
  const text = utterance.replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();

  // Wrap meeting + draft follow-up.
  if (
    /\b(wrap up|end|finish|summarize|summarise)\b.+\bmeeting\b/i.test(lower) &&
    /\b(draft|follow[- ]?up|email|reply)\b/i.test(lower)
  ) {
    return {
      reply: 'Right away. I will wrap the meeting, then draft a follow-up.',
      plan: {
        title: 'Meeting wrap',
        steps: [
          step('Stop capture', {
            surface: { op: 'stopCapture' },
          }),
          step('Summarize and pull tasks', {
            utterance: 'wrap up the meeting',
          }),
          step('Draft follow-up note', {
            utterance:
              'draft a short follow-up email based on the meeting summary and pin it on screen',
          }),
        ],
      },
    };
  }

  // Summarize / draft + pin (when not already creating a note via summarize alone).
  if (
    /\b(draft|write)\b.+\b(pin|on (?:the )?screen|on (?:the )?board)\b/i.test(
      lower,
    ) ||
    /\b(pin|put)\b.+\b(draft|reply|email|summary)\b/i.test(lower)
  ) {
    const draftBody = text
      .replace(/\b(?:and )?pin(?: it| that| this)?\b/gi, '')
      .replace(/\b(?:on (?:the )?screen|on (?:the )?board)\b/gi, '')
      .trim();
    return {
      reply: 'Of course. Drafting, then pinning it.',
      plan: {
        title: 'Draft and pin',
        steps: [
          step('Enter work mode', { surface: { op: 'work' } }),
          step('Draft', {
            utterance: draftBody || 'draft a short reply based on what is on screen',
          }),
          step('Pin to screen', {
            utterance: 'pin that',
          }),
        ],
      },
    };
  }

  // Plan my afternoon / plan around the meeting.
  if (
    /\bplan (my |the )?(afternoon|morning|day|evening)\b/i.test(lower) ||
    /\bplan (around|for)\b.+\b(call|meeting|demo|interview)\b/i.test(lower)
  ) {
    return {
      reply: 'Certainly. I will sketch a plan from your agenda and tasks.',
      plan: {
        title: 'Day plan',
        steps: [
          step('Work mode', { surface: { op: 'work' } }),
          step('Build the plan', {
            utterance:
              'create a concise afternoon plan note using today\'s agenda and open tasks, titled Day plan',
          }),
          step('Remember the plan', {
            remember: 'Kevin asked for a day plan this session.',
          }),
        ],
      },
    };
  }

  // Generic "X and then Y" / "X, then Y" — only when both sides look actionable.
  const thenSplit = text.split(/\b(?:,?\s*and then|, then| then |,? and also )\b/i);
  if (thenSplit.length >= 2 && thenSplit.length <= 4) {
    const parts = thenSplit.map((p) => p.trim()).filter(Boolean);
    const actionable = parts.every((p) =>
      /\b(make|add|create|set|start|stop|clear|copy|summar|wrap|draft|pin|remember|schedule|open|timer|note|task|list|capture|work mode|go home)\b/i.test(
        p,
      ),
    );
    if (actionable) {
      return {
        reply: `On it. ${parts.length} steps.`,
        plan: {
          title: 'Multi-step',
          steps: parts.map((part, i) =>
            step(part.slice(0, 42) || `Step ${i + 1}`, {
              utterance: part,
            }),
          ),
        },
      };
    }
  }

  // Wrap + copy.
  if (
    /\b(wrap up|end|finish)\b.+\bmeeting\b/i.test(lower) &&
    /\bcopy\b/i.test(lower)
  ) {
    return {
      reply: 'Right away. Wrapping up, then copying the summary.',
      plan: {
        title: 'Wrap and export',
        steps: [
          step('Wrap meeting', { utterance: 'wrap up the meeting' }),
          step('Copy to clipboard', { copy: true }),
        ],
      },
    };
  }

  return null;
}
