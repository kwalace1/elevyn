/**
 * Think-on-glass — long reasoning belongs on the wall; TTS stays one line.
 */

export function wantsThinkOnGlass(utterance: string): boolean {
  const lower = utterance.toLowerCase().trim();
  if (lower.length < 12) return false;

  // Keep operational / brief phrases out of this path.
  if (
    /\b(catch me up|morning brief|prep me|wrap up|email|teams|calendar|what'?s next|am i free|open |remember |schedule )\b/i.test(
      lower,
    )
  ) {
    return false;
  }

  if (
    /\b(explain|walk me through|talk me through|break (this|it|that) down|deep dive|brainstorm)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  if (
    /\b(how (should|would|do|can|might) (we|i|you)|what'?s the best way|help me (think|figure|design|plan|decide)|think (through|about)|pros and cons|compare )\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  if (
    /\b(design|architect|outline)\b.+\b(for|a|an|the|how|approach|system|api|schema|flow)\b/i.test(
      lower,
    ) ||
    /\bdraft (a |an )?(approach|architecture|design|plan|strategy)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  return false;
}

export function defaultThinkSpoken(title?: string): string {
  if (title?.trim()) {
    return `I've put ${title.trim()} on the board.`;
  }
  return "I've put a short write-up on the board.";
}

/** Strip markdown fences / bullets that read poorly on glass. */
export function sanitizeBoardText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '• ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, 1600);
}
